import { integer, pgTable, real, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { bookFiles, books } from './books';

export const readingProgress = pgTable('reading_progress', {
  bookFileId: integer('book_file_id')
    .primaryKey()
    .references(() => bookFiles.id, { onDelete: 'cascade' }),
  percentage: real('percentage').notNull().default(0),
  // EPUB: CFI string pinpoints exact location
  cfi: varchar('cfi', { length: 2000 }),
  // PDF / CBX / CBR: zero-based page index
  pageNumber: integer('page_number'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type ReadingProgress = typeof readingProgress.$inferSelect;
export type NewReadingProgress = typeof readingProgress.$inferInsert;

export const bookmarks = pgTable('bookmarks', {
  id: serial('id').primaryKey(),
  bookId: integer('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  cfi: varchar('cfi', { length: 2000 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type BookmarkRow = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export const annotations = pgTable('annotations', {
  id: serial('id').primaryKey(),
  bookId: integer('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  cfi: varchar('cfi', { length: 2000 }).notNull(),
  text: text('text').notNull(),
  color: varchar('color', { length: 20 }).notNull().default('yellow'),
  style: varchar('style', { length: 20 }).notNull().default('highlight'),
  note: text('note'),
  chapterTitle: varchar('chapter_title', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
