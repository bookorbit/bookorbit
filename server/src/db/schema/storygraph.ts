import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, real, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';
import { users } from './auth';

export const storygraphUserSettings = pgTable('storygraph_user_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  sessionCookie: varchar('session_cookie', { length: 4096 }).notNull(),
  rememberToken: varchar('remember_token', { length: 4096 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  bookSyncMode: varchar('book_sync_mode', { length: 20 }).notNull().default('all_eligible'),
  autoSyncOnStatusChange: boolean('auto_sync_on_status_change').notNull().default(true),
  autoSyncOnProgressUpdate: boolean('auto_sync_on_progress_update').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export const storygraphBookState = pgTable(
  'storygraph_book_state',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    storygraphBookId: varchar('storygraph_book_id', { length: 64 }),
    matchMethod: varchar('match_method', { length: 20 }),
    matchError: text('match_error'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSyncedStatus: varchar('last_synced_status', { length: 20 }),
    lastSyncedProgress: real('last_synced_progress'),
    syncError: text('sync_error'),
    syncOverride: varchar('sync_override', { length: 20 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    unique('storygraph_book_state_user_book_uidx').on(t.userId, t.bookId),
    index('storygraph_book_state_user_sync_override_idx').on(t.userId, t.syncOverride, t.bookId),
    index('storygraph_book_state_user_sync_error_idx')
      .on(t.userId, t.bookId)
      .where(sql`${t.syncError} is not null`),
  ],
);

export type StorygraphUserSetting = typeof storygraphUserSettings.$inferSelect;
export type NewStorygraphUserSetting = typeof storygraphUserSettings.$inferInsert;
export type StorygraphBookState = typeof storygraphBookState.$inferSelect;
export type NewStorygraphBookState = typeof storygraphBookState.$inferInsert;
