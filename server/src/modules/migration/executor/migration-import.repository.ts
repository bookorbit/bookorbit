import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, gt, inArray, like, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import { refreshPrimaryAuthorSortNamesForAuthors, refreshPrimaryAuthorSortNamesForBooks } from '../../../db/book-author-sort-key';
import * as schema from '../../../db/schema';
import { SeriesIdentityService } from '../../../common/services/series-identity.service';
import { SeriesMembershipService } from '../../../common/services/series-membership.service';
import {
  aggregateReadingSessionDailyStats,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  type ReadingDailyStatsSegment,
} from '../../../common/utils/reading-daily-stats.utils';
import { resolveTimeZone } from '../../../common/utils/timezone.utils';
import { uniqueNumbers } from './executor-utils';

type Db = NodePgDatabase<typeof schema>;

const BATCH_CHUNK_SIZE = 500;

function omitKeys<T extends Record<string, unknown>>(obj: T, ...keys: string[]): Partial<T> {
  const keySet = new Set(keys);
  const result = {} as Partial<T>;
  for (const [key, value] of Object.entries(obj)) {
    if (!keySet.has(key)) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

const BOOK_METADATA_COLUMN_BY_PROPERTY = {
  title: 'title',
  subtitle: 'subtitle',
  description: 'description',
  publisher: 'publisher',
  publishedYear: 'published_year',
  language: 'language',
  pageCount: 'page_count',
  isbn10: 'isbn10',
  isbn13: 'isbn13',
  seriesName: 'series_name',
  seriesId: 'series_id',
  seriesIndex: 'series_index',
  rating: 'rating',
  googleBooksId: 'google_books_id',
  goodreadsId: 'goodreads_id',
  amazonId: 'amazon_id',
  hardcoverId: 'hardcover_id',
  koboId: 'kobo_id',
  audibleId: 'audible_id',
  comicvineId: 'comicvine_id',
  openLibraryId: 'open_library_id',
  itunesId: 'itunes_id',
  durationSeconds: 'duration_seconds',
  abridged: 'abridged',
} as const;

function bookMetadataConflictSet(item: Record<string, unknown>): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(BOOK_METADATA_COLUMN_BY_PROPERTY)) {
    if (Object.prototype.hasOwnProperty.call(item, property)) {
      set[property] = sql.raw(`excluded.${column}`);
    }
  }
  set.updatedAt = sql`now()`;
  return set;
}

