import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { ReadStatus, ReadStatusSource, ReadingSessionSource } from '@bookorbit/types';

import { bookFiles, books } from './books';
import { libraries } from './libraries';
import { users } from './auth';

export const userBookStatus = pgTable(
  'user_book_status',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    // 'unread' | 'want_to_read' | 'reading' | 'on_hold' | 'rereading' | 'read' | 'skimmed' | 'abandoned'
    status: varchar('status', { length: 20 }).$type<ReadStatus>().notNull().default('unread'),
    // 'auto' (derived from progress) | 'manual' (user-set; never auto-overridden)
    source: varchar('source', { length: 10 }).$type<ReadStatusSource>().notNull().default('auto'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId] }),
    index('ubs_user_id_idx').on(t.userId),
    index('ubs_user_status_idx').on(t.userId, t.status),
    index('ubs_book_user_idx').on(t.bookId, t.userId),
    check(
      'user_book_status_status_chk',
      sql`${t.status} in ('unread', 'want_to_read', 'reading', 'on_hold', 'rereading', 'read', 'skimmed', 'abandoned')`,
    ),
    check('user_book_status_source_chk', sql`${t.source} in ('auto', 'manual')`),
    check('user_book_status_finished_after_started_chk', sql`${t.finishedAt} is null or ${t.startedAt} is null or ${t.finishedAt} >= ${t.startedAt}`),
  ],
);

export type UserBookStatusRow = typeof userBookStatus.$inferSelect;
export type NewUserBookStatus = typeof userBookStatus.$inferInsert;

export const userBookRatings = pgTable(
  'user_book_ratings',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId] }),
    index('ubr_user_id_idx').on(t.userId),
    index('ubr_book_id_idx').on(t.bookId),
    index('ubr_book_user_rating_idx').on(t.bookId, t.userId),
    check('user_book_ratings_rating_range_chk', sql`${t.rating} >= 1 and ${t.rating} <= 5`),
  ],
);

export type UserBookRatingRow = typeof userBookRatings.$inferSelect;
export type NewUserBookRating = typeof userBookRatings.$inferInsert;

export const readingProgress = pgTable(
  'reading_progress',
  {
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    percentage: real('percentage').notNull().default(0),
    // EPUB: CFI string pinpoints exact location
    cfi: varchar('cfi', { length: 2000 }),
    // PDF / CBX / CBR: zero-based page index
    pageNumber: integer('page_number'),
    // Audio: playback position in seconds
    positionSeconds: real('position_seconds'),
    // Kobo: spine XHTML resource used as Location.Source
    koboLocationSource: varchar('kobo_location_source', { length: 4096 }),
    // Kobo: exact bookmark location kind/value, usually KoboSpan + kobo.x.y for KEPUB
    koboLocationType: varchar('kobo_location_type', { length: 64 }),
    koboLocationValue: varchar('kobo_location_value', { length: 255 }),
    // Kobo: progress within Location.Source
    koboContentSourceProgressPercent: real('kobo_content_source_progress_percent'),
    // KOReader: XPointer progress string generated from the EPUB DOM
    koreaderProgress: text('koreader_progress'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.bookFileId, t.userId] }),
    index('reading_progress_user_id_idx').on(t.userId),
    index('reading_progress_user_updated_at_idx').on(t.userId, t.updatedAt),
    check('reading_progress_percentage_range_chk', sql`${t.percentage} >= 0 and ${t.percentage} <= 100`),
    check('reading_progress_page_number_nonnegative_chk', sql`${t.pageNumber} is null or ${t.pageNumber} >= 0`),
    check('reading_progress_position_seconds_nonnegative_chk', sql`${t.positionSeconds} is null or ${t.positionSeconds} >= 0`),
    check(
      'reading_progress_kobo_content_source_progress_range_chk',
      sql`${t.koboContentSourceProgressPercent} is null or (${t.koboContentSourceProgressPercent} >= 0 and ${t.koboContentSourceProgressPercent} <= 100)`,
    ),
  ],
);

export type ReadingProgress = typeof readingProgress.$inferSelect;
export type NewReadingProgress = typeof readingProgress.$inferInsert;

