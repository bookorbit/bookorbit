import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import type { ReadAloudPageRow } from './read-aloud-job.repository';
import { ReadAlongJobSource, type ReadAlongJobRow } from './read-along-job-source';
import { JOB_ID, jobRow } from './test-helpers';

function user(id: number, permissions: Permission[] = [], isSuperuser = false): RequestUser {
  return { id, active: true, isSuperuser, permissions } as unknown as RequestUser;
}

const requester = user(7, [Permission.LibraryGenerateReadAloud]);
const stranger = user(8, [Permission.LibraryGenerateReadAloud]);
const manager = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);
const demo = user(7, [Permission.LibraryGenerateReadAloud, Permission.DemoRestricted]);

const NOW = Date.parse('2026-11-15T12:00:00.000Z');

function page(change: Partial<ReadAloudPageRow> = {}): ReadAloudPageRow {
  const row = jobRow();
  return {
    id: row.id,
    bookId: row.bookId,
    requestedByUserId: row.requestedByUserId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    stageCurrent: null,
    stageTotal: null,
    errorCode: null,
    cancelRequested: false,
    publishApproved: false,
    pausedAt: null,
    createdAt: new Date('2026-11-15T10:00:00.000Z'),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date('2026-11-15T10:00:00.000Z'),
    dismissedAt: null,
    expiresAt: null,
    workExpiresAt: null,
    requesterName: 'Sam Whitfield',
    rank: 2,
    key: { prefix: [1, 2], suffix: [1], id: row.id },
    ...change,
  };
}

function makeSource() {
  const registry = new JobSourceRegistry();
  const jobs = {
    pageForJobs: vi.fn((): Promise<ReadAloudPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ queue: 2, needsYou: 1, failed: 0, running: 1, queued: 1, paused: 0 })),
    findByIds: vi.fn(() => Promise.resolve([jobRow()])),
    findById: vi.fn(() => Promise.resolve(jobRow())),
  };
  const readAloud = {
    cancelJob: vi.fn(() => Promise.resolve(jobRow({ status: 'cancelled' }))),
    pauseJob: vi.fn(() => Promise.resolve(jobRow({ pausedAt: new Date() }))),
    resumeJob: vi.fn(() => Promise.resolve(jobRow())),
    retryJob: vi.fn(() => Promise.resolve(jobRow())),
    dismissJob: vi.fn(() => Promise.resolve(jobRow({ status: 'failed', dismissedAt: new Date() }))),
    moveToTop: vi.fn(() => Promise.resolve(jobRow())),
    prioritize: vi.fn(() => Promise.resolve(jobRow({ priority: 1 }))),
  };
  const subjects = {
    describe: vi.fn(() => Promise.resolve(new Map([[12, { label: 'Dune', byline: 'Frank Herbert', url: '/book/12', image: null }]]))),
  };
  const source = new ReadAlongJobSource(registry, jobs as never, readAloud as never, subjects as never);
  source.onModuleInit();
  return { source, registry, jobs, readAloud, subjects };
}

const viewerOf = (who: RequestUser, all = false) => ({ user: who, access: { own: true, all } });

async function listed(change: Partial<ReadAloudPageRow>) {
  const { source, jobs } = makeSource();
  jobs.pageForJobs.mockResolvedValue([page(change)]);
  const [row] = await source.list({ view: 'queue', owner: null, cutoffAt: new Date(NOW), after: null, typeIndex: 1, limit: 50 });
  return row!;
}

function rowOf(change: Partial<ReadAloudPageRow>): ReadAlongJobRow {
  const job = page(change);
  return { nativeId: job.id, key: job.key, job, item: {} as never };
}

