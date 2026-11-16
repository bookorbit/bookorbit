import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { BookDockHoldDetail, BookDockHoldReason, BookDockMetadata } from '@bookorbit/types';

import { books } from './books';
import { libraries, libraryFolders } from './libraries';
import { libraryDocks } from './library-docks';
import { users } from './auth';

export const bookDockFiles = pgTable(
  'book_dock_files',
  {
    id: serial('id').primaryKey(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    absolutePath: text('absolute_path').notNull().unique(),
    fileSize: bigint('file_size', { mode: 'number' }),
    format: varchar('format', { length: 20 }),
    /**
     * Set when this row owns a directory of files rather than a single loose one. The row's own
     * `absolutePath`, `format` and `fileSize` keep describing the unit's **primary** file, because
     * metadata and cover extraction on a 31-track audiobook should read exactly one of them.
     *
     * Null means no exclusive directory ownership; a row may still have unit files when
     * several books share a folder. Watched books may be nested at any depth. Imports with
     * autoFinalizeSuppressed claim their directory before copying, so discovery skips its tree.
     */
    unitDirectory: text('unit_directory').unique(),
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
    /**
     * Another module owns finalization for this row and will call it explicitly once its own
     * checks pass. Generic auto-finalize skips it so the two paths never race for the same file.
     * The dock deliberately does not learn which module, only that it is not its call to make.
     */
    autoFinalizeSuppressed: boolean('auto_finalize_suppressed').notNull().default(false),
    /** The library dock the file arrived in. Null for Unsorted, request imports and Unsorted uploads. */
    dockId: integer('dock_id').references(() => libraryDocks.id, { onDelete: 'set null' }),
    /** The name of the library this file was headed for, kept when that library is deleted. */
    formerLibraryName: varchar('former_library_name', { length: 255 }),
    holdReason: varchar('hold_reason', { length: 40 }).$type<BookDockHoldReason>(),
    holdDetail: jsonb('hold_detail').$type<BookDockHoldDetail>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('book_dock_files_status_idx').on(t.status),
    index('book_dock_files_target_library_id_idx').on(t.targetLibraryId),
    index('book_dock_files_uploaded_by_idx').on(t.uploadedBy),
    index('book_dock_files_dock_id_idx').on(t.dockId),
    check('book_dock_files_status_chk', sql`${t.status} in ('pending', 'extracting', 'fetching', 'ready', 'error')`),
    check(
      'book_dock_files_hold_reason_chk',
      sql`${t.holdReason} is null or ${t.holdReason} in ('low_confidence', 'no_destination', 'no_folder', 'not_allowed_in_library', 'duplicate', 'destination_conflict', 'unsupported_layout', 'waiting_for_manager')`,
    ),
    check('book_dock_files_confidence_range_chk', sql`${t.confidence} is null or (${t.confidence} >= 0 and ${t.confidence} <= 100)`),
  ],
);

export type BookDockFileRow = typeof bookDockFiles.$inferSelect;
export type NewBookDockFileRow = typeof bookDockFiles.$inferInsert;

/**
 * The files a dock unit is made of, in playback or format order. Holds **every** file including
 * the primary, so the primary's path appears here and on the anchor row too. That duplication is
 * the cheaper half of the trade: placement, rollback, discard and delete iterate one list rather
 * than a union, and the anchor stays a plain "which file do I read metadata from" pointer.
 */
export const bookDockUnitFiles = pgTable(
  'book_dock_unit_files',
  {
    id: serial('id').primaryKey(),
    dockFileId: integer('dock_file_id')
      .notNull()
      .references(() => bookDockFiles.id, { onDelete: 'cascade' }),
    absolutePath: text('absolute_path').notNull().unique(),
    fileName: varchar('file_name', { length: 500 }).notNull(),
    fileSize: bigint('file_size', { mode: 'number' }),
    format: varchar('format', { length: 20 }),
    role: varchar('role', { length: 20 }).notNull().default('content'),
    /** Content files only. Natural order within the unit, so track 10 follows track 9. */
    sortOrder: integer('sort_order'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('book_dock_unit_files_dock_file_id_sort_order_idx').on(t.dockFileId, t.sortOrder),
    check('book_dock_unit_files_role_chk', sql`${t.role} in ('content', 'cover', 'metadata', 'supplement')`),
  ],
);

export type BookDockUnitFileRow = typeof bookDockUnitFiles.$inferSelect;
export type NewBookDockUnitFileRow = typeof bookDockUnitFiles.$inferInsert;

/**
 * Source files a keep-original dock filed by hardlink or copy and left in place for a download
 * client to keep seeding. The dock row is gone once filed; this remembers the file so a rescan does
 * not offer it again. A file whose size or modification time changed is a new arrival.
 *
 * `ignored` marks a file a manager discarded: it stays on disk and is never offered again.
 */
export const bookDockKeptFiles = pgTable(
  'book_dock_kept_files',
  {
    id: serial('id').primaryKey(),
    absolutePath: text('absolute_path').notNull().unique(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    mtimeMs: bigint('mtime_ms', { mode: 'number' }).notNull(),
    dockId: integer('dock_id').references(() => libraryDocks.id, { onDelete: 'set null' }),
    bookId: integer('book_id').references(() => books.id, { onDelete: 'set null' }),
    ignored: boolean('ignored').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('book_dock_kept_files_dock_id_idx').on(t.dockId), index('book_dock_kept_files_book_id_idx').on(t.bookId)],
);

export type BookDockKeptFileRow = typeof bookDockKeptFiles.$inferSelect;
export type NewBookDockKeptFileRow = typeof bookDockKeptFiles.$inferInsert;
