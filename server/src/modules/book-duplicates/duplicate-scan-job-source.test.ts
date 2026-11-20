import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import type { DuplicateScanPageRow } from './book-duplicates.repository';
import { DuplicateScanJobSource, type DuplicateScanJobRow } from './duplicate-scan-job-source';

function user(id: number, permissions: Permission[] = [], isSuperuser = false): RequestUser {
  return { id, active: true, isSuperuser, permissions } as unknown as RequestUser;
}

const deleter = user(7, [Permission.LibraryDeleteBooks]);
const merger = user(8, [Permission.LibraryMergeBooks]);
const manager = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);

const CREATED = new Date('2026-11-15T10:00:00.000Z');
const COMPLETED = new Date('2026-11-15T10:05:00.000Z');

function page(change: Partial<DuplicateScanPageRow> = {}): DuplicateScanPageRow {
  return {
    id: 11,
    userId: deleter.id,
    libraryIds: [2, 3],
    requestedLibraryId: null,
    status: 'queued',
    processedBooks: 0,
    totalBooks: null,
    errorCode: null,
    createdAt: CREATED,
    completedAt: null,
    requesterName: 'Sam Whitfield',
    rank: 2,
    key: { prefix: [1, 2], suffix: [1], id: 11 },
    ...change,
  };
}

function makeSource() {
  const registry = new JobSourceRegistry();
  const scans = {
    pageForJobs: vi.fn((): Promise<DuplicateScanPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ queue: 3, failed: 1, running: 1, queued: 2 })),
    findLibraryNames: vi.fn(() =>
      Promise.resolve(
        new Map([
          [2, 'Novels'],
          [3, 'Audiobooks'],
        ]),
      ),
    ),
    findScanOwners: vi.fn(() => Promise.resolve(new Map([[11, deleter.id]]))),
  };
  const libraries = { findAccessibleLibraryIds: vi.fn(() => Promise.resolve([2, 3])) };
  const source = new DuplicateScanJobSource(registry, scans as never, libraries as never);
  source.onModuleInit();
  return { source, registry, scans, libraries };
}

const viewerOf = (who: RequestUser, all = false) => ({ user: who, access: { own: true, all } });
const query = { view: 'queue' as const, owner: { id: 7, ownerless: false }, cutoffAt: CREATED, after: null, typeIndex: 5, limit: 50 };

async function listed(change: Partial<DuplicateScanPageRow>) {
  const { source, scans } = makeSource();
  scans.pageForJobs.mockResolvedValue([page(change)]);
  const [row] = await source.list(query);
  return row!;
}

function rowOf(change: Partial<DuplicateScanPageRow>): DuplicateScanJobRow {
  const scan = page(change);
  return { nativeId: String(scan.id), key: scan.key, scan, item: {} as never };
}

describe('DuplicateScanJobSource', () => {
  it('registers itself as the duplicate-scan type', () => {
    const { source, registry } = makeSource();
    expect(registry.get('duplicate-scan')).toBe(source);
  });

  it("lets whoever may start a scan see their own, and managers everyone's", () => {
    const { source } = makeSource();
    expect(source.access(deleter)).toEqual({ own: true, all: false });
    expect(source.access(merger)).toEqual({ own: true, all: false });
    expect(source.access(manager)).toEqual({ own: false, all: true });
    expect(source.access(admin)).toEqual({ own: true, all: true });
    expect(source.access(user(9))).toEqual({ own: false, all: false });
    expect(source.access({ ...deleter, active: false } as RequestUser)).toEqual({ own: false, all: false });
  });

  it('reads the owner filter and passes the paging through', async () => {
    const { source, scans } = makeSource();
    await source.list({ ...query, owner: null });
    expect(scans.pageForJobs).toHaveBeenCalledWith({ view: 'queue', ownerId: null, cutoffAt: CREATED, after: null, typeIndex: 5, limit: 50 });
  });

  it('gives a queued scan its place in the one line, and says whether it covers every library', async () => {
    expect((await listed({})).item).toMatchObject({ status: 'queued', position: 2, percent: null, kind: 'all-libraries', startedAt: null });
    expect((await listed({ requestedLibraryId: 2 })).item.kind).toBe('library');
  });

  it('shows a running scan as a percentage, never as books done, starting from when it was asked for', async () => {
    const row = await listed({ status: 'running', processedBooks: 550, totalBooks: 1000, rank: 0 });
    expect(row.item).toMatchObject({ status: 'running', percent: 55, done: null, total: null, position: null, startedAt: CREATED.toISOString() });
    expect((await listed({ status: 'running', processedBooks: 0, totalBooks: null })).item.percent).toBeNull();
  });

  it('dates finished scans by when they ended, and gives a failure its code', async () => {
    expect((await listed({ status: 'completed', completedAt: COMPLETED })).item).toMatchObject({
      status: 'completed',
      reason: null,
      finishedAt: COMPLETED.toISOString(),
    });
    expect((await listed({ status: 'failed', errorCode: 'scan_interrupted', completedAt: null })).item).toMatchObject({
      status: 'failed',
      reason: 'scan_interrupted',
      finishedAt: CREATED.toISOString(),
    });
  });

  it('counts with nothing ever needing a person or paused', async () => {
    const { source, scans } = makeSource();
    await expect(source.counts({ owner: null, cutoffAt: CREATED })).resolves.toEqual({
      queue: 3,
      needsYou: 0,
      failed: 1,
      running: 1,
      queued: 2,
      paused: 0,
    });
    expect(scans.countForJobs).toHaveBeenCalledWith(null, CREATED);
  });

  describe('describe', () => {
    it('names the scanned libraries and links the owner to the tool', async () => {
      const { source } = makeSource();
      const subjects = await source.describe([rowOf({}), rowOf({ id: 12, requestedLibraryId: 2, libraryIds: [2] })], viewerOf(deleter));
      expect(subjects.get('11')).toEqual({ label: 'Audiobooks, Novels', byline: null, url: '/tools/duplicate-books', image: null });
      expect(subjects.get('12')).toMatchObject({ label: 'Novels' });
    });

    it('leaves out libraries the viewer lost, and links nowhere for another account', async () => {
      const { source, libraries } = makeSource();
      libraries.findAccessibleLibraryIds.mockResolvedValue([3]);
      const subjects = await source.describe([rowOf({})], viewerOf(manager, true));
      expect(subjects.get('11')).toEqual({ label: 'Audiobooks', byline: null, url: null, image: null });
      libraries.findAccessibleLibraryIds.mockResolvedValue([]);
      expect((await source.describe([rowOf({})], viewerOf(manager, true))).size).toBe(0);
    });
  });

  it('offers nothing to do', () => {
    const { source } = makeSource();
    expect(source.actions()).toEqual({ actions: [], note: null });
  });

  it('refuses any action on a scan the viewer can see, and hides the rest', async () => {
    const { source, scans } = makeSource();
    const results = await source.act('cancel', ['11', '12', 'nope'], viewerOf(deleter));
    expect(results).toEqual([
      { id: '11', outcome: 'refused', status: null },
      { id: '12', outcome: 'not-found', status: null },
      { id: 'nope', outcome: 'not-found', status: null },
    ]);
    expect(scans.findScanOwners).toHaveBeenCalledWith([11, 12]);
    expect((await source.act('cancel', ['11'], viewerOf(merger)))[0]).toMatchObject({ outcome: 'not-found' });
    expect((await source.act('cancel', ['11'], viewerOf(manager, true)))[0]).toMatchObject({ outcome: 'refused' });
  });
});
