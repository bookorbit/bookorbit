import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { BulkRunStatus, JobView } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bulkRuns, users, type BulkRunFailure, type BulkRunRow } from '../../db/schema';
import { afterPosition, keysetOrder, microseconds, type JobKey, type JobPosition, type KeysetColumns } from '../jobs/job-keyset';

/** Failures kept per run; the counters still count every one. */
export const BULK_RUN_FAILURES_KEPT = 50;

const UNFINISHED: BulkRunStatus[] = ['queued', 'running'];

/** Serializes the unfinished-run limit per account, so two requests at once cannot both pass it. */
const UNFINISHED_LOCK = 'bulk_runs.unfinished';

/** Whose runs a Jobs read covers: one account's, plus those of deleted accounts when allowed; null for everyone's. */
export type BulkRunOwner = { id: number; ownerless: boolean } | null;

type Tx = Parameters<Parameters<NodePgDatabase<typeof schema>['transaction']>[0]>[0];

export interface BulkRunItemRecord {
  outcome: 'succeeded' | 'failed' | 'skipped';
  stats?: Record<string, number>;
  failure?: BulkRunFailure;
}

/** What telling a requester how their run ended needs. */
export type EndedBulkRun = Pick<
  BulkRunRow,
  'id' | 'kind' | 'requestedBy' | 'status' | 'errorCode' | 'total' | 'processed' | 'succeeded' | 'failed' | 'skipped'
>;

export type BulkRunPageRow = Omit<BulkRunRow, 'subjectIds'> & { requesterName: string | null; rank: number; key: JobKey };

export interface BulkRunPageQuery {
  view: JobView;
  owner: BulkRunOwner;
  cutoffAt: Date;
  after: JobPosition | null;
  typeIndex: number;
  limit: number;
}

export interface BulkRunCounts {
  running: number;
  queued: number;
  failed: number;
}

/** Every column but the ids, which can run to hundreds of kilobytes and no page needs. */
const PAGE_COLUMNS = {
  id: bulkRuns.id,
  kind: bulkRuns.kind,
  requestedBy: bulkRuns.requestedBy,
  credentialKind: bulkRuns.credentialKind,
  apiKeyId: bulkRuns.apiKeyId,
  status: bulkRuns.status,
  options: bulkRuns.options,
  total: bulkRuns.total,
  processed: bulkRuns.processed,
  succeeded: bulkRuns.succeeded,
  failed: bulkRuns.failed,
  skipped: bulkRuns.skipped,
  stats: bulkRuns.stats,
  failures: bulkRuns.failures,
  errorCode: bulkRuns.errorCode,
  error: bulkRuns.error,
  cancelRequested: bulkRuns.cancelRequested,
  actorUsername: bulkRuns.actorUsername,
  actorIp: bulkRuns.actorIp,
  createdAt: bulkRuns.createdAt,
  startedAt: bulkRuns.startedAt,
  finishedAt: bulkRuns.finishedAt,
  dismissedAt: bulkRuns.dismissedAt,
};

