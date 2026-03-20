import { date, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { bookFiles, books } from './books';
import { libraries } from './libraries';
import { users } from './auth';

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
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.bookFileId, t.userId] }), index('reading_progress_user_id_idx').on(t.userId)],
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
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    // Client-generated UUID; used for idempotent retries.
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at').notNull(),
    // Server-computed from endedAt - startedAt; client-provided timestamps are untrusted for duration.
    durationSeconds: integer('duration_seconds').notNull(),
    // Nullable: CBX with no percentage tracking may omit these.
    progressDelta: real('progress_delta'),
    endProgress: real('end_progress'),
  },
  (t) => [
    uniqueIndex('rs_session_id_uidx').on(t.sessionId),
    index('rs_user_started_at_idx').on(t.userId, t.startedAt),
    index('rs_book_file_started_at_idx').on(t.bookFileId, t.startedAt),
    index('rs_user_book_file_idx').on(t.userId, t.bookFileId),
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
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.libraryId, t.day] }),
    index('urds_user_day_idx').on(t.userId, t.day),
    index('urds_user_library_day_idx').on(t.userId, t.libraryId, t.day),
  ],
);

export type UserReadingDailyStat = typeof userReadingDailyStats.$inferSelect;
export type NewUserReadingDailyStat = typeof userReadingDailyStats.$inferInsert;

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
    cfi: varchar('cfi', { length: 2000 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('bookmarks_user_id_idx').on(t.userId)],
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
    cfi: varchar('cfi', { length: 2000 }).notNull(),
    text: text('text').notNull(),
    color: varchar('color', { length: 20 }).notNull().default('yellow'),
    style: varchar('style', { length: 20 }).notNull().default('highlight'),
    note: text('note'),
    chapterTitle: varchar('chapter_title', { length: 500 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [index('annotations_user_id_idx').on(t.userId)],
);

export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;

export const readerDefaultPreferences = pgTable(
  'reader_default_preferences',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    formatGroup: varchar('format_group', { length: 10 }).notNull(),
    settings: jsonb('settings').notNull(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('rdp_user_format_idx').on(t.userId, t.formatGroup)],
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
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('rp_user_file_idx').on(t.userId, t.bookFileId)],
);

export type ReaderPreference = typeof readerPreferences.$inferSelect;
export type NewReaderPreference = typeof readerPreferences.$inferInsert;
