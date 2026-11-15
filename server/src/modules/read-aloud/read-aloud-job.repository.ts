import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  ReadAloudChapterReport,
  ReadAloudDecisions,
  ReadAloudErrorCode,
  ReadAloudJobInput,
  ReadAloudJobStage,
  ReadAloudNarrationCoverage,
  ReadAloudReportSummary,
  ReadAloudStageDetail,
  ReadAloudWarningCode,
  ReadAloudWorkerStage,
} from '@bookorbit/types';
import { READ_ALOUD_ACTIVE_JOB_STATUSES, READ_ALOUD_TERMINAL_JOB_STATUSES } from '@bookorbit/types';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, bookMetadata, books, libraries, readAloudJobReports, readAloudJobs, users, type ReadAloudJobRow } from '../../db/schema';
import { afterPosition, keysetOrder, microseconds, type JobKey, type JobPosition, type KeysetColumns } from '../jobs/job-keyset';
import { READ_ALOUD_LEASE_MS } from './read-aloud.constants';

type Db = NodePgDatabase<typeof schema>;
export type ReadAloudJobPayload = ReadAloudJobInput & { sourceHashes: Record<string, string | null> };

const ACTIVE = [...READ_ALOUD_ACTIVE_JOB_STATUSES];
const TERMINAL = [...READ_ALOUD_TERMINAL_JOB_STATUSES];

export type ReadAloudSourceFile = {
  id: number;
  absolutePath: string;
  filename: string;
  format: string | null;
  role: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  fileHash: string | null;
  mediaOverlayAvailable: boolean;
  sortOrder: number | null;
};

/** Whose jobs a Jobs-area read covers: one account's, plus the ownerless ones when allowed; null for everyone's. */
export type ReadAloudOwnerFilter = { id: number; ownerless: boolean } | null;

export interface ReadAloudPageQuery {
  view: 'queue' | 'needs-you' | 'failed' | 'history';
  owner: ReadAloudOwnerFilter;
  cutoffAt: Date;
  after: JobPosition | null;
  typeIndex: number;
  limit: number;
}

const PAGE_COLUMNS = {
  id: readAloudJobs.id,
  bookId: readAloudJobs.bookId,
  requestedByUserId: readAloudJobs.requestedByUserId,
  status: readAloudJobs.status,
  stage: readAloudJobs.stage,
  progress: readAloudJobs.progress,
  stageCurrent: readAloudJobs.stageCurrent,
  stageTotal: readAloudJobs.stageTotal,
  errorCode: readAloudJobs.errorCode,
  cancelRequested: readAloudJobs.cancelRequested,
  publishApproved: readAloudJobs.publishApproved,
  pausedAt: readAloudJobs.pausedAt,
  createdAt: readAloudJobs.createdAt,
  startedAt: readAloudJobs.startedAt,
  completedAt: readAloudJobs.completedAt,
  updatedAt: readAloudJobs.updatedAt,
  dismissedAt: readAloudJobs.dismissedAt,
  expiresAt: readAloudJobs.expiresAt,
  workExpiresAt: readAloudJobs.workExpiresAt,
};

export type ReadAloudPageRow = Pick<ReadAloudJobRow, keyof typeof PAGE_COLUMNS> & {
  requesterName: string | null;
  /** 1-based place in the fair order for a queued job that can run; 0 otherwise. */
  rank: number;
  key: JobKey;
};

export interface ReadAloudJobCounts {
  queue: number;
  needsYou: number;
  failed: number;
  running: number;
  queued: number;
  paused: number;
}

/** When a finished job ended, never null, so no row drops out of a keyset comparison. */
const FINISH = sql`coalesce(${readAloudJobs.completedAt}, ${readAloudJobs.updatedAt})`;

/**
 * Queued jobs that can run, in the order they will (decision 14). Each band holds every requester's
 * next job by lane rank; inside a band, requesters served longest ago go first, so someone with 400
 * jobs gets one turn per band. A manager's priority comes before everything. Aliased throughout:
 * drizzle renders column references unqualified, which inside a subquery would bind to the wrong row.
 */