@Injectable()
export class MigrationImportRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly seriesIdentity?: SeriesIdentityService,
    @Optional() private readonly seriesMemberships?: SeriesMembershipService,
  ) {}

  async withTransaction<T>(handler: (repo: MigrationImportRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) =>
      handler(new MigrationImportRepository(tx as unknown as Db, this.seriesIdentity, this.seriesMemberships)),
    );
  }

  // --- Metadata ---

  async upsertBookMetadata(bookId: number, values: Partial<typeof schema.bookMetadata.$inferInsert>): Promise<void> {
    const shouldSyncSeries =
      Object.prototype.hasOwnProperty.call(values, 'seriesName') || Object.prototype.hasOwnProperty.call(values, 'seriesIndex');
    const patch = (await this.seriesIdentity?.resolveMetadataPatch(values, this.db)) ?? values;
    await this.db
      .insert(schema.bookMetadata)
      .values({ bookId, ...patch })
      .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: patch });
    if (shouldSyncSeries) {
      await this.seriesMemberships?.syncPrimaryFromMetadata(bookId, this.db);
    }
  }

  // --- Authors ---

  async deleteBookAuthors(bookId: number): Promise<void> {
    await this.db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, bookId));
    await refreshPrimaryAuthorSortNamesForBooks(this.db, [bookId]);
  }

  async upsertAuthor(values: typeof schema.authors.$inferInsert): Promise<{ id: number } | null> {
    const [row] = await this.db
      .insert(schema.authors)
      .values(values)
      .onConflictDoUpdate({ target: schema.authors.name, set: values })
      .returning({ id: schema.authors.id });
    if (row) await refreshPrimaryAuthorSortNamesForAuthors(this.db, [row.id]);
    return row ?? null;
  }

  async insertBookAuthor(bookId: number, authorId: number, displayOrder: number): Promise<void> {
    await this.db.insert(schema.bookAuthors).values({ bookId, authorId, displayOrder }).onConflictDoNothing();
    await refreshPrimaryAuthorSortNamesForBooks(this.db, [bookId]);
  }

  // --- Narrators ---

  async deleteBookNarrators(bookId: number): Promise<void> {
    await this.db.delete(schema.bookNarrators).where(eq(schema.bookNarrators.bookId, bookId));
  }

  async upsertNarrator(values: { name: string; sortName: string }): Promise<{ id: number } | null> {
    const [row] = await this.db
      .insert(schema.narrators)
      .values(values)
      .onConflictDoUpdate({ target: schema.narrators.name, set: values })
      .returning({ id: schema.narrators.id });
    return row ?? null;
  }

  async insertBookNarrator(bookId: number, narratorId: number, displayOrder: number): Promise<void> {
    await this.db.insert(schema.bookNarrators).values({ bookId, narratorId, displayOrder }).onConflictDoNothing();
  }

  // --- Genres ---

  async deleteBookGenres(bookId: number): Promise<void> {
    await this.db.delete(schema.bookGenres).where(eq(schema.bookGenres.bookId, bookId));
  }

  async upsertGenre(name: string): Promise<{ id: number } | null> {
    const [row] = await this.db
      .insert(schema.genres)
      .values({ name })
      .onConflictDoUpdate({ target: schema.genres.name, set: { name: sql`excluded.name` } })
      .returning({ id: schema.genres.id });
    return row ?? null;
  }

  async insertBookGenre(bookId: number, genreId: number): Promise<void> {
    await this.db.insert(schema.bookGenres).values({ bookId, genreId }).onConflictDoNothing();
  }

  // --- Tags ---

  async deleteBookTags(bookId: number): Promise<void> {
    await this.db.delete(schema.bookTags).where(eq(schema.bookTags.bookId, bookId));
  }

  async upsertTag(name: string): Promise<{ id: number } | null> {
    const [row] = await this.db
      .insert(schema.tags)
      .values({ name })
      .onConflictDoUpdate({ target: schema.tags.name, set: { name: sql`excluded.name` } })
      .returning({ id: schema.tags.id });
    return row ?? null;
  }

  async insertBookTag(bookId: number, tagId: number): Promise<void> {
    await this.db.insert(schema.bookTags).values({ bookId, tagId }).onConflictDoNothing();
  }

  // --- Cover metadata ---

  async markCoverAsCustom(bookId: number): Promise<void> {
    const now = new Date();
    await this.db
      .insert(schema.bookMetadata)
      .values({ bookId, coverSource: 'custom', updatedAt: now })
      .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: { coverSource: 'custom', updatedAt: now } });
  }

  // --- User book statuses ---

  async clearUserBookStatuses(userIds: number[], bookIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      for (const bookBatch of chunk(targetBookIds, BATCH_CHUNK_SIZE)) {
        await this.db
          .delete(schema.userBookStatus)
          .where(and(inArray(schema.userBookStatus.userId, userBatch), inArray(schema.userBookStatus.bookId, bookBatch)));
      }
    }
  }

  async upsertUserBookStatus(values: typeof schema.userBookStatus.$inferInsert): Promise<void> {
    await this.db
      .insert(schema.userBookStatus)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.userBookStatus.userId, schema.userBookStatus.bookId],
        set: omitKeys(values, 'userId', 'bookId'),
      });
  }

  async clearUserBookRatings(userIds: number[], bookIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      for (const bookBatch of chunk(targetBookIds, BATCH_CHUNK_SIZE)) {
        await this.db
          .delete(schema.userBookRatings)
          .where(and(inArray(schema.userBookRatings.userId, userBatch), inArray(schema.userBookRatings.bookId, bookBatch)));
      }
    }
  }

  // --- Reading progress ---

  async clearReadingProgress(userIds: number[], fileIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetFileIds = uniqueNumbers(fileIds);
    if (targetUserIds.length === 0 || targetFileIds.length === 0) return;
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      for (const fileBatch of chunk(targetFileIds, BATCH_CHUNK_SIZE)) {
        await this.db
          .delete(schema.readingProgress)
          .where(and(inArray(schema.readingProgress.userId, userBatch), inArray(schema.readingProgress.bookFileId, fileBatch)));
      }
    }
  }

  async upsertReadingProgress(values: typeof schema.readingProgress.$inferInsert): Promise<void> {
    await this.db
      .insert(schema.readingProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        set: omitKeys(values, 'bookFileId', 'userId'),
      });
  }

  // --- Audiobook progress ---

  async clearAudiobookProgress(userIds: number[], bookIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      for (const bookBatch of chunk(targetBookIds, BATCH_CHUNK_SIZE)) {
        await this.db
          .delete(schema.audiobookProgress)
          .where(and(inArray(schema.audiobookProgress.userId, userBatch), inArray(schema.audiobookProgress.bookId, bookBatch)));
      }
    }
  }

  async upsertAudiobookProgress(values: typeof schema.audiobookProgress.$inferInsert): Promise<void> {
    await this.db
      .insert(schema.audiobookProgress)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.audiobookProgress.userId, schema.audiobookProgress.bookId],
        set: omitKeys(values, 'userId', 'bookId'),
      });
  }

  // --- Bookmarks ---

  async clearBookmarks(userIds: number[], bookIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      for (const bookBatch of chunk(targetBookIds, BATCH_CHUNK_SIZE)) {
        await this.db.delete(schema.bookmarks).where(and(inArray(schema.bookmarks.userId, userBatch), inArray(schema.bookmarks.bookId, bookBatch)));
      }
    }
  }

  async insertBookmark(values: typeof schema.bookmarks.$inferInsert): Promise<void> {
    await this.db.insert(schema.bookmarks).values(values).onConflictDoNothing();
  }

  // --- Annotations ---

  async clearAnnotations(userIds: number[], bookIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    // Only web-origin rows are replaced by an import; device-synced annotations stay.
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      for (const bookBatch of chunk(targetBookIds, BATCH_CHUNK_SIZE)) {
        await this.db
          .delete(schema.annotations)
          .where(
            and(inArray(schema.annotations.userId, userBatch), inArray(schema.annotations.bookId, bookBatch), eq(schema.annotations.origin, 'web')),
          );
      }
    }
  }

  async insertAnnotation(values: typeof schema.annotations.$inferInsert & { cfi: string }): Promise<void> {
    const { cfi, ...annotation } = values;
    const [row] = await this.db
      .insert(schema.annotations)
      .values(annotation)
      .returning({ id: schema.annotations.id, userId: schema.annotations.userId });
    await this.db.insert(schema.annotationPositions).values({ annotationId: row.id, userId: row.userId, format: 'cfi', pos0: cfi, status: 'exact' });
  }

  // --- Collections ---

  async fetchExistingCollections(userIds: number[]): Promise<Array<typeof schema.collections.$inferSelect>> {
    const targetUserIds = uniqueNumbers(userIds);
    if (targetUserIds.length === 0) return [];
    const collections: Array<typeof schema.collections.$inferSelect> = [];
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      collections.push(...(await this.db.select().from(schema.collections).where(inArray(schema.collections.userId, userBatch))));
    }
    return collections;
  }

  async insertCollection(values: typeof schema.collections.$inferInsert): Promise<{ id: number }> {
    const [row] = await this.db.insert(schema.collections).values(values).returning({ id: schema.collections.id });
    return row;
  }

  async clearCollectionBooks(collectionId: number): Promise<void> {
    await this.db.delete(schema.collectionBooks).where(eq(schema.collectionBooks.collectionId, collectionId));
  }

  async upsertCollectionBook(collectionId: number, bookId: number): Promise<boolean> {
    const inserted = await this.db
      .insert(schema.collectionBooks)
      .values({ collectionId, bookId })
      .onConflictDoNothing()
      .returning({ collectionId: schema.collectionBooks.collectionId });
    return inserted.length > 0;
  }

  // --- Batch operations ---

  async batchUpsertBookMetadata(items: Array<{ bookId: number } & Partial<typeof schema.bookMetadata.$inferInsert>>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      for (const item of batch) {
        const shouldSyncSeries =
          Object.prototype.hasOwnProperty.call(item, 'seriesName') || Object.prototype.hasOwnProperty.call(item, 'seriesIndex');
        const patch = (await this.seriesIdentity?.resolveMetadataPatch(item, this.db)) ?? item;
        const set = bookMetadataConflictSet(patch);
        await this.db.insert(schema.bookMetadata).values(patch).onConflictDoUpdate({
          target: schema.bookMetadata.bookId,
          set,
        });
        if (shouldSyncSeries) {
          await this.seriesMemberships?.syncPrimaryFromMetadata(item.bookId, this.db);
        }
      }
    }
  }

  async batchDeleteBookAuthors(bookIds: number[]): Promise<void> {
    if (bookIds.length === 0) return;
    for (const batch of chunk(bookIds, BATCH_CHUNK_SIZE)) {
      await this.db.delete(schema.bookAuthors).where(inArray(schema.bookAuthors.bookId, batch));
      await refreshPrimaryAuthorSortNamesForBooks(this.db, batch);
    }
  }

  async batchUpsertAuthors(items: Array<typeof schema.authors.$inferInsert>): Promise<Map<string, number>> {
    const nameToId = new Map<string, number>();
    if (items.length === 0) return nameToId;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .insert(schema.authors)
        .values(batch)
        .onConflictDoUpdate({ target: schema.authors.name, set: { sortName: sql`excluded.sort_name` } })
        .returning({ id: schema.authors.id, name: schema.authors.name });
      for (const row of rows) nameToId.set(row.name, row.id);
      await refreshPrimaryAuthorSortNamesForAuthors(
        this.db,
        rows.map((row) => row.id),
      );
    }
    return nameToId;
  }

  async batchInsertBookAuthors(items: Array<{ bookId: number; authorId: number; displayOrder: number }>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.bookAuthors).values(batch).onConflictDoNothing();
      await refreshPrimaryAuthorSortNamesForBooks(
        this.db,
        batch.map((item) => item.bookId),
      );
    }
  }

  async batchDeleteBookNarrators(bookIds: number[]): Promise<void> {
    if (bookIds.length === 0) return;
    for (const batch of chunk(bookIds, BATCH_CHUNK_SIZE)) {
      await this.db.delete(schema.bookNarrators).where(inArray(schema.bookNarrators.bookId, batch));
    }
  }

  async batchUpsertNarrators(items: Array<{ name: string; sortName: string }>): Promise<Map<string, number>> {
    const nameToId = new Map<string, number>();
    if (items.length === 0) return nameToId;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .insert(schema.narrators)
        .values(batch)
        .onConflictDoUpdate({ target: schema.narrators.name, set: { sortName: sql`excluded.sort_name` } })
        .returning({ id: schema.narrators.id, name: schema.narrators.name });
      for (const row of rows) nameToId.set(row.name, row.id);
    }
    return nameToId;
  }

  async batchInsertBookNarrators(items: Array<{ bookId: number; narratorId: number; displayOrder: number }>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.bookNarrators).values(batch).onConflictDoNothing();
    }
  }

  async batchDeleteBookGenres(bookIds: number[]): Promise<void> {
    if (bookIds.length === 0) return;
    for (const batch of chunk(bookIds, BATCH_CHUNK_SIZE)) {
      await this.db.delete(schema.bookGenres).where(inArray(schema.bookGenres.bookId, batch));
    }
  }

  async batchUpsertGenres(names: string[]): Promise<Map<string, number>> {
    const nameToId = new Map<string, number>();
    if (names.length === 0) return nameToId;
    const items = names.map((name) => ({ name }));
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .insert(schema.genres)
        .values(batch)
        .onConflictDoUpdate({ target: schema.genres.name, set: { name: sql`excluded.name` } })
        .returning({ id: schema.genres.id, name: schema.genres.name });
      for (const row of rows) nameToId.set(row.name, row.id);
    }
    return nameToId;
  }

  async batchInsertBookGenres(items: Array<{ bookId: number; genreId: number }>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.bookGenres).values(batch).onConflictDoNothing();
    }
  }

  async batchDeleteBookTags(bookIds: number[]): Promise<void> {
    if (bookIds.length === 0) return;
    for (const batch of chunk(bookIds, BATCH_CHUNK_SIZE)) {
      await this.db.delete(schema.bookTags).where(inArray(schema.bookTags.bookId, batch));
    }
  }

  async batchUpsertTags(names: string[]): Promise<Map<string, number>> {
    const nameToId = new Map<string, number>();
    if (names.length === 0) return nameToId;
    const items = names.map((name) => ({ name }));
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .insert(schema.tags)
        .values(batch)
        .onConflictDoUpdate({ target: schema.tags.name, set: { name: sql`excluded.name` } })
        .returning({ id: schema.tags.id, name: schema.tags.name });
      for (const row of rows) nameToId.set(row.name, row.id);
    }
    return nameToId;
  }

  async batchInsertBookTags(items: Array<{ bookId: number; tagId: number }>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.bookTags).values(batch).onConflictDoNothing();
    }
  }

  async batchUpsertUserBookStatuses(items: Array<typeof schema.userBookStatus.$inferInsert>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db
        .insert(schema.userBookStatus)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.userBookStatus.userId, schema.userBookStatus.bookId],
          set: {
            status: sql`excluded.status`,
            source: sql`excluded.source`,
            startedAt: sql`excluded.started_at`,
            finishedAt: sql`excluded.finished_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }

  async batchUpsertUserBookRatings(items: Array<typeof schema.userBookRatings.$inferInsert>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db
        .insert(schema.userBookRatings)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.userBookRatings.userId, schema.userBookRatings.bookId],
          set: {
            rating: sql`excluded.rating`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }

  async batchUpsertReadingProgress(items: Array<typeof schema.readingProgress.$inferInsert>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db
        .insert(schema.readingProgress)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
          set: {
            percentage: sql`excluded.percentage`,
            cfi: sql`excluded.cfi`,
            pageNumber: sql`excluded.page_number`,
            positionSeconds: sql`excluded.position_seconds`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }

  async batchUpsertAudiobookProgress(items: Array<typeof schema.audiobookProgress.$inferInsert>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db
        .insert(schema.audiobookProgress)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.audiobookProgress.userId, schema.audiobookProgress.bookId],
          set: {
            percentage: sql`excluded.percentage`,
            currentFileId: sql`excluded.current_file_id`,
            positionSeconds: sql`excluded.position_seconds`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  }

  async syncImportedReadingSessions(params: {
    items: Array<typeof schema.readingSessions.$inferInsert>;
    userIds: number[];
    bookIds: number[];
    sessionIdPrefix: string;
  }): Promise<void> {
    const targetUserIds = uniqueNumbers(params.userIds);
    const targetBookIds = uniqueNumbers(params.bookIds);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;

    const existing: Array<{
      id: number;
      userId: number;
      bookId: number;
      sessionId: string;
      startedAt: Date;
      endedAt: Date;
      durationSeconds: number;
      progressDelta: number | null;
      libraryId: number;
    }> = [];
    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      existing.push(
        ...(await this.db
          .select({
            id: schema.readingSessions.id,
            userId: schema.readingSessions.userId,
            bookId: schema.readingSessions.bookId,
            sessionId: schema.readingSessions.sessionId,
            startedAt: schema.readingSessions.startedAt,
            endedAt: schema.readingSessions.endedAt,
            durationSeconds: schema.readingSessions.durationSeconds,
            progressDelta: schema.readingSessions.progressDelta,
            libraryId: schema.books.libraryId,
          })
          .from(schema.readingSessions)
          .innerJoin(schema.books, eq(schema.books.id, schema.readingSessions.bookId))
          .where(and(inArray(schema.readingSessions.userId, userBatch), like(schema.readingSessions.sessionId, `${params.sessionIdPrefix}%`)))),
      );
    }

    const desiredKeys = new Set(params.items.map((item) => `${item.userId}:${item.sessionId}`));
    const targetBookIdSet = new Set(targetBookIds);
    const relevantExisting = existing.filter((row) => targetBookIdSet.has(row.bookId) || desiredKeys.has(`${row.userId}:${row.sessionId}`));
    const stale = relevantExisting.filter((row) => targetBookIdSet.has(row.bookId) && !desiredKeys.has(`${row.userId}:${row.sessionId}`));
    const timeZonesByUserId = await this.fetchTimeZonesByUserIds(targetUserIds);
    const affectedDaysByUserLibrary = new Map<string, { userId: number; libraryId: number; timeZone: string; days: Set<string> }>();

    const addAffectedDays = (entry: {
      userId: number;
      libraryId: number;
      startedAt: Date;
      endedAt: Date;
      durationSeconds: number;
      progressDelta: number | null;
    }) => {
      const timeZone = timeZonesByUserId.get(entry.userId) ?? 'UTC';
      const key = `${entry.userId}:${entry.libraryId}`;
      const group = affectedDaysByUserLibrary.get(key) ?? { userId: entry.userId, libraryId: entry.libraryId, timeZone, days: new Set<string>() };
      for (const day of getReadingSessionDayKeys(entry, timeZone)) {
        group.days.add(day);
      }
      affectedDaysByUserLibrary.set(key, group);
    };

    for (const row of relevantExisting) {
      addAffectedDays({
        userId: row.userId,
        libraryId: row.libraryId,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        progressDelta: row.progressDelta ?? null,
      });
    }

    if (stale.length > 0) {
      for (const batch of chunk(
        stale.map((row) => row.id),
        BATCH_CHUNK_SIZE,
      )) {
        await this.db.delete(schema.readingSessions).where(inArray(schema.readingSessions.id, batch));
      }
    }

    const libraryIdsByBookId = await this.fetchLibraryIdsByBookIds(params.items.map((item) => item.bookId));

    for (const item of params.items) {
      const libraryId = libraryIdsByBookId.get(item.bookId);
      if (!libraryId) continue;
      addAffectedDays({
        userId: item.userId,
        libraryId,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        durationSeconds: item.durationSeconds,
        progressDelta: item.progressDelta ?? null,
      });
    }

    for (const batch of chunk(params.items, BATCH_CHUNK_SIZE)) {
      await this.db
        .insert(schema.readingSessions)
        .values(batch)
        .onConflictDoUpdate({
          target: [schema.readingSessions.userId, schema.readingSessions.sessionId],
          set: {
            bookFileId: sql`excluded.book_file_id`,
            bookId: sql`excluded.book_id`,
            source: sql`excluded.source`,
            startedAt: sql`excluded.started_at`,
            endedAt: sql`excluded.ended_at`,
            durationSeconds: sql`excluded.duration_seconds`,
            progressDelta: sql`excluded.progress_delta`,
            endProgress: sql`excluded.end_progress`,
          },
        });
    }

    for (const group of affectedDaysByUserLibrary.values()) {
      await this.recomputeReadingDailyStats(group.userId, group.libraryId, [...group.days], group.timeZone);
    }
  }

  async batchInsertBookmarks(items: Array<typeof schema.bookmarks.$inferInsert>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.bookmarks).values(batch).onConflictDoNothing();
    }
  }

  async batchInsertAnnotations(items: Array<typeof schema.annotations.$inferInsert & { cfi: string }>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .insert(schema.annotations)
        .values(
          batch.map((item) => {
            const annotation: typeof schema.annotations.$inferInsert & { cfi?: string } = { ...item };
            delete annotation.cfi;
            return annotation;
          }),
        )
        .returning({ id: schema.annotations.id, userId: schema.annotations.userId });
      await this.db.insert(schema.annotationPositions).values(
        rows.map((row, index) => ({
          annotationId: row.id,
          userId: row.userId,
          format: 'cfi' as const,
          pos0: batch[index].cfi,
          status: 'exact' as const,
        })),
      );
    }
  }

  async batchInsertCollectionBooks(items: Array<{ collectionId: number; bookId: number }>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.collectionBooks).values(batch).onConflictDoNothing();
    }
  }

  // --- File lookups for user state ---

  async fetchTargetBookPrimaryFiles(bookIds: number[]): Promise<{
    primaryFilesByBookId: Map<number, number>;
    audiobookPrimaryFilesByBookId: Map<number, number>;
  }> {
    const primaryFilesByBookId = new Map<number, number>();
    const audiobookPrimaryFilesByBookId = new Map<number, number>();

    if (bookIds.length === 0) return { primaryFilesByBookId, audiobookPrimaryFilesByBookId };

    const { isAudioFormat } = await import('@bookorbit/types');

    for (const batch of chunk(uniqueNumbers(bookIds), BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .select({
          bookId: schema.books.id,
          primaryFileId: schema.books.primaryFileId,
          primaryFileFormat: schema.bookFiles.format,
        })
        .from(schema.books)
        .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
        .where(inArray(schema.books.id, batch));

      for (const row of rows) {
        if (!row.primaryFileId) continue;
        primaryFilesByBookId.set(row.bookId, row.primaryFileId);
        if (row.primaryFileFormat && isAudioFormat(row.primaryFileFormat)) {
          audiobookPrimaryFilesByBookId.set(row.bookId, row.primaryFileId);
        }
      }
    }

    return { primaryFilesByBookId, audiobookPrimaryFilesByBookId };
  }

  async fetchTargetBookFiles(
    bookIds: number[],
  ): Promise<Map<number, Array<{ id: number; hash: string | null; absolutePath: string; format: string | null }>>> {
    const result = new Map<number, Array<{ id: number; hash: string | null; absolutePath: string; format: string | null }>>();
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetBookIds.length === 0) return result;

    for (const batch of chunk(targetBookIds, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .select({
          id: schema.bookFiles.id,
          bookId: schema.bookFiles.bookId,
          hash: schema.bookFiles.fileHash,
          absolutePath: schema.bookFiles.absolutePath,
          format: schema.bookFiles.format,
        })
        .from(schema.bookFiles)
        .where(inArray(schema.bookFiles.bookId, batch));

      for (const row of rows) {
        const files = result.get(row.bookId) ?? [];
        files.push({ id: row.id, hash: row.hash, absolutePath: row.absolutePath, format: row.format });
        result.set(row.bookId, files);
      }
    }

    return result;
  }

  async fetchLibraryIdsByBookIds(bookIds: number[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetBookIds.length === 0) return result;

    for (const batch of chunk(targetBookIds, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .select({ id: schema.books.id, libraryId: schema.books.libraryId })
        .from(schema.books)
        .where(inArray(schema.books.id, batch));

      for (const row of rows) {
        result.set(row.id, row.libraryId);
      }
    }

    return result;
  }

  private async fetchTimeZonesByUserIds(userIds: number[]): Promise<Map<number, string>> {
    const result = new Map<number, string>();
    const targetUserIds = uniqueNumbers(userIds);
    if (targetUserIds.length === 0) return result;

    for (const userBatch of chunk(targetUserIds, BATCH_CHUNK_SIZE)) {
      const rows = await this.db
        .select({ id: schema.users.id, settings: schema.users.settings })
        .from(schema.users)
        .where(inArray(schema.users.id, userBatch));

      for (const row of rows) {
        result.set(row.id, resolveTimeZone((row.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC'));
      }
    }
    return result;
  }

  private async recomputeReadingDailyStats(userId: number, libraryId: number, days: string[], timeZone: string): Promise<void> {
    const affectedDays = [...new Set(days)].sort();
    if (affectedDays.length === 0) return;

    await this.lockReadingDailyStats(userId, libraryId);

    for (const dayBatch of chunk(affectedDays, BATCH_CHUNK_SIZE)) {
      await this.db
        .delete(schema.userReadingDailyStats)
        .where(
          and(
            eq(schema.userReadingDailyStats.userId, userId),
            eq(schema.userReadingDailyStats.libraryId, libraryId),
            inArray(schema.userReadingDailyStats.day, dayBatch),
          ),
        );
    }

    const range = getDayRangeForDateKeys(affectedDays, timeZone);
    if (!range) return;

    const rows = await this.db
      .select({
        startedAt: schema.readingSessions.startedAt,
        endedAt: schema.readingSessions.endedAt,
        durationSeconds: schema.readingSessions.durationSeconds,
        progressDelta: schema.readingSessions.progressDelta,
      })
      .from(schema.readingSessions)
      .innerJoin(schema.books, eq(schema.books.id, schema.readingSessions.bookId))
      .where(
        and(
          eq(schema.readingSessions.userId, userId),
          eq(schema.books.libraryId, libraryId),
          lt(schema.readingSessions.startedAt, range.end),
          gt(schema.readingSessions.endedAt, range.start),
        ),
      );

    const segments = aggregateReadingSessionDailyStats(
      rows.map((row) => ({
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        progressDelta: row.progressDelta ?? null,
      })),
      timeZone,
      new Set(affectedDays),
    );
    await this.insertReadingDailyStatsSegments(userId, libraryId, segments);
  }

  private async lockReadingDailyStats(userId: number, libraryId: number): Promise<void> {
    await this.db.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
  }

  private async insertReadingDailyStatsSegments(userId: number, libraryId: number, segments: ReadingDailyStatsSegment[]): Promise<void> {
    if (segments.length === 0) return;

    const now = new Date();
    for (const batch of chunk(segments, BATCH_CHUNK_SIZE)) {
      await this.db
        .insert(schema.userReadingDailyStats)
        .values(
          batch.map((segment) => ({
            userId,
            libraryId,
            day: segment.day,
            readingSeconds: segment.readingSeconds,
            progressDelta: segment.progressDelta,
            sessionsCount: segment.sessionsCount,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [schema.userReadingDailyStats.userId, schema.userReadingDailyStats.libraryId, schema.userReadingDailyStats.day],
          set: {
            readingSeconds: sql`excluded.reading_seconds`,
            progressDelta: sql`excluded.progress_delta`,
            sessionsCount: sql`excluded.sessions_count`,
            updatedAt: now,
          },
        });
    }
  }
}
