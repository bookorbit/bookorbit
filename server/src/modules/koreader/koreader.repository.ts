import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

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

  async resolveBookFileByHash(hash: string, accessibleLibraryIds: number[] | null): Promise<{ id: number; bookId: number } | null> {
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return null;

    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;

    const [byFileHash] = await this.db
      .select({ id: schema.bookFiles.id, bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.bookFiles.fileHash, hash), libraryFilter))
      .limit(1);

    if (byFileHash) return byFileHash;

    const [byFileHashHistory] = await this.db
      .select({ id: schema.bookFiles.id, bookId: schema.bookFiles.bookId })
      .from(schema.bookFileHashHistory)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.bookFileHashHistory.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.bookFileHashHistory.fileHash, hash), libraryFilter))
      .limit(1);

    if (byFileHashHistory) return byFileHashHistory;

    return null;
  }

  async resolveBookFilesByHashes(
    hashes: string[],
    accessibleLibraryIds: number[] | null,
  ): Promise<Map<string, { bookFileId: number; bookId: number; libraryId: number }>> {
    const result = new Map<string, { bookFileId: number; bookId: number; libraryId: number }>();
    if (hashes.length === 0) return result;
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return result;

    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;

    const direct = await this.db
      .select({
        hash: schema.bookFiles.fileHash,
        bookFileId: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        libraryId: schema.books.libraryId,
      })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(inArray(schema.bookFiles.fileHash, hashes), libraryFilter));

    for (const row of direct) {
      if (row.hash && !result.has(row.hash)) {
        result.set(row.hash, { bookFileId: row.bookFileId, bookId: row.bookId, libraryId: row.libraryId });
      }
    }

    const missing = hashes.filter((hash) => !result.has(hash));
    if (missing.length === 0) return result;

    const history = await this.db
      .select({
        hash: schema.bookFileHashHistory.fileHash,
        bookFileId: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        libraryId: schema.books.libraryId,
      })
      .from(schema.bookFileHashHistory)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.bookFileHashHistory.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(inArray(schema.bookFileHashHistory.fileHash, missing), libraryFilter));

    for (const row of history) {
      if (!result.has(row.hash)) {
        result.set(row.hash, { bookFileId: row.bookFileId, bookId: row.bookId, libraryId: row.libraryId });
      }
    }

    return result;
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

  async upsertReadingProgress(bookFileId: number, userId: number, percentage: number, cfi: string | null = null, xpointer: string | null = null) {
    await this.db
      .insert(schema.readingProgress)
      .values({ bookFileId, userId, percentage, cfi, koreaderProgress: xpointer })
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        // Deliberately do NOT update updatedAt here. reading_progress.updatedAt must only
        // change when the web reader writes it, so getProgress can use it as an accurate
        // "last web-reader sync time" for comparison against koreader_device_progress.updatedAt.
        // The cfi stored here is the server-side conversion of KOReader's XPointer (null when
        // conversion fails) so the web reader resumes at the same paragraph; stale web locator
        // fields are never kept, or clients may resume at an older location. Kobo location
        // fields clear because the position no longer matches the device's bookmark; the Kobo
        // pull path recomputes a precise Location from the cfi.
        set: {
          percentage,
          cfi,
          pageNumber: null,
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

  async getDevicesList(userId: number) {
    const result = await this.db.execute<{
      device: string;
      device_id: string;
      last_sync_at: Date;
      last_book_title: string | null;
    }>(sql`
      SELECT device, device_id, last_sync_at, last_book_title
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
      ORDER BY last_sync_at DESC
    `);

    return result.rows.map((r) => ({
      device: r.device,
      deviceId: r.device_id,
      lastSyncAt: new Date(r.last_sync_at),
      lastBookTitle: r.last_book_title ?? null,
    }));
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
