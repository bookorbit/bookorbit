import { sql } from 'drizzle-orm';
import { check, integer, pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';

export const bookCovers = pgTable(
  'book_covers',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    medium: varchar('medium', { length: 5 }).notNull(),
    source: varchar('source', { length: 9 }).notNull(),
    origin: varchar('origin', { length: 12 }).notNull(),
    width: integer('width'),
    height: integer('height'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    dormantSince: timestamp('dormant_since', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.medium] }),
    check('book_covers_medium_chk', sql`${t.medium} in ('ebook', 'audio')`),
    check('book_covers_source_chk', sql`${t.source} in ('extracted', 'custom')`),
    check('book_covers_origin_chk', sql`${t.origin} in ('embedded', 'folder_image', 'opf', 'provider', 'dock', 'upload', 'legacy')`),
    check('book_covers_width_positive_chk', sql`${t.width} is null or ${t.width} > 0`),
    check('book_covers_height_positive_chk', sql`${t.height} is null or ${t.height} > 0`),
  ],
);

export type BookCover = typeof bookCovers.$inferSelect;
export type NewBookCover = typeof bookCovers.$inferInsert;
