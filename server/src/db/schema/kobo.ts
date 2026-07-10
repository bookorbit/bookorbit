import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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
    clientDeviceId: varchar('client_device_id', { length: 128 }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('kobo_devices_user_id_idx').on(t.userId),
    unique('kobo_devices_client_device_id_unique').on(t.clientDeviceId),
    unique('kobo_devices_id_user_id_unique').on(t.id, t.userId),
  ],
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
    convertToKepub: boolean('convert_to_kepub').notNull().default(true),
    forceEnableHyphenation: boolean('force_enable_hyphenation').notNull().default(false),
    kepubConversionLimitMb: integer('kepub_conversion_limit_mb').notNull().default(100),
    twoWayProgressSync: boolean('two_way_progress_sync').notNull().default(false),
    syncBookOrbitAnnotationsToKobo: boolean('sync_bookorbit_annotations_to_kobo').notNull().default(false),
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

export const koboLegacyLibrarySnapshots = pgTable('kobo_library_snapshots', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  legacyDeviceCutoffAt: timestamp('legacy_device_cutoff_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export const koboLegacySnapshotBooks = pgTable(
  'kobo_snapshot_books',
  {
    snapshotId: integer('snapshot_id')
      .notNull()
      .references(() => koboLegacyLibrarySnapshots.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    synced: boolean('synced').notNull().default(false),
    pendingDelete: boolean('pending_delete').notNull().default(false),
    isNew: boolean('is_new').notNull().default(true),
    removedByDevice: boolean('removed_by_device').notNull().default(false),
    fileHash: varchar('file_hash', { length: 64 }),
    deliveryHash: varchar('delivery_hash', { length: 64 }),
    metadataHash: varchar('metadata_hash', { length: 64 }),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.bookId] }),
    index('kobo_snapshot_books_snapshot_synced_book_idx').on(t.snapshotId, t.synced, t.bookId),
  ],
);

export const koboLibrarySnapshots = pgTable(
  'kobo_device_library_snapshots',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('kobo_device_library_snapshots_user_id_idx').on(t.userId),
    unique('kobo_device_library_snapshots_device_id_unique').on(t.deviceId),
    foreignKey({
      columns: [t.deviceId, t.userId],
      foreignColumns: [koboDevices.id, koboDevices.userId],
      name: 'kobo_device_library_snapshots_device_owner_fk',
    }).onDelete('cascade'),
  ],
);

export const koboSnapshotBooks = pgTable(
  'kobo_device_snapshot_books',
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
    needsLegacyNumericRemoval: boolean('needs_legacy_numeric_removal').notNull().default(false),
    fileHash: varchar('file_hash', { length: 64 }),
    deliveryHash: varchar('delivery_hash', { length: 64 }),
    metadataHash: varchar('metadata_hash', { length: 64 }),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.bookId] }),
    index('kobo_device_snapshot_books_snapshot_synced_book_idx').on(t.snapshotId, t.synced, t.bookId),
  ],
);

export const koboBookEntitlements = pgTable(
  'kobo_book_entitlements',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    entitlementId: uuid('entitlement_id').notNull().defaultRandom(),
    coverImageId: uuid('cover_image_id').notNull().defaultRandom(),
    needsLegacyNumericRemoval: boolean('needs_legacy_numeric_removal').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique('kobo_book_entitlements_user_book_unique').on(t.userId, t.bookId),
    unique('kobo_book_entitlements_user_entitlement_unique').on(t.userId, t.entitlementId),
    unique('kobo_book_entitlements_user_cover_unique').on(t.userId, t.coverImageId),
    index('kobo_book_entitlements_user_id_idx').on(t.userId),
    index('kobo_book_entitlements_book_id_idx').on(t.bookId),
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
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.bookId)],
);

export const koboSyncHistory = pgTable(
  'kobo_sync_history',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: integer('device_id').references(() => koboDevices.id, { onDelete: 'set null' }),
    event: varchar('event', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    counts: jsonb('counts').notNull().default({}),
    durationMs: integer('duration_ms').notNull(),
    errorClass: varchar('error_class', { length: 128 }),
    error: varchar('error', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('kobo_sync_history_user_created_idx').on(t.userId, t.createdAt),
    index('kobo_sync_history_device_created_idx').on(t.deviceId, t.createdAt),
    check(
      'kobo_sync_history_event_chk',
      sql`${t.event} in ('library_sync', 'book_download', 'progress_update', 'annotations_pull', 'annotations_push')`,
    ),
    check('kobo_sync_history_status_chk', sql`${t.status} in ('success', 'failed')`),
    check('kobo_sync_history_duration_nonnegative_chk', sql`${t.durationMs} >= 0`),
  ],
);

export type KoboDevice = typeof koboDevices.$inferSelect;
export type NewKoboDevice = typeof koboDevices.$inferInsert;

export type KoboSyncSetting = typeof koboSyncSettings.$inferSelect;
export type KoboLibrarySnapshot = typeof koboLibrarySnapshots.$inferSelect;
export type KoboSnapshotBook = typeof koboSnapshotBooks.$inferSelect;
export type KoboBookEntitlement = typeof koboBookEntitlements.$inferSelect;
export type KoboReadingState = typeof koboReadingStates.$inferSelect;
export type KoboSyncHistory = typeof koboSyncHistory.$inferSelect;
export type NewKoboSyncHistory = typeof koboSyncHistory.$inferInsert;