const FAIR_ORDER = sql`
  with lane as (
    select j.id, j.requested_by_user_id, j.user_order, j.priority, j.next_attempt_at,
      row_number() over (partition by j.requested_by_user_id order by j.user_order) as lane_rank
    from read_aloud_jobs j
    where j.status = 'queued' and j.paused_at is null and j.cancel_requested = false
  ),
  served as (
    select l.requested_by_user_id,
      case when l.requested_by_user_id is null
        then (select max(r.started_at) from read_aloud_jobs r where r.requested_by_user_id is null)
        else (select max(r.started_at) from read_aloud_jobs r where r.requested_by_user_id = l.requested_by_user_id)
      end as last_served
    from (select distinct requested_by_user_id from lane) l
  )
  select lane.id, lane.next_attempt_at,
    row_number() over (
      order by lane.priority desc, lane.lane_rank, served.last_served asc nulls first,
        lane.requested_by_user_id asc nulls last, lane.user_order
    ) as fair_rank
  from lane
  left join served on served.requested_by_user_id is not distinct from lane.requested_by_user_id`;

export type ReadAloudReadAlongFile = {
  fileId: number;
  filename: string;
  sizeBytes: number | null;
  generatedByJobId: string | null;
};

/**
 * Every status change goes through a conditional update here, so concurrent paths (the dispatch
 * loop, a user's request, a sweep) can only move a job along an edge that is still valid.
 */
@Injectable()
export class ReadAloudJobRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async create(values: { bookId: number; requestedByUserId: number; input: ReadAloudJobPayload; replaceFileId: number | null }) {
    const [row] = await this.db
      .insert(readAloudJobs)
      .values({ ...values, status: 'queued', stage: 'queued' })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  async findByIds(ids: readonly string[]): Promise<ReadAloudJobRow[]> {
    if (ids.length === 0) return [];
    return await this.db
      .select()
      .from(readAloudJobs)
      .where(inArray(readAloudJobs.id, [...ids]));
  }

  async findById(id: string) {
    const [row] = await this.db.select().from(readAloudJobs).where(eq(readAloudJobs.id, id)).limit(1);
    return row ?? null;
  }

  async findActiveForBook(bookId: number) {
    const [row] = await this.db
      .select()
      .from(readAloudJobs)
      .where(and(eq(readAloudJobs.bookId, bookId), inArray(readAloudJobs.status, ACTIVE)))
      .limit(1);
    return row ?? null;
  }

  /**
   * The newest finished job this viewer may see (their own, or anyone's for a superuser), unless it
   * was dismissed. Dismissing the newest one must not bring an older one back in its place.
   * Ordered by when the job finished: housekeeping restamps `updated_at` on old rows.
   */
  async findLatestFinishedForViewer(bookId: number, viewer: { id: number; isSuperuser: boolean }) {
    const [row] = await this.db
      .select()
      .from(readAloudJobs)
      .where(
        and(
          eq(readAloudJobs.bookId, bookId),
          inArray(readAloudJobs.status, TERMINAL),
          viewer.isSuperuser ? undefined : eq(readAloudJobs.requestedByUserId, viewer.id),
        ),
      )
      .orderBy(sql`${readAloudJobs.completedAt} desc nulls last`, desc(readAloudJobs.createdAt), desc(readAloudJobs.id))
      .limit(1);
    return row && row.dismissedAt == null ? row : null;
  }

  async findRequesterName(userId: number | null): Promise<string | null> {
    if (userId == null) return null;
    const [row] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.name ?? null;
  }

