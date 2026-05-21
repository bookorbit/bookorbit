import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { FieldPreferenceOverrides, BookMetadataFetchConfigOverride } from '@bookorbit/types';

export const libraries = pgTable(
  'libraries',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    icon: varchar('icon', { length: 100 }),
    displayOrder: integer('display_order').notNull().default(0),
    coverAspectRatio: varchar('cover_aspect_ratio', { length: 10 }).notNull().default('2/3'),

    // File watching & scheduling
    watch: boolean('watch').notNull().default(false),
    autoScanCronExpression: text('auto_scan_cron_expression'),

    // Scanner behaviour
    metadataPrecedence: jsonb('metadata_precedence')
      .$type<string[]>()
      .notNull()
      .default(['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar']),
    formatPriority: jsonb('format_priority')
      .$type<string[]>()
      .notNull()
      .default(['epub', 'pdf', 'cbz', 'cbr', 'cb7', 'mobi', 'azw3', 'azw', 'fb2', 'm4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac']),
    allowedFormats: jsonb('allowed_formats').$type<string[]>().notNull().default([]),
    organizationMode: varchar('organization_mode', { length: 20 }).notNull().default('book_per_folder'),
    excludePatterns: jsonb('exclude_patterns').$type<string[]>().notNull().default([]),

    // Reading progress thresholds
    readingThreshold: doublePrecision('reading_threshold').notNull().default(0.25),
    markAsFinishedPercentComplete: integer('mark_as_finished_percent_complete').notNull().default(98),

    // File write-back settings
    fileWriteEnabled: boolean('file_write_enabled').notNull().default(false),
    fileWriteWriteCover: boolean('file_write_write_cover').notNull().default(true),
    fileWriteEpubEnabled: boolean('file_write_epub_enabled').notNull().default(true),
    fileWriteEpubMaxFileSizeMb: integer('file_write_epub_max_file_size_mb').notNull().default(100),
    fileWritePdfEnabled: boolean('file_write_pdf_enabled').notNull().default(true),
    fileWritePdfMaxFileSizeMb: integer('file_write_pdf_max_file_size_mb').notNull().default(100),
    fileWriteCbxEnabled: boolean('file_write_cbx_enabled').notNull().default(false),
    fileWriteCbxMaxFileSizeMb: integer('file_write_cbx_max_file_size_mb').notNull().default(500),
    fileRenameEnabled: boolean('file_rename_enabled').notNull().default(false),

    // File naming pattern for uploads (null = use global default)
    fileNamingPattern: varchar('file_naming_pattern', { length: 500 }),

    // Metadata fetch preferences override (null = inherit global defaults)
    metadataFetchPreferences: jsonb('metadata_fetch_preferences').$type<FieldPreferenceOverrides>(),

    // Book metadata auto-fetch config override (null = inherit global defaults)
    bookMetadataFetchConfig: jsonb('book_metadata_fetch_config').$type<BookMetadataFetchConfigOverride>(),

    // Last manual/scheduled run info for this library (null = never run)
    bookMetadataFetchLastRunAt: timestamp('book_metadata_fetch_last_run_at', { withTimezone: true }),
    bookMetadataFetchLastQueuedCount: integer('book_metadata_fetch_last_queued_count'),

    // Legacy - kept for scanner compatibility
    scanMode: varchar('scan_mode', { length: 20 }).notNull().default('auto'),
    pollInterval: integer('poll_interval_seconds').default(300),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('libraries_name_lower_uidx').on(sql`lower(${t.name})`),
    check('libraries_display_order_nonnegative_chk', sql`${t.displayOrder} >= 0`),
    check('libraries_organization_mode_chk', sql`${t.organizationMode} in ('book_per_folder', 'book_per_file')`),
    check('libraries_reading_threshold_range_chk', sql`${t.readingThreshold} >= 0 and ${t.readingThreshold} <= 1`),
    check('libraries_mark_finished_percent_range_chk', sql`${t.markAsFinishedPercentComplete} >= 0 and ${t.markAsFinishedPercentComplete} <= 100`),
    check('libraries_scan_mode_chk', sql`${t.scanMode} in ('auto', 'manual')`),
    check('libraries_poll_interval_nonnegative_chk', sql`${t.pollInterval} is null or ${t.pollInterval} >= 0`),
    check('libraries_file_write_epub_max_size_chk', sql`${t.fileWriteEpubMaxFileSizeMb} >= 1`),
    check('libraries_file_write_pdf_max_size_chk', sql`${t.fileWritePdfMaxFileSizeMb} >= 1`),
    check('libraries_file_write_cbx_max_size_chk', sql`${t.fileWriteCbxMaxFileSizeMb} >= 1`),
  ],
);

export const libraryFolders = pgTable(
  'library_folders',
  {
    id: serial('id').primaryKey(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    path: varchar('path', { length: 4096 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('library_folders_library_id_idx').on(t.libraryId),
    uniqueIndex('library_folders_library_path_uidx').on(t.libraryId, t.path),
    unique('library_folders_id_library_id_unique').on(t.id, t.libraryId),
  ],
);

export type Library = typeof libraries.$inferSelect;
export type NewLibrary = typeof libraries.$inferInsert;

export type LibraryFolder = typeof libraryFolders.$inferSelect;
export type NewLibraryFolder = typeof libraryFolders.$inferInsert;
