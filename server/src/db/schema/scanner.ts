import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { libraries } from './libraries';

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
