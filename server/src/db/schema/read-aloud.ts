import { sql } from 'drizzle-orm';
import { bigserial, boolean, check, index, integer, jsonb, pgTable, smallint, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type {
  ReadAloudChapterReport,
  ReadAloudDecisions,
  ReadAloudJobInput,
  ReadAloudNarrationCoverage,
  ReadAloudReportSummary,
  ReadAloudWarningCode,
} from '@bookorbit/types';

import { users } from './auth';
import { bookFiles, books } from './books';

export const readAloudJobs = pgTable(
  'read_aloud_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookId: integer('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    requestedByUserId: integer('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    outputFileId: integer('output_file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
    replaceFileId: integer('replace_file_id').references(() => bookFiles.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 30 }).notNull().default('queued'),
    stage: varchar('stage', { length: 30 }).notNull().default('queued'),
    progress: smallint('progress').notNull().default(0),
    stageCurrent: integer('stage_current'),
    stageTotal: integer('stage_total'),
    stageUnit: varchar('stage_unit', { length: 10 }),
    input: jsonb('input').$type<ReadAloudJobInput & { sourceHashes: Record<string, string | null> }>().notNull(),
    decisions: jsonb('decisions')
      .$type<ReadAloudDecisions>()
      .notNull()
      .default(sql`'{"chapters":{},"audio":[]}'::jsonb`),
    resumeFrom: varchar('resume_from', { length: 30 }),
    report: jsonb('report').$type<ReadAloudReportSummary>(),
    warnings: jsonb('warnings').$type<ReadAloudWarningCode[]>().notNull().default([]),
    coverage: jsonb('coverage').$type<ReadAloudNarrationCoverage>(),
    errorCode: varchar('error_code', { length: 50 }),
    lastError: varchar('last_error', { length: 2000 }),
    device: varchar('device', { length: 20 }),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    /** Someone chose to add this output despite the review warnings; survives a server restart mid-publish. */
    publishApproved: boolean('publish_approved').notNull().default(false),
    workerEventSeq: integer('worker_event_seq').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    workExpiresAt: timestamp('work_expires_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('read_aloud_jobs_active_book_uidx')
      .on(t.bookId)
      .where(sql`${t.status} in ('queued', 'processing', 'awaiting_review')`),
    index('read_aloud_jobs_due_idx').on(t.status, t.nextAttemptAt, t.createdAt),
    index('read_aloud_jobs_book_updated_idx').on(t.bookId, sql`${t.updatedAt} desc`),
    index('read_aloud_jobs_user_updated_idx').on(t.requestedByUserId, sql`${t.updatedAt} desc`),
    index('read_aloud_jobs_output_file_idx').on(t.outputFileId),
    index('read_aloud_jobs_replace_file_idx').on(t.replaceFileId),
    check(
      'read_aloud_jobs_status_chk',
      sql`${t.status} in ('queued', 'processing', 'awaiting_review', 'completed', 'completed_with_warnings', 'failed', 'cancelled')`,
    ),
    check(
      'read_aloud_jobs_stage_chk',
      sql`${t.stage} in ('queued', 'preparing_audio', 'downloading_model', 'generating_emissions', 'marking_up_ebook', 'aligning', 'validating', 'awaiting_review', 'publishing', 'completed')`,
    ),
    check('read_aloud_jobs_stage_unit_chk', sql`${t.stageUnit} is null or ${t.stageUnit} in ('file', 'track', 'chapter')`),
    check('read_aloud_jobs_progress_chk', sql`${t.progress} between 0 and 100`),
    check('read_aloud_jobs_attempt_nonnegative_chk', sql`${t.attemptCount} >= 0`),
  ],
);

export type ReadAloudJobRow = typeof readAloudJobs.$inferSelect;

export const readAloudJobEvents = pgTable(
  'read_aloud_job_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => readAloudJobs.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    level: varchar('level', { length: 5 }).notNull(),
    stage: varchar('stage', { length: 30 }),
    code: varchar('code', { length: 60 }).notNull(),
    message: varchar('message', { length: 500 }),
    data: jsonb('data').$type<Record<string, string | number | boolean | null>>(),
  },
  (t) => [
    index('read_aloud_job_events_job_idx').on(t.jobId, t.id),
    check('read_aloud_job_events_level_chk', sql`${t.level} in ('info', 'warn', 'error')`),
  ],
);

export type ReadAloudJobEventRow = typeof readAloudJobEvents.$inferSelect;

/**
 * The per-chapter alignment report, kept after the job's work folder is gone so a finished job can
 * still say which chapters matched. Apart from the job row, which every poll reads.
 */
export const readAloudJobReports = pgTable('read_aloud_job_reports', {
  jobId: uuid('job_id')
    .primaryKey()
    .references(() => readAloudJobs.id, { onDelete: 'cascade' }),
  chapters: jsonb('chapters').$type<ReadAloudChapterReport[]>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type NewReadAloudJobEventRow = typeof readAloudJobEvents.$inferInsert;