describe('ReadAlongJobSource', () => {
  it('registers itself as the read-along type', () => {
    const { source, registry } = makeSource();
    expect(registry.get('read-along')).toBe(source);
  });

  it("lets anyone who may generate see their own jobs, and managers everyone's", () => {
    const { source } = makeSource();
    expect(source.access(requester)).toEqual({ own: true, all: false });
    expect(source.access(manager)).toEqual({ own: false, all: true });
    expect(source.access(admin)).toEqual({ own: true, all: true });
    expect(source.access(user(9))).toEqual({ own: false, all: false });
  });

  it('maps each stored state to one Jobs status', async () => {
    expect((await listed({ status: 'queued' })).item).toMatchObject({ status: 'queued', position: 2, reason: null });
    expect((await listed({ status: 'queued', pausedAt: new Date(NOW) })).item).toMatchObject({ status: 'paused', position: null, reason: 'user' });
    expect((await listed({ status: 'awaiting_review', expiresAt: new Date(NOW) })).item).toMatchObject({
      status: 'needs-you',
      reason: 'review',
      extra: { expiresAt: '2026-11-15T12:00:00.000Z' },
    });
    expect((await listed({ status: 'completed_with_warnings', completedAt: new Date(NOW) })).item).toMatchObject({
      status: 'completed',
      reason: 'warnings',
      finishedAt: '2026-11-15T12:00:00.000Z',
    });
    expect((await listed({ status: 'failed', errorCode: 'inference_failed' })).item).toMatchObject({ status: 'failed', reason: 'inference_failed' });
    expect((await listed({ status: 'cancelled', errorCode: 'review_expired' })).item).toMatchObject({
      status: 'cancelled',
      reason: 'review_expired',
    });
  });

  it('shows a running job by its stage and overall progress, since stage counters restart', async () => {
    const row = await listed({ status: 'processing', stage: 'aligning', progress: 64, stageCurrent: 3, stageTotal: 9, startedAt: new Date(NOW) });
    expect(row.item).toMatchObject({
      status: 'running',
      phase: 'aligning',
      percent: 64,
      done: null,
      total: null,
      startedAt: '2026-11-15T12:00:00.000Z',
    });
  });

  it('names the book only where the viewer still reaches it', async () => {
    const { source, subjects } = makeSource();
    const subjectsFor = await source.describe([rowOf({})], viewerOf(requester));
    expect(subjects.describe).toHaveBeenCalledWith([12], { user: requester, manages: false });
    expect(subjectsFor.get(JOB_ID)).toMatchObject({ label: 'Dune', url: '/book/12/files' });
    subjects.describe.mockResolvedValue(new Map());
    expect((await source.describe([rowOf({})], viewerOf(requester))).size).toBe(0);
  });

  describe('actions', () => {
    it('offers the requester pause, move to top and cancel on a queued job, and a manager only prioritize', () => {
      const { source } = makeSource();
      expect(source.actions(rowOf({}), viewerOf(requester), NOW)).toEqual({ actions: ['cancel', 'pause', 'move-to-top'], note: null });
      expect(source.actions(rowOf({}), viewerOf(manager, true), NOW)).toEqual({ actions: ['prioritize'], note: null });
      expect(source.actions(rowOf({}), viewerOf(admin, true), NOW).actions).toEqual(['cancel', 'pause', 'move-to-top', 'prioritize']);
    });

    it('offers resume on a paused job, and nothing that would start it ahead of others', () => {
      const { source } = makeSource();
      expect(source.actions(rowOf({ pausedAt: new Date(NOW) }), viewerOf(admin, true), NOW).actions).toEqual(['cancel', 'resume', 'move-to-top']);
    });

    it('keeps an approved job that a restart requeued from being paused, boosted or cancelled', () => {
      const { source } = makeSource();
      expect(source.actions(rowOf({ publishApproved: true }), viewerOf(admin, true), NOW).actions).toEqual(['move-to-top']);
    });

    it('offers retry only inside the retry window, and dismiss until dismissed', () => {
      const { source } = makeSource();
      const failed = { status: 'failed', completedAt: new Date(NOW) };
      expect(source.actions(rowOf({ ...failed, workExpiresAt: new Date(NOW + 1) }), viewerOf(requester), NOW).actions).toEqual(['retry', 'dismiss']);
      expect(source.actions(rowOf({ ...failed, workExpiresAt: new Date(NOW - 1) }), viewerOf(requester), NOW).actions).toEqual(['dismiss']);
      expect(source.actions(rowOf({ ...failed, dismissedAt: new Date(NOW) }), viewerOf(requester), NOW).actions).toEqual([]);
    });

    it('leaves review to the book page', () => {
      const { source } = makeSource();
      expect(source.actions(rowOf({ status: 'awaiting_review' }), viewerOf(requester), NOW)).toEqual({ actions: [], note: null });
    });

    it('says why a manager or a demo account cannot change a job they see', () => {
      const { source } = makeSource();
      expect(source.actions(rowOf({ status: 'processing' }), viewerOf(manager, true), NOW)).toEqual({ actions: [], note: 'read-along-requester' });
      expect(source.actions(rowOf({}), viewerOf(demo), NOW)).toEqual({ actions: [], note: 'demo' });
    });
  });

  describe('act', () => {
    it('answers not-found for a job the viewer neither asked for nor manages, and for ids that are not jobs', async () => {
      const { source, readAloud } = makeSource();
      const results = await source.act('cancel', [JOB_ID, 'nope'], viewerOf(stranger));
      expect(results).toEqual([
        { id: JOB_ID, outcome: 'not-found', status: null },
        { id: 'nope', outcome: 'not-found', status: null },
      ]);
      expect(readAloud.cancelJob).not.toHaveBeenCalled();
    });

    it('skips a job the action no longer applies to, and refuses a viewer who may not take it', async () => {
      const { source, jobs } = makeSource();
      jobs.findByIds.mockResolvedValue([jobRow({ status: 'completed' })]);
      expect(await source.act('pause', [JOB_ID], viewerOf(requester))).toEqual([{ id: JOB_ID, outcome: 'skipped', status: 'completed' }]);
      jobs.findByIds.mockResolvedValue([jobRow()]);
      expect(await source.act('cancel', [JOB_ID], viewerOf(manager, true))).toEqual([{ id: JOB_ID, outcome: 'refused', status: 'queued' }]);
    });

    it('takes each action through the service and reports the new status', async () => {
      const { source, readAloud } = makeSource();
      expect(await source.act('pause', [JOB_ID], viewerOf(requester))).toEqual([{ id: JOB_ID, outcome: 'done', status: 'paused' }]);
      expect(await source.act('cancel', [JOB_ID], viewerOf(requester))).toEqual([{ id: JOB_ID, outcome: 'done', status: 'cancelled' }]);
      expect(await source.act('prioritize', [JOB_ID], viewerOf(manager, true))).toEqual([{ id: JOB_ID, outcome: 'done', status: 'queued' }]);
      expect(readAloud.prioritize).toHaveBeenCalledWith(JOB_ID, manager);
    });

    it('turns service refusals into outcomes, and a retry that collides into a conflict', async () => {
      const { source, readAloud, jobs } = makeSource();
      readAloud.pauseJob.mockRejectedValueOnce(new ConflictException('worker has it'));
      expect((await source.act('pause', [JOB_ID], viewerOf(requester)))[0]).toMatchObject({ outcome: 'skipped' });
      readAloud.moveToTop.mockRejectedValueOnce(new ForbiddenException());
      expect((await source.act('move-to-top', [JOB_ID], viewerOf(requester)))[0]).toMatchObject({ outcome: 'refused' });
      readAloud.moveToTop.mockRejectedValueOnce(new NotFoundException());
      expect((await source.act('move-to-top', [JOB_ID], viewerOf(requester)))[0]).toEqual({ id: JOB_ID, outcome: 'not-found', status: null });
      readAloud.moveToTop.mockRejectedValueOnce(new Error('database is down'));
      expect((await source.act('move-to-top', [JOB_ID], viewerOf(requester)))[0]).toMatchObject({ outcome: 'error' });

      const failed = jobRow({ status: 'failed', workExpiresAt: new Date(Date.now() + 60_000) });
      jobs.findByIds.mockResolvedValue([failed]);
      jobs.findById.mockResolvedValue(failed);
      readAloud.retryJob.mockRejectedValueOnce(new ConflictException('another job'));
      expect((await source.act('retry', [JOB_ID], viewerOf(requester)))[0]).toMatchObject({ outcome: 'conflict', status: 'failed' });
    });
  });
});
