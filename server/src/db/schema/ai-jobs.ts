import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { AiEffort, AiJobEstimate, AiJobModels, AiJobSubjectRef } from '@bookorbit/types';

import { aiConnections } from './ai';
import { users } from './auth';
import { bytea } from './columns';

/**
 * One build of an AI feature's output for one subject. Every status change is a conditional update,
 * so the worker loop, a person's request and housekeeping can only move a job along a valid edge.
 */
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    feature: varchar('feature', { length: 40 }).notNull(),
    kind: varchar('kind', { length: 10 }).notNull(),
    subjectKey: varchar('subject_key', { length: 128 }).notNull(),
    subjectRef: jsonb('subject_ref').$type<AiJobSubjectRef>().notNull(),
    pipeline: varchar('pipeline', { length: 40 }).notNull(),
    generation: integer('generation').notNull().default(1),
    status: varchar('status', { length: 12 }).notNull().default('queued'),
    phase: varchar('phase', { length: 40 }),
    done: integer('done').notNull().default(0),
    total: integer('total').notNull().default(0),
    reason: varchar('reason', { length: 40 }),
    requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
    leaseOwner: varchar('lease_owner', { length: 64 }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    /** Higher runs first among due queued jobs of a feature; Move to front sets it above the rest. */
    priority: integer('priority').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    models: jsonb('models').$type<AiJobModels>(),
    estimate: jsonb('estimate').$type<AiJobEstimate>(),
    tokens: bigint('tokens', { mode: 'number' }).notNull().default(0),
    /** Micro-dollars spent so far; null while a request's cost was unknown. */
    costMicros: bigint('cost_micros', { mode: 'number' }),
    /** How many times someone chose Continue past the over-estimate cap. */
    capRaises: smallint('cap_raises').notNull().default(0),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('ai_jobs_unfinished_subject_uidx')
      .on(t.feature, t.subjectKey)
      .where(sql`${t.status} in ('queued', 'running', 'paused')`),
    index('ai_jobs_due_idx').on(t.status, t.nextAttemptAt, t.createdAt),
    index('ai_jobs_subject_created_idx').on(t.feature, t.subjectKey, sql`${t.createdAt} desc`),
    index('ai_jobs_requested_by_idx').on(t.requestedBy),
    index('ai_jobs_queue_order_idx')
      .on(t.feature, sql`${t.priority} desc`, t.nextAttemptAt, t.createdAt)
      .where(sql`${t.status} = 'queued'`),
    index('ai_jobs_finished_idx').on(sql`${t.finishedAt} desc`),
    // The Jobs area's Failed and History views page a feature's ended jobs by when they ended.
    index('ai_jobs_feature_finish_idx')
      .on(t.feature, sql`coalesce(${t.finishedAt}, ${t.updatedAt}) desc`, sql`${t.id} desc`)
      .where(sql`${t.status} in ('completed', 'failed', 'cancelled')`),
    check('ai_jobs_status_chk', sql`${t.status} in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')`),
    check('ai_jobs_kind_chk', sql`${t.kind} in ('build', 'update', 'rebuild')`),
    check('ai_jobs_counts_chk', sql`${t.done} >= 0 and ${t.total} >= 0 and ${t.attempts} >= 0 and ${t.generation} >= 1`),
  ],
);

export type AiJobRow = typeof aiJobs.$inferSelect;
export type NewAiJobRow = typeof aiJobs.$inferInsert;

/**
 * The step cache. A row is one unit's result under one fingerprint, which hashes everything the
 * unit read, so a job reuses exactly the units whose inputs did not change.
 */
export const aiJobSteps = pgTable(
  'ai_job_steps',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    feature: varchar('feature', { length: 40 }).notNull(),
    subjectKey: varchar('subject_key', { length: 128 }).notNull(),
    step: varchar('step', { length: 40 }).notNull(),
    unit: varchar('unit', { length: 64 }).notNull(),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    generation: integer('generation').notNull(),
    outcome: varchar('outcome', { length: 10 }).notNull().default('ok'),
    skipReason: varchar('skip_reason', { length: 20 }),
    result: jsonb('result'),
    model: varchar('model', { length: 200 }),
    tokens: integer('tokens').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }),
    jobId: uuid('job_id').references(() => aiJobs.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_job_steps_unit_uidx').on(t.feature, t.subjectKey, t.step, t.unit, t.fingerprint),
    index('ai_job_steps_subject_generation_idx').on(t.feature, t.subjectKey, t.generation),
    index('ai_job_steps_used_at_idx').on(t.usedAt),
    index('ai_job_steps_job_idx').on(t.jobId),
    check('ai_job_steps_outcome_chk', sql`${t.outcome} in ('ok', 'skipped')`),
  ],
);

