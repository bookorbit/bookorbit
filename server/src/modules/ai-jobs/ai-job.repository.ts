import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  AI_JOB_UNFINISHED_STATUSES,
  type AiJobFailureReason,
  type AiJobListCounts,
  type AiJobListView,
  type AiJobModels,
  type AiJobPauseReason,
} from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { aiArtifacts, aiJobs, users, type AiJobRow, type NewAiArtifactRow, type NewAiJobRow } from '../../db/schema';
import { AiJobChanges, type AiJobChangeKind } from './ai-job-changes.service';
import { afterPosition, keysetOrder, microseconds, type JobKey, type JobPosition, type KeysetColumns } from '../jobs/job-keyset';

type Db = NodePgDatabase<typeof schema>;

const UNFINISHED = [...AI_JOB_UNFINISHED_STATUSES];

/**
 * The database's clock. A job is created due at the database's `now()`, in microseconds, so a due
 * check against the server's clock, in milliseconds, can find a job queued a moment ago not yet
 * due. Every next-attempt time is written and compared with this one clock.
 */
const DB_NOW = sql`now()`;

function dueForFeature(feature: string) {
  return and(eq(aiJobs.feature, feature), eq(aiJobs.status, 'queued'), lte(aiJobs.nextAttemptAt, DB_NOW));
}

/** Clears what only a running job carries. */
const LEASE_CLEARED = { leaseOwner: null, leaseUntil: null } as const;

/** What a change announcement names. */
const CHANGED = { id: aiJobs.id, feature: aiJobs.feature, subjectRef: aiJobs.subjectRef, requestedBy: aiJobs.requestedBy } as const;

/** Pauses that only a person ends: Continue past an over-estimate, and Resume after a person's pause. */
const HELD_REASONS = ['over-estimate', 'user'];

/** The order queued jobs of a feature start in. */
const QUEUE_ORDER = [desc(aiJobs.priority), asc(aiJobs.nextAttemptAt), asc(aiJobs.createdAt)] as const;

/** Which jobs the AI area lists: a view of the registered features, everyone's or one person's. */
export interface AiJobListFilter {
  features: readonly string[];
  /** Null lists every account's jobs. */
  requestedBy: number | null;
  /** Failed jobs that finished after this are still shown on the book page and in the failed view. */
  shownAfter: Date;
}

export type AiJobListRow = AiJobRow & { requesterName: string | null };

/** Whose jobs a Jobs-area read covers: one account's, plus ownerless ones when the viewer may see them. Null covers every account. */
export type AiJobOwnerFilter = { id: number; ownerless: boolean } | null;

export interface AiJobPageQuery {
  feature: string;
  view: 'queue' | 'failed' | 'history';
  owner: AiJobOwnerFilter;
  /** Failed jobs that finished at or before this have aged into History. */
  cutoffAt: Date;
  after: JobPosition | null;
  typeIndex: number;
  limit: number;
}

/** What a Jobs-area row reads, with its place in the view's order. `rank` is a queued job's place in its feature's queue, else 0. */
export type AiJobPageRow = Pick<AiJobRow, keyof typeof PAGE_COLUMNS> & { requesterName: string | null; rank: number; key: JobKey };

/** The columns a Jobs-area row needs. */
const PAGE_COLUMNS = {
  id: aiJobs.id,
  feature: aiJobs.feature,
  kind: aiJobs.kind,
  subjectRef: aiJobs.subjectRef,
  status: aiJobs.status,
  phase: aiJobs.phase,
  done: aiJobs.done,
  total: aiJobs.total,
  reason: aiJobs.reason,
  requestedBy: aiJobs.requestedBy,
  costMicros: aiJobs.costMicros,
  createdAt: aiJobs.createdAt,
  startedAt: aiJobs.startedAt,
  pausedAt: aiJobs.pausedAt,
  finishedAt: aiJobs.finishedAt,
  dismissedAt: aiJobs.dismissedAt,
} as const;

/** The same columns read back from a subquery that selected them. */
function pick<T extends Record<keyof typeof PAGE_COLUMNS, unknown>>(source: T): Pick<T, keyof typeof PAGE_COLUMNS> {
  return Object.fromEntries(Object.keys(PAGE_COLUMNS).map((key) => [key, source[key as keyof typeof PAGE_COLUMNS]])) as Pick<
    T,
    keyof typeof PAGE_COLUMNS
  >;
}

