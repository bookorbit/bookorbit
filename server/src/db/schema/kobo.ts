import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, real, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';
import { users } from './auth';

export const koboDevices = pgTable(
  'kobo_devices',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    token: varchar('token', { length: 64 }).notNull().unique(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('kobo_devices_user_id_idx').on(t.userId)],
);

export const koboSyncSettings = pgTable(
  'kobo_sync_settings',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    readingThreshold: real('reading_threshold').notNull().default(1),
    finishedThreshold: real('finished_threshold').notNull().default(99),
    convertToKepub: boolean('convert_to_kepub').notNull().default(false),
    twoWayProgressSync: boolean('two_way_progress_sync').notNull().default(false),
    forceEnableHyphenation: boolean('force_enable_hyphenation').notNull().default(false),
    kepubConversionLimitMb: integer('kepub_conversion_limit_mb').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    check('kobo_sync_settings_reading_threshold_range_chk', sql`${t.readingThreshold} >= 0 and ${t.readingThreshold} <= 100`),
    check('kobo_sync_settings_finished_threshold_range_chk', sql`${t.finishedThreshold} >= 0 and ${t.finishedThreshold} <= 100`),
    check('kobo_sync_settings_conversion_limit_nonnegative_chk', sql`${t.kepubConversionLimitMb} >= 0`),
  ],
);

export const koboLibrarySnapshots = pgTable('kobo_library_snapshots', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export const koboSnapshotBooks = pgTable(
  'kobo_snapshot_books',
  {
    snapshotId: integer('snapshot_id')
      .notNull()
      .references(() => koboLibrarySnapshots.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    synced: boolean('synced').notNull().default(false),
    pendingDelete: boolean('pending_delete').notNull().default(false),
    isNew: boolean('is_new').notNull().default(true),
    removedByDevice: boolean('removed_by_device').notNull().default(false),
    fileHash: varchar('file_hash', { length: 64 }),
    metadataHash: varchar('metadata_hash', { length: 64 }),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.bookId] }),
    index('kobo_snapshot_books_snapshot_synced_book_idx').on(t.snapshotId, t.synced, t.bookId),
  ],
);

export const koboReadingStates = pgTable(
  'kobo_reading_states',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    entitlementId: varchar('entitlement_id', { length: 255 }).notNull(),
    createdAtKobo: varchar('created_at_kobo', { length: 50 }),
    lastModifiedKobo: varchar('last_modified_kobo', { length: 50 }),
    priorityTimestamp: varchar('priority_timestamp', { length: 50 }),
    currentBookmark: jsonb('current_bookmark'),
    statistics: jsonb('statistics'),
    statusInfo: jsonb('status_info'),
    progressSyncedAt: timestamp('progress_synced_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.bookId)],
);

export type KoboDevice = typeof koboDevices.$inferSelect;
export type NewKoboDevice = typeof koboDevices.$inferInsert;

export type KoboSyncSetting = typeof koboSyncSettings.$inferSelect;
export type KoboLibrarySnapshot = typeof koboLibrarySnapshots.$inferSelect;
export type KoboSnapshotBook = typeof koboSnapshotBooks.$inferSelect;
export type KoboReadingState = typeof koboReadingStates.$inferSelect;
