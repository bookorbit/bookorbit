import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { and, eq, inArray } from 'drizzle-orm';
import { Permission, type ReadAloudCapability, type ReadAloudJob, type ReadAloudJobEventsResponse, type ReadAloudJobReport } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { ReadAloudJobRepository } from '../src/modules/read-aloud/read-aloud-job.repository';
import { ReadAloudLifecycleService } from '../src/modules/read-aloud/read-aloud-lifecycle.service';
import { READ_ALOUD_MAX_ATTEMPTS } from '../src/modules/read-aloud/read-aloud.constants';
import { waitForCondition } from './e2e/app-harness';
import { FakeReadAloudWorker } from './e2e/read-aloud/fake-read-aloud-worker';
import { createEpubFixture } from './e2e/metadata-write/metadata-write-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';
import { writeFixtureFile } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';

const TOKEN = `fake-worker-token-${randomUUID()}`;

/**
 * The whole job lifecycle against a fake worker that speaks the real protocol and writes real
 * output, so the repository's conditional updates, publishing, replacing and the activity log run
 * against PostgreSQL and the filesystem.
 */
describe('Read-aloud jobs (e2e)', { timeout: 240_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let worker!: FakeReadAloudWorker;
  let library!: CreatedLibrary;
  let owner!: TestUserSession;
  let other!: TestUserSession;
  const previousEnv = { url: process.env.READ_ALOUD_WORKER_URL, token: process.env.READ_ALOUD_WORKER_TOKEN };

  beforeAll(async () => {
    worker = new FakeReadAloudWorker(TOKEN, []);
    await worker.start();
    process.env.READ_ALOUD_WORKER_URL = worker.url;
    process.env.READ_ALOUD_WORKER_TOKEN = TOKEN;
    ctx = await createReaderStateIsolationE2EContext();
    worker.libraryRoots = [ctx.fixture.booksPath];
    library = await createLibraryWithFolder(ctx, { mode: 'book_per_folder' });
    // Replacing a read-along overwrites a file for good, so it takes the delete permission too.
    owner = await createUserAndLogin(ctx, {
      permissions: [Permission.LibraryUpload, Permission.LibraryGenerateReadAloud, Permission.LibraryDeleteBooks],
    });
    other = await createUserAndLogin(ctx, { permissions: [Permission.LibraryUpload, Permission.LibraryGenerateReadAloud] });
    await grantLibraryAccess(ctx, owner.userId, library.libraryId, 'editor');
    await grantLibraryAccess(ctx, other.userId, library.libraryId, 'editor');
  });

  afterAll(async () => {
    await closeReaderStateIsolationE2EContext(ctx);
    await worker.stop();
    restore('READ_ALOUD_WORKER_URL', previousEnv.url);
    restore('READ_ALOUD_WORKER_TOKEN', previousEnv.token);
  });

  async function writeBook(): Promise<{ bookId: number; epubFileId: number; audioFileId: number; folder: string }> {
    const folder = `Author ${randomUUID().slice(0, 6)}/Title`;
    const epubPath = await createEpubFixture(library.folderPath, `${folder}/Title.epub`, { title: `Title ${randomUUID().slice(0, 6)}` });
    const audioPath = await writeFixtureFile(library.folderPath, `${folder}/01.mp3`, Buffer.alloc(2048, 3));
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const epub = await locateBookByAbsolutePath(ctx, epubPath);
    const audio = await locateBookByAbsolutePath(ctx, audioPath);
    expect(audio.bookId).toBe(epub.bookId);
    return { bookId: epub.bookId, epubFileId: epub.bookFileId, audioFileId: audio.bookFileId, folder: join(library.folderPath, folder) };
  }

  async function call<T>(
    user: TestUserSession,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<{ status: number; body: T }> {
    const response = await ctx.app.inject({ method, url: `/api/v1${url}`, headers: authHeader(user.accessToken), payload: payload as never });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as T };
  }

  async function waitForJob(jobId: string, predicate: (job: ReadAloudJob) => boolean): Promise<ReadAloudJob> {
    let latest: ReadAloudJob | null = null;
    await waitForCondition(
      async () => {
        latest = (await call<ReadAloudJob>(owner, 'GET', `/read-aloud-jobs/${jobId}`)).body;
        if (!predicate(latest)) {
          const [row] = await ctx.db
            .select({ lastError: schema.readAloudJobs.lastError })
            .from(schema.readAloudJobs)
            .where(eq(schema.readAloudJobs.id, jobId));
          throw new Error(`job is ${latest.status}/${latest.stage} errorCode=${latest.errorCode} lastError=${row?.lastError ?? 'none'}`);
        }
      },
      60_000,
      250,
    );
    return latest!;
  }

  it('generates, validates and publishes a read-along into the book', async () => {
    const book = await writeBook();
    const capability = await call<ReadAloudCapability>(owner, 'GET', `/books/${book.bookId}/read-aloud`);
    expect(capability.status).toBe(200);
    expect(capability.body).toMatchObject({ workerConfigured: true, workerAvailable: true, eligible: true, reason: null });

    worker.outcome = 'aligned';
    const created = await call<ReadAloudJob>(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, {
      epubFileId: book.epubFileId,
      audioFileIds: [book.audioFileId],
      language: 'en',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'queued', canManage: true });

    const done = await waitForJob(created.body.id, (job) => job.status === 'completed');
    expect(done.outputFileId).toEqual(expect.any(Number));
    expect(await readdir(book.folder)).toContain('Title.readaloud.epub');
    const [file] = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.id, done.outputFileId!));
    expect(file).toMatchObject({ bookId: book.bookId, mediaOverlayAvailable: true });
    expect(existsSync(join(ctx.fixture.booksPath, 'read-aloud', 'jobs', done.id))).toBe(false);
    // The work folder is gone, but the chapter report and coverage stay with the job.
    expect(done.coverage).toMatchObject({ outsideSentences: 0, storyUnmatchedSentences: 0 });
    const kept = await call<ReadAloudJobReport>(owner, 'GET', `/read-aloud-jobs/${done.id}/report`);
    expect(kept.body.chapters).toHaveLength(3);

    const events = await call<ReadAloudJobEventsResponse>(owner, 'GET', `/read-aloud-jobs/${done.id}/events`);
    expect(events.body.events.map((event) => event.code)).toEqual(
      expect.arrayContaining(['job_created', 'claimed', 'job_started', 'output_validated', 'published']),
    );
    const later = await call<ReadAloudJobEventsResponse>(owner, 'GET', `/read-aloud-jobs/${done.id}/events?after=${events.body.events.at(-1)!.id}`);
    expect(later.body.events).toEqual([]);

    const after = await call<ReadAloudCapability>(owner, 'GET', `/books/${book.bookId}/read-aloud`);
    expect(after.body.existingReadAlongs).toEqual([expect.objectContaining({ fileId: done.outputFileId, generatedByJobId: done.id })]);
    expect(after.body.latestJob).toMatchObject({ id: done.id, status: 'completed' });

    const dismissed = await call<ReadAloudJob>(owner, 'POST', `/read-aloud-jobs/${done.id}/dismiss`);
    expect(dismissed.body.dismissedAt).toEqual(expect.any(String));
    expect((await call<ReadAloudCapability>(owner, 'GET', `/books/${book.bookId}/read-aloud`)).body.latestJob).toBeNull();
  });

  it('holds a weak alignment for review, re-syncs it, and replaces the read-along in place', async () => {
    const book = await writeBook();
    worker.outcome = 'aligned';
    const first = await call<ReadAloudJob>(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, { epubFileId: book.epubFileId, language: 'en' });
    const published = await waitForJob(first.body.id, (job) => job.status === 'completed');
    const readAlongId = published.outputFileId!;
    await ctx.db.insert(schema.readingProgress).values({ bookFileId: readAlongId, userId: owner.userId, percentage: 0.42 });

    const refused = await call(other, 'POST', `/books/${book.bookId}/read-aloud-jobs`, {
      epubFileId: book.epubFileId,
      language: 'en',
      replaceFileId: readAlongId,
    });
    expect(refused.status).toBe(403);

    worker.outcome = 'weak';
    const second = await call<ReadAloudJob>(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, {
      epubFileId: book.epubFileId,
      language: 'en',
      replaceFileId: readAlongId,
    });
    expect(second.status).toBe(201);
    const review = await waitForJob(second.body.id, (job) => job.status === 'awaiting_review');
    expect(review.expiresAt).toEqual(expect.any(String));
    const report = await call<ReadAloudJobReport>(owner, 'GET', `/read-aloud-jobs/${review.id}/report`);
    expect(report.body.chapters.filter((chapter) => chapter.status === 'not-found')).toHaveLength(2);

    worker.outcome = 'aligned';
    const resync = await call<ReadAloudJob>(owner, 'POST', `/read-aloud-jobs/${review.id}/resync`, {
      decisions: { chapters: { 'OPS/c2.xhtml': 'excluded', 'OPS/c3.xhtml': 'excluded' }, audio: [] },
    });
    expect(resync.status).toBe(200);
    const done = await waitForJob(review.id, (job) => job.status === 'completed');
    const resubmitted = worker.requests.filter((request) => request.method === 'POST' && request.body?.jobId === review.id).at(-1)!.body!;
    expect(resubmitted).toMatchObject({
      resumeFrom: 'aligning',
      decisions: { chapters: { 'OPS/c2.xhtml': 'excluded', 'OPS/c3.xhtml': 'excluded' } },
    });

    expect(done.outputFileId).toBe(readAlongId);
    const readAlongs = await ctx.db
      .select({ id: schema.bookFiles.id })
      .from(schema.bookFiles)
      .where(and(eq(schema.bookFiles.bookId, book.bookId), eq(schema.bookFiles.mediaOverlayAvailable, true)));
    expect(readAlongs).toEqual([{ id: readAlongId }]);
    const [progress] = await ctx.db.select().from(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, readAlongId));
    expect(progress?.percentage).toBeCloseTo(0.42);
    const history = await ctx.db.select().from(schema.bookFileHashHistory).where(eq(schema.bookFileHashHistory.bookFileId, readAlongId));
    expect(history.map((row) => row.reason)).toContain('read_aloud_replace');

    // Dismissing the newest finished job hides the card; the older, undismissed one stays hidden too.
    await call(owner, 'POST', `/read-aloud-jobs/${done.id}/dismiss`);
    expect((await call<ReadAloudCapability>(owner, 'GET', `/books/${book.bookId}/read-aloud`)).body.latestJob).toBeNull();
  });

  it('finishes adding reviewed output after a restart instead of asking for the same review again', async () => {
    const book = await writeBook();
    worker.outcome = 'weak';
    const created = await call<ReadAloudJob>(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, { epubFileId: book.epubFileId, language: 'en' });
    const review = await waitForJob(created.body.id, (job) => job.status === 'awaiting_review');

    // The state "Add anyway" leaves when the server dies mid-copy: approved, publishing, lease lapsed.
    const jobs = ctx.app.get(ReadAloudJobRepository);
    expect(await jobs.claimForPublishing(review.id)).toMatchObject({ stage: 'publishing', publishApproved: true });
    await ctx.db
      .update(schema.readAloudJobs)
      .set({ leaseUntil: new Date(Date.now() - 1_000) })
      .where(eq(schema.readAloudJobs.id, review.id));
    await ctx.app.get(ReadAloudLifecycleService).recoverExpiredJobs();

    const done = await waitForJob(review.id, (job) => job.status === 'completed_with_warnings' || job.status === 'awaiting_review');
    expect(done.status).toBe('completed_with_warnings');
    expect(done.outputFileId).toEqual(expect.any(Number));
    const events = await call<ReadAloudJobEventsResponse>(owner, 'GET', `/read-aloud-jobs/${review.id}/events`);
    expect(events.body.events.filter((event) => event.code === 'needs_review')).toHaveLength(1);
  });

  it('lets only the requester manage a job, and keeps failed work for a resuming retry', async () => {
    const book = await writeBook();
    worker.outcome = 'fail';
    const created = await call<ReadAloudJob>(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, { epubFileId: book.epubFileId, language: 'en' });
    const failed = await waitForJob(created.body.id, (job) => job.status === 'failed');
    expect(failed).toMatchObject({ errorCode: 'inference_failed', retryableUntil: expect.any(String) });
    expect(existsSync(join(ctx.fixture.booksPath, 'read-aloud', 'jobs', failed.id))).toBe(true);

    const seenByOther = await call<ReadAloudJob>(other, 'GET', `/read-aloud-jobs/${failed.id}`);
    expect(seenByOther.body.canManage).toBe(false);
    expect((await call(other, 'POST', `/read-aloud-jobs/${failed.id}/retry`)).status).toBe(403);
    expect((await call(other, 'POST', `/read-aloud-jobs/${failed.id}/dismiss`)).status).toBe(403);
    expect((await call<ReadAloudCapability>(other, 'GET', `/books/${book.bookId}/read-aloud`)).body.latestJob).toBeNull();

    worker.outcome = 'aligned';
    const retried = await call<ReadAloudJob>(owner, 'POST', `/read-aloud-jobs/${failed.id}/retry`);
    expect(retried.body.status).toBe('queued');
    await waitForJob(failed.id, (job) => job.status === 'completed');
  });

  it('stops a running job on the worker when it is cancelled', async () => {
    const book = await writeBook();
    worker.outcome = 'hang';
    const created = await call<ReadAloudJob>(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, { epubFileId: book.epubFileId, language: 'en' });
    await waitForJob(created.body.id, (job) => job.status === 'processing' && job.stage !== 'queued');
    expect((await call(other, 'DELETE', `/read-aloud-jobs/${created.body.id}`)).status).toBe(403);

    const cancelling = await call<ReadAloudJob>(owner, 'DELETE', `/read-aloud-jobs/${created.body.id}`);
    expect(cancelling.body).toMatchObject({ status: 'processing', cancelRequested: true });
    await waitForJob(created.body.id, (job) => job.status === 'cancelled');
    expect(worker.requests.some((request) => request.method === 'DELETE' && request.path.endsWith(created.body.id))).toBe(true);
    expect(existsSync(join(ctx.fixture.booksPath, 'read-aloud', 'jobs', created.body.id))).toBe(false);
  });

  it('resumes a job when the worker forgets it mid-run', async () => {
    const book = await writeBook();
    worker.outcome = 'hang';
    const created = await call<ReadAloudJob>(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, { epubFileId: book.epubFileId, language: 'en' });
    await waitForJob(created.body.id, (job) => job.status === 'processing' && job.stage !== 'queued');
    worker.outcome = 'aligned';
    worker.forgetJobs();
    await waitForJob(created.body.id, (job) => job.status === 'completed');
    const events = await call<ReadAloudJobEventsResponse>(owner, 'GET', `/read-aloud-jobs/${created.body.id}/events`);
    expect(events.body.events.map((event) => event.code)).toContain('worker_lost_job');
  });

  async function insertJob(
    book: { bookId: number; epubFileId: number; audioFileId: number },
    values: Partial<typeof schema.readAloudJobs.$inferInsert>,
  ): Promise<typeof schema.readAloudJobs.$inferSelect> {
    const [row] = await ctx.db
      .insert(schema.readAloudJobs)
      .values({
        bookId: book.bookId,
        requestedByUserId: owner.userId,
        input: {
          epubFileId: book.epubFileId,
          audioFileIds: [book.audioFileId],
          language: 'en',
          granularity: 'sentence',
          sourceBytes: 1,
          replaceFileId: null,
          sourceHashes: {},
        },
        ...values,
      })
      .returning();
    return row!;
  }

  async function jobState(jobId: string) {
    const [row] = await ctx.db.select().from(schema.readAloudJobs).where(eq(schema.readAloudJobs.id, jobId));
    return row!;
  }

  it('shows the job that finished last, however recently housekeeping touched an older one', async () => {
    const book = await writeBook();
    const day = 24 * 60 * 60_000;
    const older = await insertJob(book, {
      status: 'failed',
      stage: 'generating_emissions',
      errorCode: 'inference_failed',
      completedAt: new Date(Date.now() - 9 * day),
      updatedAt: new Date(Date.now() - 9 * day),
      workExpiresAt: new Date(Date.now() - 2 * day),
    });
    const newer = await insertJob(book, {
      status: 'completed',
      stage: 'completed',
      progress: 100,
      completedAt: new Date(Date.now() - day),
      updatedAt: new Date(Date.now() - day),
    });

    // The hourly sweep closes the older job's retry window, which restamps its updated_at.
    await ctx.app.get(ReadAloudJobRepository).clearExpiredWorkWindows(new Date());
    expect((await jobState(older.id)).updatedAt.getTime()).toBeGreaterThan((await jobState(newer.id)).updatedAt.getTime());

    const capability = await call<ReadAloudCapability>(owner, 'GET', `/books/${book.bookId}/read-aloud`);
    expect(capability.body.latestJob).toMatchObject({ id: newer.id, status: 'completed' });

    await call(owner, 'POST', `/read-aloud-jobs/${newer.id}/dismiss`);
    expect((await call<ReadAloudCapability>(owner, 'GET', `/books/${book.bookId}/read-aloud`)).body.latestJob).toBeNull();
  });

  it('refuses a cancel once publishing has begun, and lets an earlier cancel keep the job from publishing', async () => {
    const jobs = ctx.app.get(ReadAloudJobRepository);
    const lease = new Date(Date.now() + 60 * 60_000);
    const publishingBook = await writeBook();
    const validatingBook = await writeBook();
    const publishing = await insertJob(publishingBook, { status: 'processing', stage: 'publishing', progress: 99, leaseUntil: lease });
    const validating = await insertJob(validatingBook, { status: 'processing', stage: 'validating', progress: 97, leaseUntil: lease });
    try {
      const refused = await call<{ message: string }>(owner, 'DELETE', `/read-aloud-jobs/${publishing.id}`);
      expect(refused.status).toBe(409);
      expect(await jobState(publishing.id)).toMatchObject({ status: 'processing', stage: 'publishing', cancelRequested: false, errorCode: null });

      const accepted = await call<ReadAloudJob>(owner, 'DELETE', `/read-aloud-jobs/${validating.id}`);
      expect(accepted.status).toBe(200);
      expect(accepted.body).toMatchObject({ status: 'processing', cancelRequested: true });
      expect(await jobs.beginPublishing(validating.id)).toBeNull();
      expect(await jobState(validating.id)).toMatchObject({ status: 'processing', stage: 'validating' });

      await ctx.db.update(schema.readAloudJobs).set({ cancelRequested: false }).where(eq(schema.readAloudJobs.id, validating.id));
      expect(await jobs.beginPublishing(validating.id)).toMatchObject({ status: 'processing', stage: 'publishing', progress: 99 });
      expect(await jobs.requestCancellation(validating.id)).toBeNull();
    } finally {
      await ctx.db
        .update(schema.readAloudJobs)
        .set({ status: 'cancelled', stage: 'queued', leaseUntil: null, completedAt: new Date() })
        .where(inArray(schema.readAloudJobs.id, [publishing.id, validating.id]));
    }
  });

  it('refuses a cancel for an approved job a restart put back in the queue', async () => {
    const book = await writeBook();
    // Scheduled far ahead so the dispatcher leaves it alone while the cancel is tried.
    const requeued = await insertJob(book, { status: 'queued', publishApproved: true, nextAttemptAt: new Date(Date.now() + 60 * 60_000) });
    try {
      expect((await call(owner, 'DELETE', `/read-aloud-jobs/${requeued.id}`)).status).toBe(409);
      expect(await jobState(requeued.id)).toMatchObject({ status: 'queued', cancelRequested: false });
    } finally {
      await ctx.db.update(schema.readAloudJobs).set({ status: 'cancelled', completedAt: new Date() }).where(eq(schema.readAloudJobs.id, requeued.id));
    }
  });

  it('fails a job that keeps losing its server instead of requeueing it forever, keeping its work for Retry', async () => {
    const book = await writeBook();
    const stuck = await insertJob(book, {
      status: 'processing',
      stage: 'aligning',
      attemptCount: READ_ALOUD_MAX_ATTEMPTS,
      leaseUntil: new Date(Date.now() - 1_000),
    });
    await ctx.app.get(ReadAloudLifecycleService).recoverExpiredJobs();

    const state = await jobState(stuck.id);
    expect(state).toMatchObject({ status: 'failed', errorCode: 'unknown', leaseUntil: null });
    expect(state.workExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    const events = await call<ReadAloudJobEventsResponse>(owner, 'GET', `/read-aloud-jobs/${stuck.id}/events`);
    expect(events.body.events).toEqual([expect.objectContaining({ level: 'error', code: 'unknown' })]);
  });

  it('only ever raises the stored worker event sequence, and only while the job runs', async () => {
    const jobs = ctx.app.get(ReadAloudJobRepository);
    const book = await writeBook();
    const running = await insertJob(book, {
      status: 'processing',
      stage: 'aligning',
      workerEventSeq: 5,
      leaseUntil: new Date(Date.now() + 60 * 60_000),
    });
    try {
      await jobs.advanceWorkerEventSeq(running.id, 3);
      expect((await jobState(running.id)).workerEventSeq).toBe(5);
      await jobs.advanceWorkerEventSeq(running.id, 9);
      expect((await jobState(running.id)).workerEventSeq).toBe(9);

      await ctx.db.update(schema.readAloudJobs).set({ status: 'failed', completedAt: new Date() }).where(eq(schema.readAloudJobs.id, running.id));
      await jobs.advanceWorkerEventSeq(running.id, 20);
      expect((await jobState(running.id)).workerEventSeq).toBe(9);
    } finally {
      await ctx.db
        .update(schema.readAloudJobs)
        .set({ status: 'cancelled', leaseUntil: null, completedAt: new Date() })
        .where(eq(schema.readAloudJobs.id, running.id));
    }
  });

  it('explains up front when the library is not mounted in the worker', async () => {
    const book = await writeBook();
    worker.libraryRoots = ['/somewhere/else'];
    try {
      await waitForCondition(async () => {
        const capability = await call<ReadAloudCapability>(owner, 'GET', `/books/${book.bookId}/read-aloud`);
        expect(capability.body.reason).toBe('library_not_mounted');
      }, 20_000);
      const created = await call(owner, 'POST', `/books/${book.bookId}/read-aloud-jobs`, { epubFileId: book.epubFileId, language: 'en' });
      expect(created.status).toBe(400);
    } finally {
      worker.libraryRoots = [ctx.fixture.booksPath];
    }
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
