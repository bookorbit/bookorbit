import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { bookFiles } from './books';
import { users } from './auth';

export const koreaderUsers = pgTable(
  'koreader_users',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: varchar('username', { length: 100 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    passwordMd5: varchar('password_md5', { length: 32 }),
    syncEnabled: boolean('sync_enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('koreader_users_user_id_uidx').on(t.userId), uniqueIndex('koreader_users_username_uidx').on(t.username)],
);

export type KoreaderUser = typeof koreaderUsers.$inferSelect;
export type NewKoreaderUser = typeof koreaderUsers.$inferInsert;

export const koreaderDeviceProgress = pgTable(
  'koreader_device_progress',
  {
    id: serial('id').primaryKey(),
    bookFileId: integer('book_file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    device: varchar('device', { length: 100 }).notNull().default('KOReader'),
    deviceId: varchar('device_id', { length: 100 }).notNull(),
    percentage: real('percentage'),
    progress: text('progress'),
    chapterIndex: integer('chapter_index'),
    syncTimestamp: bigint('sync_timestamp', { mode: 'number' }),
    orphaned: boolean('orphaned').notNull().default(false),
    orphanedHash: varchar('orphaned_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('koreader_device_progress_book_user_device_uidx')
      .on(t.bookFileId, t.userId, t.device, t.deviceId)
      .where(sql`${t.orphaned} = false`),
    index('koreader_device_progress_orphaned_hash_idx')
      .on(t.orphanedHash)
      .where(sql`${t.orphaned} = true`),
    index('koreader_device_progress_user_updated_at_idx').on(t.userId, t.updatedAt),
    index('koreader_device_progress_book_file_id_idx')
      .on(t.bookFileId)
      .where(sql`${t.bookFileId} is not null`),
    check('koreader_device_progress_percentage_range_chk', sql`${t.percentage} is null or (${t.percentage} >= 0 and ${t.percentage} <= 1)`),
  ],
);

export type KoreaderDeviceProgress = typeof koreaderDeviceProgress.$inferSelect;
export type NewKoreaderDeviceProgress = typeof koreaderDeviceProgress.$inferInsert;

export const bookFileHashHistory = pgTable(
  'book_file_hash_history',
  {
    id: serial('id').primaryKey(),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    fileHash: varchar('file_hash', { length: 32 }).notNull(),
    reason: varchar('reason', { length: 30 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('book_file_hash_history_book_file_id_file_hash_idx').on(t.bookFileId, t.fileHash),
    index('book_file_hash_history_file_hash_idx').on(t.fileHash),
    check('book_file_hash_history_reason_chk', sql`${t.reason} in ('file_write', 'external_change', 'rescan')`),
  ],
);

export type BookFileHashHistory = typeof bookFileHashHistory.$inferSelect;
export type NewBookFileHashHistory = typeof bookFileHashHistory.$inferInsert;

export const bookFileChapters = pgTable(
  'book_file_chapters',
  {
    id: serial('id').primaryKey(),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    chapterIndex: integer('chapter_index').notNull(),
    title: varchar('title', { length: 500 }),
    href: varchar('href', { length: 1000 }),
    spineIndex: integer('spine_index'),
  },
  (t) => [
    uniqueIndex('book_file_chapters_book_file_id_chapter_index_uidx').on(t.bookFileId, t.chapterIndex),
    index('book_file_chapters_book_file_id_idx').on(t.bookFileId),
  ],
);

export type BookFileChapter = typeof bookFileChapters.$inferSelect;
export type NewBookFileChapter = typeof bookFileChapters.$inferInsert;

export const koreaderPageStats = pgTable(
  'koreader_page_stats',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    deviceId: varchar('device_id', { length: 100 }).notNull(),
    page: integer('page').notNull(),
    // Device-reported unix seconds; part of the dedup key, stored verbatim (device clock accepted as-is).
    startTime: bigint('start_time', { mode: 'number' }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    totalPages: integer('total_pages').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('kps_user_file_device_page_start_uidx').on(t.userId, t.bookFileId, t.deviceId, t.page, t.startTime),
    index('kps_user_file_device_start_idx').on(t.userId, t.bookFileId, t.deviceId, t.startTime),
    index('kps_user_id_idx').on(t.userId),
    check('koreader_page_stats_duration_nonnegative_chk', sql`${t.durationSeconds} >= 0`),
    check('koreader_page_stats_page_nonnegative_chk', sql`${t.page} >= 0`),
    check('koreader_page_stats_total_pages_positive_chk', sql`${t.totalPages} > 0`),
    check('koreader_page_stats_start_time_positive_chk', sql`${t.startTime} > 0`),
  ],
);

export type KoreaderPageStat = typeof koreaderPageStats.$inferSelect;
export type NewKoreaderPageStat = typeof koreaderPageStats.$inferInsert;

export const koreaderDeviceSweeps = pgTable(
  'koreader_device_sweeps',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: varchar('device_id', { length: 100 }).notNull(),
    deviceModel: varchar('device_model', { length: 100 }).notNull().default('KOReader'),
    pluginVersion: varchar('plugin_version', { length: 20 }),
    lastSweepAt: timestamp('last_sweep_at', { withTimezone: true }).notNull(),
    lastSweepBooksMatched: integer('last_sweep_books_matched').notNull().default(0),
    lastSweepPageStats: integer('last_sweep_page_stats').notNull().default(0),
    lastSweepAnnotations: integer('last_sweep_annotations').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.deviceId] }), index('kds_user_id_idx').on(t.userId)],
);

export type KoreaderDeviceSweep = typeof koreaderDeviceSweeps.$inferSelect;
export type NewKoreaderDeviceSweep = typeof koreaderDeviceSweeps.$inferInsert;