const ENDED = ['completed', 'failed', 'cancelled'];

/** When a job ended. Every terminal write sets `finished_at`; the fallback keeps a row from dropping out of a comparison on a null. */
const FINISH = sql`coalesce(${aiJobs.finishedAt}, ${aiJobs.updatedAt})`;

/**
 * Every status change is a conditional update, so the worker loop, a person's request and
 * housekeeping can only move a job along an edge that is still valid. Changes a running job makes
 * also require its lease owner: a worker that lost its lease can no longer write.
 *
 * Every write that lands is announced on `AiJobChanges`. Announcing here, where every write to a
 * job's row passes, means no new path can change a job without the pages showing it hearing.
 */
@Injectable()
export class AiJobRepository {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() private readonly changes?: AiJobChanges,
  ) {}

  /** Null when the subject already has an unfinished job. */
  async create(values: Omit<NewAiJobRow, 'status'>): Promise<AiJobRow | null> {
    const [row] = await this.db
      .insert(aiJobs)
      .values({ ...values, status: 'queued' })
      .onConflictDoNothing()
      .returning();
    return this.announce(row ?? null, 'state');
  }

  async findByIds(ids: readonly string[]): Promise<AiJobRow[]> {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(aiJobs)
      .where(inArray(aiJobs.id, [...ids]));
  }

  async findById(id: string): Promise<AiJobRow | null> {
    const [row] = await this.db.select().from(aiJobs).where(eq(aiJobs.id, id)).limit(1);
    return row ?? null;
  }

  async findUnfinished(feature: string, subjectKey: string): Promise<AiJobRow | null> {
    const [row] = await this.db
      .select()
      .from(aiJobs)
      .where(and(eq(aiJobs.feature, feature), eq(aiJobs.subjectKey, subjectKey), inArray(aiJobs.status, UNFINISHED)))
      .limit(1);
    return row ?? null;
  }

  async findLatest(feature: string, subjectKey: string): Promise<AiJobRow | null> {
    const [row] = await this.db
      .select()
      .from(aiJobs)
      .where(and(eq(aiJobs.feature, feature), eq(aiJobs.subjectKey, subjectKey)))
      .orderBy(desc(aiJobs.createdAt), desc(aiJobs.id))
      .limit(1);
    return row ?? null;
  }

  async maxGeneration(feature: string, subjectKey: string): Promise<number | null> {
    const [row] = await this.db
      .select({ value: max(aiJobs.generation) })
      .from(aiJobs)
      .where(and(eq(aiJobs.feature, feature), eq(aiJobs.subjectKey, subjectKey)));
    return row?.value ?? null;
  }

  /** Jobs of the same feature that run before this one: those running, and those queued ahead of it. */
  async countAhead(job: AiJobRow): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.feature, job.feature),
          ne(aiJobs.id, job.id),
          or(
            eq(aiJobs.status, 'running'),
            and(
              eq(aiJobs.status, 'queued'),
              or(
                gt(aiJobs.priority, job.priority),
                and(
                  eq(aiJobs.priority, job.priority),
                  or(
                    lt(aiJobs.nextAttemptAt, job.nextAttemptAt),
                    and(eq(aiJobs.nextAttemptAt, job.nextAttemptAt), lt(aiJobs.createdAt, job.createdAt)),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    return row?.value ?? 0;
  }

  async hasDueJob(feature: string): Promise<boolean> {
    const [candidate] = await this.db
      .select({ due: sql<number>`1` })
      .from(aiJobs)
      .where(dueForFeature(feature))
      .limit(1);
    return candidate !== undefined;
  }

  /**
   * Claims the first due job of a feature (highest priority, then oldest), unless that feature already runs as many jobs as it may.
   * The count and the claim happen under one lock per feature, so two servers cannot both pass it.
   */
  async claimNext(feature: string, owner: string, leaseMs: number, limit: number): Promise<AiJobRow | null> {
    const claimed = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai_jobs:${feature}`}))`);
      const [running] = await tx
        .select({ value: count() })
        .from(aiJobs)
        .where(and(eq(aiJobs.feature, feature), eq(aiJobs.status, 'running')));
      if ((running?.value ?? 0) >= limit) return null;
      const now = new Date();
      const [candidate] = await tx
        .select({ id: aiJobs.id })
        .from(aiJobs)
        .where(dueForFeature(feature))
        .orderBy(...QUEUE_ORDER)
        .limit(1)
        .for('update', { skipLocked: true });
      if (!candidate) return null;
      const [claimed] = await tx
        .update(aiJobs)
        .set({
          status: 'running',
          reason: null,
          leaseOwner: owner,
          leaseUntil: new Date(now.getTime() + leaseMs),
          attempts: sql`${aiJobs.attempts} + 1`,
          startedAt: sql`coalesce(${aiJobs.startedAt}, now())`,
          pausedAt: null,
        })
        .where(and(eq(aiJobs.id, candidate.id), eq(aiJobs.status, 'queued')))
        .returning();
      return claimed ?? null;
    });
    return this.announce(claimed, 'state');
  }

  /** False once the job is no longer this owner's to run: cancelled, or its lease lapsed and it was requeued. */
  async renewLease(id: string, owner: string, leaseMs: number): Promise<boolean> {
    const rows = await this.db
      .update(aiJobs)
      .set({ leaseUntil: new Date(Date.now() + leaseMs) })
      .where(this.runningFor(id, owner))
      .returning({ id: aiJobs.id });
    return rows.length > 0;
  }

  async isRunningFor(id: string, owner: string): Promise<boolean> {
    const rows = await this.db.select({ id: aiJobs.id }).from(aiJobs).where(this.runningFor(id, owner)).limit(1);
    return rows.length > 0;
  }

  async setModels(id: string, owner: string, models: AiJobModels): Promise<boolean> {
    const rows = await this.db.update(aiJobs).set({ models }).where(this.runningFor(id, owner)).returning({ id: aiJobs.id });
    return rows.length > 0;
  }

  async setProgress(id: string, owner: string, progress: { phase: string; done: number; total: number }): Promise<void> {
    const [row] = await this.db.update(aiJobs).set(progress).where(this.runningFor(id, owner)).returning(CHANGED);
    this.announce(row ?? null, 'progress');
  }

  /** Adds a request's usage to the job, whatever its state: the money was spent either way. */
  async addUsage(id: string, tokens: number, costMicros: number | null): Promise<void> {
    const [row] = await this.db
      .update(aiJobs)
      .set({
        tokens: sql`${aiJobs.tokens} + ${tokens}`,
        ...(costMicros == null ? {} : { costMicros: sql`coalesce(${aiJobs.costMicros}, 0) + ${costMicros}` }),
      })
      .where(eq(aiJobs.id, id))
      .returning(CHANGED);
    this.announce(row ?? null, 'progress');
  }

  async pause(id: string, owner: string, reason: AiJobPauseReason): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({ status: 'paused', reason, pausedAt: new Date(), ...LEASE_CLEARED })
      .where(this.runningFor(id, owner))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  async fail(id: string, owner: string, reason: AiJobFailureReason): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({ status: 'failed', reason, finishedAt: new Date(), ...LEASE_CLEARED })
      .where(this.runningFor(id, owner))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /** Marks the job completed and replaces the subject's artifact in one transaction, or does neither. */
  async complete(id: string, owner: string, artifact: Omit<NewAiArtifactRow, 'jobId' | 'builtAt'>): Promise<AiJobRow | null> {
    const completed = await this.db.transaction(async (tx) => {
      const now = new Date();
      const [row] = await tx
        .update(aiJobs)
        .set({ status: 'completed', reason: null, finishedAt: now, ...LEASE_CLEARED })
        .where(this.runningFor(id, owner))
        .returning();
      if (!row) return null;
      const values = { ...artifact, jobId: id, builtAt: now };
      await tx
        .insert(aiArtifacts)
        .values(values)
        .onConflictDoUpdate({ target: [aiArtifacts.feature, aiArtifacts.subjectKey], set: values });
      return row;
    });
    // After the commit, so a page that asks on hearing it finds the guide.
    return this.announce(completed, 'state');
  }

  /**
   * Back to the queue from a pause, under a fresh attempt count. `requestedBy` hands the job to the
   * person who resumed it; `raiseCap` is Continue on an over-estimate pause.
   */
  async resumePaused(id: string, change: { requestedBy?: number; raiseCap?: boolean } = {}): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({
        status: 'queued',
        reason: null,
        pausedAt: null,
        nextAttemptAt: DB_NOW,
        attempts: 0,
        ...LEASE_CLEARED,
        ...(change.requestedBy == null ? {} : { requestedBy: change.requestedBy }),
        ...(change.raiseCap ? { capRaises: sql`${aiJobs.capRaises} + 1` } : {}),
      })
      .where(and(eq(aiJobs.id, id), eq(aiJobs.status, 'paused')))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /** The cause that still holds a paused job, when it differs from the one it paused for. */
  async setPauseReason(id: string, reason: AiJobPauseReason): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({ reason })
      .where(and(eq(aiJobs.id, id), eq(aiJobs.status, 'paused')))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  async failPaused(id: string, reason: AiJobFailureReason): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({ status: 'failed', reason, finishedAt: new Date(), ...LEASE_CLEARED })
      .where(and(eq(aiJobs.id, id), eq(aiJobs.status, 'paused')))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /**
   * Try again on a failed job: back to the queue in the same generation, so it reuses every saved
   * unit, as the person who asked. Throws a unique violation when the subject has another
   * unfinished job by now.
   */
  async retryFailed(id: string, requestedBy: number): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({
        status: 'queued',
        reason: null,
        phase: null,
        done: 0,
        total: 0,
        requestedBy,
        attempts: 0,
        nextAttemptAt: DB_NOW,
        finishedAt: null,
        dismissedAt: null,
        ...LEASE_CLEARED,
      })
      .where(and(eq(aiJobs.id, id), eq(aiJobs.status, 'failed')))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /** A person's pause on a queued or running job. A run that still holds the lease finds it gone at its next check. */
  async pauseByUser(id: string): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({ status: 'paused', reason: 'user', pausedAt: new Date(), ...LEASE_CLEARED })
      .where(and(eq(aiJobs.id, id), inArray(aiJobs.status, ['queued', 'running'])))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /** Puts a queued job ahead of every other queued job of its feature. */
  async prioritize(id: string): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({
        priority: sql`(select coalesce(max(queued.priority), 0) + 1 from ai_jobs queued where queued.feature = ai_jobs.feature and queued.status = 'queued')`,
      })
      .where(and(eq(aiJobs.id, id), eq(aiJobs.status, 'queued')))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /** A page of one view, with the requester's name. */
  async list(filter: AiJobListFilter, view: AiJobListView, offset: number, limit: number): Promise<{ rows: AiJobListRow[]; total: number }> {
    if (filter.features.length === 0) return { rows: [], total: 0 };
    const where = and(this.scope(filter), this.view(view, filter.shownAfter));
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ ...getTableColumns(aiJobs), requesterName: users.name })
        .from(aiJobs)
        .leftJoin(users, eq(users.id, aiJobs.requestedBy))
        .where(where)
        .orderBy(...this.order(view))
        .offset(offset)
        .limit(limit),
      this.db.select({ value: count() }).from(aiJobs).where(where),
    ]);
    return { rows, total: totalRow?.value ?? 0 };
  }

  /** How many jobs each view holds. */
  async countViews(filter: AiJobListFilter): Promise<AiJobListCounts> {
    if (filter.features.length === 0) return { queue: 0, failed: 0, history: 0, running: 0, queued: 0, paused: 0 };
    const [row] = await this.db
      .select({
        queue: sql<number>`count(*) filter (where ${this.view('queue', filter.shownAfter)})`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${this.view('failed', filter.shownAfter)})`.mapWith(Number),
        history: sql<number>`count(*) filter (where ${this.view('history', filter.shownAfter)})`.mapWith(Number),
        running: sql<number>`count(*) filter (where ${aiJobs.status} = 'running')`.mapWith(Number),
        queued: sql<number>`count(*) filter (where ${aiJobs.status} = 'queued')`.mapWith(Number),
        paused: sql<number>`count(*) filter (where ${aiJobs.status} = 'paused')`.mapWith(Number),
      })
      .from(aiJobs)
      .where(this.scope(filter));
    return {
      queue: row?.queue ?? 0,
      failed: row?.failed ?? 0,
      history: row?.history ?? 0,
      running: row?.running ?? 0,
      queued: row?.queued ?? 0,
      paused: row?.paused ?? 0,
    };
  }

  /** Each of these queued jobs' place in its feature's queue, 1 being next. */
  async queuePositions(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const ranked = this.db
      .select({
        id: aiJobs.id,
        position:
          sql<number>`row_number() over (partition by ${aiJobs.feature} order by ${aiJobs.priority} desc, ${aiJobs.nextAttemptAt}, ${aiJobs.createdAt})`
            .mapWith(Number)
            .as('position'),
      })
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.status, 'queued'),
          inArray(
            aiJobs.feature,
            this.db
              .selectDistinct({ feature: aiJobs.feature })
              .from(aiJobs)
              .where(inArray(aiJobs.id, [...ids])),
          ),
        ),
      )
      .as('ranked');
    const rows = await this.db
      .select({ id: ranked.id, position: ranked.position })
      .from(ranked)
      .where(inArray(ranked.id, [...ids]));
    return new Map(rows.map((row) => [row.id, row.position]));
  }

  /**
   * One Jobs-area page of a feature's jobs, after a cursor position. The Queue ranks every queued
   * job of the feature before the owner filter, so a person's rows carry their place among
   * everyone's; ended views read straight off the finish-time index.
   */
  async pageForJobs(query: AiJobPageQuery): Promise<AiJobPageRow[]> {
    return query.view === 'queue' ? await this.queuePage(query) : await this.endedPage(query);
  }

  /** How many of a feature's jobs each Jobs-area view holds, failed ones measured from `cutoffAt`. */
  async countForJobs(feature: string, owner: AiJobOwnerFilter, cutoffAt: Date): Promise<AiJobListCounts> {
    const [row] = await this.db
      .select({
        queue: sql<number>`count(*) filter (where ${inArray(aiJobs.status, UNFINISHED)})`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${this.failedShown(cutoffAt)})`.mapWith(Number),
        running: sql<number>`count(*) filter (where ${aiJobs.status} = 'running')`.mapWith(Number),
        queued: sql<number>`count(*) filter (where ${aiJobs.status} = 'queued')`.mapWith(Number),
        paused: sql<number>`count(*) filter (where ${aiJobs.status} = 'paused')`.mapWith(Number),
      })
      .from(aiJobs)
      .where(and(eq(aiJobs.feature, feature), inArray(aiJobs.status, [...UNFINISHED, 'failed']), this.owned(owner)));
    return {
      queue: row?.queue ?? 0,
      failed: row?.failed ?? 0,
      history: 0,
      running: row?.running ?? 0,
      queued: row?.queued ?? 0,
      paused: row?.paused ?? 0,
    };
  }

  private async queuePage(query: AiJobPageQuery): Promise<AiJobPageRow[]> {
    const ranked = this.db
      .select({
        ...PAGE_COLUMNS,
        group: sql<number>`case ${aiJobs.status} when 'running' then 0 when 'queued' then 1 else 2 end`.as('job_group'),
        rank: sql<number>`case when ${aiJobs.status} = 'queued' then row_number() over (partition by ${aiJobs.status} order by ${aiJobs.priority} desc, ${aiJobs.nextAttemptAt}, ${aiJobs.createdAt}) else 0 end`.as(
          'job_rank',
        ),
        at: sql<number>`(extract(epoch from case ${aiJobs.status} when 'running' then coalesce(${aiJobs.startedAt}, timestamptz 'epoch') when 'queued' then ${aiJobs.createdAt} else coalesce(${aiJobs.pausedAt}, timestamptz 'epoch') end) * 1000000)::bigint`.as(
          'job_at',
        ),
      })
      .from(aiJobs)
      .where(and(eq(aiJobs.feature, query.feature), inArray(aiJobs.status, UNFINISHED)))
      .as('ranked');
    const columns: KeysetColumns = {
      prefix: [
        { kind: 'number', expr: sql`${ranked.group}` },
        { kind: 'number', expr: sql`${ranked.rank}` },
      ],
      suffix: [{ kind: 'number', expr: sql`${ranked.at}` }],
      id: { kind: 'uuid', expr: sql`${ranked.id}` },
    };
    const owner =
      query.owner === null ? undefined : or(eq(ranked.requestedBy, query.owner.id), query.owner.ownerless ? isNull(ranked.requestedBy) : undefined);
    const rows = await this.db
      .select({
        ...pick(ranked),
        group: sql<number>`${ranked.group}`.mapWith(Number),
        rank: sql<number>`${ranked.rank}`.mapWith(Number),
        at: sql<number>`${ranked.at}`.mapWith(Number),
        requesterName: users.name,
      })
      .from(ranked)
      .leftJoin(users, eq(users.id, ranked.requestedBy))
      .where(and(owner, query.after ? afterPosition(columns, 'queue', query.after, query.typeIndex) : undefined))
      .orderBy(...keysetOrder(columns, 'queue'))
      .limit(query.limit);
    return rows.map(({ group, rank, at, ...row }) => ({ ...row, rank, key: { prefix: [group, rank], suffix: [at], id: row.id } }));
  }

  private async endedPage(query: AiJobPageQuery): Promise<AiJobPageRow[]> {
    const columns: KeysetColumns = { prefix: [{ kind: 'time', expr: FINISH }], suffix: [], id: { kind: 'uuid', expr: sql`${aiJobs.id}` } };
    const view =
      query.view === 'failed'
        ? this.failedShown(query.cutoffAt)
        : and(inArray(aiJobs.status, ENDED), or(ne(aiJobs.status, 'failed'), isNotNull(aiJobs.dismissedAt), sql`${FINISH} <= ${query.cutoffAt}`));
    const rows = await this.db
      .select({ ...PAGE_COLUMNS, finish: microseconds(FINISH), requesterName: users.name })
      .from(aiJobs)
      .leftJoin(users, eq(users.id, aiJobs.requestedBy))
      .where(
        and(
          eq(aiJobs.feature, query.feature),
          view,
          this.owned(query.owner),
          query.after ? afterPosition(columns, query.view, query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, query.view))
      .limit(query.limit);
    return rows.map(({ finish, ...row }) => ({ ...row, rank: 0, key: { prefix: [finish], suffix: [], id: row.id } }));
  }

  /** Failed, not dismissed, and finished after the cutoff: what the Failed view still shows. */
  private failedShown(cutoffAt: Date): SQL {
    return and(eq(aiJobs.status, 'failed'), isNull(aiJobs.dismissedAt), sql`${FINISH} > ${cutoffAt}`)!;
  }

  private owned(owner: AiJobOwnerFilter): SQL | undefined {
    if (owner === null) return undefined;
    return or(eq(aiJobs.requestedBy, owner.id), owner.ownerless ? isNull(aiJobs.requestedBy) : undefined);
  }

  private scope(filter: AiJobListFilter): SQL | undefined {
    return and(inArray(aiJobs.feature, [...filter.features]), filter.requestedBy === null ? undefined : eq(aiJobs.requestedBy, filter.requestedBy));
  }

  private view(view: AiJobListView, shownAfter: Date): SQL {
    const shown = and(isNull(aiJobs.dismissedAt), or(isNull(aiJobs.finishedAt), gt(aiJobs.finishedAt, shownAfter)));
    switch (view) {
      case 'queue':
        return inArray(aiJobs.status, UNFINISHED);
      case 'failed':
        return and(eq(aiJobs.status, 'failed'), shown)!;
      case 'history':
        return or(
          inArray(aiJobs.status, ['completed', 'cancelled']),
          and(eq(aiJobs.status, 'failed'), or(isNotNull(aiJobs.dismissedAt), lte(aiJobs.finishedAt, shownAfter))),
        )!;
    }
  }

  /** Running first, then the queue in the order it starts, then paused; ended jobs newest first. */
  private order(view: AiJobListView): SQL[] {
    if (view !== 'queue') return [sql`${aiJobs.finishedAt} desc nulls first`, desc(aiJobs.id)];
    return [sql`case ${aiJobs.status} when 'running' then 0 when 'queued' then 1 else 2 end`, ...QUEUE_ORDER, asc(aiJobs.id)];
  }

  /** Ends a queued, running or paused job. A run that still holds the lease finds it gone at its next check. */
  async cancel(id: string): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({ status: 'cancelled', finishedAt: new Date(), ...LEASE_CLEARED })
      .where(and(eq(aiJobs.id, id), inArray(aiJobs.status, UNFINISHED)))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /** Takes a failed job out of status; it stays failed, with its event log. */
  async dismiss(id: string): Promise<AiJobRow | null> {
    const [row] = await this.db
      .update(aiJobs)
      .set({ dismissedAt: new Date() })
      .where(and(eq(aiJobs.id, id), eq(aiJobs.status, 'failed'), isNull(aiJobs.dismissedAt)))
      .returning();
    return this.announce(row ?? null, 'state');
  }

  /**
   * Paused jobs of these features that may resume on their own, longest paused first. Over-estimate
   * waits for Continue, and a person's pause for Resume.
   */
  async listResumable(features: readonly string[], limit: number): Promise<AiJobRow[]> {
    if (features.length === 0) return [];
    return await this.db
      .select()
      .from(aiJobs)
      .where(
        and(inArray(aiJobs.feature, [...features]), eq(aiJobs.status, 'paused'), or(isNull(aiJobs.reason), notInArray(aiJobs.reason, HELD_REASONS))),
      )
      .orderBy(asc(aiJobs.pausedAt), asc(aiJobs.createdAt))
      .limit(limit);
  }

  /** Unfinished jobs that recorded this connection for a slot, so the connection is not deleted under them. */
  async countUnfinishedUsing(connectionId: number): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(aiJobs)
      .where(
        and(
          inArray(aiJobs.status, UNFINISHED),
          sql`exists (select 1 from jsonb_each(coalesce(${aiJobs.models}, '{}'::jsonb)) slot where slot.value ->> 'connectionId' = ${String(connectionId)})`,
        ),
      );
    return row?.value ?? 0;
  }

  /** Which of these jobs are still unfinished. */
  async unfinishedIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: aiJobs.id })
      .from(aiJobs)
      .where(and(inArray(aiJobs.id, [...ids]), inArray(aiJobs.status, UNFINISHED)));
    return rows.map((row) => row.id);
  }

  /**
   * Running jobs whose lease lapsed lost their server. Each goes back to the queue and resumes from
   * the step cache, unless it has lost its lease too many times.
   */
  /** A feature's unfinished job ids, for removing all of its output. */
  async unfinishedIdsForFeature(feature: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: aiJobs.id })
      .from(aiJobs)
      .where(and(eq(aiJobs.feature, feature), inArray(aiJobs.status, UNFINISHED)));
    return rows.map((row) => row.id);
  }

  async subjectRefs(ids: readonly string[]): Promise<Map<string, AiJobRow['subjectRef']>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: aiJobs.id, subjectRef: aiJobs.subjectRef })
      .from(aiJobs)
      .where(inArray(aiJobs.id, [...ids]));
    return new Map(rows.map((row) => [row.id, row.subjectRef]));
  }

  async recoverExpiredLeases(maxAttempts: number): Promise<{ requeued: AiJobRow[]; failed: AiJobRow[] }> {
    const now = new Date();
    const expired = and(eq(aiJobs.status, 'running'), or(isNull(aiJobs.leaseUntil), lte(aiJobs.leaseUntil, now)));
    const failed = await this.db
      .update(aiJobs)
      .set({ status: 'failed', reason: 'error', finishedAt: now, ...LEASE_CLEARED })
      .where(and(expired, gte(aiJobs.attempts, maxAttempts)))
      .returning();
    const requeued = await this.db
      .update(aiJobs)
      .set({ status: 'queued', nextAttemptAt: DB_NOW, ...LEASE_CLEARED })
      .where(expired)
      .returning();
    for (const row of [...failed, ...requeued]) this.announce(row, 'state');
    return { requeued, failed };
  }

  /** Tells this server's listeners about a write that landed, and hands the row back. */
  private announce<T extends { id: string; feature: string; subjectRef: AiJobRow['subjectRef']; requestedBy: number | null }>(
    row: T | null,
    kind: AiJobChangeKind,
  ): T | null {
    if (row) this.changes?.changed({ id: row.id, feature: row.feature, subjectRef: row.subjectRef, requestedBy: row.requestedBy, kind });
    return row;
  }

  private runningFor(id: string, owner: string) {
    return and(eq(aiJobs.id, id), eq(aiJobs.status, 'running'), eq(aiJobs.leaseOwner, owner));
  }
}
