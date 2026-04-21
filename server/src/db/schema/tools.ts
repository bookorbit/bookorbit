import { index, integer, pgTable, serial, text, timestamp, unique, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const dismissedDuplicatePairs = pgTable(
  'dismissed_duplicate_pairs',
  {
    id: serial('id').primaryKey(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityIdA: integer('entity_id_a').notNull(),
    entityIdB: integer('entity_id_b').notNull(),
    reason: text('reason'),
    dismissedBy: integer('dismissed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('dismissed_duplicate_pairs_unique').on(t.entityType, t.entityIdA, t.entityIdB),
    index('dismissed_duplicate_pairs_entity_a_idx').on(t.entityType, t.entityIdA),
    index('dismissed_duplicate_pairs_entity_b_idx').on(t.entityType, t.entityIdB),
  ],
);

export type DismissedDuplicatePair = typeof dismissedDuplicatePairs.$inferSelect;
export type NewDismissedDuplicatePair = typeof dismissedDuplicatePairs.$inferInsert;

export const dismissedInlineDuplicatePairs = pgTable(
  'dismissed_inline_duplicate_pairs',
  {
    id: serial('id').primaryKey(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    valueA: varchar('value_a', { length: 500 }).notNull(),
    valueB: varchar('value_b', { length: 500 }).notNull(),
    reason: text('reason'),
    dismissedBy: integer('dismissed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('dismissed_inline_duplicate_pairs_unique').on(t.entityType, t.valueA, t.valueB),
    index('dismissed_inline_pairs_entity_a_idx').on(t.entityType, t.valueA),
    index('dismissed_inline_pairs_entity_b_idx').on(t.entityType, t.valueB),
  ],
);

export type DismissedInlineDuplicatePair = typeof dismissedInlineDuplicatePairs.$inferSelect;
export type NewDismissedInlineDuplicatePair = typeof dismissedInlineDuplicatePairs.$inferInsert;
