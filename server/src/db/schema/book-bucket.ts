import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { BookBucketMetadata } from '@projectx/types';

import { libraries, libraryFolders } from './libraries';

export const bookBucketFiles = pgTable(
  'book_bucket_files',
  {
    id: serial('id').primaryKey(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    absolutePath: text('absolute_path').notNull().unique(),
    fileSize: bigint('file_size', { mode: 'number' }),
    format: varchar('format', { length: 20 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    embeddedMetadata: jsonb('embedded_metadata').$type<BookBucketMetadata>(),
    selectedMetadata: jsonb('selected_metadata').$type<BookBucketMetadata>(),
    fetchedMetadata: jsonb('fetched_metadata').$type<BookBucketMetadata>(),
    coverPath: text('cover_path'),
    targetLibraryId: integer('target_library_id').references(() => libraries.id, { onDelete: 'set null' }),
    targetFolderId: integer('target_folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
    confidence: integer('confidence'),
    fetchedMetadataSources: jsonb('fetched_metadata_sources').$type<Partial<Record<keyof BookBucketMetadata, string>>>(),
    errorMessage: text('error_message'),
    metadataEditedAt: timestamp('metadata_edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('book_bucket_files_status_idx').on(t.status),
    check('book_bucket_files_status_chk', sql`${t.status} in ('pending', 'extracting', 'fetching', 'ready', 'error')`),
    check('book_bucket_files_confidence_range_chk', sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 100)`),
  ],
);

export type BookBucketFileRow = typeof bookBucketFiles.$inferSelect;
export type NewBookBucketFileRow = typeof bookBucketFiles.$inferInsert;
