import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { libraries, libraryFolders } from './libraries';

/**
 * Crash marker for cross-library move jobs. Job progress itself stays in memory
 * like every other bulk job; this row exists so a restart can tell that a move
 * was interrupted and repair the affected libraries immediately instead of
 * waiting for the periodic reconcile.
 */
export const bookMoveJobs = pgTable(
  'book_move_jobs',
  {
    id: serial('id').primaryKey(),
    startedBy: integer('started_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetLibraryId: integer('target_library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    targetFolderId: integer('target_folder_id')
      .notNull()
      .references(() => libraryFolders.id, { onDelete: 'cascade' }),
    sourceLibraryIds: jsonb('source_library_ids').$type<number[]>().notNull().default([]),
    status: varchar('status', { length: 20 }).notNull().default('running'),
    totalBooks: integer('total_books').notNull().default(0),
    succeeded: integer('succeeded').notNull().default(0),
    merged: integer('merged').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('book_move_jobs_status_idx').on(t.status),
    index('book_move_jobs_started_at_idx').on(sql`${t.startedAt} desc`),
    check('book_move_jobs_status_chk', sql`${t.status} in ('running', 'completed', 'failed', 'interrupted')`),
    check(
      'book_move_jobs_counts_nonnegative_chk',
      sql`${t.totalBooks} >= 0 and ${t.succeeded} >= 0 and ${t.merged} >= 0 and ${t.failed} >= 0 and ${t.skipped} >= 0`,
    ),
  ],
);

export type BookMoveJob = typeof bookMoveJobs.$inferSelect;
export type NewBookMoveJob = typeof bookMoveJobs.$inferInsert;