  async findBookTitle(bookId: number): Promise<string | null> {
    const [row] = await this.db.select({ title: bookMetadata.title }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    return row?.title ?? null;
  }

  /** The book's folder and its library's allowed formats, for eligibility checks the detail DTO doesn't carry. */
  async findBookPlacement(bookId: number): Promise<{ folderPath: string; allowedFormats: string[] } | null> {
    const [row] = await this.db
      .select({ folderPath: books.folderPath, allowedFormats: libraries.allowedFormats })
      .from(books)
      .innerJoin(libraries, eq(books.libraryId, libraries.id))
      .where(eq(books.id, bookId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Jobs ahead of each queued job, counting the running one: its place in the fair order less one,
   * plus what is processing. One query for any number of jobs; a job not in line (paused, cancel
   * requested, no longer queued) is left out.
   */
  async queuePositions(ids: readonly string[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const fair = this.fair();
    const [rows, [running]] = await Promise.all([
      this.db
        .with(fair)
        .select({ id: fair.fairId, rank: sql<number>`${fair.fairRank}`.mapWith(Number) })
        .from(fair)
        .where(inArray(fair.fairId, [...ids])),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(readAloudJobs)
        .where(eq(readAloudJobs.status, 'processing')),
    ]);
    const processing = running?.count ?? 0;
    return new Map(rows.map((row) => [row.id, row.rank - 1 + processing]));
  }

  async findSourceFiles(bookId: number, fileIds: number[]): Promise<ReadAloudSourceFile[]> {
    if (fileIds.length === 0) return [];
    return await this.db
      .select({
        id: bookFiles.id,
        absolutePath: bookFiles.absolutePath,
        filename: sql<string>`regexp_replace(${bookFiles.absolutePath}, '^.*/', '')`,
        format: bookFiles.format,
        role: bookFiles.role,
        sizeBytes: bookFiles.sizeBytes,
        durationSeconds: bookFiles.durationSeconds,
        fileHash: bookFiles.fileHash,
        mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
        sortOrder: bookFiles.sortOrder,
      })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), inArray(bookFiles.id, fileIds)))
      .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  /** Media-overlay EPUBs on the book, marked with the job that produced each one, if any. */
  async findReadAlongFiles(bookId: number): Promise<ReadAloudReadAlongFile[]> {
    return await this.db
      .select({
        fileId: bookFiles.id,
        filename: sql<string>`regexp_replace(${bookFiles.absolutePath}, '^.*/', '')`,
        sizeBytes: bookFiles.sizeBytes,
        // Spelled out with aliases: drizzle renders column references unqualified, which inside a
        // correlated subquery binds "id" to the jobs table instead of the outer file row.
        generatedByJobId: sql<string | null>`(
          select rj.id::text from read_aloud_jobs rj
          where rj.output_file_id = "book_files"."id"
            and rj.status in ('completed', 'completed_with_warnings')
          order by rj.completed_at desc nulls last
          limit 1
        )`,
      })
      .from(bookFiles)
      .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.mediaOverlayAvailable, true), sql`lower(${bookFiles.format}) = 'epub'`))
      .orderBy(asc(bookFiles.sortOrder), asc(bookFiles.id));
  }

  /** Claims the first due job in the fair order. A job in retry backoff keeps its place; it is skipped until due. */
  async claimNext(leaseMs = READ_ALOUD_LEASE_MS) {
    for (;;) {
      const fair = this.fair();
      const [candidate] = await this.db
        .with(fair)
        .select({ id: fair.fairId })
        .from(fair)
        .where(sql`${fair.fairDueAt} <= ${new Date()}`)
        .orderBy(fair.fairRank)
        .limit(1);
      if (!candidate) return null;
      const claimed = await this.claimQueued(candidate.id, { leaseMs });
      if (claimed) return claimed;
    }
  }

  /**
   * Claims one queued job whatever its schedule. `adopt` is for a worker that is already running
   * it: a pause is ignored and cleared, because the work is under way.
   */
  async claimQueued(id: string, options: { leaseMs?: number; adopt?: boolean } = {}) {
    const now = new Date();
    const [claimed] = await this.db
      .update(readAloudJobs)
      .set({
        status: 'processing',
        stage: sql`coalesce(${readAloudJobs.resumeFrom}, 'preparing_audio')`,
        stageCurrent: null,
        stageTotal: null,
        stageUnit: null,
        attemptCount: sql`${readAloudJobs.attemptCount} + 1`,
        leaseUntil: new Date(now.getTime() + (options.leaseMs ?? READ_ALOUD_LEASE_MS)),
        startedAt: now,
        pausedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(readAloudJobs.id, id),
          eq(readAloudJobs.status, 'queued'),
          eq(readAloudJobs.cancelRequested, false),
          options.adopt ? undefined : isNull(readAloudJobs.pausedAt),
        ),
      )
      .returning();
    return claimed ?? null;
  }

