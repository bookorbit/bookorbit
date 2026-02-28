import { bigint, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { StagingMetadata } from '@projectx/types';

import { libraries, libraryFolders } from './libraries';

export const stagingFiles = pgTable(
  'staging_files',
  {
    id: serial('id').primaryKey(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    absolutePath: text('absolute_path').notNull().unique(),
    fileSize: bigint('file_size', { mode: 'number' }),
    format: varchar('format', { length: 20 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    embeddedMetadata: jsonb('embedded_metadata').$type<StagingMetadata>(),
    selectedMetadata: jsonb('selected_metadata').$type<StagingMetadata>(),
    fetchedMetadata: jsonb('fetched_metadata').$type<StagingMetadata>(),
    coverPath: text('cover_path'),
    targetLibraryId: integer('target_library_id').references(() => libraries.id, { onDelete: 'set null' }),
    targetFolderId: integer('target_folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
    confidence: integer('confidence'),
    fetchedMetadataSources: jsonb('fetched_metadata_sources').$type<Partial<Record<keyof StagingMetadata, string>>>(),
    errorMessage: text('error_message'),
    metadataEditedAt: timestamp('metadata_edited_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [index('staging_files_status_idx').on(t.status)],
);

export type StagingFileRow = typeof stagingFiles.$inferSelect;
export type NewStagingFileRow = typeof stagingFiles.$inferInsert;
