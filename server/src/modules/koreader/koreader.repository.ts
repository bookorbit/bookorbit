import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, notExists, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { chunk } from '../../common/utils/batch.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type ResolvedBookFileByHash = { id: number; bookId: number; libraryId: number; format: string | null };
type ResolvedBookFileByHashes = { bookFileId: number; bookId: number; libraryId: number; format: string | null };
type KoreaderUnmatchedSource = 'current_file' | 'file' | 'statistics';
type KoreaderUnmatchedCandidate = {
  hash: string;
  title?: string | null;
  authors?: string | null;
  lastOpen?: number | null;
  source?: KoreaderUnmatchedSource;
  metadataAmbiguous?: boolean;
};
type KoreaderHashLinkMetadata = {
  title?: string | null;
  authors?: string | null;
  lastOpen?: number | null;
};

type HashedResolvedBookFile = ResolvedBookFileByHashes & { hash: string | null };

function resolveUniqueBook<T extends { bookId: number }>(rows: T[]): T | null {
  const first = rows[0];
  if (!first) return null;
  return rows.every((row) => row.bookId === first.bookId) ? first : null;
}

function addUnambiguousHashMatches(rows: HashedResolvedBookFile[], result: Map<string, ResolvedBookFileByHashes>): Set<string> {
  const rowsByHash = new Map<string, HashedResolvedBookFile[]>();

  for (const row of rows) {
    if (!row.hash) continue;
    const matches = rowsByHash.get(row.hash);
    if (matches) matches.push(row);
    else rowsByHash.set(row.hash, [row]);
  }

  for (const [hash, matches] of rowsByHash) {
    const resolved = resolveUniqueBook(matches);
    if (resolved) {
      result.set(hash, {
        bookFileId: resolved.bookFileId,
        bookId: resolved.bookId,
        libraryId: resolved.libraryId,
        format: resolved.format,
      });
    }
  }

  return new Set(rowsByHash.keys());
}

export interface ReadingProgressUpsert {
  bookFileId: number;
  userId: number;
  percentage: number;
  /** Reflowable position converted from the device xpointer; null for paged formats or a failed conversion. */
  cfi?: string | null;
  /** The device position string verbatim, so the next pull hands KOReader back what it sent. */
  xpointer?: string | null;
  /** 1-based page for paged formats; null for reflowable and audio. */
  pageNumber?: number | null;
}

export interface DeviceProgressUpsert {
  bookFileId: number;
  userId: number;
  device: string;
  deviceId: string;
  percentage: number;
  progress: string | null;
  chapterIndex: number | null;
  syncTimestamp: number | null;
}

const BATCH_QUERY_SIZE = 200;