  /** Holds a queued job off the worker. Not one approved for publishing: its file may be in the library already. */
  async pause(id: string) {
    const now = new Date();
    const [row] = await this.db
      .update(readAloudJobs)
      .set({ pausedAt: now, updatedAt: now })
      .where(
        and(
          eq(readAloudJobs.id, id),
          eq(readAloudJobs.status, 'queued'),
          eq(readAloudJobs.cancelRequested, false),
          eq(readAloudJobs.publishApproved, false),
          isNull(readAloudJobs.pausedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Returns a paused job to its place in line. `next_attempt_at` is untouched, so a backoff still applies. */
  async resume(id: string) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({ pausedAt: null, updatedAt: new Date() })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'queued'), isNotNull(readAloudJobs.pausedAt)))
      .returning();
    return row ?? null;
  }

  /** First in its requester's own lane. Other requesters' turns do not change. */
  async moveToTop(id: string) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        userOrder: sql`(select min(q.user_order) - 1 from read_aloud_jobs q where q.status = 'queued' and q.requested_by_user_id is not distinct from read_aloud_jobs.requested_by_user_id)`,
        updatedAt: new Date(),
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'queued'), eq(readAloudJobs.cancelRequested, false)))
      .returning();
    return row ?? null;
  }

  /** Ahead of every queued job, as the AI queue's prioritize does. `next_attempt_at` is left alone. */
  async prioritize(id: string) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        priority: sql`(select coalesce(max(q.priority), 0) + 1 from read_aloud_jobs q where q.status = 'queued')`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(readAloudJobs.id, id),
          eq(readAloudJobs.status, 'queued'),
          eq(readAloudJobs.cancelRequested, false),
          eq(readAloudJobs.publishApproved, false),
          isNull(readAloudJobs.pausedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async heartbeat(id: string, leaseMs = READ_ALOUD_LEASE_MS): Promise<void> {
    await this.db
      .update(readAloudJobs)
      .set({ leaseUntil: new Date(Date.now() + leaseMs) })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing')));
  }

  async updateProgress(
    id: string,
    progress: {
      stage: ReadAloudJobStage;
      progress: number;
      stageDetail?: ReadAloudStageDetail | null;
      device?: string | null;
      workerEventSeq?: number;
    },
  ) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        stage: progress.stage,
        progress: Math.max(0, Math.min(100, Math.round(progress.progress))),
        ...(progress.stageDetail !== undefined
          ? {
              stageCurrent: progress.stageDetail?.current ?? null,
              stageTotal: progress.stageDetail?.total ?? null,
              stageUnit: progress.stageDetail?.unit ?? null,
            }
          : {}),
        ...(progress.device !== undefined ? { device: progress.device } : {}),
        ...(progress.workerEventSeq !== undefined ? { workerEventSeq: progress.workerEventSeq } : {}),
        leaseUntil: new Date(Date.now() + READ_ALOUD_LEASE_MS),
        updatedAt: new Date(),
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing')))
      .returning();
    return row ?? null;
  }

  /** Remembers the last worker event stored, so the next run of this job does not store it again. */
  async advanceWorkerEventSeq(id: string, seq: number): Promise<void> {
    await this.db
      .update(readAloudJobs)
      .set({ workerEventSeq: sql`greatest(${readAloudJobs.workerEventSeq}, ${seq})` })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing')));
  }

  async isCancellationRequested(id: string): Promise<boolean> {
    const [row] = await this.db.select({ value: readAloudJobs.cancelRequested }).from(readAloudJobs).where(eq(readAloudJobs.id, id)).limit(1);
    return row?.value ?? true;
  }

  /**
   * Queued and review jobs end immediately. A processing job only records the request; the
   * dispatch loop stops the worker and finishes the transition. A job that is already publishing,
   * or was approved for it before a restart put it back in line, cannot be cancelled: its file may
   * be in the library already.
   */
  async requestCancellation(id: string) {
    const now = new Date();
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        cancelRequested: true,
        status: sql`case when ${readAloudJobs.status} in ('queued', 'awaiting_review') then 'cancelled' else ${readAloudJobs.status} end`,
        errorCode: sql`case when ${readAloudJobs.status} = 'awaiting_review' then 'discarded' else 'cancelled' end`,
        completedAt: sql`case when ${readAloudJobs.status} in ('queued', 'awaiting_review') then ${now} else ${readAloudJobs.completedAt} end`,
        expiresAt: null,
        workExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(readAloudJobs.id, id),
          inArray(readAloudJobs.status, ACTIVE),
          or(ne(readAloudJobs.status, 'processing'), ne(readAloudJobs.stage, 'publishing')),
          eq(readAloudJobs.publishApproved, false),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Moves a validated job into publishing unless a cancel got there first. Together with
   * `requestCancellation` refusing a publishing job, a cancel either stops the job before its file
   * is written or is refused; it can never be acknowledged and then ignored.
   */
  async beginPublishing(id: string, leaseMs = READ_ALOUD_LEASE_MS) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        stage: 'publishing',
        progress: 99,
        stageCurrent: null,
        stageTotal: null,
        stageUnit: null,
        leaseUntil: new Date(Date.now() + leaseMs),
        updatedAt: new Date(),
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing'), eq(readAloudJobs.cancelRequested, false)))
      .returning();
    return row ?? null;
  }

  async markAwaitingReview(
    id: string,
    report: ReadAloudReportSummary,
    warnings: ReadAloudWarningCode[],
    coverage: ReadAloudNarrationCoverage | null,
    expiresAt: Date,
  ) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        status: 'awaiting_review',
        stage: 'awaiting_review',
        progress: 100,
        stageCurrent: null,
        stageTotal: null,
        stageUnit: null,
        report,
        warnings,
        coverage,
        leaseUntil: null,
        resumeFrom: null,
        publishApproved: false,
        expiresAt,
        remindedAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing'), eq(readAloudJobs.cancelRequested, false)))
      .returning();
    return row ?? null;
  }

  async claimForPublishing(id: string, leaseMs = READ_ALOUD_LEASE_MS) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        status: 'processing',
        stage: 'publishing',
        progress: 99,
        // Kept through a restart: lease recovery requeues the job, and this tells it to skip review.
        publishApproved: true,
        leaseUntil: new Date(Date.now() + leaseMs),
        expiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'awaiting_review'), eq(readAloudJobs.cancelRequested, false)))
      .returning();
    return row ?? null;
  }

  async complete(
    id: string,
    outputFileId: number,
    report: ReadAloudReportSummary,
    warnings: ReadAloudWarningCode[],
    coverage: ReadAloudNarrationCoverage | null,
  ) {
    const now = new Date();
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        status: warnings.length > 0 ? 'completed_with_warnings' : 'completed',
        stage: 'completed',
        progress: 100,
        stageCurrent: null,
        stageTotal: null,
        stageUnit: null,
        outputFileId,
        report,
        warnings,
        coverage,
        errorCode: null,
        lastError: null,
        leaseUntil: null,
        resumeFrom: null,
        expiresAt: null,
        workExpiresAt: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing')))
      .returning();
    return row ?? null;
  }

  /** Ends a processing job. A pending cancellation wins over the failure. */
  async fail(id: string, code: ReadAloudErrorCode, error: string, workExpiresAt: Date | null) {
    const now = new Date();
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        status: sql`case when ${readAloudJobs.cancelRequested} then 'cancelled' else 'failed' end`,
        errorCode: sql`case when ${readAloudJobs.cancelRequested} then 'cancelled' else ${code} end`,
        lastError: error.slice(0, 2000),
        leaseUntil: null,
        resumeFrom: null,
        workExpiresAt: sql`case when ${readAloudJobs.cancelRequested} then null else ${workExpiresAt}::timestamptz end`,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing')))
      .returning();
    return row ?? null;
  }

  /** Puts a processing job back in the queue after a transient failure, keeping its work. */
  async requeue(id: string, retryAt: Date, code: ReadAloudErrorCode, error: string) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        status: sql`case when ${readAloudJobs.cancelRequested} then 'cancelled' else 'queued' end`,
        stage: sql`case when ${readAloudJobs.cancelRequested} then ${readAloudJobs.stage} else 'queued' end`,
        errorCode: sql`case when ${readAloudJobs.cancelRequested} then 'cancelled' else ${code} end`,
        lastError: error.slice(0, 2000),
        nextAttemptAt: retryAt,
        leaseUntil: null,
        completedAt: sql`case when ${readAloudJobs.cancelRequested} then now() else null end`,
        updatedAt: new Date(),
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'processing')))
      .returning();
    return row ?? null;
  }

  /**
   * A job whose lease lapsed lost its server; requeue it, or finish it if cancellation was asked for.
   * One that keeps losing it is failed instead, keeping its work for Retry: a job that takes the
   * server down with it would otherwise be picked up again forever and hold the only dispatch slot.
   */
  async recoverExpiredLeases(
    maxAttempts: number,
    workExpiresAt: Date,
  ): Promise<{ cancelledIds: string[]; requeuedIds: string[]; failed: ReadAloudJobRow[] }> {
    const now = new Date();
    const expired = and(eq(readAloudJobs.status, 'processing'), or(isNull(readAloudJobs.leaseUntil), lte(readAloudJobs.leaseUntil, now)));
    const cancelled = await this.db
      .update(readAloudJobs)
      .set({ status: 'cancelled', errorCode: 'cancelled', leaseUntil: null, workExpiresAt: null, completedAt: now, updatedAt: now })
      .where(and(expired, eq(readAloudJobs.cancelRequested, true)))
      .returning({ id: readAloudJobs.id });
    const failed = await this.db
      .update(readAloudJobs)
      .set({
        status: 'failed',
        errorCode: 'unknown',
        lastError: `The server stopped during this job ${maxAttempts} times`,
        leaseUntil: null,
        resumeFrom: null,
        workExpiresAt,
        completedAt: now,
        updatedAt: now,
      })
      .where(and(expired, eq(readAloudJobs.cancelRequested, false), gte(readAloudJobs.attemptCount, maxAttempts)))
      .returning();
    const requeued = await this.db
      .update(readAloudJobs)
      .set({
        status: 'queued',
        stage: 'queued',
        // Its file may already be in the library, so from here on it can no longer be cancelled.
        publishApproved: sql`${readAloudJobs.publishApproved} or ${readAloudJobs.stage} = 'publishing'`,
        leaseUntil: null,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(and(expired, eq(readAloudJobs.cancelRequested, false)))
      .returning({ id: readAloudJobs.id });
    return { cancelledIds: cancelled.map((row) => row.id), requeuedIds: requeued.map((row) => row.id), failed };
  }

  /** Re-queues a failed job inside its retry window; its cached work makes it resume. */
  async retry(id: string) {
    const now = new Date();
    try {
      const [row] = await this.db
        .update(readAloudJobs)
        .set({
          status: 'queued',
          stage: 'queued',
          progress: 0,
          errorCode: null,
          lastError: null,
          attemptCount: 0,
          nextAttemptAt: now,
          cancelRequested: false,
          completedAt: null,
          dismissedAt: null,
          workExpiresAt: null,
          pausedAt: null,
          priority: 0,
          updatedAt: now,
        })
        .where(
          and(
            eq(readAloudJobs.id, id),
            eq(readAloudJobs.status, 'failed'),
            isNotNull(readAloudJobs.workExpiresAt),
            gt(readAloudJobs.workExpiresAt, now),
          ),
        )
        .returning();
      return row ?? null;
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async resync(id: string, decisions: ReadAloudDecisions, resumeFrom: ReadAloudWorkerStage) {
    const now = new Date();
    const [row] = await this.db
      .update(readAloudJobs)
      .set({
        status: 'queued',
        stage: 'queued',
        progress: 0,
        decisions,
        resumeFrom,
        // New decisions make new output, which needs its own review.
        publishApproved: false,
        attemptCount: 0,
        nextAttemptAt: now,
        expiresAt: null,
        remindedAt: null,
        pausedAt: null,
        priority: 0,
        updatedAt: now,
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'awaiting_review'), eq(readAloudJobs.cancelRequested, false)))
      .returning();
    return row ?? null;
  }

  async dismiss(id: string) {
    const [row] = await this.db
      .update(readAloudJobs)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(readAloudJobs.id, id), inArray(readAloudJobs.status, TERMINAL)))
      .returning();
    return row ?? null;
  }

  /** Keeps the per-chapter report past the work folder, which publishing and discarding delete. */
  async saveReportChapters(jobId: string, chapters: ReadAloudChapterReport[]): Promise<void> {
    const now = new Date();
    await this.db
      .insert(readAloudJobReports)
      .values({ jobId, chapters, updatedAt: now })
      .onConflictDoUpdate({ target: readAloudJobReports.jobId, set: { chapters, updatedAt: now } });
  }

  async findReportChapters(jobId: string): Promise<ReadAloudChapterReport[] | null> {
    const [row] = await this.db
      .select({ chapters: readAloudJobReports.chapters })
      .from(readAloudJobReports)
      .where(eq(readAloudJobReports.jobId, jobId))
      .limit(1);
    return row?.chapters ?? null;
  }

  async findReviewsToRemind(now: Date, remindBeforeMs: number) {
    return await this.db
      .select()
      .from(readAloudJobs)
      .where(
        and(
          eq(readAloudJobs.status, 'awaiting_review'),
          isNull(readAloudJobs.remindedAt),
          isNotNull(readAloudJobs.expiresAt),
          lte(readAloudJobs.expiresAt, new Date(now.getTime() + remindBeforeMs)),
        ),
      )
      .limit(100);
  }

  async markReminded(id: string): Promise<void> {
    await this.db.update(readAloudJobs).set({ remindedAt: new Date() }).where(eq(readAloudJobs.id, id));
  }

  async expireReviews(now: Date) {
    return await this.db
      .update(readAloudJobs)
      .set({ status: 'cancelled', errorCode: 'review_expired', expiresAt: null, completedAt: now, updatedAt: now })
      .where(and(eq(readAloudJobs.status, 'awaiting_review'), isNotNull(readAloudJobs.expiresAt), lte(readAloudJobs.expiresAt, now)))
      .returning();
  }

  /** A page of jobs for the Jobs area, in the view's keyset order. */
  async pageForJobs(query: ReadAloudPageQuery): Promise<ReadAloudPageRow[]> {
    return query.view === 'queue' ? await this.queuePage(query) : await this.settledPage(query);
  }

  /** How many jobs each Jobs-area view holds, failed ones measured from `cutoffAt`. */
  async countForJobs(owner: ReadAloudOwnerFilter, cutoffAt: Date): Promise<ReadAloudJobCounts> {
    const [row] = await this.db
      .select({
        queue: sql<number>`count(*) filter (where ${inArray(readAloudJobs.status, ['queued', 'processing'])})`.mapWith(Number),
        needsYou: sql<number>`count(*) filter (where ${readAloudJobs.status} = 'awaiting_review')`.mapWith(Number),
        failed: sql<number>`count(*) filter (where ${this.failedShown(cutoffAt)})`.mapWith(Number),
        running: sql<number>`count(*) filter (where ${readAloudJobs.status} = 'processing')`.mapWith(Number),
        queued: sql<number>`count(*) filter (where ${readAloudJobs.status} = 'queued' and ${readAloudJobs.pausedAt} is null)`.mapWith(Number),
        paused: sql<number>`count(*) filter (where ${readAloudJobs.status} = 'queued' and ${readAloudJobs.pausedAt} is not null)`.mapWith(Number),
      })
      .from(readAloudJobs)
      .where(and(inArray(readAloudJobs.status, ['queued', 'processing', 'awaiting_review', 'failed']), this.owned(owner)));
    return {
      queue: row?.queue ?? 0,
      needsYou: row?.needsYou ?? 0,
      failed: row?.failed ?? 0,
      running: row?.running ?? 0,
      queued: row?.queued ?? 0,
      paused: row?.paused ?? 0,
    };
  }

  /** Running first, then the fair order, then paused jobs by when they were paused. */
  private async queuePage(query: ReadAloudPageQuery): Promise<ReadAloudPageRow[]> {
    const fair = this.fair();
    const group = sql<number>`case when ${readAloudJobs.status} = 'processing' then 0 when ${readAloudJobs.pausedAt} is null then 1 else 2 end`;
    const rank = sql<number>`case when ${readAloudJobs.status} = 'queued' and ${readAloudJobs.pausedAt} is null then coalesce(${fair.fairRank}, 2147483647) else 0 end`;
    const at = microseconds(
      sql`case when ${readAloudJobs.status} = 'processing' then coalesce(${readAloudJobs.startedAt}, timestamptz 'epoch') when ${readAloudJobs.pausedAt} is null then ${readAloudJobs.createdAt} else ${readAloudJobs.pausedAt} end`,
    );
    const columns: KeysetColumns = {
      prefix: [
        { kind: 'number', expr: group },
        { kind: 'number', expr: rank },
      ],
      suffix: [{ kind: 'number', expr: at }],
      id: { kind: 'uuid', expr: sql`${readAloudJobs.id}` },
    };
    const rows = await this.db
      .with(fair)
      .select({
        ...PAGE_COLUMNS,
        group: sql<number>`${group}`.mapWith(Number),
        rank: sql<number>`${rank}`.mapWith(Number),
        at,
        requesterName: users.name,
      })
      .from(readAloudJobs)
      .leftJoin(fair, eq(fair.fairId, readAloudJobs.id))
      .leftJoin(users, eq(users.id, readAloudJobs.requestedByUserId))
      .where(
        and(
          inArray(readAloudJobs.status, ['queued', 'processing']),
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

  /** Needs you by when review began; Failed and History by when the job finished; newest first. */
  private async settledPage(query: ReadAloudPageQuery): Promise<ReadAloudPageRow[]> {
    const at = query.view === 'needs-you' ? sql`${readAloudJobs.updatedAt}` : FINISH;
    const columns: KeysetColumns = { prefix: [{ kind: 'time', expr: at }], suffix: [], id: { kind: 'uuid', expr: sql`${readAloudJobs.id}` } };
    const rows = await this.db
      .select({ ...PAGE_COLUMNS, finish: microseconds(at), requesterName: users.name })
      .from(readAloudJobs)
      .leftJoin(users, eq(users.id, readAloudJobs.requestedByUserId))
      .where(
        and(
          this.settledView(query.view, query.cutoffAt),
          this.owned(query.owner),
          query.after ? afterPosition(columns, query.view, query.after, query.typeIndex) : undefined,
        ),
      )
      .orderBy(...keysetOrder(columns, query.view))
      .limit(query.limit);
    return rows.map(({ finish, ...row }) => ({ ...row, rank: 0, key: { prefix: [finish], suffix: [], id: row.id } }));
  }

  private settledView(view: ReadAloudPageQuery['view'], cutoffAt: Date): SQL {
    if (view === 'needs-you') return eq(readAloudJobs.status, 'awaiting_review');
    if (view === 'failed') return this.failedShown(cutoffAt);
    return and(
      inArray(readAloudJobs.status, TERMINAL),
      or(ne(readAloudJobs.status, 'failed'), isNotNull(readAloudJobs.dismissedAt), sql`${FINISH} <= ${cutoffAt}`),
    )!;
  }

  /** Failed, not dismissed, and finished after the cutoff: what the Failed view still shows. */
  private failedShown(cutoffAt: Date): SQL {
    return and(eq(readAloudJobs.status, 'failed'), isNull(readAloudJobs.dismissedAt), sql`${FINISH} > ${cutoffAt}`)!;
  }

  private owned(owner: ReadAloudOwnerFilter): SQL | undefined {
    if (owner === null) return undefined;
    return or(eq(readAloudJobs.requestedByUserId, owner.id), owner.ownerless ? isNull(readAloudJobs.requestedByUserId) : undefined);
  }

  private fair() {
    return this.db.$with('fair').as(
      this.db
        .select({
          fairId: sql<string>`fair_order.id`.as('fair_id'),
          fairRank: sql<number>`fair_order.fair_rank`.as('fair_rank'),
          fairDueAt: sql<Date>`fair_order.next_attempt_at`.as('fair_due_at'),
        })
        .from(sql`(${FAIR_ORDER}) fair_order`),
    );
  }

  /** Jobs whose work folder must survive a sweep. */
  async findJobIdsKeepingWork(now: Date): Promise<Set<string>> {
    const rows = await this.db
      .select({ id: readAloudJobs.id })
      .from(readAloudJobs)
      .where(
        or(
          inArray(readAloudJobs.status, ACTIVE),
          and(eq(readAloudJobs.status, 'failed'), isNotNull(readAloudJobs.workExpiresAt), gt(readAloudJobs.workExpiresAt, now)),
        ),
      );
    return new Set(rows.map((row) => row.id));
  }

  /** Returns how many failed jobs lost their retry window. */
  async clearExpiredWorkWindows(now: Date): Promise<number> {
    const cleared = await this.db
      .update(readAloudJobs)
      .set({ workExpiresAt: null })
      .where(and(eq(readAloudJobs.status, 'failed'), isNotNull(readAloudJobs.workExpiresAt), lte(readAloudJobs.workExpiresAt, now)))
      .returning({ id: readAloudJobs.id });
    return cleared.length;
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === '23505';
}
