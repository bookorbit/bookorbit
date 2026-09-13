import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    message: text('message'),
    actionUrl: varchar('action_url', { length: 2048 }),
    meta: jsonb('meta'),
    read: boolean('read').notNull().default(false),
    groupKey: varchar('group_key', { length: 255 }),
    count: integer('count').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('notifications_user_id_idx').on(t.userId),
    index('notifications_user_unread_idx').on(t.userId, t.read),
    index('notifications_created_at_idx').on(t.createdAt),
    index('notifications_user_updated_at_idx').on(t.userId, t.updatedAt.desc()),
    index('notifications_updated_at_idx').on(t.updatedAt),
    uniqueIndex('notifications_user_unread_group_key_idx')
      .on(t.userId, t.groupKey)
      .where(sql`${t.read} = false and ${t.groupKey} is not null`),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
