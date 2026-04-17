import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { libraries } from './libraries';
import { libraryFolders } from './libraries';

export const scanJobs = pgTable(
  'scan_jobs',
  {
    id: serial('id').primaryKey(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    triggeredBy: varchar('triggered_by', { length: 20 }).notNull(),
    addedCount: integer('added_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    missingCount: integer('missing_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('scan_jobs_library_status_idx').on(t.libraryId, t.status),
    check('scan_jobs_status_chk', sql`${t.status} in ('running', 'completed', 'failed')`),
    check('scan_jobs_triggered_by_chk', sql`${t.triggeredBy} in ('manual', 'watcher', 'schedule')`),
    check('scan_jobs_added_count_nonnegative_chk', sql`${t.addedCount} >= 0`),
    check('scan_jobs_updated_count_nonnegative_chk', sql`${t.updatedCount} >= 0`),
    check('scan_jobs_missing_count_nonnegative_chk', sql`${t.missingCount} >= 0`),
  ],
);

export type ScanJob = typeof scanJobs.$inferSelect;
export type NewScanJob = typeof scanJobs.$inferInsert;

export const libraryDirScanState = pgTable(
  'library_dir_scan_state',
  {
    id: serial('id').primaryKey(),
    libraryFolderId: integer('library_folder_id')
      .notNull()
      .references(() => libraryFolders.id, { onDelete: 'cascade' }),
    dirPath: varchar('dir_path', { length: 4096 }).notNull(),
    lastSeenMtimeMs: bigint('last_seen_mtime_ms', { mode: 'number' }).notNull(),
  },
  (t) => [
    uniqueIndex('library_dir_scan_state_folder_dir_uidx').on(t.libraryFolderId, t.dirPath),
    index('library_dir_scan_state_folder_idx').on(t.libraryFolderId),
  ],
);

export type LibraryDirScanState = typeof libraryDirScanState.$inferSelect;
