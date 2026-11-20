import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookChapterJobs } from '../../db/schema';
import type { BookChapterJobKind, BookChapterJobState } from '@bookorbit/types';
import { afterPosition, keysetOrder, microseconds, type JobKey, type JobPosition, type KeysetColumns } from '../jobs/job-keyset';

/** How long finished chapter jobs are kept before housekeeping removes them. */
export const CHAPTER_JOB_RETENTION_MS = 7 * 86_400_000;

export type ChapterJobRow = typeof bookChapterJobs.$inferSelect;

/** Whose jobs a Jobs-area read covers: one account's, or everyone's when null. Chapter jobs always have an owner. */
export type ChapterJobOwnerFilter = { id: number; ownerless: boolean } | null;

export interface ChapterJobPageQuery {
  view: 'queue' | 'needs-you' | 'failed' | 'history';
  owner: ChapterJobOwnerFilter;
  cutoffAt: Date;
  after: JobPosition | null;
  typeIndex: number;
  limit: number;
}

const PAGE_COLUMNS = {
  id: bookChapterJobs.id,
  bookId: bookChapterJobs.bookId,
  userId: bookChapterJobs.userId,
  kind: bookChapterJobs.kind,
  baseRevision: bookChapterJobs.baseRevision,
  status: bookChapterJobs.status,
  filesWritten: bookChapterJobs.filesWritten,
  filesTotal: bookChapterJobs.filesTotal,
  errorCode: bookChapterJobs.errorCode,
  createdAt: bookChapterJobs.createdAt,
  updatedAt: bookChapterJobs.updatedAt,
};

export type ChapterJobPageRow = Pick<ChapterJobRow, keyof typeof PAGE_COLUMNS> & {
  requesterName: string | null;
  /** 1-based place among queued jobs in claim order; 0 otherwise. */
  rank: number;
  key: JobKey;
};

export interface ChapterJobCounts {
  queue: number;
  needsYou: number;
  failed: number;
  running: number;
  queued: number;
  paused: number;
}

/**
 * A queued job's place in the claim order (`created_at, id`). The table holds at most 128 waiting
 * jobs, so a correlated count is cheap. Aliased: drizzle renders the outer columns unqualified.
 */
const QUEUED_RANK = sql<number>`(select count(*) from book_chapter_jobs q where q.status = 'queued' and (q.created_at, q.id) <= (book_chapter_jobs.created_at, book_chapter_jobs.id))`;

