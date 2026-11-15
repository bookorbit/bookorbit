import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { JobOwnerFilter, SourceListQuery } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { LIBRARY_SCAN_FAILED_WINDOW_MS, LibraryScanJobSource, managesScans } from './library-scan-job-source';
import { ScanJobStore } from './scan-job-store.service';
import type { ScanJobPageRow } from './scanner.repository';

function user(id: number, permissions: Permission[] = [], isSuperuser = false, active = true): RequestUser {
  return { id, active, isSuperuser, permissions } as unknown as RequestUser;
}

const librarian = user(3, [Permission.ManageLibraries]);
const operator = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);
const reader = user(9, [Permission.LibraryEditMetadata]);

const STARTED = new Date('2026-11-15T10:00:00.000Z');
const FINISHED = new Date('2026-11-15T10:05:00.000Z');
const CUTOFF = new Date('2026-11-08T12:00:00.000Z');

function scan(change: Partial<ScanJobPageRow> = {}): ScanJobPageRow {
  return {
    id: 41,
    libraryId: 5,
    status: 'running',
    triggeredBy: 'manual',
    startedAt: STARTED,
    completedAt: null,
    key: { prefix: [0, 0], suffix: [STARTED.getTime() * 1000], id: 41 },
    ...change,
  };
}

function makeSource(visible: number[] | null = null) {
  const registry = new JobSourceRegistry();
  const store = new ScanJobStore();
  const scans = {
    pageForJobs: vi.fn((): Promise<ScanJobPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ running: 2, failed: 1 })),
    findLibraryNames: vi.fn(() => Promise.resolve(new Map([[5, 'Fiction']]))),
    findScanJobsByIds: vi.fn((): Promise<Pick<ScanJobPageRow, 'id' | 'libraryId' | 'status'>[]> => Promise.resolve([])),
  };
  const scope = {
    visibleIdsOrAll: vi.fn(() => Promise.resolve(visible)),
    filterVisible: vi.fn((_user: RequestUser, ids: readonly number[]) =>
      Promise.resolve(visible === null ? [...ids] : ids.filter((id) => visible.includes(id))),
    ),
  };
  const source = new LibraryScanJobSource(registry, scans as never, store, scope as never);
  source.onModuleInit();
  return { source, registry, store, scans, scope };
}

const viewerOf = (who: RequestUser) => ({ user: who, access: { own: false, all: managesScans(who) } });

function query(change: Partial<SourceListQuery> = {}): SourceListQuery {
  return { view: 'history', owner: null, cutoffAt: CUTOFF, after: null, typeIndex: 7, limit: 50, ...change };
}

async function listedItem(change: Partial<ScanJobPageRow>, prepare?: (store: ScanJobStore) => void) {
  const { source, scans, store } = makeSource();
  prepare?.(store);
  scans.pageForJobs.mockResolvedValue([scan(change)]);
  const [row] = await source.list(query(), viewerOf(admin));
  return row!;
}

