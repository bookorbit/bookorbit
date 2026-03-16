import { boolean, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import { FieldPreferenceOverrides, BookMetadataFetchConfigOverride } from '@projectx/types';

export const libraries = pgTable('libraries', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  icon: varchar('icon', { length: 100 }),
  displayOrder: integer('display_order').notNull().default(0),

  // File watching & scheduling
  watch: boolean('watch').notNull().default(false),
  autoScanCronExpression: text('auto_scan_cron_expression'),

  // Scanner behaviour
  metadataPrecedence: jsonb('metadata_precedence')
    .$type<string[]>()
    .notNull()
    .default(['folderStructure', 'embedded', 'nfoFile', 'opfFile', 'sidecar']),
  formatPriority: jsonb('format_priority').$type<string[]>().notNull().default(['epub', 'pdf', 'cbz', 'cbr', 'mobi', 'azw3', 'fb2']),
  allowedFormats: jsonb('allowed_formats').$type<string[]>().notNull().default([]),
  organizationMode: varchar('organization_mode', { length: 20 }).notNull().default('auto'),
  excludePatterns: jsonb('exclude_patterns').$type<string[]>().notNull().default([]),

  // Reading progress thresholds
  markAsFinishedSecondsRemaining: integer('mark_as_finished_seconds_remaining'),
  markAsFinishedPercentComplete: integer('mark_as_finished_percent_complete'),

  // File naming pattern for uploads (null = use global default)
  fileNamingPattern: varchar('file_naming_pattern', { length: 500 }),

  // Metadata fetch preferences override (null = inherit global defaults)
  metadataFetchPreferences: jsonb('metadata_fetch_preferences').$type<FieldPreferenceOverrides>(),

  // Book metadata auto-fetch config override (null = inherit global defaults)
  bookMetadataFetchConfig: jsonb('book_metadata_fetch_config').$type<BookMetadataFetchConfigOverride>(),

  // Last manual/scheduled run info for this library (null = never run)
  bookMetadataFetchLastRunAt: timestamp('book_metadata_fetch_last_run_at'),
  bookMetadataFetchLastQueuedCount: integer('book_metadata_fetch_last_queued_count'),

  // Legacy — kept for scanner compatibility
  scanMode: varchar('scan_mode', { length: 20 }).notNull().default('auto'),
  pollInterval: integer('poll_interval_seconds').default(300),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdateFn(() => new Date()),
});

export const libraryFolders = pgTable('library_folders', {
  id: serial('id').primaryKey(),
  libraryId: integer('library_id')
    .notNull()
    .references(() => libraries.id, { onDelete: 'cascade' }),
  path: varchar('path', { length: 4096 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export type Library = typeof libraries.$inferSelect;
export type NewLibrary = typeof libraries.$inferInsert;

export type LibraryFolder = typeof libraryFolders.$inferSelect;
export type NewLibraryFolder = typeof libraryFolders.$inferInsert;