@Injectable()
export class ChapterJobRepository {
  constructor(@Inject(DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async enqueue(bookId: number, userId: number, kind: BookChapterJobKind, baseRevision: string, retry = false): Promise<BookChapterJobState> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1120, 1)`);
      const [existing] = await tx
        .select()
        .from(bookChapterJobs)
        .where(
          and(
            eq(bookChapterJobs.bookId, bookId),
            eq(bookChapterJobs.userId, userId),
            eq(bookChapterJobs.kind, kind),
            eq(bookChapterJobs.baseRevision, baseRevision),
          ),
        )
        .limit(1);
      const freshRead = existing?.status === 'success' && kind === 'read';
      if (existing && !freshRead && (!retry || existing.status !== 'failed')) return this.state(existing);
      const [count] = await tx
        .select({ total: sql<number>`count(*)::int`, mine: sql<number>`count(*) FILTER (WHERE user_id = ${userId})::int` })
        .from(bookChapterJobs)
        .where(sql`status IN ('queued', 'processing')`);
      if (count.total >= 128 || count.mine >= 16) throw new ConflictException('Too many chapter operations are waiting');
      if (existing) {
        const [requeued] = await tx
          .update(bookChapterJobs)
          .set({ status: 'queued', result: null, errorCode: null, filesWritten: 0, filesTotal: 0, updatedAt: new Date() })
          .where(eq(bookChapterJobs.id, existing.id))
          .returning();
        return this.state(requeued);
      }
      const [job] = await tx.insert(bookChapterJobs).values({ bookId, userId, kind, baseRevision }).returning();
      return this.state(job);
    });
  }

  async find(bookId: number, userId: number, id: string): Promise<BookChapterJobState | null> {
    const [job] = await this.db
      .select()
      .from(bookChapterJobs)
      .where(and(eq(bookChapterJobs.id, id), eq(bookChapterJobs.bookId, bookId), eq(bookChapterJobs.userId, userId)))
      .limit(1);
    return job ? this.state(job) : null;
  }

  async latest(bookId: number, userId: number): Promise<BookChapterJobState | null> {
    const [job] = await this.db
      .select()
      .from(bookChapterJobs)
      .where(and(eq(bookChapterJobs.bookId, bookId), eq(bookChapterJobs.userId, userId)))
      .orderBy(desc(bookChapterJobs.updatedAt), desc(bookChapterJobs.id))
      .limit(1);
    return job ? this.state(job) : null;
  }

  /** Returns how many interrupted jobs were marked failed. */
  async recover(): Promise<number> {
    // Remux is not replayed automatically: a process crash may follow a successful disk replacement.
    const recovered = await this.db
      .update(bookChapterJobs)
      .set({ status: 'failed', errorCode: 'book_chapters_operation_interrupted', updatedAt: new Date() })
      .where(eq(bookChapterJobs.status, 'processing'))
      .returning({ id: bookChapterJobs.id });
    return recovered.length;
  }

  /** Removes finished jobs last touched before `before`; returns how many went. */
  async purgeFinished(before: Date): Promise<number> {
    const removed = await this.db
      .delete(bookChapterJobs)
      .where(and(inArray(bookChapterJobs.status, ['success', 'failed']), lt(bookChapterJobs.updatedAt, before)))
      .returning({ id: bookChapterJobs.id });
    return removed.length;
  }

  async findByIds(ids: readonly string[]): Promise<ChapterJobRow[]> {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(bookChapterJobs)
      .where(inArray(bookChapterJobs.id, [...ids]));
  }

  /** A page of jobs for the Jobs area, in the view's keyset order. Nothing here waits on a person, so Needs you is empty. */
  async pageForJobs(query: ChapterJobPageQuery): Promise<ChapterJobPageRow[]> {
    if (query.view === 'needs-you') return [];
    return query.view === 'queue' ? await this.queuePage(query) : await this.settledPage(query);
  }

  /** How many jobs each Jobs-area view holds, failed ones measured from `cutoffAt`. */
  async countForJobs(owner: ChapterJobOwnerFilter, cutoffAt: Date): Promise<ChapterJobCounts> {
    const [row] = await this.db
      .select({
        running: sql<number>`count(*) filter (where ${bookChapterJobs.status} = 'processing')`.mapWith(Number),
        queued: sql<number>`count(*) filter (where ${bookChapterJobs.status} = 'queued')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${this.failedShown(cutoffAt)})`.mapWith(Number),
      })
      .from(bookChapterJobs)
      .where(and(inArray(bookChapterJobs.status, ['queued', 'processing', 'failed']), this.owned(owner)));
    const running = row?.running ?? 0;
    const queued = row?.queued ?? 0;
    return { queue: running + queued, needsYou: 0, failed: row?.failed ?? 0, running, queued, paused: 0 };
  }

  /** Processing first, then queued jobs in the order the worker claims them. */
  private async queuePage(query: ChapterJobPageQuery): Promise<ChapterJobPageRow[]> {
    const group = sql<number>`case when ${bookChapterJobs.status} = 'processing' then 0 else 1 end`;
    const rank = sql<number>`case when ${bookChapterJobs.status} = 'queued' then ${QUEUED_RANK} else 0 end`;
    // Created, not updated: progress moves `updated_at`, and a key must not shift while it is paged.
    const at = microseconds(sql`${bookChapterJobs.createdAt}`);
    const columns: KeysetColumns = {
      prefix: [
        { kind: 'number', expr: group },
        { kind: 'number', expr: rank },
      ],
      suffix: [{ kind: 'number', expr: at }],
      id: { kind: 'uuid', expr: sql`${bookChapterJobs.id}` },
    };
    const rows = await this.db
      .select({
        ...PAGE_COLUMNS,
        group: sql<number>`${group}`.mapWith(Number),
        rank: sql<number>`${rank}`.mapWith(Number),
        at,
        requesterName: schema.users.name,
      })
      .from(bookChapterJobs)
      .leftJoin(schema.users, eq(schema.users.id, bookChapterJobs.userId))
      .where(
        and(
          inArray(bookChapterJobs.status, ['queued', 'processing']),
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

  /** Failed and History by when the job finished, newest first. A job requeued in place leaves both. */
  private async settledPage(query: ChapterJobPageQuery): Promise<ChapterJobPageRow[]> {
    const finish = sql`${bookChapterJobs.updatedAt}`;
    const columns: KeysetColumns = { prefix: [{ kind: 'time', expr: finish }], suffix: [], id: { kind: 'uuid', expr: sql`${bookChapterJobs.id}` } };
    const rows = await this.db
      .select({ ...PAGE_COLUMNS, finish: microseconds(finish), requesterName: schema.users.name })
      .from(bookChapterJobs)
      .leftJoin(schema.users, eq(schema.users.id, bookChapterJobs.userId))
      .where(
        and(
          query.view === 'failed' ? this.failedShown(query.cutoffAt) : this.historyShown(query.cutoffAt),
          this.owned(query.owner),
          query.after ? afterPosition(columns, query.view, query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, query.view))
      .limit(query.limit);
    return rows.map(({ finish: at, ...row }) => ({ ...row, rank: 0, key: { prefix: [at], suffix: [], id: row.id } }));
  }

  private failedShown(cutoffAt: Date): SQL {
    return and(eq(bookChapterJobs.status, 'failed'), sql`${bookChapterJobs.updatedAt} > ${cutoffAt}`)!;
  }

  private historyShown(cutoffAt: Date): SQL {
    return sql`(${bookChapterJobs.status} = 'success' or (${bookChapterJobs.status} = 'failed' and ${bookChapterJobs.updatedAt} <= ${cutoffAt}))`;
  }

  private owned(owner: ChapterJobOwnerFilter): SQL | undefined {
    return owner === null ? undefined : eq(bookChapterJobs.userId, owner.id);
  }

  async claim() {
    const result = await this.db.execute<{ id: string }>(sql`UPDATE book_chapter_jobs SET status = 'processing', updated_at = now()
      WHERE id = (SELECT id FROM book_chapter_jobs WHERE status = 'queued' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id`);
    if (!result.rows[0]) return null;
    const [job] = await this.db.select().from(bookChapterJobs).where(eq(bookChapterJobs.id, result.rows[0].id));
    return job;
  }

  async progress(id: string, filesWritten: number, filesTotal: number): Promise<void> {
    await this.db.update(bookChapterJobs).set({ filesWritten, filesTotal, updatedAt: new Date() }).where(eq(bookChapterJobs.id, id));
  }

  async finish(id: string, result: BookChapterJobState['result'], errorCode?: string): Promise<void> {
    await this.db
      .update(bookChapterJobs)
      .set({ status: errorCode ? 'failed' : 'success', result: result ?? null, errorCode: errorCode ?? null, updatedAt: new Date() })
      .where(eq(bookChapterJobs.id, id));
  }

  private state(job: typeof bookChapterJobs.$inferSelect): BookChapterJobState {
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      filesWritten: job.filesWritten,
      filesTotal: job.filesTotal,
      result: job.result ?? undefined,
      errorCode: job.errorCode ?? undefined,
    };
  }
}