describe('LibraryScanJobSource', () => {
  it('registers itself as the library-scan type with a seven-day Failed window', () => {
    const { source, registry } = makeSource();
    expect(registry.get('library-scan')).toBe(source);
    expect(source.failedWindowMs).toBe(LIBRARY_SCAN_FAILED_WINDOW_MS);
    expect(LIBRARY_SCAN_FAILED_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  describe('access', () => {
    it('gives no own rows, since scans belong to no account', () => {
      const { source } = makeSource();
      for (const who of [librarian, operator, admin, reader]) expect(source.access(who).own).toBe(false);
    });

    it('shows every scan to library managers, server managers and superusers', () => {
      const { source } = makeSource();
      expect(source.access(librarian).all).toBe(true);
      expect(source.access(operator).all).toBe(true);
      expect(source.access(admin).all).toBe(true);
      expect(source.access(reader).all).toBe(false);
    });

    it('shows nothing to a deactivated account', () => {
      const { source } = makeSource();
      expect(source.access(user(3, [Permission.ManageLibraries], false, false)).all).toBe(false);
      expect(source.access(user(1, [], true, false)).all).toBe(false);
    });
  });

  describe('list', () => {
    it('limits the read to the libraries the viewer can access and passes the cursor through', async () => {
      const { source, scans, scope } = makeSource([5, 8]);
      const after = { prefix: [10], suffix: [], id: 40, typeIndex: 7 };
      await source.list(query({ view: 'failed', after, limit: 25 }), viewerOf(librarian));
      expect(scope.visibleIdsOrAll).toHaveBeenCalledWith(librarian);
      expect(scans.pageForJobs).toHaveBeenCalledWith({ view: 'failed', libraryIds: [5, 8], cutoffAt: CUTOFF, after, typeIndex: 7, limit: 25 });
    });

    it('reads every library for a viewer who sees them all', async () => {
      const { source, scans } = makeSource(null);
      await source.list(query(), viewerOf(admin));
      expect(scans.pageForJobs).toHaveBeenCalledWith(expect.objectContaining({ libraryIds: null }));
    });

    it.each<[string, JobOwnerFilter]>([
      ['the everyone scope', null],
      ['mine with ownerless rows', { id: 3, ownerless: true }],
    ])('lists scans for %s', async (_label, owner) => {
      const { source, scans } = makeSource();
      scans.pageForJobs.mockResolvedValue([scan()]);
      await expect(source.list(query({ owner }), viewerOf(librarian))).resolves.toHaveLength(1);
    });

    it('holds nothing for a read of one account without the ownerless rows, or a viewer without access', async () => {
      const { source, scans } = makeSource();
      scans.pageForJobs.mockResolvedValue([scan()]);
      await expect(source.list(query({ owner: { id: 9, ownerless: false } }), viewerOf(librarian))).resolves.toEqual([]);
      await expect(source.list(query(), viewerOf(reader))).resolves.toEqual([]);
      expect(scans.pageForJobs).not.toHaveBeenCalled();
    });

    it('keys rows by the scan id and keeps the repository key', async () => {
      const row = await listedItem({});
      expect(row.nativeId).toBe('41');
      expect(row.key).toEqual({ prefix: [0, 0], suffix: [STARTED.getTime() * 1000], id: 41 });
    });

    it('maps a running scan with live progress from the store', async () => {
      const row = await listedItem({ triggeredBy: 'schedule' }, (store) => {
        store.create(41, 5, 200, 'schedule');
        store.increment(5, { processed: 30 });
      });
      expect(row.item).toEqual({
        kind: 'schedule',
        shape: 'job',
        status: 'running',
        reason: null,
        phase: null,
        done: 30,
        total: 200,
        percent: null,
        position: null,
        requester: null,
        cost: null,
        createdAt: STARTED.toISOString(),
        startedAt: STARTED.toISOString(),
        pausedAt: null,
        finishedAt: null,
        extra: null,
      });
    });

    it('leaves progress unknown until the scan has counted its files', async () => {
      const row = await listedItem({}, (store) => store.create(41, 5, 0, 'manual'));
      expect(row.item).toMatchObject({ status: 'running', done: null, total: null });
    });

    it('ignores store progress that belongs to a newer scan of the same library', async () => {
      const row = await listedItem({}, (store) => {
        store.create(99, 5, 200, 'manual');
        store.increment(5, { processed: 30 });
      });
      expect(row.item).toMatchObject({ done: null, total: null });
    });

    it('maps a completed scan without progress and with its finish time', async () => {
      const row = await listedItem({ status: 'completed', triggeredBy: 'watcher', completedAt: FINISHED }, (store) =>
        store.create(41, 5, 10, 'watcher'),
      );
      expect(row.item).toMatchObject({
        kind: 'watcher',
        status: 'completed',
        reason: null,
        done: null,
        total: null,
        startedAt: null,
        finishedAt: FINISHED.toISOString(),
      });
    });

    it('maps a failed scan with the error reason', async () => {
      const row = await listedItem({ status: 'failed', completedAt: FINISHED });
      expect(row.item).toMatchObject({ status: 'failed', reason: 'error', finishedAt: FINISHED.toISOString() });
    });

    it('falls back to the start time for a finished scan with no completion time', async () => {
      const row = await listedItem({ status: 'failed', completedAt: null });
      expect(row.item.finishedAt).toBe(STARTED.toISOString());
    });
  });

  describe('counts', () => {
    it('counts running scans in the Queue and failed ones in Failed, in visible libraries', async () => {
      const { source, scans } = makeSource([5]);
      await expect(source.counts({ owner: null, cutoffAt: CUTOFF }, viewerOf(librarian))).resolves.toEqual({
        queue: 2,
        needsYou: 0,
        failed: 1,
        running: 2,
        queued: 0,
        paused: 0,
      });
      expect(scans.countForJobs).toHaveBeenCalledWith([5], CUTOFF);
    });

    it('counts nothing for a read of one account without the ownerless rows', async () => {
      const { source, scans } = makeSource();
      await expect(source.counts({ owner: { id: 3, ownerless: false }, cutoffAt: CUTOFF }, viewerOf(librarian))).resolves.toEqual({
        queue: 0,
        needsYou: 0,
        failed: 0,
        running: 0,
        queued: 0,
        paused: 0,
      });
      expect(scans.countForJobs).not.toHaveBeenCalled();
    });
  });

  describe('describe', () => {
    it('names each scan by its library and links to the library page', async () => {
      const { source, scans } = makeSource();
      const rows = [
        { nativeId: '41', key: scan().key, job: scan(), item: {} as never },
        { nativeId: '42', key: scan().key, job: scan({ id: 42 }), item: {} as never },
        { nativeId: '43', key: scan().key, job: scan({ id: 43, libraryId: 6 }), item: {} as never },
      ];
      const subjects = await source.describe(rows);
      expect(scans.findLibraryNames).toHaveBeenCalledWith([5, 6]);
      expect(subjects.get('41')).toEqual({ label: 'Fiction', byline: null, url: '/library/5', image: null });
      expect(subjects.get('42')).toEqual({ label: 'Fiction', byline: null, url: '/library/5', image: null });
      expect(subjects.has('43')).toBe(false);
    });
  });

  describe('actions', () => {
    it('offers no action and no note on any scan', () => {
      const { source } = makeSource();
      expect(source.actions()).toEqual({ actions: [], note: null });
    });

    it('skips an action on a visible scan and reports others as missing', async () => {
      const { source, scans } = makeSource([5]);
      scans.findScanJobsByIds.mockResolvedValue([
        { id: 41, libraryId: 5, status: 'failed' },
        { id: 42, libraryId: 6, status: 'completed' },
      ]);
      const results = await source.act('retry', ['41', '42', '43', 'abc', '99999999999'], viewerOf(librarian));
      expect(scans.findScanJobsByIds).toHaveBeenCalledWith([41, 42, 43]);
      expect(results).toEqual([
        { id: '41', outcome: 'skipped', status: 'failed' },
        { id: '42', outcome: 'not-found', status: null },
        { id: '43', outcome: 'not-found', status: null },
        { id: 'abc', outcome: 'not-found', status: null },
        { id: '99999999999', outcome: 'not-found', status: null },
      ]);
    });

    it('treats every scan as missing for a viewer without access', async () => {
      const { source, scans } = makeSource();
      await expect(source.act('cancel', ['41'], viewerOf(reader))).resolves.toEqual([{ id: '41', outcome: 'not-found', status: null }]);
      expect(scans.findScanJobsByIds).not.toHaveBeenCalled();
    });
  });
});
