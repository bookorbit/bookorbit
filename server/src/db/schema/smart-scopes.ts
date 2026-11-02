import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, timestamp, unique, varchar } from 'drizzle-orm/pg-core';
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
    syncToKobo: boolean('sync_to_kobo').notNull().default(false),
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

/**
 * Opt-in Kobo sync for shared scopes. `smartScopes.syncToKobo` only governs the
 * owner's own devices; every other user decides for themselves whether a public
 * scope reaches their Kobo, so nothing lands on a device without consent.
 */
export const smartScopeKoboSubscriptions = pgTable(
  'smart_scope_kobo_subscriptions',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    smartScopeId: integer('smart_scope_id')
      .notNull()
      .references(() => smartScopes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.smartScopeId] }), index('smart_scope_kobo_subscriptions_smart_scope_id_idx').on(t.smartScopeId)],
);

export type SmartScopeKoboSubscription = typeof smartScopeKoboSubscriptions.$inferSelect;
