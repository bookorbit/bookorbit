import { sql } from 'drizzle-orm';
import { bigint, check, foreignKey, index, integer, pgTable, serial, timestamp, unique, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

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
    primaryFileId: integer('primary_file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
    primaryAuthorSortName: varchar('primary_author_sort_name', { length: 500 }),
    folderPath: varchar('folder_path', { length: 4096 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('present'),
    addedAt: timestamp('added_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('books_library_id_folder_path_idx').on(t.libraryId, t.folderPath),
    unique('books_id_library_folder_id_unique').on(t.id, t.libraryFolderId),
    index('books_primary_file_id_idx').on(t.primaryFileId),
    index('books_library_status_idx').on(t.libraryId, t.status),
    index('books_library_added_at_idx').on(t.libraryId, sql`${t.addedAt} desc`),
    index('books_library_visible_added_id_idx')
      .on(t.libraryId, sql`${t.addedAt} desc`, t.id)
      .where(sql`${t.status} <> 'processing'`),
    index('books_library_author_sort_id_idx')
      .on(t.libraryId, sql`${t.primaryAuthorSortName} asc nulls last`, t.id)
      .where(sql`${t.status} <> 'processing'`),
    index('books_library_author_sort_desc_id_idx')
      .on(t.libraryId, sql`${t.primaryAuthorSortName} desc nulls last`, t.id)
      .where(sql`${t.status} <> 'processing'`),
    foreignKey({
      columns: [t.libraryFolderId, t.libraryId],
      foreignColumns: [libraryFolders.id, libraryFolders.libraryId],
      name: 'books_library_folder_library_fk',
    }),
    check('books_status_chk', sql`${t.status} in ('present', 'missing', 'processing')`),
  ],
);

export const bookFiles = pgTable(
  'book_files',
  {
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
    mtime: timestamp('mtime', { withTimezone: true }),
    fileHash: varchar('file_hash', { length: 32 }),
    format: varchar('format', { length: 20 }),
    role: varchar('role', { length: 20 }).notNull().default('content'),
    sortOrder: integer('sort_order'),
    durationSeconds: integer('duration_seconds'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('book_files_absolute_path_uidx').on(t.absolutePath),
    index('book_files_book_id_idx').on(t.bookId),
    index('book_files_library_folder_id_idx').on(t.libraryFolderId),
    index('book_files_file_hash_idx').on(t.fileHash),
    index('book_files_ino_idx').on(t.ino),
    index('book_files_format_idx').on(t.format),
    index('book_files_library_folder_file_hash_idx').on(t.libraryFolderId, t.fileHash),
    index('book_files_library_folder_ino_idx').on(t.libraryFolderId, t.ino),
    foreignKey({
      columns: [t.bookId, t.libraryFolderId],
      foreignColumns: [books.id, books.libraryFolderId],
      name: 'book_files_book_folder_consistency_fk',
    }).onUpdate('cascade'),
    check('book_files_role_chk', sql`${t.role} in ('content', 'cover', 'metadata', 'supplement')`),
    check('book_files_size_bytes_nonnegative_chk', sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
    check('book_files_duration_seconds_nonnegative_chk', sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`),
  ],
);

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;

export type BookFile = typeof bookFiles.$inferSelect;
export type NewBookFile = typeof bookFiles.$inferInsert;
