import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { ChapterEditJobSource, type ChapterEditJobRow } from './chapter-edit-job-source';
import type { ChapterJobPageRow, ChapterJobRow } from './chapter-job.repository';

const JOB_ID = '3f2a7c1e-0b5d-4e8a-9c3f-1d2e3f4a5b6c';
const NOW = Date.parse('2026-11-15T12:00:00.000Z');

function user(id: number, permissions: Permission[] = [], isSuperuser = false): RequestUser {
  return { id, active: true, isSuperuser, permissions } as unknown as RequestUser;
}

const editor = user(7, [Permission.LibraryEditMetadata]);
const otherEditor = user(8, [Permission.LibraryEditMetadata]);
const manager = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);

function stored(change: Partial<ChapterJobRow> = {}): ChapterJobRow {
  return {
    id: JOB_ID,
    bookId: 12,
    userId: editor.id,
    kind: 'write',
    baseRevision: 'a'.repeat(64),
    status: 'failed',
    filesWritten: 0,
    filesTotal: 0,
    result: null,
    errorCode: 'CHAPTERS_STALE',
    createdAt: new Date('2026-11-15T10:00:00.000Z'),
    updatedAt: new Date('2026-11-15T11:00:00.000Z'),
    ...change,
  };
}

function page(change: Partial<ChapterJobPageRow> = {}): ChapterJobPageRow {
  const row = stored();
  return {
    id: row.id,
    bookId: row.bookId,
    userId: row.userId,
    kind: row.kind,
    baseRevision: row.baseRevision,
    filesWritten: row.filesWritten,
    filesTotal: row.filesTotal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: 'queued',
    errorCode: null,
    requesterName: 'Sam Whitfield',
    rank: 2,
    key: { prefix: [1, 2], suffix: [1], id: JOB_ID },
    ...change,
  };
}

function makeSource() {
  const registry = new JobSourceRegistry();
  const jobs = {
    pageForJobs: vi.fn((): Promise<ChapterJobPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ queue: 2, needsYou: 0, failed: 1, running: 1, queued: 1, paused: 0 })),
    findByIds: vi.fn((): Promise<ChapterJobRow[]> => Promise.resolve([stored()])),
  };
  const service = {
    start: vi.fn(() => Promise.resolve({ id: JOB_ID, kind: 'write', status: 'queued', filesWritten: 0, filesTotal: 0 })),
  };
  const subjects = {
    describe: vi.fn(() => Promise.resolve(new Map([[12, { label: 'Dune', byline: 'Frank Herbert', url: '/book/12', image: null }]]))),
  };
  const source = new ChapterEditJobSource(registry, jobs as never, service as never, subjects as never);
  source.onModuleInit();
  return { source, registry, jobs, service, subjects };
}

const viewerOf = (who: RequestUser, all = false) => ({ user: who, access: { own: true, all } });

async function listed(change: Partial<ChapterJobPageRow>) {
  const { source, jobs } = makeSource();
  jobs.pageForJobs.mockResolvedValue([page(change)]);
  const [row] = await source.list({ view: 'queue', owner: null, cutoffAt: new Date(NOW), after: null, typeIndex: 3, limit: 50 });
  return row!;
}

function rowOf(change: Partial<ChapterJobPageRow>): ChapterEditJobRow {
  const job = page(change);
  return { nativeId: job.id, key: job.key, job, item: {} as never };
}

