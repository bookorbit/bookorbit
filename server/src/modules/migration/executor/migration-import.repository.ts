import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { SeriesIdentityService } from '../../../common/services/series-identity.service';
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
  ) {}

  async withTransaction<T>(handler: (repo: MigrationImportRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => handler(new MigrationImportRepository(tx as unknown as Db, this.seriesIdentity)));
  }

  // --- Metadata ---

  async upsertBookMetadata(bookId: number, values: Partial<typeof schema.bookMetadata.$inferInsert>): Promise<void> {
    const patch = (await this.seriesIdentity?.resolveMetadataPatch(values, this.db)) ?? values;
    await this.db
      .insert(schema.bookMetadata)
      .values({ bookId, ...patch })
      .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: patch });
  }

  // --- Authors ---

  async deleteBookAuthors(bookId: number): Promise<void> {
    await this.db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, bookId));
  }

  async upsertAuthor(values: typeof schema.authors.$inferInsert): Promise<{ id: number } | null> {
    const [row] = await this.db
      .insert(schema.authors)
      .values(values)
      .onConflictDoUpdate({ target: schema.authors.name, set: values })
      .returning({ id: schema.authors.id });
    return row ?? null;
  }

  async insertBookAuthor(bookId: number, authorId: number, displayOrder: number): Promise<void> {
    await this.db.insert(schema.bookAuthors).values({ bookId, authorId, displayOrder }).onConflictDoNothing();
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
    await this.db
      .delete(schema.userBookStatus)
      .where(and(inArray(schema.userBookStatus.userId, targetUserIds), inArray(schema.userBookStatus.bookId, targetBookIds)));
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

  // --- Reading progress ---

  async clearReadingProgress(userIds: number[], fileIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetFileIds = uniqueNumbers(fileIds);
    if (targetUserIds.length === 0 || targetFileIds.length === 0) return;
    await this.db
      .delete(schema.readingProgress)
      .where(and(inArray(schema.readingProgress.userId, targetUserIds), inArray(schema.readingProgress.bookFileId, targetFileIds)));
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
    await this.db
      .delete(schema.audiobookProgress)
      .where(and(inArray(schema.audiobookProgress.userId, targetUserIds), inArray(schema.audiobookProgress.bookId, targetBookIds)));
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
    await this.db
      .delete(schema.bookmarks)
      .where(and(inArray(schema.bookmarks.userId, targetUserIds), inArray(schema.bookmarks.bookId, targetBookIds)));
  }

  async insertBookmark(values: typeof schema.bookmarks.$inferInsert): Promise<void> {
    await this.db.insert(schema.bookmarks).values(values).onConflictDoNothing();
  }

  // --- Annotations ---

  async clearAnnotations(userIds: number[], bookIds: number[]): Promise<void> {
    const targetUserIds = uniqueNumbers(userIds);
    const targetBookIds = uniqueNumbers(bookIds);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    await this.db
      .delete(schema.annotations)
      .where(and(inArray(schema.annotations.userId, targetUserIds), inArray(schema.annotations.bookId, targetBookIds)));
  }

  async insertAnnotation(values: typeof schema.annotations.$inferInsert): Promise<void> {
    await this.db.insert(schema.annotations).values(values);
  }

  // --- Collections ---

  async fetchExistingCollections(userIds: number[]): Promise<Array<typeof schema.collections.$inferSelect>> {
    if (userIds.length === 0) return [];
    return this.db.select().from(schema.collections).where(inArray(schema.collections.userId, userIds));
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
        const patch = (await this.seriesIdentity?.resolveMetadataPatch(item, this.db)) ?? item;
        const set = bookMetadataConflictSet(patch);
        await this.db.insert(schema.bookMetadata).values(patch).onConflictDoUpdate({
          target: schema.bookMetadata.bookId,
          set,
        });
      }
    }
  }

  async batchDeleteBookAuthors(bookIds: number[]): Promise<void> {
    if (bookIds.length === 0) return;
    for (const batch of chunk(bookIds, BATCH_CHUNK_SIZE)) {
      await this.db.delete(schema.bookAuthors).where(inArray(schema.bookAuthors.bookId, batch));
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
    }
    return nameToId;
  }

  async batchInsertBookAuthors(items: Array<{ bookId: number; authorId: number; displayOrder: number }>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.bookAuthors).values(batch).onConflictDoNothing();
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

  async batchInsertBookmarks(items: Array<typeof schema.bookmarks.$inferInsert>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.bookmarks).values(batch).onConflictDoNothing();
    }
  }

  async batchInsertAnnotations(items: Array<typeof schema.annotations.$inferInsert>): Promise<void> {
    if (items.length === 0) return;
    for (const batch of chunk(items, BATCH_CHUNK_SIZE)) {
      await this.db.insert(schema.annotations).values(batch);
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

    const rows = await this.db
      .select({
        bookId: schema.books.id,
        primaryFileId: schema.books.primaryFileId,
        primaryFileFormat: schema.bookFiles.format,
      })
      .from(schema.books)
      .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .where(inArray(schema.books.id, bookIds));

    for (const row of rows) {
      if (!row.primaryFileId) continue;
      primaryFilesByBookId.set(row.bookId, row.primaryFileId);
      if (row.primaryFileFormat && isAudioFormat(row.primaryFileFormat)) {
        audiobookPrimaryFilesByBookId.set(row.bookId, row.primaryFileId);
      }
    }

    return { primaryFilesByBookId, audiobookPrimaryFilesByBookId };
  }

  async fetchTargetBookFiles(bookIds: number[]): Promise<Map<number, Array<{ id: number; hash: string | null; absolutePath: string }>>> {
    const result = new Map<number, Array<{ id: number; hash: string | null; absolutePath: string }>>();
    if (bookIds.length === 0) return result;

    const rows = await this.db
      .select({
        id: schema.bookFiles.id,
        bookId: schema.bookFiles.bookId,
        hash: schema.bookFiles.fileHash,
        absolutePath: schema.bookFiles.absolutePath,
      })
      .from(schema.bookFiles)
      .where(inArray(schema.bookFiles.bookId, bookIds));

    for (const row of rows) {
      const files = result.get(row.bookId) ?? [];
      files.push({ id: row.id, hash: row.hash, absolutePath: row.absolutePath });
      result.set(row.bookId, files);
    }

    return result;
  }

  async fetchLibraryIdsByBookIds(bookIds: number[]): Promise<Map<number, number>> {
    const result = new Map<number, number>();
    if (bookIds.length === 0) return result;

    const rows = await this.db
      .select({ id: schema.books.id, libraryId: schema.books.libraryId })
      .from(schema.books)
      .where(inArray(schema.books.id, bookIds));

    for (const row of rows) {
      result.set(row.id, row.libraryId);
    }

    return result;
  }
}
