import { integer, pgEnum, pgTable, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

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

export const opdsUsers = pgTable('opds_users', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  username: varchar('username', { length: 100 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  sortOrder: opdsSortOrderEnum('sort_order').notNull().default('recent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date()),
});
