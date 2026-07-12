import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, real, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';

export const bookSeries = pgTable(
  'book_series',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 500 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 500 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('book_series_normalized_name_uidx').on(t.normalizedName),
    index('book_series_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
    index('book_series_name_unaccent_trgm_idx').using('gin', sql`public.bookorbit_unaccent(${t.name}) gin_trgm_ops`),
    index('book_series_name_lower_idx').on(sql`lower(${t.name})`),
  ],
);

export type BookSeries = typeof bookSeries.$inferSelect;
export type NewBookSeries = typeof bookSeries.$inferInsert;

export const bookSeriesMemberships = pgTable(
  'book_series_memberships',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    seriesId: integer('series_id')
      .notNull()
      .references(() => bookSeries.id, { onDelete: 'cascade' }),
    seriesIndex: real('series_index'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.seriesId] }),
    uniqueIndex('book_series_memberships_book_display_uidx').on(t.bookId, t.displayOrder),
    index('book_series_memberships_series_index_book_idx').on(t.seriesId, t.seriesIndex, t.bookId),
    index('book_series_memberships_book_display_idx').on(t.bookId, t.displayOrder),
    check('book_series_memberships_display_order_nonnegative_chk', sql`${t.displayOrder} >= 0`),
  ],
);

export type BookSeriesMembership = typeof bookSeriesMemberships.$inferSelect;
export type NewBookSeriesMembership = typeof bookSeriesMemberships.$inferInsert;
