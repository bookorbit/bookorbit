import { boolean, integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const readwiseUserSettings = pgTable('readwise_user_settings', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' })
    .unique(),
  apiToken: text('api_token'),
  enabled: boolean('enabled').notNull().default(true),
  lastSyncedAnnotationId: integer('last_synced_annotation_id').notNull().default(0),
  disabledReason: text('disabled_reason'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type ReadwiseUserSetting = typeof readwiseUserSettings.$inferSelect;
export type NewReadwiseUserSetting = typeof readwiseUserSettings.$inferInsert;
