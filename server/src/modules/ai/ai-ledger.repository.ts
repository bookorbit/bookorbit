import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiUsage, type NewAiUsageRow } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

export interface AiConnectionMonthTotals {
  requests: number;
  costMicros: number;
}

/** Totals for one month, feature, slot, connection and model: the grain the usage page adds up. */
export interface AiUsageGroup {
  month: string;
  feature: string;
  slot: string;
  connectionId: number | null;
  model: string;
  requests: number;
  errors: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  costMicros: number;
  unknownCostRequests: number;
}

export interface AiReaderSpend {
  requests: number;
  costMicros: number;
}

export interface AiUsageJobTotal {
  jobId: string;
  feature: string;
  requests: number;
  costMicros: number;
}

export interface AiUsageErrorRow {
  at: Date;
  feature: string;
  slot: string;
  model: string;
  outcome: string;
  connectionId: number | null;
}

/** Outcomes that count as errors on the usage page. */
const ERROR_SQL = sql`(${aiUsage.outcome} like 'error:%' or ${aiUsage.outcome} in ('timeout', 'rate-limited', 'invalid-json'))`;
/** A reply that used tokens but has no cost, because its slot had no prices. */
const UNKNOWN_COST_SQL = sql`(${aiUsage.costMicros} is null and (${aiUsage.inputTokens} > 0 or ${aiUsage.outputTokens} > 0))`;

