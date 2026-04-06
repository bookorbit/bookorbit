import { sql } from 'drizzle-orm';
import { integer, pgEnum, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const opdsSortOrderEnum = pgEnum('opds_sort_order', [
  'recent',
  'title_asc',
  'title_desc',
  'author_asc',
  'author_desc',
  'series_asc',
  'series_desc',
]);

export const opdsUsers = pgTable(
  'opds_users',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: varchar('username', { length: 100 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    sortOrder: opdsSortOrderEnum('sort_order').notNull().default('recent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('opds_users_username_lower_uidx').on(sql`lower(${t.username})`)],
);
