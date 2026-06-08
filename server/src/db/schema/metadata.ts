import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

const embedding256 = customType<{ data: number[]; driverData: string }>({
  dataType: () => 'vector(256)',
  toDriver: (v) => `[${v.join(',')}]`,
  fromDriver: (v) => {
    if (typeof v !== 'string' || !v || v === '[]') return [];
    return v
      .slice(1, -1)
      .split(',')
      .map((n) => parseFloat(n));
  },
});

import { books } from './books';
import { bookSeries } from './series';

export const bookMetadata = pgTable(
  'book_metadata',
  {
    bookId: integer('book_id')
      .primaryKey()
      .references(() => books.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 1000 }),
    subtitle: varchar('subtitle', { length: 1000 }),
    description: text('description'),
    isbn10: varchar('isbn10', { length: 10 }),
    isbn13: varchar('isbn13', { length: 13 }),
    publisher: varchar('publisher', { length: 500 }),
    publishedYear: integer('published_year'),
    language: varchar('language', { length: 100 }),
    pageCount: integer('page_count'),
    seriesId: integer('series_id').references(() => bookSeries.id, { onDelete: 'set null' }),
    seriesName: varchar('series_name', { length: 500 }),
    seriesIndex: real('series_index'),
    rating: integer('rating'),
    coverSource: varchar('cover_source', { length: 9 }),
    googleBooksId: varchar('google_books_id', { length: 50 }),
    goodreadsId: varchar('goodreads_id', { length: 50 }),
    amazonId: varchar('amazon_id', { length: 20 }),
    hardcoverId: varchar('hardcover_id', { length: 255 }),
    openLibraryId: varchar('open_library_id', { length: 50 }),
    itunesId: varchar('itunes_id', { length: 50 }),
    koboId: varchar('kobo_id', { length: 255 }),
    metadataScore: integer('metadata_score'),
    lastMetadataFetchAt: timestamp('last_metadata_fetch_at', { withTimezone: true }),
    embedding: embedding256('embedding'),
    lastWrittenAt: timestamp('last_written_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds'),
    abridged: boolean('abridged').notNull().default(false),
    audibleId: varchar('audible_id', { length: 20 }),
    comicvineId: varchar('comicvine_id', { length: 50 }),
    ranobedbId: varchar('ranobedb_id', { length: 50 }),
    chapters: jsonb('chapters'),
    lockedFields: text('locked_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('bm_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('bm_title_lower_idx').on(sql`lower(${t.title})`),
    index('bm_series_trgm_idx').using('gin', t.seriesName.op('gin_trgm_ops')),
    index('bm_series_id_idx').on(t.seriesId),
    index('bm_series_name_lower_btrim_idx').on(sql`lower(btrim(${t.seriesName}))`),
    index('bm_publisher_trgm_idx').using('gin', t.publisher.op('gin_trgm_ops')),
    index('bm_language_idx').on(t.language),
    index('bm_language_trgm_idx').using('gin', t.language.op('gin_trgm_ops')),
    index('bm_published_year_idx').on(t.publishedYear),
    index('bm_series_name_index_idx').on(t.seriesName, t.seriesIndex),
    index('bm_isbn10_idx').on(t.isbn10),
    index('bm_isbn13_idx').on(t.isbn13),
    index('bm_embedding_hnsw_cosine_idx').using('hnsw', sql`${t.embedding} vector_cosine_ops`),
    check('book_metadata_rating_range_chk', sql`${t.rating} is null or (${t.rating} >= 1 and ${t.rating} <= 10)`),
    check('book_metadata_published_year_range_chk', sql`${t.publishedYear} is null or (${t.publishedYear} >= 1000 and ${t.publishedYear} <= 2200)`),
    check('book_metadata_page_count_nonnegative_chk', sql`${t.pageCount} is null or ${t.pageCount} >= 0`),
    check('book_metadata_duration_seconds_nonnegative_chk', sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`),
    check('book_metadata_cover_source_chk', sql`${t.coverSource} is null or ${t.coverSource} in ('extracted', 'custom')`),
  ],
);

export const authors = pgTable(
  'authors',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 500 }).notNull(),
    sortName: varchar('sort_name', { length: 500 }),
    description: text('description'),
    hasPhoto: boolean('has_photo').notNull().default(false),
    lastEnrichedAt: timestamp('last_enriched_at', { withTimezone: true }),
  },
  (t) => [unique('authors_name_unique').on(t.name), index('authors_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops'))],
);

export const bookAuthors = pgTable(
  'book_authors',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    authorId: integer('author_id')
      .notNull()
      .references(() => authors.id),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.authorId] }),
    index('book_authors_author_id_idx').on(t.authorId),
    index('book_authors_book_display_idx').on(t.bookId, t.displayOrder),
  ],
);

export const authorEnrichmentQueue = pgTable(
  'author_enrichment_queue',
  {
    authorId: integer('author_id')
      .primaryKey()
      .references(() => authors.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    reason: varchar('reason', { length: 50 }).notNull().default('unknown'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastHttpStatus: integer('last_http_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('author_enrichment_queue_status_next_attempt_idx').on(t.status, t.nextAttemptAt),
    index('author_enrichment_queue_next_attempt_idx').on(t.nextAttemptAt),
    uniqueIndex('author_enrichment_queue_single_processing_idx')
      .on(t.status)
      .where(sql`${t.status} = 'processing'`),
    check('author_enrichment_queue_status_chk', sql`${t.status} in ('queued', 'processing', 'rate_limited', 'failed', 'done')`),
    check(
      'author_enrichment_queue_reason_chk',
      sql`${t.reason} in ('unknown', 'metadata_replace', 'manual_backfill', 'manual_backfill_all', 'author_rename', 'author_merge_target')`,
    ),
    check('author_enrichment_queue_attempt_count_nonnegative_chk', sql`${t.attemptCount} >= 0`),
  ],
);

export const genres = pgTable(
  'genres',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 200 }).notNull().unique(),
  },
  (t) => [index('genres_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops'))],
);

export const bookGenres = pgTable(
  'book_genres',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    genreId: integer('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.genreId] }), index('book_genres_genre_id_idx').on(t.genreId)],
);

export const tags = pgTable(
  'tags',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 200 }).notNull().unique(),
  },
  (t) => [index('tags_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops'))],
);

export const bookTags = pgTable(
  'book_tags',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.tagId] }), index('book_tags_tag_id_idx').on(t.tagId)],
);

export type BookMetadata = typeof bookMetadata.$inferSelect;
export type NewBookMetadata = typeof bookMetadata.$inferInsert;

export type Author = typeof authors.$inferSelect;
export type NewAuthor = typeof authors.$inferInsert;

export type Genre = typeof genres.$inferSelect;
export type NewGenre = typeof genres.$inferInsert;

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;

export type AuthorEnrichmentQueue = typeof authorEnrichmentQueue.$inferSelect;
export type NewAuthorEnrichmentQueue = typeof authorEnrichmentQueue.$inferInsert;

export const bookMetadataFetchQueue = pgTable(
  'book_metadata_fetch_queue',
  {
    bookId: integer('book_id')
      .primaryKey()
      .references(() => books.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    reason: varchar('reason', { length: 50 }).notNull().default('manual_trigger'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    lastHttpStatus: integer('last_http_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('bmfq_status_idx').on(t.status),
    index('bmfq_created_at_idx').on(t.createdAt),
    index('bmfq_status_created_book_idx').on(t.status, t.createdAt, t.bookId),
    check('book_metadata_fetch_queue_status_chk', sql`${t.status} in ('queued', 'processing', 'failed')`),
    check('book_metadata_fetch_queue_reason_chk', sql`${t.reason} in ('event_import', 'manual_trigger', 'manual_retry')`),
    check('book_metadata_fetch_queue_attempt_count_nonnegative_chk', sql`${t.attemptCount} >= 0`),
  ],
);

export type BookMetadataFetchQueue = typeof bookMetadataFetchQueue.$inferSelect;
export type NewBookMetadataFetchQueue = typeof bookMetadataFetchQueue.$inferInsert;
