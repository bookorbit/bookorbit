import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { BulkRunKind, BulkRunStatus } from '@bookorbit/types';

import { apiKeys } from './api-keys';
import { users } from './auth';

export interface BulkRunFailure {
  id: number;
  code: string;
  message: string | null;
}

/**
 * One bulk action or book move running in the background. `subject_ids` holds the resolved ids in
 * order; `processed` is both the count done and where a continued run resumes. The ids are cleared
 * once a run settles, and kept on an interrupted run until it is continued or dismissed.
 */
export const bulkRuns = pgTable(
  'bulk_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: varchar('kind', { length: 40 }).$type<BulkRunKind>().notNull(),
    requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
    credentialKind: varchar('credential_kind', { length: 10 }).$type<'session' | 'api_key'>().notNull(),
    // A key run whose key is deleted loses it here and stops at its next credential check.
    apiKeyId: integer('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 20 }).$type<BulkRunStatus>().notNull().default('queued'),
    subjectIds: integer('subject_ids')
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    total: integer('total').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    succeeded: integer('succeeded').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    stats: jsonb('stats').$type<Record<string, number>>().notNull().default({}),
    failures: jsonb('failures').$type<BulkRunFailure[]>().notNull().default([]),
    errorCode: varchar('error_code', { length: 50 }),
    error: text('error'),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    actorUsername: varchar('actor_username', { length: 255 }),
    actorIp: varchar('actor_ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [
    index('bulk_runs_status_created_idx').on(t.status, t.createdAt),
    index('bulk_runs_requested_by_created_idx').on(t.requestedBy, sql`${t.createdAt} desc`),
    index('bulk_runs_finished_idx').on(sql`${t.finishedAt} desc`, sql`${t.id} desc`),
    index('bulk_runs_requested_by_finished_idx').on(t.requestedBy, sql`${t.finishedAt} desc`, sql`${t.id} desc`),
    check(
      'bulk_runs_kind_chk',
      sql`${t.kind} in ('book-refresh-metadata', 'book-re-extract-cover', 'book-embed-audio-cover', 'author-refresh-metadata', 'book-move')`,
    ),
    check('bulk_runs_status_chk', sql`${t.status} in ('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted')`),
    check('bulk_runs_credential_kind_chk', sql`${t.credentialKind} in ('session', 'api_key')`),
    check(
      'bulk_runs_counts_nonnegative_chk',
      sql`${t.total} >= 0 and ${t.processed} >= 0 and ${t.succeeded} >= 0 and ${t.failed} >= 0 and ${t.skipped} >= 0`,
    ),
  ],
);

export type BulkRunRow = typeof bulkRuns.$inferSelect;
