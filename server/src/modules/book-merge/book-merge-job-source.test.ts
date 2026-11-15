import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { BookMergeJobSource, type BookMergeJobRow } from './book-merge-job-source';
import type { MergeJobPageRow } from './book-merge.repository';

function user(id: number, permissions: Permission[] = [], isSuperuser = false): RequestUser {
  return { id, active: true, isSuperuser, permissions } as unknown as RequestUser;
}

const merger = user(4, [Permission.LibraryMergeBooks]);
const stranger = user(8, [Permission.LibraryMergeBooks]);
const manager = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);
const AT = new Date('2026-11-15T10:00:00.000Z');
const LATER = new Date('2026-11-15T10:05:00.000Z');

function page(change: Partial<MergeJobPageRow> = {}): MergeJobPageRow {
  return {
    id: 31,
    targetBookId: 12,
    requestedByUserId: merger.id,
    status: 'planned',
    processed: 0,
    total: 3,
    errorCode: null,
    createdAt: AT,
    updatedAt: AT,
    finishedAt: null,
    requesterName: 'Sam Whitfield',
    rank: 2,
    key: { prefix: [1, 2], suffix: [1], id: 31 },
    ...change,
  };
}

function makeSource() {
  const registry = new JobSourceRegistry();
  const jobs = {
    pageForJobs: vi.fn((): Promise<MergeJobPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ queue: 3, failed: 1, running: 2, queued: 1 })),
    findJobStatuses: vi.fn(() => Promise.resolve([{ id: 31, requestedByUserId: merger.id, status: 'moving' }])),
  };
  const subjects = {
    describe: vi.fn(() => Promise.resolve(new Map([[12, { label: 'Dune', byline: 'Frank Herbert', url: '/book/12', image: null }]]))),
  };
  const source = new BookMergeJobSource(registry, jobs as never, subjects as never);
  source.onModuleInit();
  return { source, registry, jobs, subjects };
}

const viewerOf = (who: RequestUser, all = false) => ({ user: who, access: { own: true, all } });
const QUERY = { view: 'queue' as const, owner: null, cutoffAt: AT, after: null, typeIndex: 2, limit: 50 };

async function listed(change: Partial<MergeJobPageRow>) {
  const { source, jobs } = makeSource();
  jobs.pageForJobs.mockResolvedValue([page(change)]);
  const [row] = await source.list(QUERY);
  return row!;
}

function rowOf(change: Partial<MergeJobPageRow> = {}): BookMergeJobRow {
  const job = page(change);
  return { nativeId: String(job.id), key: job.key, job, item: {} as never };
}

describe('BookMergeJobSource', () => {
  it('registers itself as the book-merge type', () => {
    const { source, registry } = makeSource();
    expect(registry.get('book-merge')).toBe(source);
  });

  it("lets anyone who may merge see their own merges, and managers everyone's", () => {
    const { source } = makeSource();
    expect(source.access(merger)).toEqual({ own: true, all: false });
    expect(source.access(manager)).toEqual({ own: false, all: true });
    expect(source.access(admin)).toEqual({ own: true, all: true });
    expect(source.access(user(9))).toEqual({ own: false, all: false });
    expect(source.access({ ...merger, active: false } as RequestUser)).toEqual({ own: false, all: false });
  });

  it('shows a planned merge waiting for a run slot with its place in line', async () => {
    const row = await listed({});
    expect(row.nativeId).toBe('31');
    expect(row.item).toMatchObject({
      status: 'queued',
      position: 2,
      phase: null,
      done: 0,
      total: 3,
      startedAt: null,
      finishedAt: null,
      requester: { id: merger.id, name: 'Sam Whitfield' },
    });
  });

  it.each(['moving', 'committing', 'committed'])('shows a %s merge as running, by source books merged', async (status) => {
    const row = await listed({ status, processed: 1, rank: 0 });
    expect(row.item).toMatchObject({ status: 'running', phase: status, done: 1, total: 3, position: null, startedAt: AT.toISOString() });
  });

  it('ends a merge as completed, or failed with its error code, whether rolled back or not', async () => {
    expect((await listed({ status: 'done', processed: 3, finishedAt: LATER })).item).toMatchObject({
      status: 'completed',
      reason: null,
      finishedAt: LATER.toISOString(),
    });
    expect((await listed({ status: 'rolled_back', errorCode: 'FILE_CHANGED', finishedAt: LATER })).item).toMatchObject({
      status: 'failed',
      reason: 'FILE_CHANGED',
    });
    expect((await listed({ status: 'failed', errorCode: 'INTERRUPTED' })).item).toMatchObject({ status: 'failed', reason: 'INTERRUPTED' });
    expect((await listed({ status: 'rolled_back', errorCode: null })).item).toMatchObject({ status: 'failed', reason: 'rolled-back' });
  });

  it('dates an ended merge written before finishes were stamped by its last write', async () => {
    const row = await listed({ status: 'failed', errorCode: 'MERGE_FAILED', finishedAt: null, updatedAt: LATER });
    expect(row.item.finishedAt).toBe(LATER.toISOString());
  });

  it('a merge never needs a person and never pauses', async () => {
    const { source } = makeSource();
    expect(await source.counts({ owner: null, cutoffAt: AT })).toEqual({ queue: 3, needsYou: 0, failed: 1, running: 2, queued: 1, paused: 0 });
  });

  it('names the book the others went into, and leaves out one the viewer no longer reaches', async () => {
    const { source, subjects } = makeSource();
    const found = await source.describe([rowOf()], viewerOf(merger));
    expect(subjects.describe).toHaveBeenCalledWith([12], { user: merger, manages: false });
    expect(found.get('31')).toMatchObject({ label: 'Dune', url: '/book/12' });
    subjects.describe.mockResolvedValue(new Map());
    expect((await source.describe([rowOf()], viewerOf(manager, true))).size).toBe(0);
  });

  it('offers no actions yet', () => {
    const { source } = makeSource();
    expect(source.actions()).toEqual({ actions: [], note: null });
  });

  it("refuses an action on a merge the viewer sees, and treats another account's as missing", async () => {
    const { source, jobs } = makeSource();
    expect(await source.act('cancel', ['31', 'x', '007'], viewerOf(merger))).toEqual([
      { id: '31', outcome: 'refused', status: 'running' },
      { id: 'x', outcome: 'not-found', status: null },
      { id: '007', outcome: 'not-found', status: null },
    ]);
    expect(jobs.findJobStatuses).toHaveBeenCalledWith([31]);
    expect(await source.act('cancel', ['31'], viewerOf(stranger))).toEqual([{ id: '31', outcome: 'not-found', status: null }]);
    expect(await source.act('cancel', ['31'], viewerOf(manager, true))).toEqual([{ id: '31', outcome: 'refused', status: 'running' }]);
  });
});
