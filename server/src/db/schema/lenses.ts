import { boolean, integer, jsonb, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const lenses = pgTable(
  'lenses',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    icon: varchar('icon', { length: 64 }),
    filter: jsonb('filter'),
    defaultSort: jsonb('default_sort').notNull().default([]),
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.name)],
);

export type Lens = typeof lenses.$inferSelect;
export type NewLens = typeof lenses.$inferInsert;