describe('ChapterEditJobSource', () => {
  it('registers itself as the chapter-edit type', () => {
    const { source, registry } = makeSource();
    expect(registry.get('chapter-edit')).toBe(source);
  });

  it("lets metadata editors see their own chapter jobs, and managers everyone's", () => {
    const { source } = makeSource();
    expect(source.access(editor)).toEqual({ own: true, all: false });
    expect(source.access(manager)).toEqual({ own: false, all: true });
    expect(source.access(admin)).toEqual({ own: true, all: true });
    expect(source.access(user(9))).toEqual({ own: false, all: false });
    expect(source.access({ ...editor, active: false } as RequestUser)).toEqual({ own: false, all: false });
  });

  it('maps each stored state, keeping the kind and the place in line', async () => {
    expect((await listed({ status: 'queued', kind: 'read' })).item).toMatchObject({
      status: 'queued',
      kind: 'read',
      position: 2,
      reason: null,
      finishedAt: null,
    });
    expect((await listed({ status: 'success', kind: 'revert', rank: 0 })).item).toMatchObject({
      status: 'completed',
      kind: 'revert',
      position: null,
      finishedAt: '2026-11-15T11:00:00.000Z',
    });
    expect((await listed({ status: 'failed', errorCode: 'CHAPTERS_STALE', rank: 0 })).item).toMatchObject({
      status: 'failed',
      reason: 'CHAPTERS_STALE',
    });
    expect((await listed({ status: 'failed', errorCode: null, rank: 0 })).item).toMatchObject({ status: 'failed', reason: 'error' });
  });

  it('counts files once the running job knows how many it touches', async () => {
    expect((await listed({ status: 'processing', filesWritten: 0, filesTotal: 0, rank: 0 })).item).toMatchObject({
      status: 'running',
      done: null,
      total: null,
    });
    expect((await listed({ status: 'processing', filesWritten: 2, filesTotal: 5, rank: 0 })).item).toMatchObject({
      status: 'running',
      done: 2,
      total: 5,
    });
  });

  it('shows a job retried in place back in the queue under the same id', async () => {
    const failed = await listed({ status: 'failed', rank: 0 });
    const retried = await listed({ status: 'queued', errorCode: null, rank: 1 });
    expect(retried.nativeId).toBe(failed.nativeId);
    expect(retried.item).toMatchObject({ status: 'queued', position: 1, reason: null });
  });

  it('names the book only where the viewer still reaches it', async () => {
    const { source, subjects } = makeSource();
    const found = await source.describe([rowOf({})], viewerOf(editor));
    expect(subjects.describe).toHaveBeenCalledWith([12], { user: editor, manages: false });
    expect(found.get(JOB_ID)).toMatchObject({ label: 'Dune', url: '/book/12' });
    subjects.describe.mockResolvedValue(new Map());
    expect((await source.describe([rowOf({})], viewerOf(editor))).size).toBe(0);
  });

  it('offers retry on a failed job to its requester only, and says why to anyone else', () => {
    const { source } = makeSource();
    expect(source.actions(rowOf({ status: 'failed' }), viewerOf(editor))).toEqual({ actions: ['retry'], note: null });
    expect(source.actions(rowOf({ status: 'failed' }), viewerOf(admin, true))).toEqual({ actions: [], note: 'chapter-edit-requester' });
    expect(source.actions(rowOf({ status: 'queued' }), viewerOf(editor))).toEqual({ actions: [], note: null });
    expect(source.actions(rowOf({ status: 'success' }), viewerOf(editor))).toEqual({ actions: [], note: null });
  });

  describe('act', () => {
    it('retries in place through the normal start path', async () => {
      const { source, service } = makeSource();
      expect(await source.act('retry', [JOB_ID], viewerOf(editor))).toEqual([{ id: JOB_ID, outcome: 'done', status: 'queued' }]);
      expect(service.start).toHaveBeenCalledWith(12, 'write', 'a'.repeat(64), editor, true);
    });

    it("answers not-found for someone else's job and for ids that are not jobs", async () => {
      const { source, service } = makeSource();
      expect(await source.act('retry', [JOB_ID, 'nope'], viewerOf(otherEditor))).toEqual([
        { id: JOB_ID, outcome: 'not-found', status: null },
        { id: 'nope', outcome: 'not-found', status: null },
      ]);
      expect(service.start).not.toHaveBeenCalled();
    });

    it('skips a job that is no longer failed or an action it does not take, and refuses a manager', async () => {
      const { source, jobs, service } = makeSource();
      expect(await source.act('cancel', [JOB_ID], viewerOf(editor))).toEqual([{ id: JOB_ID, outcome: 'skipped', status: 'failed' }]);
      expect(await source.act('retry', [JOB_ID], viewerOf(manager, true))).toEqual([{ id: JOB_ID, outcome: 'refused', status: 'failed' }]);
      jobs.findByIds.mockResolvedValue([stored({ status: 'success' })]);
      expect(await source.act('retry', [JOB_ID], viewerOf(editor))).toEqual([{ id: JOB_ID, outcome: 'skipped', status: 'completed' }]);
      expect(service.start).not.toHaveBeenCalled();
    });

    it('reports a job that moved on meanwhile as skipped', async () => {
      const { source, service } = makeSource();
      service.start.mockResolvedValue({ id: JOB_ID, kind: 'write', status: 'processing', filesWritten: 0, filesTotal: 0 });
      expect(await source.act('retry', [JOB_ID], viewerOf(editor))).toEqual([{ id: JOB_ID, outcome: 'skipped', status: 'running' }]);
    });

    it('turns the start path refusals into outcomes', async () => {
      const { source, service } = makeSource();
      service.start.mockRejectedValueOnce(new NotFoundException());
      expect((await source.act('retry', [JOB_ID], viewerOf(editor)))[0]).toEqual({ id: JOB_ID, outcome: 'not-found', status: null });
      service.start.mockRejectedValueOnce(new ForbiddenException());
      expect((await source.act('retry', [JOB_ID], viewerOf(editor)))[0]).toMatchObject({ outcome: 'refused' });
      service.start.mockRejectedValueOnce(new ConflictException('Too many chapter operations are waiting'));
      expect((await source.act('retry', [JOB_ID], viewerOf(editor)))[0]).toMatchObject({ outcome: 'refused' });
      service.start.mockRejectedValueOnce(new Error('database is down'));
      expect((await source.act('retry', [JOB_ID], viewerOf(editor)))[0]).toMatchObject({ outcome: 'error' });
    });
  });
});