export type AiJobStepRow = typeof aiJobSteps.$inferSelect;
export type NewAiJobStepRow = typeof aiJobSteps.$inferInsert;

/** The progress log managers can open. */
export const aiJobEvents = pgTable(
  'ai_job_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => aiJobs.id, { onDelete: 'cascade' }),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    level: varchar('level', { length: 5 }).notNull(),
    step: varchar('step', { length: 40 }),
    code: varchar('code', { length: 60 }).notNull(),
    data: jsonb('data').$type<Record<string, string | number | boolean | null>>(),
  },
  (t) => [index('ai_job_events_job_idx').on(t.jobId, t.id), check('ai_job_events_level_chk', sql`${t.level} in ('info', 'warn', 'error')`)],
);

export type AiJobEventRow = typeof aiJobEvents.$inferSelect;
export type NewAiJobEventRow = typeof aiJobEvents.$inferInsert;

/**
 * A feature's finished output for one subject, stored in the newest format the feature writes. One
 * row per feature and subject: a new build replaces it in one statement, so the previous output is
 * served until the new one is ready.
 */
export const aiArtifacts = pgTable(
  'ai_artifacts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    feature: varchar('feature', { length: 40 }).notNull(),
    subjectKey: varchar('subject_key', { length: 128 }).notNull(),
    format: smallint('format').notNull(),
    pipeline: varchar('pipeline', { length: 40 }).notNull(),
    generation: integer('generation').notNull(),
    /** Gzipped. */
    payload: bytea('payload').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    size: integer('size').notNull(),
    coverage: doublePrecision('coverage').notNull(),
    models: jsonb('models').$type<AiJobModels>(),
    costMicros: bigint('cost_micros', { mode: 'number' }),
    jobId: uuid('job_id').references(() => aiJobs.id, { onDelete: 'set null' }),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_artifacts_subject_uidx').on(t.feature, t.subjectKey),
    index('ai_artifacts_job_idx').on(t.jobId),
    check('ai_artifacts_coverage_chk', sql`${t.coverage} >= 0 and ${t.coverage} <= 1`),
  ],
);

export type AiArtifactRow = typeof aiArtifacts.$inferSelect;
export type NewAiArtifactRow = typeof aiArtifacts.$inferInsert;

/**
 * How long a model step took for the units it ran itself, per connection and model, so build times
 * can be estimated from what the provider actually managed. Written when a job completes, one row
 * per step that ran at least one unit; units reused from the step cache are not counted. Only the
 * newest few rows per step, connection and model are kept.
 */
export const aiStepTimings = pgTable(
  'ai_step_timings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    feature: varchar('feature', { length: 40 }).notNull(),
    step: varchar('step', { length: 40 }).notNull(),
    connectionId: integer('connection_id')
      .notNull()
      .references(() => aiConnections.id, { onDelete: 'cascade' }),
    model: varchar('model', { length: 200 }).notNull(),
    /** The slot's effort level; null for builds that left effort to the feature. */
    effort: varchar('effort', { length: 16 }).$type<AiEffort>(),
    units: integer('units').notNull(),
    /** Units the step ran at once: 1 for a sequential step. */
    lanes: integer('lanes').notNull(),
    durationMs: integer('duration_ms').notNull(),
    jobId: uuid('job_id').references(() => aiJobs.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ai_step_timings_key_idx').on(t.feature, t.connectionId, t.model, t.step, sql`${t.createdAt} desc`),
    check('ai_step_timings_counts_chk', sql`${t.units} > 0 and ${t.lanes} > 0 and ${t.durationMs} >= 0`),
  ],
);

export type AiStepTimingRow = typeof aiStepTimings.$inferSelect;
export type NewAiStepTimingRow = typeof aiStepTimings.$inferInsert;