export const readingSessions = pgTable(
  'reading_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Nullable: manual sessions are book-level and have no file.
    bookFileId: integer('book_file_id').references(() => bookFiles.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    // Client-generated UUID; used for idempotent retries.
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    // 'web' (browser reader) | 'koreader' (page-stats derivation) | 'manual' (user-entered) | 'kobo' (future)
    source: varchar('source', { length: 10 }).$type<ReadingSessionSource>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    // Server-computed from endedAt - startedAt; client-provided timestamps are untrusted for duration.
    durationSeconds: integer('duration_seconds').notNull(),
    // Nullable: CBX with no percentage tracking may omit these.
    progressDelta: real('progress_delta'),
    endProgress: real('end_progress'),
  },
  (t) => [
    uniqueIndex('rs_user_session_id_uidx').on(t.userId, t.sessionId),
    index('rs_user_started_at_idx').on(t.userId, t.startedAt),
    index('rs_book_file_started_at_idx').on(t.bookFileId, t.startedAt),
    index('rs_user_book_file_idx').on(t.userId, t.bookFileId),
    index('rs_user_book_started_at_idx').on(t.userId, t.bookId, t.startedAt),
    check('reading_sessions_source_chk', sql`${t.source} in ('web', 'koreader', 'manual', 'kobo')`),
    check('reading_sessions_duration_seconds_nonnegative_chk', sql`${t.durationSeconds} >= 0`),
    check('reading_sessions_end_progress_range_chk', sql`${t.endProgress} is null or (${t.endProgress} >= 0 and ${t.endProgress} <= 100)`),
    check('reading_sessions_ended_after_started_chk', sql`${t.endedAt} >= ${t.startedAt}`),
  ],
);

export type ReadingSession = typeof readingSessions.$inferSelect;
export type NewReadingSession = typeof readingSessions.$inferInsert;

export const userReadingDailyStats = pgTable(
  'user_reading_daily_stats',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    readingSeconds: integer('reading_seconds').notNull().default(0),
    progressDelta: real('progress_delta').notNull().default(0),
    sessionsCount: integer('sessions_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.libraryId, t.day] }),
    index('urds_user_day_idx').on(t.userId, t.day),
    check('user_reading_daily_stats_reading_seconds_nonnegative_chk', sql`${t.readingSeconds} >= 0`),
    check('user_reading_daily_stats_sessions_count_nonnegative_chk', sql`${t.sessionsCount} >= 0`),
  ],
);

export type UserReadingDailyStat = typeof userReadingDailyStats.$inferSelect;
export type NewUserReadingDailyStat = typeof userReadingDailyStats.$inferInsert;

export const audiobookProgress = pgTable(
  'audiobook_progress',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    percentage: real('percentage').notNull().default(0),
    currentFileId: integer('current_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    positionSeconds: real('position_seconds').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.bookId] }),
    index('abp_user_id_idx').on(t.userId),
    check('audiobook_progress_percentage_range_chk', sql`${t.percentage} >= 0 and ${t.percentage} <= 100`),
    check('audiobook_progress_position_seconds_nonnegative_chk', sql`${t.positionSeconds} >= 0`),
  ],
);

export type AudiobookProgress = typeof audiobookProgress.$inferSelect;
export type NewAudiobookProgress = typeof audiobookProgress.$inferInsert;

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    // EPUB: CFI string pinpoints exact location. Null for audio bookmarks.
    cfi: varchar('cfi', { length: 2000 }),
    title: varchar('title', { length: 500 }).notNull(),
    // Audio: absolute book position in seconds (sum of preceding file durations + offset).
    positionSeconds: real('position_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('bookmarks_user_book_idx').on(t.userId, t.bookId),
    uniqueIndex('bookmarks_user_book_cfi_uidx')
      .on(t.userId, t.bookId, t.cfi)
      .where(sql`${t.cfi} is not null`),
    uniqueIndex('bookmarks_user_book_pos_uidx')
      .on(t.userId, t.bookId, t.positionSeconds)
      .where(sql`${t.positionSeconds} is not null and ${t.cfi} is null`),
  ],
);

