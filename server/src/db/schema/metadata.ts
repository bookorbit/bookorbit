import { integer, pgTable, primaryKey, real, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { books } from './books';

export const bookMetadata = pgTable('book_metadata', {
  bookId: integer('book_id')
    .primaryKey()
    .references(() => books.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 1000 }),
  subtitle: varchar('subtitle', { length: 1000 }),
  description: text('description'),
  isbn10: varchar('isbn10', { length: 10 }),
  isbn13: varchar('isbn13', { length: 13 }),
  publisher: varchar('publisher', { length: 500 }),
  publishedYear: integer('published_year'),
  language: varchar('language', { length: 10 }),
  pageCount: integer('page_count'),
  seriesName: varchar('series_name', { length: 500 }),
  seriesIndex: real('series_index'),
  rating: integer('rating'),
  coverSource: varchar('cover_source', { length: 9 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const authors = pgTable('authors', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 500 }).notNull(),
  sortName: varchar('sort_name', { length: 500 }),
});

export const bookAuthors = pgTable(
  'book_authors',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    authorId: integer('author_id')
      .notNull()
      .references(() => authors.id),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.authorId] })],
);

export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 200 }).notNull().unique(),
});

export const bookTags = pgTable(
  'book_tags',
  {
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.tagId] })],
);

export type BookMetadata = typeof bookMetadata.$inferSelect;
export type NewBookMetadata = typeof bookMetadata.$inferInsert;

export type Author = typeof authors.$inferSelect;
export type NewAuthor = typeof authors.$inferInsert;

export type Tag = typeof tags.$inferSelect;
export type NewTag = typeof tags.$inferInsert;
