import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
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

  async countQueuedAhead(job: ReadAloudJobRow): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(readAloudJobs)
      .where(
        and(
          ne(readAloudJobs.id, job.id),
          or(
            eq(readAloudJobs.status, 'processing'),
            and(
              eq(readAloudJobs.status, 'queued'),
              eq(readAloudJobs.cancelRequested, false),
              or(
                lt(readAloudJobs.nextAttemptAt, job.nextAttemptAt),
                and(eq(readAloudJobs.nextAttemptAt, job.nextAttemptAt), lt(readAloudJobs.createdAt, job.createdAt)),
              ),
            ),
          ),
        ),
      );
    return row?.count ?? 0;
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

  async claimNext(leaseMs = READ_ALOUD_LEASE_MS) {
    for (;;) {
      const [candidate] = await this.db
        .select({ id: readAloudJobs.id })
        .from(readAloudJobs)
        .where(and(eq(readAloudJobs.status, 'queued'), lte(readAloudJobs.nextAttemptAt, new Date()), eq(readAloudJobs.cancelRequested, false)))
        .orderBy(asc(readAloudJobs.nextAttemptAt), asc(readAloudJobs.createdAt))
        .limit(1);
      if (!candidate) return null;
      const claimed = await this.claimQueued(candidate.id, leaseMs);
      if (claimed) return claimed;
    }
  }

  /** Claims one queued job whatever its schedule, for a worker that is already running it. */
  async claimQueued(id: string, leaseMs = READ_ALOUD_LEASE_MS) {
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
        leaseUntil: new Date(now.getTime() + leaseMs),
        startedAt: now,
        updatedAt: now,
      })
      .where(and(eq(readAloudJobs.id, id), eq(readAloudJobs.status, 'queued'), eq(readAloudJobs.cancelRequested, false)))
      .returning();
    return claimed ?? null;
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

  async clearExpiredWorkWindows(now: Date): Promise<void> {
    await this.db
      .update(readAloudJobs)
      .set({ workExpiresAt: null })
      .where(and(eq(readAloudJobs.status, 'failed'), isNotNull(readAloudJobs.workExpiresAt), lte(readAloudJobs.workExpiresAt, now)));
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === '23505';
}