export type BookmarkRow = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export const annotations = pgTable(
  'annotations',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    color: varchar('color', { length: 20 }).notNull().default('yellow'),
    style: varchar('style', { length: 20 }).notNull().default('highlight'),
    note: text('note'),
    chapterTitle: varchar('chapter_title', { length: 500 }),
    origin: varchar('origin', { length: 10 }).$type<'web' | 'koreader' | 'kobo'>().notNull().default('web'),
    // Bumped on every content mutation (edit, soft delete, restore, device position
    // correction); annotation_sync_state.lastAppliedVersion tracks per-device delivery.
    version: integer('version').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Device-local "YYYY-MM-DD HH:MM:SS" strings stored verbatim (device has no timezone info).
    // deviceCreatedAt doubles as the KOReader-side identity datetime for synced annotations.
    deviceCreatedAt: varchar('device_created_at', { length: 19 }),
    deviceUpdatedAt: varchar('device_updated_at', { length: 19 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('annotations_user_id_idx').on(t.userId),
    index('annotations_user_book_idx').on(t.userId, t.bookId),
    index('annotations_user_book_active_idx')
      .on(t.userId, t.bookId)
      .where(sql`${t.deletedAt} is null`),
    check('annotations_style_chk', sql`${t.style} in ('highlight', 'underline', 'strikethrough', 'squiggly', 'invert')`),
    check('annotations_origin_chk', sql`${t.origin} in ('web', 'koreader', 'kobo')`),
  ],
);

export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;

export const annotationPositions = pgTable(
  'annotation_positions',
  {
    id: serial('id').primaryKey(),
    annotationId: integer('annotation_id')
      .notNull()
      .references(() => annotations.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
    format: varchar('format', { length: 12 }).$type<'cfi' | 'xpointer' | 'pdf' | 'kobo_span'>().notNull(),
    pos0: text('pos0'),
    pos1: text('pos1'),
    // exact: structurally resolved and text-verified; repaired: re-anchored via text search;
    // pending: generated but not yet verified by the target renderer; failed: no usable position.
    status: varchar('status', { length: 10 }).$type<'exact' | 'repaired' | 'failed' | 'pending'>().notNull().default('exact'),
    converterVersion: integer('converter_version'),
    extras: jsonb('extras').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('annotation_positions_annotation_format_uidx').on(t.annotationId, t.format),
    index('annotation_positions_user_idx').on(t.userId),
    index('annotation_positions_format_status_idx').on(t.format, t.status),
    check('annotation_positions_format_chk', sql`${t.format} in ('cfi', 'xpointer', 'pdf', 'kobo_span')`),
    check('annotation_positions_status_chk', sql`${t.status} in ('exact', 'repaired', 'failed', 'pending')`),
    check('annotation_positions_pos0_chk', sql`${t.status} in ('failed', 'pending') or ${t.pos0} is not null`),
  ],
);

export type AnnotationPosition = typeof annotationPositions.$inferSelect;
export type NewAnnotationPosition = typeof annotationPositions.$inferInsert;

export const annotationSyncState = pgTable(
  'annotation_sync_state',
  {
    id: serial('id').primaryKey(),
    annotationId: integer('annotation_id')
      .notNull()
      .references(() => annotations.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 10 }).$type<'koreader' | 'kobo'>().notNull(),
    deviceId: varchar('device_id', { length: 100 }).notNull(),
    // KOReader: md5 hex of `${deviceCreatedAt}|${pos0}` (device-format pos0).
    externalKey: varchar('external_key', { length: 64 }).notNull(),
    externalCreatedAt: varchar('external_created_at', { length: 19 }),
    // 0 = row exists from device upload but nothing pushed yet; otherwise the canonical
    // version this device has acknowledged. Only the exchange ack advances it.
    lastAppliedVersion: integer('last_applied_version').notNull().default(0),
    deleteAckedAt: timestamp('delete_acked_at', { withTimezone: true }),
    firstSyncedAt: timestamp('first_synced_at', { withTimezone: true }).defaultNow().notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('annotation_sync_state_annotation_source_device_uidx').on(t.annotationId, t.source, t.deviceId),
    // Non-unique: the same external key can legitimately exist for two different books
    // (the same file scanned into two libraries); lookups are book-scoped.
    index('annotation_sync_state_user_source_device_key_idx').on(t.userId, t.source, t.deviceId, t.externalKey),
    index('annotation_sync_state_user_key_idx').on(t.userId, t.externalKey),
    index('annotation_sync_state_annotation_id_idx').on(t.annotationId),
    check('annotation_sync_state_source_chk', sql`${t.source} in ('koreader', 'kobo')`),
  ],
);

export type AnnotationSyncStateRow = typeof annotationSyncState.$inferSelect;
export type NewAnnotationSyncState = typeof annotationSyncState.$inferInsert;

export const readerDefaultPreferences = pgTable(
  'reader_default_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    formatGroup: varchar('format_group', { length: 10 }).notNull(),
    settings: jsonb('settings').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('rdp_user_format_idx').on(t.userId, t.formatGroup),
    check('reader_default_preferences_format_group_chk', sql`${t.formatGroup} in ('epub', 'pdf', 'cbx', 'audio')`),
  ],
);

export type ReaderDefaultPreference = typeof readerDefaultPreferences.$inferSelect;
export type NewReaderDefaultPreference = typeof readerDefaultPreferences.$inferInsert;

export const readerPreferences = pgTable(
  'reader_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    settings: jsonb('settings').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('rp_user_file_idx').on(t.userId, t.bookFileId)],
);

export type ReaderPreference = typeof readerPreferences.$inferSelect;
export type NewReaderPreference = typeof readerPreferences.$inferInsert;
