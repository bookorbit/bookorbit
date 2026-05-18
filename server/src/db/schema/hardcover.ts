import { boolean, integer, pgTable, real, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';
import { users } from './auth';

export const hardcoverUserSettings = pgTable('hardcover_user_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  apiToken: varchar('api_token', { length: 2048 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  autoSyncOnStatusChange: boolean('auto_sync_on_status_change').notNull().default(true),
  autoSyncOnProgressUpdate: boolean('auto_sync_on_progress_update').notNull().default(true),
  autoSyncOnRatingChange: boolean('auto_sync_on_rating_change').notNull().default(true),
  privacySettingId: integer('privacy_setting_id').notNull().default(3),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export const hardcoverBookState = pgTable(
  'hardcover_book_state',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    hardcoverBookId: integer('hardcover_book_id'),
    hardcoverEditionId: integer('hardcover_edition_id'),
    hardcoverUserBookId: integer('hardcover_user_book_id'),
    hardcoverReadId: integer('hardcover_read_id'),
    matchMethod: varchar('match_method', { length: 10 }),
    matchError: text('match_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncedStatus: varchar('last_synced_status', { length: 20 }),
    lastSyncedProgress: real('last_synced_progress'),
    lastSyncedRating: integer('last_synced_rating'),
    lastSyncedStartedAt: varchar('last_synced_started_at', { length: 10 }),
    lastSyncedFinishedAt: varchar('last_synced_finished_at', { length: 10 }),
    syncError: text('sync_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique('hardcover_book_state_user_book_uidx').on(t.userId, t.bookId)],
);

export type HardcoverUserSetting = typeof hardcoverUserSettings.$inferSelect;
export type NewHardcoverUserSetting = typeof hardcoverUserSettings.$inferInsert;
export type HardcoverBookState = typeof hardcoverBookState.$inferSelect;
export type NewHardcoverBookState = typeof hardcoverBookState.$inferInsert;
