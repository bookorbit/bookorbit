import { bigint, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { libraryFolders, libraries } from './libraries';

export const books = pgTable(
  'books',
  {
    id: serial('id').primaryKey(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    libraryFolderId: integer('library_folder_id')
      .notNull()
      .references(() => libraryFolders.id, { onDelete: 'cascade' }),
    folderPath: varchar('folder_path', { length: 4096 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('present'),
    addedAt: timestamp('added_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [uniqueIndex('books_library_id_folder_path_idx').on(t.libraryId, t.folderPath)],
);

export const bookFiles = pgTable('book_files', {
  id: serial('id').primaryKey(),
  bookId: integer('book_id')
    .notNull()
    .references(() => books.id, { onDelete: 'cascade' }),
  libraryFolderId: integer('library_folder_id')
    .notNull()
    .references(() => libraryFolders.id, { onDelete: 'cascade' }),
  absolutePath: varchar('absolute_path', { length: 4096 }).notNull(),
  relPath: varchar('rel_path', { length: 4096 }),
  ino: bigint('ino', { mode: 'number' }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  mtime: timestamp('mtime'),
  hash: varchar('hash', { length: 64 }),
  format: varchar('format', { length: 20 }),
  role: varchar('role', { length: 20 }).notNull().default('primary'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;

export type BookFile = typeof bookFiles.$inferSelect;
export type NewBookFile = typeof bookFiles.$inferInsert;
