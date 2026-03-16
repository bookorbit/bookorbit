import { sql } from 'drizzle-orm';
import { boolean, customType, index, integer, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

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
    seriesName: varchar('series_name', { length: 500 }),
    seriesIndex: real('series_index'),
    rating: integer('rating'),
    coverSource: varchar('cover_source', { length: 9 }),
    googleBooksId: varchar('google_books_id', { length: 50 }),
    goodreadsId: varchar('goodreads_id', { length: 50 }),
    amazonId: varchar('amazon_id', { length: 20 }),
    hardcoverId: varchar('hardcover_id', { length: 50 }),
    openLibraryId: varchar('open_library_id', { length: 50 }),
    itunesId: varchar('itunes_id', { length: 50 }),
    metadataScore: integer('metadata_score'),
    lastMetadataFetchAt: timestamp('last_metadata_fetch_at'),
    embedding: embedding256('embedding'),
    lastWrittenAt: timestamp('last_written_at'),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('bm_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('bm_series_trgm_idx').using('gin', t.seriesName.op('gin_trgm_ops')),
    index('bm_publisher_trgm_idx').using('gin', t.publisher.op('gin_trgm_ops')),
    index('bm_language_idx').on(t.language),
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
    lastEnrichedAt: timestamp('last_enriched_at'),
  },
  (t) => [index('authors_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops'))],
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
  (t) => [primaryKey({ columns: [t.bookId, t.authorId] }), index('book_authors_author_id_idx').on(t.authorId)],
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
    nextAttemptAt: timestamp('next_attempt_at').notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at'),
    lastSuccessAt: timestamp('last_success_at'),
    lastError: text('last_error'),
    lastHttpStatus: integer('last_http_status'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
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
  ],
);

export const genres = pgTable('genres', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
});

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
  (t) => [primaryKey({ columns: [t.bookId, t.genreId] })],
);

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
});

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
  (t) => [primaryKey({ columns: [t.bookId, t.tagId] })],
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
    lastAttemptAt: timestamp('last_attempt_at'),
    lastError: text('last_error'),
    lastHttpStatus: integer('last_http_status'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [index('bmfq_status_idx').on(t.status), index('bmfq_created_at_idx').on(t.createdAt)],
);

export type BookMetadataFetchQueue = typeof bookMetadataFetchQueue.$inferSelect;
export type NewBookMetadataFetchQueue = typeof bookMetadataFetchQueue.$inferInsert;
