import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { BookDockMetadata } from '@bookorbit/types';

import { libraries, libraryFolders } from './libraries';
import { users } from './auth';

export const bookDockFiles = pgTable(
  'book_dock_files',
  {
    id: serial('id').primaryKey(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    absolutePath: text('absolute_path').notNull().unique(),
    fileSize: bigint('file_size', { mode: 'number' }),
    format: varchar('format', { length: 20 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    embeddedMetadata: jsonb('embedded_metadata').$type<BookDockMetadata>(),
    selectedMetadata: jsonb('selected_metadata').$type<BookDockMetadata>(),
    fetchedMetadata: jsonb('fetched_metadata').$type<BookDockMetadata>(),
    coverPath: text('cover_path'),
    targetLibraryId: integer('target_library_id').references(() => libraries.id, { onDelete: 'set null' }),
    targetFolderId: integer('target_folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
    confidence: integer('confidence'),
    fetchedMetadataSources: jsonb('fetched_metadata_sources').$type<Partial<Record<keyof BookDockMetadata, string>>>(),
    errorMessage: text('error_message'),
    metadataEditedAt: timestamp('metadata_edited_at', { withTimezone: true }),
    uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('book_dock_files_status_idx').on(t.status),
    index('book_dock_files_uploaded_by_idx').on(t.uploadedBy),
    check('book_dock_files_status_chk', sql`${t.status} in ('pending', 'extracting', 'fetching', 'ready', 'error')`),
    check('book_dock_files_confidence_range_chk', sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 100)`),
  ],
);

export type BookDockFileRow = typeof bookDockFiles.$inferSelect;
export type NewBookDockFileRow = typeof bookDockFiles.$inferInsert;
