import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
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
  uuid,
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

import type { AudiobookChapter, AudiobookChapterSource, ChapterLookupQueueStatus, ChapterLookupReviewSummary } from '@bookorbit/types';

import { users } from './auth';
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
    publishedDate: date('published_date', { mode: 'string' }),
    publishedYear: integer('published_year'),
    language: varchar('language', { length: 100 }),
    pageCount: integer('page_count'),
    seriesId: integer('series_id').references(() => bookSeries.id, { onDelete: 'set null' }),
    seriesName: varchar('series_name', { length: 500 }),
    seriesIndex: varchar('series_index', { length: 20 }),
    rating: integer('rating'),
    coverSource: varchar('cover_source', { length: 9 }),
    googleBooksId: varchar('google_books_id', { length: 50 }),
    goodreadsId: varchar('goodreads_id', { length: 50 }),
    amazonId: varchar('amazon_id', { length: 20 }),
    hardcoverId: varchar('hardcover_id', { length: 255 }),
    hardcoverEditionId: varchar('hardcover_edition_id', { length: 50 }),
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
    librofmId: varchar('librofm_id', { length: 50 }),
    comicvineId: varchar('comicvine_id', { length: 50 }),
    ranobedbId: varchar('ranobedb_id', { length: 50 }),
    lubimyczytacId: text('lubimyczytac_id'),
    aladinId: varchar('aladin_id', { length: 20 }),
    chapters: jsonb('chapters'),
    chapterCount: integer('chapter_count').generatedAlwaysAs(
      sql`CASE WHEN jsonb_typeof(chapters) = 'array' THEN jsonb_array_length(chapters) ELSE 0 END`,
    ),
    numberedChapterCount: integer('numbered_chapter_count').generatedAlwaysAs(
      sql`CASE WHEN jsonb_typeof(chapters) = 'array' THEN jsonb_array_length(jsonb_path_query_array(chapters, '$[*] ? (@.title like_regex "^[[:space:]]*((track|disc|cd|part)[[:space:]]*)?[#._-]*[[:space:]]*[0-9]+([[:space:]]*(of|/)[[:space:]]*[0-9]+)?[[:space:]]*$" flag "i")')) ELSE 0 END`,
    ),
    manifestLegacyRecorded: boolean('manifest_legacy_recorded').notNull().default(false),
    // Where `chapters` came from. An automated pass may clear or re-derive only a list that was
    // itself read from the files; anything a provider, a migration or a person supplied stays.
    chaptersSource: varchar('chapters_source', { length: 20 }).$type<AudiobookChapterSource>(),
    chaptersUpdatedAt: timestamp('chapters_updated_at', { withTimezone: true }),
    chaptersUpdatedBy: integer('chapters_updated_by').references(() => users.id, { onDelete: 'set null' }),
    lockedFields: text('locked_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Moves only when the served cover image changes, so a Kobo device is not handed a fresh
    // CoverImageId for a picture it already stores locally. See buildVersionedCoverImageId().
    coverUpdatedAt: timestamp('cover_updated_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('bm_chapter_count_idx').on(t.chapterCount, t.bookId),
    index('bm_numbered_chapters_idx')
      .on(t.bookId)
      .where(sql`numbered_chapter_count >= chapter_count * 0.8 AND chapter_count >= 2`),
    index('bm_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('bm_title_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.title}) gin_trgm_ops`),
    index('bm_title_lower_idx').on(sql`lower(${t.title})`),
    index('bm_title_book_id_idx').on(t.title, t.bookId),
    index('bm_subtitle_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.subtitle}) gin_trgm_ops`),
    index('bm_series_trgm_idx').using('gin', t.seriesName.op('gin_trgm_ops')),
    index('bm_series_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.seriesName}) gin_trgm_ops`),
    index('bm_series_id_idx').on(t.seriesId),
    index('bm_chapters_updated_by_idx')
      .on(t.chaptersUpdatedBy)
      .where(sql`${t.chaptersUpdatedBy} is not null`),
    index('bm_series_id_index_book_id_idx').on(
      t.seriesId,
      sql`(CASE WHEN ${t.seriesIndex} IS NULL THEN NULL ELSE ARRAY[split_part(${t.seriesIndex}, '.', 1)::numeric, CASE WHEN strpos(${t.seriesIndex}, '.') = 0 THEN -1::numeric ELSE split_part(${t.seriesIndex}, '.', 2)::numeric END] END)`,
      sql`${t.seriesIndex} COLLATE "C"`,
      t.bookId,
    ),
    index('bm_series_index_sort_idx').on(
      sql`(CASE WHEN ${t.seriesIndex} IS NULL THEN NULL ELSE ARRAY[split_part(${t.seriesIndex}, '.', 1)::numeric, CASE WHEN strpos(${t.seriesIndex}, '.') = 0 THEN -1::numeric ELSE split_part(${t.seriesIndex}, '.', 2)::numeric END] END)`,
      sql`${t.seriesIndex} COLLATE "C"`,
      t.bookId,
    ),
    index('bm_series_name_lower_btrim_idx').on(sql`lower(btrim(${t.seriesName}))`),
    index('bm_publisher_trgm_idx').using('gin', t.publisher.op('gin_trgm_ops')),
    index('bm_publisher_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.publisher}) gin_trgm_ops`),
    index('bm_language_idx').on(t.language),
    index('bm_language_trgm_idx').using('gin', t.language.op('gin_trgm_ops')),
    index('bm_language_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.language}) gin_trgm_ops`),
    index('bm_published_date_idx').on(t.publishedDate),
    index('bm_published_year_idx').on(t.publishedYear),
    index('bm_page_count_idx').on(t.pageCount),
    index('bm_published_date_sort_idx').on(sql`coalesce(${t.publishedDate}, make_date(${t.publishedYear}, 1, 1))`),
    index('bm_series_name_index_idx').on(
      t.seriesName,
      sql`(CASE WHEN ${t.seriesIndex} IS NULL THEN NULL ELSE ARRAY[split_part(${t.seriesIndex}, '.', 1)::numeric, CASE WHEN strpos(${t.seriesIndex}, '.') = 0 THEN -1::numeric ELSE split_part(${t.seriesIndex}, '.', 2)::numeric END] END)`,
      sql`${t.seriesIndex} COLLATE "C"`,
    ),
    index('bm_isbn10_idx').on(t.isbn10),
    index('bm_isbn13_idx').on(t.isbn13),
    index('bm_embedding_hnsw_cosine_idx').using('hnsw', sql`${t.embedding} vector_cosine_ops`),
    check('book_metadata_rating_range_chk', sql`${t.rating} is null or (${t.rating} >= 1 and ${t.rating} <= 10)`),
    check(
      'book_metadata_published_date_range_chk',
      sql`${t.publishedDate} is null or (extract(year from ${t.publishedDate}) >= 1000 and extract(year from ${t.publishedDate}) <= 2200)`,
    ),
    check('book_metadata_published_year_range_chk', sql`${t.publishedYear} is null or (${t.publishedYear} >= 1000 and ${t.publishedYear} <= 2200)`),
    check('book_metadata_page_count_nonnegative_chk', sql`${t.pageCount} is null or ${t.pageCount} >= 0`),
    check('book_metadata_series_index_format_chk', sql`${t.seriesIndex} is null or ${t.seriesIndex} ~ '^[0-9]+([.][0-9]+)?$'`),
    check('book_metadata_duration_seconds_nonnegative_chk', sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`),
    check('book_metadata_cover_source_chk', sql`${t.coverSource} is null or ${t.coverSource} in ('extracted', 'custom')`),
  ],
);

export const bookCommunityRatings = pgTable(
  'book_community_ratings',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 50 }).notNull(),
    rating: real('rating').notNull(),
    ratingCount: integer('rating_count'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.provider] }),
    index('book_community_ratings_provider_idx').on(t.provider),
    index('book_community_ratings_rating_book_idx').on(t.rating, t.bookId),
    index('book_community_ratings_provider_rating_book_idx').on(t.provider, t.rating, t.bookId),
    index('book_community_ratings_count_book_idx').on(t.ratingCount, t.bookId),
    index('book_community_ratings_provider_count_book_idx').on(t.provider, t.ratingCount, t.bookId),
    check('book_community_ratings_rating_range_chk', sql`${t.rating} >= 0 and ${t.rating} <= 5`),
    check('book_community_ratings_count_nonnegative_chk', sql`${t.ratingCount} is null or ${t.ratingCount} >= 0`),
  ],
);

/**
 * Ids from external metadata providers, one row per book and provider. Built-in providers keep
 * their own columns on `book_metadata`; any provider registered at runtime lands here, so a new one
 * needs no column. Rows outlive their provider's registration, so re-adding it restores them.
 */
export const bookProviderIds = pgTable(
  'book_provider_ids',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    externalId: varchar('external_id', { length: 512 }).notNull(),
    /** The record page the id was applied from, for a link on the book page. */
    sourceUrl: varchar('source_url', { length: 2048 }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.provider] }), index('book_provider_ids_provider_external_id_idx').on(t.provider, t.externalId)],
);

export const authors = pgTable(
  'authors',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 500 }).notNull(),
    sortName: varchar('sort_name', { length: 500 }),
    description: text('description'),
    hasPhoto: boolean('has_photo').notNull().default(false),
    birthDate: date('birth_date', { mode: 'string' }),
    birthYear: integer('birth_year'),
    deathDate: date('death_date', { mode: 'string' }),
    deathYear: integer('death_year'),
    website: varchar('website', { length: 2048 }),
    genres: text('genres').array(),
    influences: text('influences').array(),
    metadataProvider: varchar('metadata_provider', { length: 50 }),
    metadataProviderId: varchar('metadata_provider_id', { length: 128 }),
    /** Set when a user chose this provider match; enrichment then looks the id up instead of searching by name. */
    metadataProviderPinned: boolean('metadata_provider_pinned').notNull().default(false),
    lastEnrichedAt: timestamp('last_enriched_at', { withTimezone: true }),
  },
  (t) => [
    unique('authors_name_unique').on(t.name),
    index('authors_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('authors_name_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.name}) gin_trgm_ops`),
  ],
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
    index('book_authors_book_display_author_idx').on(t.bookId, t.displayOrder, t.authorId),
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
    /** Set by a run that asked to bypass cached provider answers; survives requeues. */
    ignoreCache: boolean('ignore_cache').notNull().default(false),
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

// The chapter lists the editor saved for a book, newest kept per book, so a bad save or a bad
// lookup can be undone after the fact.
export const bookChapterVersions = pgTable(
  'book_chapter_versions',
  {
    id: serial('id').primaryKey(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    chapters: jsonb('chapters').$type<AudiobookChapter[]>().notNull(),
    source: varchar('source', { length: 20 }).$type<AudiobookChapterSource>().notNull(),
    chapterCount: integer('chapter_count').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('bcv_book_created_idx').on(t.bookId, t.createdAt),
    index('bcv_created_by_idx')
      .on(t.createdBy)
      .where(sql`${t.createdBy} is not null`),
  ],
);

// Books waiting for, or finished with, a bulk chapter lookup on Audible. One row per book: queuing a
// book again replaces its last outcome. Rows a person still has to look at keep their result.
export const chapterLookupQueue = pgTable(
  'chapter_lookup_queue',
  {
    claimToken: uuid('claim_token').notNull().defaultRandom(),
    bookId: integer('book_id')
      .primaryKey()
      .references(() => books.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).$type<ChapterLookupQueueStatus>().notNull().default('queued'),
    reason: varchar('reason', { length: 40 }),
    result: jsonb('result').$type<ChapterLookupReviewSummary | null>(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** A retry waits until this time, so a short outage does not use up every attempt at once. */
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('clq_status_available_idx').on(t.status, t.availableAt), index('clq_user_status_idx').on(t.userId, t.status)],
);

export const genres = pgTable(
  'genres',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 200 }).notNull().unique(),
  },
  (t) => [
    index('genres_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('genres_name_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.name}) gin_trgm_ops`),
  ],
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
  (t) => [
    index('tags_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('tags_name_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.name}) gin_trgm_ops`),
  ],
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
export type BookChapterVersionRow = typeof bookChapterVersions.$inferSelect;
export type BookCommunityRating = typeof bookCommunityRatings.$inferSelect;
export type NewBookCommunityRating = typeof bookCommunityRatings.$inferInsert;

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
    /** Set by a run that asked to bypass cached provider answers; survives requeues. */
    ignoreCache: boolean('ignore_cache').notNull().default(false),
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

export const bookChapterJobs = pgTable(
  'book_chapter_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 10 }).$type<import('@bookorbit/types').BookChapterJobKind>().notNull(),
    baseRevision: varchar('base_revision', { length: 64 }).notNull(),
    status: varchar('status', { length: 12 }).$type<import('@bookorbit/types').BookChapterJobState['status']>().notNull().default('queued'),
    filesWritten: integer('files_written').notNull().default(0),
    filesTotal: integer('files_total').notNull().default(0),
    result: jsonb('result').$type<import('@bookorbit/types').BookChapterJobState['result']>(),
    errorCode: varchar('error_code', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bcj_status_created_idx').on(t.status, t.createdAt), uniqueIndex('bcj_request_idx').on(t.userId, t.bookId, t.kind, t.baseRevision)],
);
