import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';
import { books } from './books';
import { libraries } from './libraries';

export interface BookMergeSnapshotFile {
  fileId: number;
  relPath: string | null;
  role: string;
  format: string | null;
}

export interface BookMergeSnapshotCoverSlot {
  medium: string;
  source: string | null;
  lockedAt: string | null;
}

/** The merged-away book as it stood, without any per-user data. Kept for a later split and for support. */
export interface BookMergeSnapshot {
  title: string | null;
  folderPath: string;
  libraryFolderId: number;
  addedAt: string | null;
  metadata: Record<string, unknown> | null;
  lockedFields: string[];
  authors: string[];
  narrators: string[];
  series: Array<{ seriesId: number; seriesIndex: number | null; displayOrder: number }>;
  genreIds: number[];
  tagIds: number[];
  providerIds: Record<string, string>;
  coverSlots: BookMergeSnapshotCoverSlot[];
  files: BookMergeSnapshotFile[];
}

export interface BookMergeJobMove {
  fileId: number | null;
  from: string;
  to: string;
  phase: 'started' | 'done';
  expectedSize: number | null;
  expectedMtimeMs: number | null;
  movedSize?: number;
  movedMtimeMs?: number;
  movedIno?: string;
}

export const bookMergeJobs = pgTable(
  'book_merge_jobs',
  {
    id: serial('id').primaryKey(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    // Every library the merge touches, the destination included; null on jobs from before merges
    // could span libraries, which touched `library_id` only. Recovery takes all of their gates.
    libraryIds: integer('library_ids').array(),
    // Plain ids: the job outlives the books it names, and recovery must still read them.
    targetBookId: integer('target_book_id').notNull(),
    destinationBookId: integer('destination_book_id'),
    sourceBookIds: integer('source_book_ids').array().notNull(),
    requestedByUserId: integer('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).notNull().default('planned'),
    plan: jsonb('plan').$type<Record<string, unknown>>().notNull(),
    moves: jsonb('moves').$type<BookMergeJobMove[]>().notNull().default([]),
    outcomes: jsonb('outcomes').$type<Array<{ sourceBookId: number; status: string; errorCode: string | null }>>().notNull().default([]),
    result: jsonb('result').$type<Record<string, unknown>>(),
    currentSourceBookId: integer('current_source_book_id'),
    processed: integer('processed').notNull().default(0),
    total: integer('total').notNull().default(0),
    errorCode: varchar('error_code', { length: 64 }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('book_merge_jobs_unfinished_idx')
      .on(t.status)
      .where(sql`${t.status} not in ('done', 'failed', 'rolled_back')`),
    index('book_merge_jobs_library_idx').on(t.libraryId),
    check('book_merge_jobs_status_chk', sql`${t.status} in ('planned', 'moving', 'committing', 'committed', 'done', 'failed', 'rolled_back')`),
    check('book_merge_jobs_counts_nonnegative_chk', sql`${t.processed} >= 0 and ${t.total} >= 0`),
  ],
);

/**
 * Every merged-away book id and the book it now lives in. Serial ids are never reused, so an alias
 * can never shadow a new book; the target is always the final one (flattened on a later merge).
 */
export const bookMerges = pgTable(
  'book_merges',
  {
    sourceBookId: integer('source_book_id').primaryKey(),
    targetBookId: integer('target_book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id').notNull(),
    mergedByUserId: integer('merged_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    mergedAt: timestamp('merged_at', { withTimezone: true }).defaultNow().notNull(),
    jobId: integer('job_id').references(() => bookMergeJobs.id, { onDelete: 'set null' }),
    snapshot: jsonb('snapshot').$type<BookMergeSnapshot>().notNull(),
  },
  (t) => [index('book_merges_target_book_id_idx').on(t.targetBookId)],
);
