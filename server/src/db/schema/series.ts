import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, primaryKey, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';

export const bookSeries = pgTable(
  'book_series',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 500 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 500 }).notNull(),
    expectedBookCount: integer('expected_book_count'),
    expectedBookCountSource: varchar('expected_book_count_source', { length: 50 }),
    expectedBookCountUpdatedAt: timestamp('expected_book_count_updated_at', { withTimezone: true }),
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
    // Ceiling mirrors MAX_SERIES_TOTAL_BOOKS; a provider cannot persist a total that would
    // make the series gap finder enumerate an unbounded range.
    check(
      'book_series_expected_book_count_range_chk',
      sql`${t.expectedBookCount} IS NULL OR (${t.expectedBookCount} >= 1 AND ${t.expectedBookCount} <= 10000)`,
    ),
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
    seriesIndex: varchar('series_index', { length: 20 }),
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
    index('book_series_memberships_series_index_book_idx').on(
      t.seriesId,
      sql`(CASE WHEN ${t.seriesIndex} IS NULL THEN NULL ELSE ARRAY[split_part(${t.seriesIndex}, '.', 1)::numeric, CASE WHEN strpos(${t.seriesIndex}, '.') = 0 THEN -1::numeric ELSE split_part(${t.seriesIndex}, '.', 2)::numeric END] END)`,
      sql`${t.seriesIndex} COLLATE "C"`,
      t.bookId,
    ),
    index('book_series_memberships_book_display_idx').on(t.bookId, t.displayOrder),
    check('book_series_memberships_display_order_nonnegative_chk', sql`${t.displayOrder} >= 0`),
    check('book_series_memberships_series_index_format_chk', sql`${t.seriesIndex} is null or ${t.seriesIndex} ~ '^[0-9]+([.][0-9]+)?$'`),
  ],
);

export type BookSeriesMembership = typeof bookSeriesMemberships.$inferSelect;
export type NewBookSeriesMembership = typeof bookSeriesMemberships.$inferInsert;
