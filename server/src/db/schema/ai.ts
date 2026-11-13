import { sql } from 'drizzle-orm';
import { bigint, bigserial, char, check, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import type { AiConnectionTest, AiFailureCode, NetworkProfile } from '@bookorbit/types';

import { users } from './auth';

/** A header's name and the last characters of its value, readable without the encryption key. */
export interface AiStoredHeader {
  name: string;
  hint: string | null;
}

export const aiConnections = pgTable(
  'ai_connections',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    /** No check constraint: a type a newer server wrote must survive a downgrade, unusable but kept. */
    apiType: varchar('api_type', { length: 40 }).notNull(),
    baseUrl: text('base_url').notNull(),
    keyEncrypted: text('key_encrypted'),
    keyHint: varchar('key_hint', { length: 8 }),
    /** Names and hints of the extra headers; their values are in `headers_encrypted`. */
    headers: jsonb('headers').$type<AiStoredHeader[]>().notNull().default([]),
    headersEncrypted: text('headers_encrypted'),
    networkProfile: jsonb('network_profile').$type<NetworkProfile>(),
    timeoutMs: integer('timeout_ms').notNull().default(120_000),
    maxParallel: integer('max_parallel').notNull().default(8),
    requestsPerMinute: integer('requests_per_minute'),
    lastTest: jsonb('last_test').$type<AiConnectionTest>(),
    failingSince: timestamp('failing_since', { withTimezone: true }),
    failingCode: varchar('failing_code', { length: 40 }).$type<AiFailureCode>(),
    failingReason: text('failing_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('ai_connections_name_lower_uidx').on(sql`lower(${t.name})`),
    check('ai_connections_timeout_chk', sql`${t.timeoutMs} between 10000 and 600000`),
    check('ai_connections_parallel_chk', sql`${t.maxParallel} between 1 and 32`),
    check('ai_connections_rpm_chk', sql`${t.requestsPerMinute} is null or ${t.requestsPerMinute} >= 1`),
  ],
);

/** One row per request attempt, success or not. */
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** `YYYY-MM` in the server's time zone, the month budgets count against. */
    month: varchar('month', { length: 7 }).notNull(),
    feature: varchar('feature', { length: 60 }).notNull(),
    slot: varchar('slot', { length: 20 }).notNull(),
    connectionId: integer('connection_id').references(() => aiConnections.id, { onDelete: 'set null' }),
    model: varchar('model', { length: 200 }).notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    cachedTokens: integer('cached_tokens').notNull().default(0),
    /** Estimated cost in millionths of a dollar; null when the slot has no prices. */
    costMicros: bigint('cost_micros', { mode: 'number' }),
    durationMs: integer('duration_ms').notNull(),
    outcome: varchar('outcome', { length: 60 }).notNull(),
    jobId: varchar('job_id', { length: 64 }),
    attempt: integer('attempt').notNull().default(1),
    /** The reader a request was made for; null for builds and the admin's own requests. */
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('ai_usage_month_feature_idx').on(t.month, t.feature),
    index('ai_usage_month_feature_user_idx')
      .on(t.month, t.feature, t.userId)
      .where(sql`${t.userId} is not null`),
    index('ai_usage_at_idx').on(t.at),
    index('ai_usage_job_idx')
      .on(t.jobId)
      .where(sql`${t.jobId} is not null`),
  ],
);

/** `ai_usage` rows older than 90 days, folded into monthly totals. */
export const aiUsageMonthly = pgTable(
  'ai_usage_monthly',
  {
    id: serial('id').primaryKey(),
    month: varchar('month', { length: 7 }).notNull(),
    feature: varchar('feature', { length: 60 }).notNull(),
    slot: varchar('slot', { length: 20 }).notNull(),
    /** No foreign key: deleting a connection must not merge two totals into one key. */
    connectionId: integer('connection_id'),
    model: varchar('model', { length: 200 }).notNull(),
    requests: integer('requests').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    reasoningTokens: bigint('reasoning_tokens', { mode: 'number' }).notNull().default(0),
    cachedTokens: bigint('cached_tokens', { mode: 'number' }).notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull().default(0),
    unknownCostRequests: integer('unknown_cost_requests').notNull().default(0),
  },
  (t) => [uniqueIndex('ai_usage_monthly_key_uidx').on(t.month, t.feature, t.slot, t.model, sql`coalesce(${t.connectionId}, 0)`)],
);

/**
 * What a running job has set aside from the month's budget. Released, not deleted, when the job
 * ends, so the month's row count is also the builds started that month.
 */
export const aiBudgetReservations = pgTable(
  'ai_budget_reservations',
  {
    jobId: varchar('job_id', { length: 64 }).primaryKey(),
    feature: varchar('feature', { length: 60 }).notNull(),
    month: varchar('month', { length: 7 }).notNull(),
    amountMicros: bigint('amount_micros', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [index('ai_budget_reservations_month_idx').on(t.month, t.feature), check('ai_budget_reservations_amount_chk', sql`${t.amountMicros} >= 0`)],
);

export type AiConnectionRow = typeof aiConnections.$inferSelect;
export type NewAiConnectionRow = typeof aiConnections.$inferInsert;
/**
 * Short answers a model wrote from passages of a book, keyed by everything that shaped them: the
 * kind, the prompt's version, the connection and model, the language and the passages. Nothing in a
 * key or an answer says who asked, so one reader's answer serves another who sends the same text.
 */
export const aiAnswerCache = pgTable(
  'ai_answer_cache',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    keyHash: char('key_hash', { length: 64 }).notNull(),
    feature: varchar('feature', { length: 60 }).notNull(),
    kind: varchar('kind', { length: 40 }).notNull(),
    answer: text('answer').notNull(),
    bytes: integer('bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_answer_cache_key_uidx').on(t.keyHash), index('ai_answer_cache_accessed_idx').on(t.lastAccessedAt)],
);

export type AiUsageRow = typeof aiUsage.$inferSelect;
export type NewAiUsageRow = typeof aiUsage.$inferInsert;
export type AiBudgetReservationRow = typeof aiBudgetReservations.$inferSelect;
