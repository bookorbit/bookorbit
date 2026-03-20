import { boolean, date, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

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

export const readingSessionEvents = pgTable(
  'reading_session_events',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    // Idempotency key from the client save call; retries must reuse this value.
    eventKey: varchar('event_key', { length: 120 }).notNull(),
    recordedAt: timestamp('recorded_at').notNull().defaultNow(),
    percentage: real('percentage').notNull(),
    percentageDelta: real('percentage_delta').notNull().default(0),
    pageNumber: integer('page_number'),
    pageDelta: integer('page_delta').notNull().default(0),
    deltaSeconds: integer('delta_seconds').notNull().default(0),
    source: varchar('source', { length: 40 }).notNull().default('reader'),
    synthetic: boolean('synthetic').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rse_event_key_uidx').on(t.eventKey),
    index('rse_user_recorded_at_idx').on(t.userId, t.recordedAt),
    index('rse_file_recorded_at_idx').on(t.bookFileId, t.recordedAt),
  ],
);

export type ReadingSessionEvent = typeof readingSessionEvents.$inferSelect;
export type NewReadingSessionEvent = typeof readingSessionEvents.$inferInsert;

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
    eventsCount: integer('events_count').notNull().default(0),
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