@Injectable()
export class KoreaderRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findKoreaderUser(userId: number) {
    return this.db.query.koreaderUsers.findFirst({
      where: eq(schema.koreaderUsers.userId, userId),
    });
  }

  async findKoreaderUserByUsername(username: string) {
    return this.db.query.koreaderUsers.findFirst({
      where: eq(schema.koreaderUsers.username, username),
    });
  }

  async createKoreaderUser(data: { userId: number; username: string; passwordHash: string; passwordMd5: string }) {
    const [row] = await this.db.insert(schema.koreaderUsers).values(data).returning();
    return row!;
  }

  async updateKoreaderUser(userId: number, data: Partial<{ username: string; passwordHash: string; passwordMd5: string; syncEnabled: boolean }>) {
    await this.db.update(schema.koreaderUsers).set(data).where(eq(schema.koreaderUsers.userId, userId));
  }

  async deleteKoreaderUser(userId: number) {
    await this.db.delete(schema.koreaderUsers).where(eq(schema.koreaderUsers.userId, userId));
  }

  // KOReader's partial hash can collide for different files. Multiple matching files are safe only
  // when they belong to the same book; otherwise a user-scoped manual link must disambiguate them.
  async resolveBookFileByHash(hash: string, accessibleLibraryIds: number[] | null, userId?: number): Promise<ResolvedBookFileByHash | null> {
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return null;

    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;

    const byFileHash = await this.db
      .selectDistinctOn([schema.bookFiles.bookId], {
        id: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        libraryId: schema.books.libraryId,
        format: schema.bookFiles.format,
      })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.bookFiles.fileHash, hash), libraryFilter))
      .orderBy(asc(schema.bookFiles.bookId), asc(schema.bookFiles.id))
      .limit(2);

    if (byFileHash.length > 0) {
      return resolveUniqueBook(byFileHash) ?? (userId === undefined ? null : this.resolveManualBookFileByHash(hash, accessibleLibraryIds, userId));
    }

    const byFileHashHistory = await this.db
      .selectDistinctOn([schema.bookFiles.bookId], {
        id: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        libraryId: schema.books.libraryId,
        format: schema.bookFiles.format,
      })
      .from(schema.bookFileHashHistory)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.bookFileHashHistory.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.bookFileHashHistory.fileHash, hash), libraryFilter))
      .orderBy(asc(schema.bookFiles.bookId), asc(schema.bookFiles.id))
      .limit(2);

    if (byFileHashHistory.length > 0) {
      return (
        resolveUniqueBook(byFileHashHistory) ?? (userId === undefined ? null : this.resolveManualBookFileByHash(hash, accessibleLibraryIds, userId))
      );
    }

    return userId === undefined ? null : this.resolveManualBookFileByHash(hash, accessibleLibraryIds, userId);
  }

  async resolveBookFilesByHashes(
    hashes: string[],
    accessibleLibraryIds: number[] | null,
    userId?: number,
  ): Promise<Map<string, ResolvedBookFileByHashes>> {
    const result = new Map<string, ResolvedBookFileByHashes>();
    if (hashes.length === 0) return result;
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return result;

    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;

    const direct = await this.db
      .select({
        hash: schema.bookFiles.fileHash,
        bookFileId: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        libraryId: schema.books.libraryId,
        format: schema.bookFiles.format,
      })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(inArray(schema.bookFiles.fileHash, hashes), libraryFilter))
      .orderBy(asc(schema.bookFiles.id));

    const directHashes = addUnambiguousHashMatches(direct, result);

    const missing = hashes.filter((hash) => !directHashes.has(hash));
    if (missing.length > 0) {
      const history = await this.db
        .select({
          hash: schema.bookFileHashHistory.fileHash,
          bookFileId: schema.bookFiles.id,
          bookId: schema.bookFiles.bookId,
          libraryId: schema.books.libraryId,
          format: schema.bookFiles.format,
        })
        .from(schema.bookFileHashHistory)
        .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.bookFileHashHistory.bookFileId))
        .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
        .where(and(inArray(schema.bookFileHashHistory.fileHash, missing), libraryFilter))
        .orderBy(asc(schema.bookFiles.id));

      addUnambiguousHashMatches(history, result);
    }

    const stillMissing = hashes.filter((hash) => !result.has(hash));
    if (stillMissing.length === 0 || userId === undefined) return result;

    const manualLinks = await this.db
      .select({
        hash: schema.koreaderBookHashLinks.hash,
        bookFileId: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        libraryId: schema.books.libraryId,
        format: schema.bookFiles.format,
      })
      .from(schema.koreaderBookHashLinks)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.koreaderBookHashLinks.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.koreaderBookHashLinks.userId, userId), inArray(schema.koreaderBookHashLinks.hash, stillMissing), libraryFilter));

    for (const row of manualLinks) {
      if (!result.has(row.hash)) {
        result.set(row.hash, { bookFileId: row.bookFileId, bookId: row.bookId, libraryId: row.libraryId, format: row.format });
      }
    }

    return result;
  }

  private async resolveManualBookFileByHash(
    hash: string,
    accessibleLibraryIds: number[] | null,
    userId: number,
  ): Promise<ResolvedBookFileByHash | null> {
    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;
    const [byManualLink] = await this.db
      .select({ id: schema.bookFiles.id, bookId: schema.bookFiles.bookId, libraryId: schema.books.libraryId, format: schema.bookFiles.format })
      .from(schema.koreaderBookHashLinks)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.koreaderBookHashLinks.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.koreaderBookHashLinks.userId, userId), eq(schema.koreaderBookHashLinks.hash, hash), libraryFilter))
      .limit(1);

    return byManualLink ?? null;
  }

  async upsertUnmatchedBooks(userId: number, candidates: KoreaderUnmatchedCandidate[], deviceId?: string): Promise<void> {
    if (candidates.length === 0) return;

    const now = new Date();
    const incomingSourceRank = sql<number>`case excluded.source when 'current_file' then 2 when 'file' then 1 else 0 end`;
    const storedSourceRank = sql<number>`case ${schema.koreaderUnmatchedBooks.source} when 'current_file' then 2 when 'file' then 1 else 0 end`;

    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.koreaderUnmatchedBooks)
        .values(
          candidates.map((candidate) => ({
            userId,
            hash: candidate.hash,
            title: candidate.title?.trim() || null,
            authors: candidate.authors?.trim() || null,
            lastOpen: candidate.lastOpen ?? null,
            source: candidate.source ?? 'statistics',
            metadataAmbiguous: candidate.metadataAmbiguous ?? false,
            lastSeenAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.koreaderUnmatchedBooks.userId, schema.koreaderUnmatchedBooks.hash],
          set: {
            title: sql`
              case
                when ${incomingSourceRank} >= ${storedSourceRank} then coalesce(excluded.title, ${schema.koreaderUnmatchedBooks.title})
                else coalesce(${schema.koreaderUnmatchedBooks.title}, excluded.title)
              end
            `,
            authors: sql`
              case
                when ${incomingSourceRank} >= ${storedSourceRank} then coalesce(excluded.authors, ${schema.koreaderUnmatchedBooks.authors})
                else coalesce(${schema.koreaderUnmatchedBooks.authors}, excluded.authors)
              end
            `,
            lastOpen: sql`
              case
                when excluded.last_open is null then ${schema.koreaderUnmatchedBooks.lastOpen}
                when ${schema.koreaderUnmatchedBooks.lastOpen} is null then excluded.last_open
                else greatest(excluded.last_open, ${schema.koreaderUnmatchedBooks.lastOpen})
              end
            `,
            source: sql`
              case
                when ${incomingSourceRank} >= ${storedSourceRank} then excluded.source
                else ${schema.koreaderUnmatchedBooks.source}
              end
            `,
            metadataAmbiguous: sql`
              case
                when ${incomingSourceRank} >= ${storedSourceRank} then excluded.metadata_ambiguous
                else ${schema.koreaderUnmatchedBooks.metadataAmbiguous}
              end
            `,
            lastSeenAt: now,
          },
        });

      if (!deviceId) return;

      await tx
        .insert(schema.koreaderUnmatchedBookDevices)
        .values(candidates.map((candidate) => ({ userId, hash: candidate.hash, deviceId, lastSeenAt: now })))
        .onConflictDoUpdate({
          target: [
            schema.koreaderUnmatchedBookDevices.userId,
            schema.koreaderUnmatchedBookDevices.hash,
            schema.koreaderUnmatchedBookDevices.deviceId,
          ],
          set: { lastSeenAt: now },
        });
    });
  }

  async clearUnmatchedBooks(userId: number, hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;
    await this.db
      .delete(schema.koreaderUnmatchedBooks)
      .where(and(eq(schema.koreaderUnmatchedBooks.userId, userId), inArray(schema.koreaderUnmatchedBooks.hash, hashes)));
  }

  async dismissUnmatchedBook(userId: number, hash: string) {
    // The koreader_unmatched_book_devices FK is ON DELETE CASCADE, so removing this row also
    // clears any device associations for it - no separate cleanup needed here.
    const [row] = await this.db
      .delete(schema.koreaderUnmatchedBooks)
      .where(and(eq(schema.koreaderUnmatchedBooks.userId, userId), eq(schema.koreaderUnmatchedBooks.hash, hash)))
      .returning({ hash: schema.koreaderUnmatchedBooks.hash });
    return row ?? null;
  }

  async dismissAllUnmatchedBooks(userId: number): Promise<number> {
    // Scoped to the same source/ambiguity filter as listUnmatchedBooks so this only clears what
    // the "Unmatched Books" list actually shows the user - not internal statistics-only or
    // ambiguous candidates that were never surfaced.
    const rows = await this.db
      .delete(schema.koreaderUnmatchedBooks)
      .where(
        and(
          eq(schema.koreaderUnmatchedBooks.userId, userId),
          inArray(schema.koreaderUnmatchedBooks.source, ['current_file', 'file']),
          eq(schema.koreaderUnmatchedBooks.metadataAmbiguous, false),
        ),
      )
      .returning({ hash: schema.koreaderUnmatchedBooks.hash });
    return rows.length;
  }

  async listUnmatchedBooks(userId: number, limit: number) {
    return this.db
      .select()
      .from(schema.koreaderUnmatchedBooks)
      .where(
        and(
          eq(schema.koreaderUnmatchedBooks.userId, userId),
          inArray(schema.koreaderUnmatchedBooks.source, ['current_file', 'file']),
          eq(schema.koreaderUnmatchedBooks.metadataAmbiguous, false),
        ),
      )
      .orderBy(desc(schema.koreaderUnmatchedBooks.lastSeenAt))
      .limit(limit);
  }

  async getUnmatchedBook(userId: number, hash: string) {
    const [row] = await this.db
      .select()
      .from(schema.koreaderUnmatchedBooks)
      .where(and(eq(schema.koreaderUnmatchedBooks.userId, userId), eq(schema.koreaderUnmatchedBooks.hash, hash)))
      .limit(1);
    return row ?? null;
  }

  async listBookHashLinks(userId: number, limit: number, accessibleLibraryIds: number[] | null) {
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return [];

    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;
    const rows = await this.db
      .select({
        hash: schema.koreaderBookHashLinks.hash,
        bookFileId: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        bookTitle: schema.bookMetadata.title,
        koreaderTitle: schema.koreaderBookHashLinks.koreaderTitle,
        koreaderAuthors: schema.koreaderBookHashLinks.koreaderAuthors,
        koreaderLastOpen: schema.koreaderBookHashLinks.koreaderLastOpen,
        createdAt: schema.koreaderBookHashLinks.createdAt,
        updatedAt: schema.koreaderBookHashLinks.updatedAt,
      })
      .from(schema.koreaderBookHashLinks)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.koreaderBookHashLinks.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .where(and(eq(schema.koreaderBookHashLinks.userId, userId), libraryFilter))
      .orderBy(desc(schema.koreaderBookHashLinks.updatedAt))
      .limit(limit);

    const bookIds = [...new Set(rows.map((row) => row.bookId))];
    const authorRows =
      bookIds.length > 0
        ? await this.db
            .select({ bookId: schema.bookAuthors.bookId, name: schema.authors.name })
            .from(schema.bookAuthors)
            .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
            .where(inArray(schema.bookAuthors.bookId, bookIds))
            .orderBy(schema.bookAuthors.displayOrder)
        : [];

    const authorsByBook = new Map<number, string[]>();
    for (const row of authorRows) {
      const list = authorsByBook.get(row.bookId) ?? [];
      list.push(row.name);
      authorsByBook.set(row.bookId, list);
    }

    return rows.map((row) => ({ ...row, bookAuthors: authorsByBook.get(row.bookId) ?? [] }));
  }

  async upsertBookHashLink(userId: number, hash: string, bookFileId: number, metadata: KoreaderHashLinkMetadata = {}) {
    const now = new Date();
    await this.db
      .insert(schema.koreaderBookHashLinks)
      .values({
        userId,
        hash,
        bookFileId,
        koreaderTitle: metadata.title?.trim() || null,
        koreaderAuthors: metadata.authors?.trim() || null,
        koreaderLastOpen: metadata.lastOpen ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.koreaderBookHashLinks.userId, schema.koreaderBookHashLinks.hash],
        set: {
          bookFileId,
          koreaderTitle: sql`coalesce(excluded.koreader_title, ${schema.koreaderBookHashLinks.koreaderTitle})`,
          koreaderAuthors: sql`coalesce(excluded.koreader_authors, ${schema.koreaderBookHashLinks.koreaderAuthors})`,
          koreaderLastOpen: sql`
            case
              when excluded.koreader_last_open is null then ${schema.koreaderBookHashLinks.koreaderLastOpen}
              when ${schema.koreaderBookHashLinks.koreaderLastOpen} is null then excluded.koreader_last_open
              else greatest(excluded.koreader_last_open, ${schema.koreaderBookHashLinks.koreaderLastOpen})
            end
          `,
          updatedAt: now,
        },
      });
  }

  async getBookHashLink(userId: number, hash: string): Promise<{ bookFileId: number } | null> {
    const [row] = await this.db
      .select({ bookFileId: schema.koreaderBookHashLinks.bookFileId })
      .from(schema.koreaderBookHashLinks)
      .where(and(eq(schema.koreaderBookHashLinks.userId, userId), eq(schema.koreaderBookHashLinks.hash, hash)))
      .limit(1);
    return row ?? null;
  }

  async deleteBookHashLink(userId: number, hash: string) {
    const [row] = await this.db
      .delete(schema.koreaderBookHashLinks)
      .where(and(eq(schema.koreaderBookHashLinks.userId, userId), eq(schema.koreaderBookHashLinks.hash, hash)))
      .returning({
        hash: schema.koreaderBookHashLinks.hash,
        bookFileId: schema.koreaderBookHashLinks.bookFileId,
        koreaderTitle: schema.koreaderBookHashLinks.koreaderTitle,
        koreaderAuthors: schema.koreaderBookHashLinks.koreaderAuthors,
        koreaderLastOpen: schema.koreaderBookHashLinks.koreaderLastOpen,
      });
    return row ?? null;
  }

  async getAccessibleLibraryIds(userId: number): Promise<number[] | null> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { isSuperuser: true },
    });
    if (user?.isSuperuser) return null;

    const rows = await this.db
      .select({ libraryId: schema.userLibraryAccess.libraryId })
      .from(schema.userLibraryAccess)
      .where(eq(schema.userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  async upsertDeviceProgress(data: {
    bookFileId: number;
    userId: number;
    device: string;
    deviceId: string;
    percentage: number;
    progress: string | null;
    chapterIndex: number | null;
    syncTimestamp: number | null;
  }) {
    await this.db
      .insert(schema.koreaderDeviceProgress)
      .values({
        bookFileId: data.bookFileId,
        userId: data.userId,
        device: data.device,
        deviceId: data.deviceId,
        percentage: data.percentage,
        progress: data.progress,
        chapterIndex: data.chapterIndex,
        syncTimestamp: data.syncTimestamp,
        orphaned: false,
        orphanedHash: null,
      })
      .onConflictDoUpdate({
        target: [
          schema.koreaderDeviceProgress.bookFileId,
          schema.koreaderDeviceProgress.userId,
          schema.koreaderDeviceProgress.device,
          schema.koreaderDeviceProgress.deviceId,
        ],
        targetWhere: eq(schema.koreaderDeviceProgress.orphaned, false),
        set: {
          percentage: data.percentage,
          progress: data.progress,
          chapterIndex: data.chapterIndex,
          syncTimestamp: data.syncTimestamp,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Entries must already be deduplicated by book file: the partial unique index makes
   * Postgres reject an ON CONFLICT DO UPDATE that would touch the same row twice.
   */
  async upsertDeviceProgressMany(entries: DeviceProgressUpsert[], updatedAt = new Date()) {
    for (const batch of chunk(entries, BATCH_QUERY_SIZE)) {
      await this.db
        .insert(schema.koreaderDeviceProgress)
        .values(
          batch.map((entry) => ({
            bookFileId: entry.bookFileId,
            userId: entry.userId,
            device: entry.device,
            deviceId: entry.deviceId,
            percentage: entry.percentage,
            progress: entry.progress,
            chapterIndex: entry.chapterIndex,
            syncTimestamp: entry.syncTimestamp,
            orphaned: false,
            orphanedHash: null,
            updatedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [
            schema.koreaderDeviceProgress.bookFileId,
            schema.koreaderDeviceProgress.userId,
            schema.koreaderDeviceProgress.device,
            schema.koreaderDeviceProgress.deviceId,
          ],
          targetWhere: eq(schema.koreaderDeviceProgress.orphaned, false),
          set: {
            percentage: sql`excluded.percentage`,
            progress: sql`excluded.progress`,
            chapterIndex: sql`excluded.chapter_index`,
            syncTimestamp: sql`excluded.sync_timestamp`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }

  async getLatestDeviceProgress(bookFileId: number, userId: number) {
    const [row] = await this.db
      .select()
      .from(schema.koreaderDeviceProgress)
      .where(
        and(
          eq(schema.koreaderDeviceProgress.bookFileId, bookFileId),
          eq(schema.koreaderDeviceProgress.userId, userId),
          eq(schema.koreaderDeviceProgress.orphaned, false),
        ),
      )
      .orderBy(desc(schema.koreaderDeviceProgress.updatedAt))
      .limit(1);
    return row ?? null;
  }

  async getReadingProgress(bookFileId: number, userId: number) {
    const [row] = await this.db
      .select()
      .from(schema.readingProgress)
      .where(and(eq(schema.readingProgress.bookFileId, bookFileId), eq(schema.readingProgress.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async upsertReadingProgress(entry: ReadingProgressUpsert) {
    const { bookFileId, userId, percentage, cfi = null, xpointer = null, pageNumber = null } = entry;

    await this.db
      .insert(schema.readingProgress)
      .values({ bookFileId, userId, percentage, cfi, pageNumber, koreaderProgress: xpointer })
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        // Deliberately do NOT update updatedAt here. reading_progress.updatedAt must only
        // change when the web reader writes it, so getProgress can use it as an accurate
        // "last web-reader sync time" for comparison against koreader_device_progress.updatedAt.
        // Exactly one of cfi and pageNumber carries the position, chosen by the book file's
        // format: cfi is the server-side conversion of KOReader's XPointer for reflowable
        // documents, pageNumber the page KOReader reports for paged ones. Both are written on
        // every sync so stale web locator fields are never kept, or clients may resume at an
        // older location. Kobo location fields clear because the position no longer matches the
        // device's bookmark; the Kobo pull path recomputes a precise Location from the cfi.
        set: {
          percentage,
          cfi,
          pageNumber,
          koreaderProgress: xpointer,
          koboLocationSource: null,
          koboLocationType: null,
          koboLocationValue: null,
          koboContentSourceProgressPercent: null,
          updatedAt: sql`"reading_progress"."updated_at"`,
        },
      });
  }

  async getAllDeviceProgress(bookFileId: number, userId: number) {
    return this.db
      .select()
      .from(schema.koreaderDeviceProgress)
      .where(
        and(
          eq(schema.koreaderDeviceProgress.bookFileId, bookFileId),
          eq(schema.koreaderDeviceProgress.userId, userId),
          eq(schema.koreaderDeviceProgress.orphaned, false),
        ),
      )
      .orderBy(desc(schema.koreaderDeviceProgress.updatedAt));
  }

  /** Device rows for many files at once, newest first within each file. */
  async getDeviceProgressForFiles(bookFileIds: number[], userId: number) {
    const byFile = new Map<
      number,
      { device: string; deviceId: string; percentage: number | null; syncTimestamp: number | null; updatedAt: Date }[]
    >();
    for (const batch of chunk([...new Set(bookFileIds)], BATCH_QUERY_SIZE)) {
      const rows = await this.db
        .select({
          bookFileId: schema.koreaderDeviceProgress.bookFileId,
          device: schema.koreaderDeviceProgress.device,
          deviceId: schema.koreaderDeviceProgress.deviceId,
          percentage: schema.koreaderDeviceProgress.percentage,
          syncTimestamp: schema.koreaderDeviceProgress.syncTimestamp,
          updatedAt: schema.koreaderDeviceProgress.updatedAt,
        })
        .from(schema.koreaderDeviceProgress)
        .where(
          and(
            inArray(schema.koreaderDeviceProgress.bookFileId, batch),
            eq(schema.koreaderDeviceProgress.userId, userId),
            eq(schema.koreaderDeviceProgress.orphaned, false),
          ),
        )
        .orderBy(desc(schema.koreaderDeviceProgress.updatedAt));
      for (const row of rows) {
        if (row.bookFileId == null) continue;
        const existing = byFile.get(row.bookFileId);
        const entry = {
          device: row.device,
          deviceId: row.deviceId,
          percentage: row.percentage,
          syncTimestamp: row.syncTimestamp,
          updatedAt: row.updatedAt,
        };
        if (existing) existing.push(entry);
        else byFile.set(row.bookFileId, [entry]);
      }
    }
    return byFile;
  }

  async getReadingProgressUpdatedAtForFiles(bookFileIds: number[], userId: number) {
    const byFile = new Map<number, Date>();
    for (const batch of chunk([...new Set(bookFileIds)], BATCH_QUERY_SIZE)) {
      const rows = await this.db
        .select({ bookFileId: schema.readingProgress.bookFileId, updatedAt: schema.readingProgress.updatedAt })
        .from(schema.readingProgress)
        .where(and(inArray(schema.readingProgress.bookFileId, batch), eq(schema.readingProgress.userId, userId)));
      for (const row of rows) {
        if (row.updatedAt) byFile.set(row.bookFileId, row.updatedAt);
      }
    }
    return byFile;
  }

  /**
   * The live reset marker for a file, or null when none is outstanding. A live marker means
   * the user cleared this file's position server-side and no device has been told yet, so it
   * outranks every stored position regardless of timestamps: a device that pushed after the
   * reset carries a fresh push clock but a pre-reset position, and the two are
   * indistinguishable on the wire.
   */
  async getProgressReset(bookFileId: number, userId: number) {
    const [row] = await this.db
      .select({ resetAt: schema.koreaderProgressResets.resetAt })
      .from(schema.koreaderProgressResets)
      .where(and(eq(schema.koreaderProgressResets.bookFileId, bookFileId), eq(schema.koreaderProgressResets.userId, userId)))
      .limit(1);
    return row?.resetAt ?? null;
  }

  async getProgressResetsForFiles(bookFileIds: number[], userId: number) {
    const byFile = new Map<number, Date>();
    for (const batch of chunk([...new Set(bookFileIds)], BATCH_QUERY_SIZE)) {
      const rows = await this.db
        .select({ bookFileId: schema.koreaderProgressResets.bookFileId, resetAt: schema.koreaderProgressResets.resetAt })
        .from(schema.koreaderProgressResets)
        .where(and(inArray(schema.koreaderProgressResets.bookFileId, batch), eq(schema.koreaderProgressResets.userId, userId)));
      for (const row of rows) byFile.set(row.bookFileId, row.resetAt);
    }
    return byFile;
  }

  /**
   * The file a book's KOReader progress hangs off, in the shape the shared-progress path needs.
   * Resolved through the book's primary file, matching findBookFileIdByBookId: the book page
   * reports one file's holds, so the release action has to act on that same file rather than
   * whichever one a marker happens to be found on first.
   */
  async findProgressBookFileByBookId(bookId: number, accessibleLibraryIds: number[] | null) {
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return null;
    const [row] = await this.db
      .select({
        id: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        libraryId: schema.books.libraryId,
        format: schema.bookFiles.format,
      })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(
        and(
          eq(schema.books.id, bookId),
          eq(schema.books.primaryFileId, schema.bookFiles.id),
          // Scoped the same way every other entry point into this module is. A device progress
          // row outlives the library grant that created it, so ownership of the row is not
          // ownership of the book, and this path writes.
          accessibleLibraryIds === null ? undefined : inArray(schema.books.libraryId, accessibleLibraryIds),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async getDeviceProgressForDevice(bookFileId: number, userId: number, deviceId: string) {
    const [row] = await this.db
      .select()
      .from(schema.koreaderDeviceProgress)
      .where(
        and(
          eq(schema.koreaderDeviceProgress.bookFileId, bookFileId),
          eq(schema.koreaderDeviceProgress.userId, userId),
          eq(schema.koreaderDeviceProgress.deviceId, deviceId),
          eq(schema.koreaderDeviceProgress.orphaned, false),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** Device ids that have taken the outstanding reset for this file. */
  async getConvergedResetDeviceIds(bookFileId: number, userId: number) {
    const rows = await this.db
      .select({ deviceId: schema.koreaderProgressResetDevices.deviceId })
      .from(schema.koreaderProgressResetDevices)
      .where(and(eq(schema.koreaderProgressResetDevices.bookFileId, bookFileId), eq(schema.koreaderProgressResetDevices.userId, userId)));
    return new Set(rows.map((row) => row.deviceId));
  }

  async getConvergedResetDeviceIdsForFiles(bookFileIds: number[], userId: number) {
    const byFile = new Map<number, Set<string>>();
    for (const batch of chunk([...new Set(bookFileIds)], BATCH_QUERY_SIZE)) {
      const rows = await this.db
        .select({ bookFileId: schema.koreaderProgressResetDevices.bookFileId, deviceId: schema.koreaderProgressResetDevices.deviceId })
        .from(schema.koreaderProgressResetDevices)
        .where(and(inArray(schema.koreaderProgressResetDevices.bookFileId, batch), eq(schema.koreaderProgressResetDevices.userId, userId)));
      for (const row of rows) {
        const existing = byFile.get(row.bookFileId);
        if (existing) existing.add(row.deviceId);
        else byFile.set(row.bookFileId, new Set([row.deviceId]));
      }
    }
    return byFile;
  }

  /**
   * Records that a device has landed on the reset position. Deliberately per-device and not a
   * retirement of the marker: another device may still be holding a pre-reset position, and it
   * has to keep being held until it takes the reset itself.
   */
  async recordResetConvergence(bookFileId: number, userId: number, deviceId: string) {
    await this.db.insert(schema.koreaderProgressResetDevices).values({ userId, bookFileId, deviceId }).onConflictDoNothing();
  }

  /** Retires a marker whose outcome is settled for every device, cascading the per-device rows. */
  async clearProgressReset(bookFileId: number, userId: number) {
    await this.db
      .delete(schema.koreaderProgressResets)
      .where(and(eq(schema.koreaderProgressResets.bookFileId, bookFileId), eq(schema.koreaderProgressResets.userId, userId)));
  }

  async getDevicesList(userId: number) {
    const result = await this.db.execute<{
      device: string;
      device_id: string;
      last_sync_at: Date;
      last_book_title: string | null;
      retired_at: Date | null;
    }>(sql`
      SELECT sub.device, sub.device_id, sub.last_sync_at, sub.last_book_title, r.retired_at
      FROM (
        SELECT DISTINCT ON (d.device, d.device_id)
          d.device,
          d.device_id,
          d.updated_at AS last_sync_at,
          bm.title AS last_book_title
        FROM koreader_device_progress d
        LEFT JOIN book_files bf ON bf.id = d.book_file_id
        LEFT JOIN book_metadata bm ON bm.book_id = bf.book_id
        WHERE d.user_id = ${userId} AND d.orphaned = false
        ORDER BY d.device, d.device_id, d.updated_at DESC
      ) sub
      LEFT JOIN koreader_device_retirements r ON r.user_id = ${userId} AND r.device_id = sub.device_id
      ORDER BY sub.last_sync_at DESC
    `);

    return result.rows.map((r) => ({
      device: r.device,
      deviceId: r.device_id,
      lastSyncAt: new Date(r.last_sync_at),
      lastBookTitle: r.last_book_title ?? null,
      retiredAt: r.retired_at ? new Date(r.retired_at) : null,
    }));
  }

  async listRetiredDeviceIds(userId: number): Promise<Map<string, Date>> {
    const rows = await this.db
      .select({ deviceId: schema.koreaderDeviceRetirements.deviceId, retiredAt: schema.koreaderDeviceRetirements.retiredAt })
      .from(schema.koreaderDeviceRetirements)
      .where(eq(schema.koreaderDeviceRetirements.userId, userId));
    return new Map(rows.map((row) => [row.deviceId, row.retiredAt]));
  }

  /** True when any device-keyed table still knows this device, which is what makes it listable. */
  async deviceExists(userId: number, deviceId: string): Promise<boolean> {
    const result = await this.db.execute<{ device_exists: boolean }>(sql`
      SELECT
        EXISTS (SELECT 1 FROM koreader_device_progress WHERE user_id = ${userId} AND device_id = ${deviceId})
        OR EXISTS (SELECT 1 FROM koreader_device_sweeps WHERE user_id = ${userId} AND device_id = ${deviceId})
        OR EXISTS (SELECT 1 FROM koreader_device_settings WHERE user_id = ${userId} AND device_id = ${deviceId})
        AS device_exists
    `);
    return result.rows[0]?.device_exists === true;
  }

  async retireDevice(userId: number, deviceId: string): Promise<void> {
    await this.db
      .insert(schema.koreaderDeviceRetirements)
      .values({ userId, deviceId })
      .onConflictDoNothing({
        target: [schema.koreaderDeviceRetirements.userId, schema.koreaderDeviceRetirements.deviceId],
      });
  }

  async restoreDevice(userId: number, deviceId: string): Promise<void> {
    await this.db
      .delete(schema.koreaderDeviceRetirements)
      .where(and(eq(schema.koreaderDeviceRetirements.userId, userId), eq(schema.koreaderDeviceRetirements.deviceId, deviceId)));
  }

  async getKoreaderUserDefaultPattern(userId: number): Promise<string | null> {
    const row = await this.db.query.koreaderUserSettings.findFirst({
      where: eq(schema.koreaderUserSettings.userId, userId),
    });
    return row?.defaultFileNamingPattern ?? null;
  }

  async setKoreaderUserDefaultPattern(userId: number, pattern: string): Promise<void> {
    await this.db
      .insert(schema.koreaderUserSettings)
      .values({ userId, defaultFileNamingPattern: pattern })
      .onConflictDoUpdate({
        target: schema.koreaderUserSettings.userId,
        set: { defaultFileNamingPattern: pattern, updatedAt: new Date() },
      });
  }

  async getDeviceFileNamingPatterns(userId: number) {
    return this.db
      .select({
        deviceId: schema.koreaderDeviceSettings.deviceId,
        fileNamingPattern: schema.koreaderDeviceSettings.fileNamingPattern,
        seriesFileNamingPattern: schema.koreaderDeviceSettings.seriesFileNamingPattern,
        standaloneFileNamingPattern: schema.koreaderDeviceSettings.standaloneFileNamingPattern,
      })
      .from(schema.koreaderDeviceSettings)
      .where(eq(schema.koreaderDeviceSettings.userId, userId));
  }

  async getDeviceFileNamingPattern(userId: number, deviceId: string) {
    return (
      (await this.db.query.koreaderDeviceSettings.findFirst({
        where: and(eq(schema.koreaderDeviceSettings.userId, userId), eq(schema.koreaderDeviceSettings.deviceId, deviceId)),
      })) ?? null
    );
  }

  async setDeviceFileNamingPattern(
    userId: number,
    deviceId: string,
    config: { fileNamingPattern: string; seriesFileNamingPattern: string; standaloneFileNamingPattern: string },
  ): Promise<void> {
    await this.db
      .insert(schema.koreaderDeviceSettings)
      .values({ userId, deviceId, ...config })
      .onConflictDoUpdate({
        target: [schema.koreaderDeviceSettings.userId, schema.koreaderDeviceSettings.deviceId],
        set: { ...config, updatedAt: new Date() },
      });
  }

  async clearDeviceFileNamingPattern(userId: number, deviceId: string): Promise<void> {
    await this.db
      .delete(schema.koreaderDeviceSettings)
      .where(and(eq(schema.koreaderDeviceSettings.userId, userId), eq(schema.koreaderDeviceSettings.deviceId, deviceId)));
  }

  async removeDevice(userId: number, deviceId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const [deletedProgress, deletedSweep, deletedPageStats, deletedUnmatchedDeviceLinks, deletedDeviceSettings] = await Promise.all([
        tx
          .delete(schema.koreaderDeviceProgress)
          .where(and(eq(schema.koreaderDeviceProgress.userId, userId), eq(schema.koreaderDeviceProgress.deviceId, deviceId)))
          .returning({ id: schema.koreaderDeviceProgress.id }),
        tx
          .delete(schema.koreaderDeviceSweeps)
          .where(and(eq(schema.koreaderDeviceSweeps.userId, userId), eq(schema.koreaderDeviceSweeps.deviceId, deviceId)))
          .returning({ deviceId: schema.koreaderDeviceSweeps.deviceId }),
        tx
          .delete(schema.koreaderPageStats)
          .where(and(eq(schema.koreaderPageStats.userId, userId), eq(schema.koreaderPageStats.deviceId, deviceId)))
          .returning({ id: schema.koreaderPageStats.id }),
        tx
          .delete(schema.koreaderUnmatchedBookDevices)
          .where(and(eq(schema.koreaderUnmatchedBookDevices.userId, userId), eq(schema.koreaderUnmatchedBookDevices.deviceId, deviceId)))
          .returning({ hash: schema.koreaderUnmatchedBookDevices.hash }),
        tx
          .delete(schema.koreaderDeviceSettings)
          .where(and(eq(schema.koreaderDeviceSettings.userId, userId), eq(schema.koreaderDeviceSettings.deviceId, deviceId)))
          .returning({ deviceId: schema.koreaderDeviceSettings.deviceId }),
      ]);

      // Not counted towards the deleted-row total: a marker on its own never made the device listable.
      await tx
        .delete(schema.koreaderDeviceRetirements)
        .where(and(eq(schema.koreaderDeviceRetirements.userId, userId), eq(schema.koreaderDeviceRetirements.deviceId, deviceId)));

      // Only drop unmatched-book rows this device orphaned - a hash still reported by another
      // device must stay visible until that device is removed (or the hash is matched/linked).
      const affectedHashes = [...new Set(deletedUnmatchedDeviceLinks.map((row) => row.hash))];
      let deletedUnmatchedBooks: { hash: string }[] = [];
      if (affectedHashes.length > 0) {
        deletedUnmatchedBooks = await tx
          .delete(schema.koreaderUnmatchedBooks)
          .where(
            and(
              eq(schema.koreaderUnmatchedBooks.userId, userId),
              inArray(schema.koreaderUnmatchedBooks.hash, affectedHashes),
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(schema.koreaderUnmatchedBookDevices)
                  .where(
                    and(
                      eq(schema.koreaderUnmatchedBookDevices.userId, userId),
                      eq(schema.koreaderUnmatchedBookDevices.hash, schema.koreaderUnmatchedBooks.hash),
                    ),
                  ),
              ),
            ),
          )
          .returning({ hash: schema.koreaderUnmatchedBooks.hash });
      }

      return (
        deletedProgress.length +
        deletedSweep.length +
        deletedPageStats.length +
        deletedUnmatchedDeviceLinks.length +
        deletedDeviceSettings.length +
        deletedUnmatchedBooks.length
      );
    });
  }

  async getTotalSyncedBooks(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(distinct ${schema.books.id})` })
      .from(schema.koreaderDeviceProgress)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.koreaderDeviceProgress.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.koreaderDeviceProgress.userId, userId), eq(schema.koreaderDeviceProgress.orphaned, false)));
    return Number(result?.count ?? 0);
  }

  async getChapters(bookFileId: number) {
    return this.db
      .select()
      .from(schema.bookFileChapters)
      .where(eq(schema.bookFileChapters.bookFileId, bookFileId))
      .orderBy(schema.bookFileChapters.chapterIndex);
  }

  async getLastFileWriteTime(bookFileId: number): Promise<Date | null> {
    const [row] = await this.db
      .select({ writtenAt: schema.fileWriteLog.writtenAt })
      .from(schema.fileWriteLog)
      .where(eq(schema.fileWriteLog.bookFileId, bookFileId))
      .orderBy(desc(schema.fileWriteLog.writtenAt))
      .limit(1);
    return row?.writtenAt ?? null;
  }

  async getBookProgressForDashboard(bookFileId: number, userId: number) {
    const deviceProgress = await this.getAllDeviceProgress(bookFileId, userId);
    const readingProg = await this.getReadingProgress(bookFileId, userId);
    return { deviceProgress, readingProgress: readingProg };
  }

  async findBookFileIdByBookId(bookId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ id: schema.bookFiles.id })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.books.id, bookId), eq(schema.books.primaryFileId, schema.bookFiles.id)))
      .limit(1);
    return row?.id ?? null;
  }
}