@Injectable()
export class BulkRunsRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async countUnfinished(userId: number, db: NodePgDatabase<typeof schema> | Tx = this.db): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(bulkRuns)
      .where(and(eq(bulkRuns.requestedBy, userId), inArray(bulkRuns.status, UNFINISHED)));
    return row?.count ?? 0;
  }

  /** Inserts a run unless its account already has `max` unfinished; null when it has. */
  async insertWithinLimit(values: typeof bulkRuns.$inferInsert & { requestedBy: number }, max: number): Promise<BulkRunRow | null> {
    return await this.db.transaction(async (tx) => {
      await this.lockUnfinished(tx, values.requestedBy);
      if ((await this.countUnfinished(values.requestedBy, tx)) >= max) return null;
      const [row] = await tx.insert(bulkRuns).values(values).returning();
      return row!;
    });
  }

  async findById(id: string): Promise<BulkRunRow | null> {
    const [row] = await this.db.select().from(bulkRuns).where(eq(bulkRuns.id, id));
    return row ?? null;
  }

  /** The runs behind a page of action ids, without their ids. */
  async findByIds(ids: readonly string[]): Promise<Omit<BulkRunRow, 'subjectIds'>[]> {
    if (ids.length === 0) return [];
    return await this.db
      .select(PAGE_COLUMNS)
      .from(bulkRuns)
      .where(inArray(bulkRuns.id, [...ids]));
  }

  async countRunning(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(bulkRuns)
      .where(eq(bulkRuns.status, 'running'));
    return row?.count ?? 0;
  }

  /**
   * Claims the next run: each account has at most one running, and accounts take turns by their
   * oldest waiting run. The conditional update makes the claim safe against a concurrent one.
   */
  async claimNext(excluded: readonly string[]): Promise<{ run: BulkRunRow; firstStart: boolean } | null> {
    const skip =
      excluded.length > 0
        ? sql`and q.id not in (${sql.join(
            excluded.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql``;
    const candidates = await this.db.execute<{ id: string; fresh: boolean }>(sql`
      select q.id, q.fresh
      from (
        select r.id, r.requested_by, r.created_at, r.started_at is null as fresh, min(r.created_at) over (partition by r.requested_by) as turn
        from bulk_runs r
        where r.status = 'queued'
          and not exists (select 1 from bulk_runs x where x.status = 'running' and x.requested_by is not distinct from r.requested_by)
      ) q
      where true ${skip}
      order by q.turn, q.requested_by nulls last, q.created_at, q.id
      limit 5
    `);
    for (const candidate of candidates.rows) {
      const [claimed] = await this.db
        .update(bulkRuns)
        .set({ status: 'running', startedAt: sql`coalesce(${bulkRuns.startedAt}, now())` })
        .where(and(eq(bulkRuns.id, candidate.id), eq(bulkRuns.status, 'queued')))
        .returning();
      if (claimed) return { run: claimed, firstStart: candidate.fresh };
    }
    return null;
  }

  /**
   * Puts a claimed run back in line, as it was, when it cannot start yet. A cancel asked for while it
   * was claimed is honoured here instead: the run ends cancelled rather than waiting to start.
   */
  async releaseClaim(id: string, firstStart: boolean): Promise<BulkRunRow | null> {
    const cancelled = sql`${bulkRuns.cancelRequested}`;
    const [row] = await this.db
      .update(bulkRuns)
      .set({
        status: sql`case when ${cancelled} then 'cancelled' else 'queued' end`,
        finishedAt: sql`case when ${cancelled} then now() else ${bulkRuns.finishedAt} end`,
        subjectIds: sql`case when ${cancelled} then '{}'::integer[] else ${bulkRuns.subjectIds} end`,
        ...(firstStart ? { startedAt: sql`case when ${cancelled} then ${bulkRuns.startedAt} else null end` } : {}),
      })
      .where(and(eq(bulkRuns.id, id), eq(bulkRuns.status, 'running')))
      .returning();
    return row ?? null;
  }

  /** Whether someone asked the run to stop; read once as a claimed run starts. */
  async cancelRequested(id: string): Promise<boolean> {
    const [row] = await this.db.select({ cancelRequested: bulkRuns.cancelRequested }).from(bulkRuns).where(eq(bulkRuns.id, id));
    return row?.cancelRequested ?? false;
  }

  /** One item done: the counters, its stats and, while there is room, its failure. Answers whether a cancel was asked for. */
  async recordItem(id: string, item: BulkRunItemRecord): Promise<boolean> {
    let stats: SQL = sql`${bulkRuns.stats}`;
    for (const [key, amount] of Object.entries(item.stats ?? {})) {
      if (!Number.isFinite(amount) || amount === 0) continue;
      stats = sql`jsonb_set(${stats}, array[${key}]::text[], to_jsonb(coalesce((${bulkRuns.stats} ->> ${key})::int, 0) + ${Math.trunc(amount)}::int))`;
    }
    const failures = item.failure
      ? sql`case when jsonb_array_length(${bulkRuns.failures}) < ${BULK_RUN_FAILURES_KEPT} then ${bulkRuns.failures} || ${JSON.stringify([item.failure])}::jsonb else ${bulkRuns.failures} end`
      : sql`${bulkRuns.failures}`;
    const [row] = await this.db
      .update(bulkRuns)
      .set({
        processed: sql`${bulkRuns.processed} + 1`,
        succeeded: item.outcome === 'succeeded' ? sql`${bulkRuns.succeeded} + 1` : sql`${bulkRuns.succeeded}`,
        failed: item.outcome === 'failed' ? sql`${bulkRuns.failed} + 1` : sql`${bulkRuns.failed}`,
        skipped: item.outcome === 'skipped' ? sql`${bulkRuns.skipped} + 1` : sql`${bulkRuns.skipped}`,
        stats,
        failures,
      })
      .where(eq(bulkRuns.id, id))
      .returning({ cancelRequested: bulkRuns.cancelRequested });
    return row?.cancelRequested ?? false;
  }

  /** Settles a run and drops its ids; nothing can resume a settled run. */
  async settle(
    id: string,
    status: 'completed' | 'failed' | 'cancelled',
    failure?: { code: string; error: string | null },
  ): Promise<BulkRunRow | null> {
    const [row] = await this.db
      .update(bulkRuns)
      .set({
        status,
        finishedAt: new Date(),
        subjectIds: [],
        errorCode: failure?.code ?? null,
        error: failure?.error ?? null,
      })
      .where(and(eq(bulkRuns.id, id), inArray(bulkRuns.status, ['queued', 'running'])))
      .returning();
    return row ?? null;
  }

  /** Cancels a run still waiting; null when the dispatcher claimed it first. */
  async cancelQueued(id: string): Promise<BulkRunRow | null> {
    const [row] = await this.db
      .update(bulkRuns)
      .set({ status: 'cancelled', cancelRequested: true, finishedAt: new Date(), subjectIds: [] })
      .where(and(eq(bulkRuns.id, id), eq(bulkRuns.status, 'queued')))
      .returning();
    return row ?? null;
  }

  async requestCancel(id: string): Promise<BulkRunRow | null> {
    const [row] = await this.db
      .update(bulkRuns)
      .set({ cancelRequested: true })
      .where(and(eq(bulkRuns.id, id), eq(bulkRuns.status, 'running')))
      .returning();
    return row ?? null;
  }

  /** At boot nothing runs, so every run still marked running was cut short. Its ids and place stay for Continue. */
  async interruptRunning(): Promise<EndedBulkRun[]> {
    return await this.db.update(bulkRuns).set({ status: 'interrupted', finishedAt: new Date() }).where(eq(bulkRuns.status, 'running')).returning({
      id: bulkRuns.id,
      kind: bulkRuns.kind,
      requestedBy: bulkRuns.requestedBy,
      status: bulkRuns.status,
      errorCode: bulkRuns.errorCode,
      total: bulkRuns.total,
      processed: bulkRuns.processed,
      succeeded: bulkRuns.succeeded,
      failed: bulkRuns.failed,
      skipped: bulkRuns.skipped,
    });
  }

  /** Returns an interrupted run to the line unless its account already has `max` unfinished. */
  async continueWithinLimit(id: string, requestedBy: number | null, max: number): Promise<BulkRunRow | 'limit' | null> {
    if (requestedBy === null) return await this.continueRun(id);
    return await this.db.transaction(async (tx) => {
      await this.lockUnfinished(tx, requestedBy);
      if ((await this.countUnfinished(requestedBy, tx)) >= max) return 'limit' as const;
      return await this.continueRun(id, tx);
    });
  }

  async continueRun(id: string, db: NodePgDatabase<typeof schema> | Tx = this.db): Promise<BulkRunRow | null> {
    const [row] = await db
      .update(bulkRuns)
      .set({ status: 'queued', finishedAt: null, cancelRequested: false, errorCode: null, error: null })
      .where(and(eq(bulkRuns.id, id), eq(bulkRuns.status, 'interrupted'), isNull(bulkRuns.dismissedAt)))
      .returning();
    return row ?? null;
  }

  /** Moves a failed or interrupted run to History; an interrupted one can no longer continue. */
  async dismiss(id: string): Promise<BulkRunRow | null> {
    const [row] = await this.db
      .update(bulkRuns)
      .set({ dismissedAt: new Date(), subjectIds: [] })
      .where(and(eq(bulkRuns.id, id), inArray(bulkRuns.status, ['failed', 'interrupted']), isNull(bulkRuns.dismissedAt)))
      .returning();
    return row ?? null;
  }

  async autoDismissInterrupted(before: Date): Promise<number> {
    const rows = await this.db
      .update(bulkRuns)
      .set({ dismissedAt: new Date(), subjectIds: [] })
      .where(and(eq(bulkRuns.status, 'interrupted'), isNull(bulkRuns.dismissedAt), lt(bulkRuns.finishedAt, before)))
      .returning({ id: bulkRuns.id });
    return rows.length;
  }

  async deleteFinished(before: Date): Promise<number> {
    const rows = await this.db
      .delete(bulkRuns)
      .where(
        and(
          lt(bulkRuns.finishedAt, before),
          or(
            inArray(bulkRuns.status, ['completed', 'failed', 'cancelled']),
            and(eq(bulkRuns.status, 'interrupted'), isNotNull(bulkRuns.dismissedAt)),
          ),
        ),
      )
      .returning({ id: bulkRuns.id });
    return rows.length;
  }

  async countForJobs(owner: BulkRunOwner, cutoffAt: Date): Promise<BulkRunCounts> {
    const [row] = await this.db
      .select({
        running: sql<number>`count(*) filter (where ${bulkRuns.status} = 'running')`.mapWith(Number),
        queued: sql<number>`count(*) filter (where ${bulkRuns.status} = 'queued')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${this.failedShown(cutoffAt)})`.mapWith(Number),
      })
      .from(bulkRuns)
      .where(and(inArray(bulkRuns.status, ['queued', 'running', 'failed', 'interrupted']), this.owned(owner)));
    return { running: row?.running ?? 0, queued: row?.queued ?? 0, failed: row?.failed ?? 0 };
  }

  async pageForJobs(query: BulkRunPageQuery): Promise<BulkRunPageRow[]> {
    if (query.view === 'needs-you') return [];
    return query.view === 'queue' ? await this.queuePage(query) : await this.settledPage(query);
  }

  /** Running runs, then each account's waiting runs by their place in that account's own line. */
  private async queuePage(query: BulkRunPageQuery): Promise<BulkRunPageRow[]> {
    // Aliased: drizzle renders column references unqualified, which inside a subquery would bind to the wrong row.
    const lane = this.db
      .$with('bulk_lane')
      .as(
        this.db
          .select({ laneId: sql<string>`lane_order.id`.as('lane_id'), place: sql<number>`lane_order.place`.as('place') })
          .from(
            sql`(select q.id, row_number() over (partition by q.requested_by order by q.created_at, q.id) as place from bulk_runs q where q.status = 'queued') lane_order`,
          ),
      );
    const group = sql<number>`case when ${bulkRuns.status} = 'running' then 0 else 1 end`;
    const rank = sql<number>`case when ${bulkRuns.status} = 'queued' then coalesce(${lane.place}, 2147483647) else 0 end`;
    const at = sql`case when ${bulkRuns.status} = 'running' then coalesce(${bulkRuns.startedAt}, ${bulkRuns.createdAt}) else ${bulkRuns.createdAt} end`;
    const columns: KeysetColumns = {
      prefix: [
        { kind: 'number', expr: group },
        { kind: 'number', expr: rank },
      ],
      suffix: [{ kind: 'time', expr: at }],
      id: { kind: 'uuid', expr: sql`${bulkRuns.id}` },
    };
    const rows = await this.db
      .with(lane)
      .select({
        ...PAGE_COLUMNS,
        group: sql<number>`${group}`.mapWith(Number),
        rank: sql<number>`${rank}`.mapWith(Number),
        at: microseconds(at),
        requesterName: users.name,
      })
      .from(bulkRuns)
      .leftJoin(lane, eq(lane.laneId, bulkRuns.id))
      .leftJoin(users, eq(users.id, bulkRuns.requestedBy))
      .where(
        and(
          inArray(bulkRuns.status, UNFINISHED),
          this.owned(query.owner),
          query.after ? afterPosition(columns, 'queue', query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, 'queue'))
      .limit(query.limit);
    return rows.map(({ group: band, rank: place, at: since, ...row }) => ({
      ...row,
      rank: place,
      key: { prefix: [band, place], suffix: [since], id: row.id },
    }));
  }

  /** Failed and History by when the run ended, newest first. */
  private async settledPage(query: BulkRunPageQuery): Promise<BulkRunPageRow[]> {
    const columns: KeysetColumns = {
      prefix: [{ kind: 'time', expr: sql`${bulkRuns.finishedAt}` }],
      suffix: [],
      id: { kind: 'uuid', expr: sql`${bulkRuns.id}` },
    };
    const shown = query.view === 'failed' ? this.failedShown(query.cutoffAt) : this.historyShown(query.cutoffAt);
    const rows = await this.db
      .select({ ...PAGE_COLUMNS, finish: microseconds(sql`${bulkRuns.finishedAt}`), requesterName: users.name })
      .from(bulkRuns)
      .leftJoin(users, eq(users.id, bulkRuns.requestedBy))
      .where(
        and(
          isNotNull(bulkRuns.finishedAt),
          shown,
          this.owned(query.owner),
          query.after ? afterPosition(columns, query.view, query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, query.view))
      .limit(query.limit);
    return rows.map(({ finish, ...row }) => ({ ...row, rank: 0, key: { prefix: [finish], suffix: [], id: row.id } }));
  }

  /** Failed or interrupted, not dismissed, and ended after the cutoff. */
  private failedShown(cutoffAt: Date): SQL {
    return and(inArray(bulkRuns.status, ['failed', 'interrupted']), isNull(bulkRuns.dismissedAt), sql`${bulkRuns.finishedAt} > ${cutoffAt}`)!;
  }

  private historyShown(cutoffAt: Date): SQL {
    return or(
      inArray(bulkRuns.status, ['completed', 'cancelled']),
      and(inArray(bulkRuns.status, ['failed', 'interrupted']), or(isNotNull(bulkRuns.dismissedAt), lte(bulkRuns.finishedAt, cutoffAt))),
    )!;
  }

  private owned(owner: BulkRunOwner): SQL | undefined {
    if (owner === null) return undefined;
    return owner.ownerless ? or(eq(bulkRuns.requestedBy, owner.id), isNull(bulkRuns.requestedBy)) : eq(bulkRuns.requestedBy, owner.id);
  }

  private async lockUnfinished(tx: Tx, userId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${UNFINISHED_LOCK}), ${userId})`);
  }
}
