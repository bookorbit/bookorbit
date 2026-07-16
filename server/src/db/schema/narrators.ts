import { sql } from 'drizzle-orm';
import { index, integer, pgTable, primaryKey, serial, timestamp, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';

export const narrators = pgTable(
  'narrators',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 500 }).notNull().unique(),
    sortName: varchar('sort_name', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('narrators_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('narrators_name_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.name}) gin_trgm_ops`),
  ],
);

export const bookNarrators = pgTable(
  'book_narrators',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    narratorId: integer('narrator_id')
      .notNull()
      .references(() => narrators.id),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.narratorId] }), index('book_narrators_narrator_id_idx').on(t.narratorId)],
);

export type Narrator = typeof narrators.$inferSelect;
export type NewNarrator = typeof narrators.$inferInsert;