@Injectable()
export class AiLedgerRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async insert(row: NewAiUsageRow): Promise<void> {
    await this.db.insert(aiUsage).values(row);
  }

  /**
   * What one reader spent through one feature this month: requests (first attempts only, so a
   * retry is not a second request) and estimated cost. Folded months carry no reader, and the
   * current month is never folded.
   */
  async readerSpend(month: string, feature: string, userId: number): Promise<AiReaderSpend> {
    const [row] = await this.db
      .select({
        requests: sql<number>`count(*) filter (where ${aiUsage.attempt} = 1)::int`,
        costMicros: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint`,
      })
      .from(aiUsage)
      .where(and(eq(aiUsage.month, month), eq(aiUsage.feature, feature), eq(aiUsage.userId, userId)));
    return { requests: Number(row?.requests ?? 0), costMicros: Number(row?.costMicros ?? 0) };
  }

  async connectionMonthTotals(month: string): Promise<Map<number, AiConnectionMonthTotals>> {
    const groups = await this.groups(month, month);
    const totals = new Map<number, AiConnectionMonthTotals>();
    for (const group of groups) {
      if (group.connectionId === null) continue;
      const entry = totals.get(group.connectionId) ?? { requests: 0, costMicros: 0 };
      entry.requests += group.requests;
      entry.costMicros += group.costMicros;
      totals.set(group.connectionId, entry);
    }
    return totals;
  }

  /** Every group from `from` to `to` (months, inclusive): recent rows and folded totals together. */
  async groups(from: string, to: string): Promise<AiUsageGroup[]> {
    const result = await this.db.execute<Record<string, string | number | null>>(sql`
      select month, feature, slot, connection_id, model,
        sum(requests)::bigint as requests, sum(errors)::bigint as errors,
        sum(input_tokens)::bigint as input_tokens, sum(output_tokens)::bigint as output_tokens,
        sum(reasoning_tokens)::bigint as reasoning_tokens, sum(cached_tokens)::bigint as cached_tokens,
        sum(cost_micros)::bigint as cost_micros, sum(unknown_cost_requests)::bigint as unknown_cost_requests
      from (
        select month, feature, slot, connection_id, model,
          count(*) as requests,
          count(*) filter (where ${ERROR_SQL}) as errors,
          sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
          sum(reasoning_tokens) as reasoning_tokens, sum(cached_tokens) as cached_tokens,
          coalesce(sum(cost_micros), 0) as cost_micros,
          count(*) filter (where ${UNKNOWN_COST_SQL}) as unknown_cost_requests
        from ai_usage
        where month between ${from} and ${to}
        group by month, feature, slot, connection_id, model
        union all
        select month, feature, slot, connection_id, model, requests, errors, input_tokens, output_tokens,
          reasoning_tokens, cached_tokens, cost_micros, unknown_cost_requests
        from ai_usage_monthly
        where month between ${from} and ${to}
      ) as combined
      group by month, feature, slot, connection_id, model
      order by month, feature, slot, model
    `);
    return result.rows.map((row) => ({
      month: String(row.month),
      feature: String(row.feature),
      slot: String(row.slot),
      connectionId: row.connection_id === null ? null : Number(row.connection_id),
      model: String(row.model),
      requests: Number(row.requests),
      errors: Number(row.errors),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      reasoningTokens: Number(row.reasoning_tokens),
      cachedTokens: Number(row.cached_tokens),
      costMicros: Number(row.cost_micros),
      unknownCostRequests: Number(row.unknown_cost_requests),
    }));
  }

  /** The costliest jobs in the range. Jobs older than 90 days are folded and no longer named. */
  async costliestJobs(from: string, to: string, limit: number): Promise<AiUsageJobTotal[]> {
    const total = sql<string>`coalesce(sum(${aiUsage.costMicros}), 0)`;
    const rows = await this.db
      .select({ jobId: aiUsage.jobId, feature: aiUsage.feature, requests: sql<string>`count(*)`, costMicros: total })
      .from(aiUsage)
      .where(and(isNotNull(aiUsage.jobId), gte(aiUsage.month, from), lte(aiUsage.month, to)))
      .groupBy(aiUsage.jobId, aiUsage.feature)
      .orderBy(desc(total))
      .limit(limit);
    return rows.map((row) => ({
      jobId: row.jobId as string,
      feature: row.feature,
      requests: Number(row.requests),
      costMicros: Number(row.costMicros),
    }));
  }

  async recentErrors(from: string, to: string, limit: number): Promise<AiUsageErrorRow[]> {
    return this.db
      .select({
        at: aiUsage.at,
        feature: aiUsage.feature,
        slot: aiUsage.slot,
        model: aiUsage.model,
        outcome: aiUsage.outcome,
        connectionId: aiUsage.connectionId,
      })
      .from(aiUsage)
      .where(and(ERROR_SQL, gte(aiUsage.month, from), lte(aiUsage.month, to)))
      .orderBy(desc(aiUsage.at))
      .limit(limit);
  }

  /**
   * Folds rows from before `cutoff` into monthly totals and deletes them, in one transaction, so a
   * row is counted exactly once. Returns how many rows were folded.
   */
  async foldBefore(cutoff: Date): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into ai_usage_monthly (month, feature, slot, connection_id, model, requests, errors, input_tokens,
          output_tokens, reasoning_tokens, cached_tokens, cost_micros, unknown_cost_requests)
        select month, feature, slot, connection_id, model, count(*), count(*) filter (where ${ERROR_SQL}),
          sum(input_tokens), sum(output_tokens), sum(reasoning_tokens), sum(cached_tokens),
          coalesce(sum(cost_micros), 0), count(*) filter (where ${UNKNOWN_COST_SQL})
        from ai_usage
        where at < ${cutoff.toISOString()}::timestamptz
        group by month, feature, slot, connection_id, model
        on conflict (month, feature, slot, model, (coalesce(connection_id, 0))) do update set
          requests = ai_usage_monthly.requests + excluded.requests,
          errors = ai_usage_monthly.errors + excluded.errors,
          input_tokens = ai_usage_monthly.input_tokens + excluded.input_tokens,
          output_tokens = ai_usage_monthly.output_tokens + excluded.output_tokens,
          reasoning_tokens = ai_usage_monthly.reasoning_tokens + excluded.reasoning_tokens,
          cached_tokens = ai_usage_monthly.cached_tokens + excluded.cached_tokens,
          cost_micros = ai_usage_monthly.cost_micros + excluded.cost_micros,
          unknown_cost_requests = ai_usage_monthly.unknown_cost_requests + excluded.unknown_cost_requests
      `);
      const deleted = await tx.execute(sql`delete from ai_usage where at < ${cutoff.toISOString()}::timestamptz`);
      return deleted.rowCount ?? 0;
    });
  }
}
