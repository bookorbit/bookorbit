import { boolean, integer, jsonb, pgTable, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
import type { GroupRule, SortSpec } from '@bookorbit/types';

import { users } from './auth';

export const smartScopes = pgTable(
  'smart_scopes',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    icon: varchar('icon', { length: 100 }),
    filter: jsonb('filter').$type<GroupRule | null>(),
    defaultSort: jsonb('default_sort').$type<SortSpec[]>().notNull().default([]),
    isPublic: boolean('is_public').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [unique().on(t.userId, t.name)],
);

export type SmartScope = typeof smartScopes.$inferSelect;
export type NewSmartScope = typeof smartScopes.$inferInsert;
