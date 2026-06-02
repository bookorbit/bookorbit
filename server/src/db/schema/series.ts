import { sql } from 'drizzle-orm';
import { index, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

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
    index('book_series_name_lower_idx').on(sql`lower(${t.name})`),
  ],
);

export type BookSeries = typeof bookSeries.$inferSelect;
export type NewBookSeries = typeof bookSeries.$inferInsert;
