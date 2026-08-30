import { Inject, Injectable } from '@nestjs/common';
import { isAudioFormat, Permission } from '@bookorbit/types';
import type { ContentFilterRules, ReadStatus } from '@bookorbit/types';
import { and, asc, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { buildContentFilterClauses } from '../../common/utils/content-filter-sql.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import type { HardcoverBookState, HardcoverUserSetting, NewHardcoverBookState, NewHardcoverUserSetting } from '../../db/schema';
import { HARDCOVER_EXTERNAL_PROVIDER } from './hardcover-read-selection';

type Db = NodePgDatabase<typeof schema>;

const READING_ATTEMPT_EXTERNAL_CONSTRAINT = 'reading_attempts_external_uidx';

export type HardcoverLinkOutcome = 'linked' | 'conflict';

function* iterateErrorChain(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isExternalIdConflict(error: unknown): boolean {
  for (const entry of iterateErrorChain(error)) {
    if (entry['code'] !== '23505') continue;
    if (asString(entry['constraint']) === READING_ATTEMPT_EXTERNAL_CONSTRAINT) return true;
    if (asString(entry['message']).includes(READING_ATTEMPT_EXTERNAL_CONSTRAINT)) return true;
  }
  return false;
}

export interface BookSyncData {
  bookId: number;
  isbn13: string | null;
  isbn10: string | null;
  title: string | null;
  authorName: string | null;
  hardcoverMetadataId: string | null;
  pageCount: number | null;
  format: string | null;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rating: number | null;
  progress: number | null;
  attemptsUpdatedAt?: Date | null;
}

export interface HardcoverImportLocalBook {
  bookId: number;
  primaryFileId: number | null;
  primaryFileFormat: string | null;
  title: string | null;
  isbn13: string | null;
  isbn10: string | null;
  hardcoverMetadataId: string | null;
  authors: string[];
  status: ReadStatus | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  progress: number | null;
}

@Injectable()
export class HardcoverRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  // ---- User Settings ----

  async findSettings(userId: number): Promise<HardcoverUserSetting | undefined> {
    return this.db.query.hardcoverUserSettings.findFirst({
      where: eq(schema.hardcoverUserSettings.userId, userId),
    });
  }

  async upsertSettings(
    userId: number,
    data: Partial<Omit<HardcoverUserSetting, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<HardcoverUserSetting> {
    const [row] = await this.db
      .insert(schema.hardcoverUserSettings)
      .values({ userId, ...data } as NewHardcoverUserSetting)
      .onConflictDoUpdate({
        target: schema.hardcoverUserSettings.userId,
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  async deleteSettings(userId: number): Promise<void> {
    await this.db.delete(schema.hardcoverUserSettings).where(eq(schema.hardcoverUserSettings.userId, userId));
  }

  async userHasHardcoverSyncPermission(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({
        isSuperuser: schema.users.isSuperuser,
        permissionName: schema.userPermissions.permissionName,
      })
      .from(schema.users)
      .leftJoin(
        schema.userPermissions,
        and(eq(schema.userPermissions.userId, schema.users.id), eq(schema.userPermissions.permissionName, Permission.HardcoverSync)),
      )
      .where(and(eq(schema.users.id, userId), eq(schema.users.active, true)))
      .limit(1);

    return row?.isSuperuser === true || row?.permissionName === Permission.HardcoverSync;
  }

  // ---- Book State ----

  async findBookState(userId: number, bookId: number): Promise<HardcoverBookState | undefined> {
    return this.db.query.hardcoverBookState.findFirst({
      where: and(eq(schema.hardcoverBookState.userId, userId), eq(schema.hardcoverBookState.bookId, bookId)),
    });
  }

  async findBookStatesByBookIds(userId: number, bookIds: number[]): Promise<HardcoverBookState[]> {
    if (bookIds.length === 0) return [];
    return this.db.query.hardcoverBookState.findMany({
      where: and(eq(schema.hardcoverBookState.userId, userId), sql`${schema.hardcoverBookState.bookId} = any(${sql.param(bookIds)}::integer[])`),
    });
  }

  async upsertBookState(data: NewHardcoverBookState): Promise<HardcoverBookState> {
    const [row] = await this.db
      .insert(schema.hardcoverBookState)
      .values(data)
      .onConflictDoUpdate({
        target: [schema.hardcoverBookState.userId, schema.hardcoverBookState.bookId],
        set: { ...data, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  // Only updates an existing link (never creates one) - used to propagate a metadata-side edition
  // pick into a user's sync target without turning an unrelated metadata edit into a new sync link.
  async updateEditionIfLinked(userId: number, bookId: number, hardcoverEditionId: number): Promise<boolean> {
    const [row] = await this.db
      .update(schema.hardcoverBookState)
      .set({ hardcoverEditionId, updatedAt: new Date() })
      .where(and(eq(schema.hardcoverBookState.userId, userId), eq(schema.hardcoverBookState.bookId, bookId)))
      .returning({ id: schema.hardcoverBookState.id });
    return row != null;
  }

  async setBookSyncOverride(userId: number, bookId: number, syncOverride: 'included' | 'excluded' | null): Promise<HardcoverBookState> {
    const syncExcluded = syncOverride === 'excluded';
    const [row] = await this.db
      .insert(schema.hardcoverBookState)
      .values({ userId, bookId, syncOverride, syncExcluded } as NewHardcoverBookState)
      .onConflictDoUpdate({
        target: [schema.hardcoverBookState.userId, schema.hardcoverBookState.bookId],
        set: { syncOverride, syncExcluded, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  // ---- Sync Settings ----

  async updateLastSyncedAt(userId: number, at: Date): Promise<void> {
    await this.db.update(schema.hardcoverUserSettings).set({ lastSyncedAt: at }).where(eq(schema.hardcoverUserSettings.userId, userId));
  }

  // ---- Books for sync ----

  async findSyncableBooks(userId: number): Promise<BookSyncData[]> {
    return this.findSyncableBooksForUser(userId);
  }

  async findSyncableBook(userId: number, bookId: number): Promise<BookSyncData | null> {
    const [row] = await this.findSyncableBooksForUser(userId, bookId);
    return row ?? null;
  }

  async findBookSyncData(userId: number, bookId: number): Promise<BookSyncData | null> {
    const [row] = await this.findBookSyncDataForUser(userId, bookId);
    return row ?? null;
  }

  // Bounded and ordered: this backs a settings list, not a sync run, and a library can hold far
  // more in-progress books than anyone wants rendered at once.
  async findCurrentReadingBooks(userId: number, limit: number): Promise<BookSyncData[]> {
    return this.findBookSyncDataForUser(userId, undefined, false, { statuses: ['reading', 'rereading'], limit });
  }

  private async findSyncableBooksForUser(userId: number, bookId?: number): Promise<BookSyncData[]> {
    return this.findBookSyncDataForUser(userId, bookId, false);
  }

  private async findBookSyncDataForUser(
    userId: number,
    bookId?: number,
    includeUnread = true,
    options: { statuses?: ReadStatus[]; limit?: number } = {},
  ): Promise<BookSyncData[]> {
    const bookFilter = bookId !== undefined ? eq(schema.books.id, bookId) : undefined;

    const maxProgressSq = this.db
      .select({
        bookId: schema.books.id,
        maxProgress: sql<number>`max(${schema.readingProgress.percentage})`.as('max_progress'),
      })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.bookId, schema.books.id))
      .innerJoin(schema.readingProgress, and(eq(schema.readingProgress.bookFileId, schema.bookFiles.id), eq(schema.readingProgress.userId, userId)))
      .where(bookFilter)
      .groupBy(schema.books.id)
      .as('max_progress_sq');

    const firstAuthorSq = this.db
      .select({
        bookId: schema.bookAuthors.bookId,
        authorName: sql<string>`min(${schema.authors.name})`.as('author_name'),
      })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(bookId !== undefined ? eq(schema.bookAuthors.bookId, bookId) : undefined)
      .groupBy(schema.bookAuthors.bookId)
      .as('first_author_sq');

    const attemptsSq = this.db
      .select({
        bookId: schema.readingAttempts.bookId,
        // mapWith keeps the driver's raw timestamp string from reaching callers: hasChanges compares
        // this against a mapped Date, and a string/Date comparison is silently always false.
        updatedAt: sql<Date | null>`max(${schema.readingAttempts.updatedAt})`.mapWith(schema.readingAttempts.updatedAt).as('attempts_updated_at'),
      })
      .from(schema.readingAttempts)
      .where(and(eq(schema.readingAttempts.userId, userId), sql`${schema.readingAttempts.deletedAt} is null`))
      .groupBy(schema.readingAttempts.bookId)
      .as('hardcover_attempts_sq');

    const query = this.db
      .select({
        bookId: schema.books.id,
        isbn13: schema.bookMetadata.isbn13,
        isbn10: schema.bookMetadata.isbn10,
        title: schema.bookMetadata.title,
        authorName: firstAuthorSq.authorName,
        hardcoverMetadataId: schema.bookMetadata.hardcoverId,
        pageCount: schema.bookMetadata.pageCount,
        format: schema.bookFiles.format,
        status: includeUnread ? sql<string>`coalesce(${schema.userBookStatus.status}, 'unread')` : schema.userBookStatus.status,
        startedAt: schema.userBookStatus.startedAt,
        finishedAt: schema.userBookStatus.finishedAt,
        rating: schema.userBookRatings.rating,
        readingProgress: maxProgressSq.maxProgress,
        audioProgress: schema.audiobookProgress.percentage,
        attemptsUpdatedAt: attemptsSq.updatedAt,
      })
      .from(schema.books)
      .leftJoin(schema.userBookStatus, and(eq(schema.userBookStatus.bookId, schema.books.id), eq(schema.userBookStatus.userId, userId)))
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .leftJoin(schema.userBookRatings, and(eq(schema.userBookRatings.bookId, schema.books.id), eq(schema.userBookRatings.userId, userId)))
      .leftJoin(maxProgressSq, eq(maxProgressSq.bookId, schema.books.id))
      .leftJoin(schema.audiobookProgress, and(eq(schema.audiobookProgress.bookId, schema.books.id), eq(schema.audiobookProgress.userId, userId)))
      .leftJoin(firstAuthorSq, eq(firstAuthorSq.bookId, schema.books.id))
      .leftJoin(attemptsSq, eq(attemptsSq.bookId, schema.books.id))
      .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId));

    const statusFilter = options.statuses ? inArray(schema.userBookStatus.status, options.statuses) : ne(schema.userBookStatus.status, 'unread');
    const filtered = includeUnread ? query.where(bookFilter) : query.where(and(bookFilter, statusFilter));

    // Sync callers stay unordered and unbounded; only the bounded list needs a stable window.
    const rows =
      options.limit === undefined
        ? await filtered
        : await filtered.orderBy(asc(schema.bookMetadata.title), asc(schema.books.id)).limit(options.limit);

    return rows.map(({ readingProgress, audioProgress, ...row }) => ({
      ...row,
      status: row.status as string,
      progress: row.format && isAudioFormat(row.format) ? audioProgress : readingProgress,
    }));
  }

  async findReadingAttempts(userId: number, bookId: number) {
    return this.db
      .select()
      .from(schema.readingAttempts)
      .where(
        and(eq(schema.readingAttempts.userId, userId), eq(schema.readingAttempts.bookId, bookId), sql`${schema.readingAttempts.deletedAt} is null`),
      )
      .orderBy(schema.readingAttempts.id);
  }

  /**
   * Reports an ownership conflict instead of throwing. Another attempt - possibly a soft-deleted
   * tombstone - can already own this read, and the caller recovers by selecting a different read
   * rather than by merging or reassigning attempts.
   */
  async linkReadingAttempt(userId: number, attemptId: number, hardcoverReadId: number): Promise<HardcoverLinkOutcome> {
    const externalId = String(hardcoverReadId);
    try {
      const rows = await this.db
        .update(schema.readingAttempts)
        .set({ externalProvider: HARDCOVER_EXTERNAL_PROVIDER, externalId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.readingAttempts.userId, userId),
            eq(schema.readingAttempts.id, attemptId),
            isNull(schema.readingAttempts.deletedAt),
            or(
              and(isNull(schema.readingAttempts.externalProvider), isNull(schema.readingAttempts.externalId)),
              and(eq(schema.readingAttempts.externalProvider, HARDCOVER_EXTERNAL_PROVIDER), eq(schema.readingAttempts.externalId, externalId)),
            ),
          ),
        )
        .returning({ id: schema.readingAttempts.id });
      return rows.length > 0 ? 'linked' : 'conflict';
    } catch (err) {
      if (isExternalIdConflict(err)) return 'conflict';
      throw err;
    }
  }

  /**
   * Read ids already spoken for on this book. Soft-deleted attempts are included on purpose:
   * reading_attempts_external_uidx has no deleted_at predicate, and a deleted attempt keeping its
   * external id is the tombstone importExternalRead relies on to avoid re-importing a removed read.
   */
  async findClaimedHardcoverReadIds(userId: number, bookId: number): Promise<number[]> {
    const rows = await this.db
      .select({ externalId: schema.readingAttempts.externalId })
      .from(schema.readingAttempts)
      .where(
        and(
          eq(schema.readingAttempts.userId, userId),
          eq(schema.readingAttempts.bookId, bookId),
          eq(schema.readingAttempts.externalProvider, HARDCOVER_EXTERNAL_PROVIDER),
          isNotNull(schema.readingAttempts.externalId),
        ),
      );
    const ids: number[] = [];
    for (const row of rows) {
      const parsed = Number(row.externalId);
      if (Number.isInteger(parsed) && parsed > 0) ids.push(parsed);
    }
    return ids;
  }

  async findBookIdByFileId(bookFileId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, bookFileId))
      .limit(1);
    return row?.bookId ?? null;
  }

  async findImportCandidateBooks(
    userId: number,
    accessibleLibraryIds: number[],
    contentFilters?: ContentFilterRules,
  ): Promise<HardcoverImportLocalBook[]> {
    if (accessibleLibraryIds.length === 0) return [];

    const contentFilterClauses = contentFilters ? buildContentFilterClauses(contentFilters, this.db) : [];
    const maxProgressSq = this.db
      .select({
        bookId: schema.bookFiles.bookId,
        maxProgress: sql<number>`max(${schema.readingProgress.percentage})`.as('max_progress'),
      })
      .from(schema.bookFiles)
      .innerJoin(schema.readingProgress, and(eq(schema.readingProgress.bookFileId, schema.bookFiles.id), eq(schema.readingProgress.userId, userId)))
      .groupBy(schema.bookFiles.bookId)
      .as('import_max_progress_sq');

    const rows = await this.db
      .select({
        bookId: schema.books.id,
        primaryFileId: schema.books.primaryFileId,
        primaryFileFormat: schema.bookFiles.format,
        title: schema.bookMetadata.title,
        isbn13: schema.bookMetadata.isbn13,
        isbn10: schema.bookMetadata.isbn10,
        hardcoverMetadataId: schema.bookMetadata.hardcoverId,
        authorsCsv: sql<string>`coalesce(string_agg(${schema.authors.name}, '||' order by ${schema.bookAuthors.displayOrder}, ${schema.bookAuthors.authorId}), '')`,
        status: schema.userBookStatus.status,
        startedAt: schema.userBookStatus.startedAt,
        finishedAt: schema.userBookStatus.finishedAt,
        progress: maxProgressSq.maxProgress,
      })
      .from(schema.books)
      .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
      .leftJoin(schema.bookAuthors, eq(schema.bookAuthors.bookId, schema.books.id))
      .leftJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .leftJoin(schema.userBookStatus, and(eq(schema.userBookStatus.bookId, schema.books.id), eq(schema.userBookStatus.userId, userId)))
      .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .leftJoin(maxProgressSq, eq(maxProgressSq.bookId, schema.books.id))
      .where(and(inArray(schema.books.libraryId, accessibleLibraryIds), eq(schema.books.status, 'present'), ...contentFilterClauses))
      .groupBy(
        schema.books.id,
        schema.books.primaryFileId,
        schema.bookFiles.format,
        schema.bookMetadata.title,
        schema.bookMetadata.isbn13,
        schema.bookMetadata.isbn10,
        schema.bookMetadata.hardcoverId,
        schema.userBookStatus.status,
        schema.userBookStatus.startedAt,
        schema.userBookStatus.finishedAt,
        maxProgressSq.maxProgress,
      );

    return rows.map((row) => ({
      bookId: row.bookId,
      primaryFileId: row.primaryFileId,
      primaryFileFormat: row.primaryFileFormat,
      title: row.title,
      isbn13: row.isbn13,
      isbn10: row.isbn10,
      hardcoverMetadataId: row.hardcoverMetadataId,
      authors: row.authorsCsv ? row.authorsCsv.split('||').filter((author) => author.length > 0) : [],
      status: row.status as ReadStatus | null,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      progress: row.progress,
    }));
  }

  async upsertImportProgress(userId: number, bookFileId: number, percentage: number): Promise<boolean> {
    const now = new Date();
    const normalizedPercentage = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
    const [row] = await this.db
      .insert(schema.readingProgress)
      .values({
        userId,
        bookFileId,
        cfi: null,
        pageNumber: null,
        percentage: normalizedPercentage,
        positionSeconds: null,
        koboLocationSource: null,
        koboLocationType: null,
        koboLocationValue: null,
        koboContentSourceProgressPercent: null,
        koreaderProgress: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        setWhere: sql`${schema.readingProgress.percentage} <= 0`,
        set: {
          cfi: null,
          pageNumber: null,
          percentage: normalizedPercentage,
          positionSeconds: null,
          koboLocationSource: null,
          koboLocationType: null,
          koboLocationValue: null,
          koboContentSourceProgressPercent: null,
          koreaderProgress: null,
          updatedAt: now,
        },
      })
      .returning({ bookFileId: schema.readingProgress.bookFileId });
    return row != null;
  }
}
