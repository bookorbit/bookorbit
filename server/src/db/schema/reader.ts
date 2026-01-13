import { index, integer, pgTable, primaryKey, real, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { bookFiles, books } from './books';
import { users } from './auth';

export const readingProgress = pgTable(
  'reading_progress',
  {
    bookFileId: integer('book_file_id')
      .notNull()
      .references(() => bookFiles.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    percentage: real('percentage').notNull().default(0),
    // EPUB: CFI string pinpoints exact location
    cfi: varchar('cfi', { length: 2000 }),
    // PDF / CBX / CBR: zero-based page index
    pageNumber: integer('page_number'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookFileId, t.userId] }), index('reading_progress_user_id_idx').on(t.userId)],
);

export type ReadingProgress = typeof readingProgress.$inferSelect;
export type NewReadingProgress = typeof readingProgress.$inferInsert;

export const bookmarks = pgTable(
  'bookmarks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    cfi: varchar('cfi', { length: 2000 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('bookmarks_user_id_idx').on(t.userId)],
);

export type BookmarkRow = typeof bookmarks.$inferSelect;
export type NewBookmark = typeof bookmarks.$inferInsert;

export const annotations = pgTable(
  'annotations',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
  },
  (t) => [index('annotations_user_id_idx').on(t.userId)],
);

export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
