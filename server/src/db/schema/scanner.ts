import { integer, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { libraries } from './libraries';

export const scanJobs = pgTable('scan_jobs', {
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
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
});

export type ScanJob = typeof scanJobs.$inferSelect;
export type NewScanJob = typeof scanJobs.$inferInsert;
