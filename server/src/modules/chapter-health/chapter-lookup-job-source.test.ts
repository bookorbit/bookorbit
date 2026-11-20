import { EMPTY_CONTENT_FILTER_RULES, Permission, type JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { JobPosition } from '../jobs/job-keyset';
import type { JobViewer, SourceListQuery } from '../jobs/job-source';
import type { ChapterLookupSummary } from './chapter-health.repository';
import { ChapterLookupJobSource } from './chapter-lookup-job-source';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const DAY_US = 24 * 60 * 60 * 1_000_000;
const micros = (iso: string) => Date.parse(iso) * 1000;
const TYPE_INDEX = 3;

function user(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 7,
    active: true,
    isSuperuser: false,
    permissions: [Permission.LibraryEditMetadata],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  } as RequestUser;
}

const OWNER = user();
const MANAGER = user({ id: 2, permissions: [Permission.ManageAppSettings, Permission.LibraryEditMetadata] });

function summary(overrides: Partial<ChapterLookupSummary> = {}): ChapterLookupSummary {
  return {
    userId: 7,
    userName: 'Sam Whitfield',
    queued: 0,
    processing: 0,
    review: 0,
    failed: 0,
    queueSince: null,
    reviewAt: null,
    failedAt: null,
    ...overrides,
  };
}

function setup(summaries: ChapterLookupSummary[] = []) {
  const registry = { register: vi.fn() };
  const chapterHealth = {
    jobSummaries: vi.fn().mockResolvedValue(summaries),
    clearQueuedFor: vi.fn().mockResolvedValue(3),
    dismissReviewsFor: vi.fn().mockResolvedValue(2),
    clearFailedFor: vi.fn().mockResolvedValue(1),
    retryFailedFor: vi.fn().mockResolvedValue(1),
  };
  const source = new ChapterLookupJobSource(registry as never, chapterHealth as never);
  return { source, registry, chapterHealth };
}

function viewer(of: RequestUser, source: ChapterLookupJobSource): JobViewer {
  return { user: of, access: source.access(of) };
}

function query(view: JobView, overrides: Partial<SourceListQuery> = {}): SourceListQuery {
  return {
    view,
    owner: { id: 7, ownerless: false },
    cutoffAt: new Date(NOW - 7 * 24 * 60 * 60 * 1000),
    after: null,
    typeIndex: TYPE_INDEX,
    limit: 51,
    ...overrides,
  };
}

const SAM_RUNNING = summary({ userId: 7, queued: 40, processing: 1, queueSince: micros('2026-11-14T10:00:00.000Z') });
const BEN_WAITING = summary({ userId: 9, userName: 'Ben Ortiz', queued: 5, queueSince: micros('2026-11-14T09:00:00.000Z') });
const CARA_WAITING = summary({ userId: 11, userName: 'Cara Lund', queued: 2, queueSince: micros('2026-11-14T11:00:00.000Z') });
const ORPHANS = summary({ userId: null, userName: null, review: 4, reviewAt: micros('2026-11-14T08:00:00.000Z') });

describe('ChapterLookupJobSource', () => {
  it('registers itself with the Jobs area', () => {
    const { source, registry } = setup();

    source.onModuleInit();

    expect(registry.register).toHaveBeenCalledWith(source);
  });

  describe('access', () => {
    it('lets anyone who may edit metadata see their own lookups, and managers everyone', () => {
      const { source } = setup();

      expect(source.access(OWNER)).toEqual({ own: true, all: false });
      expect(source.access(MANAGER)).toEqual({ own: true, all: true });
      expect(source.access(user({ isSuperuser: true, permissions: [] }))).toEqual({ own: true, all: true });
      expect(source.access(user({ permissions: [] }))).toEqual({ own: false, all: false });
      expect(source.access(user({ active: false, isSuperuser: true }))).toEqual({ own: false, all: false });
    });
  });

  describe('list', () => {
    it('gives each requester one Queue row: running ones first, then waiting ones oldest first', async () => {
      const { source, chapterHealth } = setup([CARA_WAITING, SAM_RUNNING, BEN_WAITING, ORPHANS]);
      const manager = viewer(MANAGER, source);

      const rows = await source.list(query('queue', { owner: null }), manager);

      expect(chapterHealth.jobSummaries).toHaveBeenCalledWith(MANAGER, null);
      expect(rows.map((row) => row.nativeId)).toEqual(['user-7.queue', 'user-9.queue', 'user-11.queue']);
      expect(rows.map((row) => row.key)).toEqual([
        { prefix: [0, 0], suffix: [0], id: 'user-7.queue' },
        { prefix: [1, 1], suffix: [BEN_WAITING.queueSince], id: 'user-9.queue' },
        { prefix: [1, 1], suffix: [CARA_WAITING.queueSince], id: 'user-11.queue' },
      ]);
      expect(rows[0]!.item).toEqual({
        kind: null,
        shape: 'queue',
        status: 'running',
        reason: null,
        phase: null,
        done: null,
        total: 41,
        percent: null,
        position: null,
        requester: { id: 7, name: 'Sam Whitfield' },
        cost: null,
        createdAt: '2026-11-14T10:00:00.000Z',
        startedAt: null,
        pausedAt: null,
        finishedAt: null,
        extra: null,
      });
      expect(rows[1]!.item.status).toBe('queued');
    });

    it('puts reviews in Needs you, newest first, with the count of books to review', async () => {
      const sam = summary({ review: 3, reviewAt: micros('2026-11-14T11:30:00.000Z') });
      const { source } = setup([ORPHANS, sam]);

      const rows = await source.list(query('needs-you', { owner: null }), viewer(MANAGER, source));

      expect(rows.map((row) => row.nativeId)).toEqual(['user-7.review', 'system.review']);
      expect(rows[0]!.key).toEqual({ prefix: [sam.reviewAt], suffix: [], id: 'user-7.review' });
      expect(rows[0]!.item).toMatchObject({ status: 'needs-you', reason: 'review', extra: { review: 3 }, createdAt: '2026-11-14T11:30:00.000Z' });
      expect(rows[1]!.item.requester).toBeNull();
    });

    it('puts failures in Failed by their latest failure, until a week passes with none', async () => {
      const recent = summary({ userId: 7, failed: 2, failedAt: micros('2026-11-13T12:00:00.000Z') });
      const stale = summary({ userId: 9, userName: 'Ben Ortiz', failed: 6, failedAt: micros('2026-11-14T12:00:00.000Z') - 8 * DAY_US });
      const { source } = setup([recent, stale]);

      const rows = await source.list(query('failed', { owner: null }), viewer(MANAGER, source));

      expect(rows.map((row) => row.nativeId)).toEqual(['user-7.failed']);
      expect(rows[0]!.item).toMatchObject({
        status: 'failed',
        reason: 'failed',
        finishedAt: '2026-11-13T12:00:00.000Z',
        extra: { failed: 2 },
      });
    });

    it('leaves History to the chapter health page', async () => {
      const { source, chapterHealth } = setup([summary({ failed: 1, failedAt: micros('2026-11-01T00:00:00.000Z') })]);

      await expect(source.list(query('history'), viewer(OWNER, source))).resolves.toEqual([]);
      expect(chapterHealth.jobSummaries).not.toHaveBeenCalled();
    });

    it('makes no row for a requester with nothing in that view', async () => {
      const { source } = setup([summary({ review: 2, reviewAt: micros('2026-11-14T11:00:00.000Z') })]);
      const owner = viewer(OWNER, source);

      await expect(source.list(query('queue'), owner)).resolves.toEqual([]);
      await expect(source.list(query('failed'), owner)).resolves.toEqual([]);
    });

    it('continues strictly after the cursor and stops at the limit', async () => {
      const { source } = setup([CARA_WAITING, SAM_RUNNING, BEN_WAITING]);
      const manager = viewer(MANAGER, source);
      const first = await source.list(query('queue', { owner: null, limit: 2 }), manager);
      const last = first.at(-1)!;
      const after: JobPosition = { ...last.key, typeIndex: TYPE_INDEX };

      const rest = await source.list(query('queue', { owner: null, after }), manager);

      expect(first.map((row) => row.nativeId)).toEqual(['user-7.queue', 'user-9.queue']);
      expect(rest.map((row) => row.nativeId)).toEqual(['user-11.queue']);
    });

    it("compares the cursor against other types' rows by type order", async () => {
      const { source } = setup([BEN_WAITING]);
      const manager = viewer(MANAGER, source);
      const band = { prefix: [1, 1], suffix: [0], id: 'zzz' };

      // A cursor on an earlier type in the same band leaves this row to come; one on a later type has passed it.
      await expect(source.list(query('queue', { owner: null, after: { ...band, typeIndex: TYPE_INDEX - 1 } }), manager)).resolves.toHaveLength(1);
      await expect(source.list(query('queue', { owner: null, after: { ...band, typeIndex: TYPE_INDEX + 1 } }), manager)).resolves.toHaveLength(0);
    });
  });

  describe('counts', () => {
    it('counts each summary row once, however many books it stands for', async () => {
      const { source } = setup([
        SAM_RUNNING,
        BEN_WAITING,
        ORPHANS,
        summary({ userId: 11, failed: 9, failedAt: micros('2026-11-14T00:00:00.000Z'), review: 1, reviewAt: micros('2026-11-14T00:00:00.000Z') }),
        summary({ userId: 12, failed: 3, failedAt: micros('2026-11-01T00:00:00.000Z') }),
      ]);

      await expect(source.counts({ owner: null, cutoffAt: new Date(NOW - 7 * 24 * 60 * 60 * 1000) }, viewer(MANAGER, source))).resolves.toEqual({
        queue: 2,
        running: 1,
        queued: 1,
        paused: 0,
        needsYou: 2,
        failed: 1,
      });
    });
  });

  describe('describe', () => {
    it('opens every row on the chapter health page', async () => {
      const { source } = setup([SAM_RUNNING]);
      const owner = viewer(OWNER, source);
      const rows = await source.list(query('queue'), owner);

      const subjects = await source.describe(rows);

      expect(subjects.get('user-7.queue')).toEqual({ label: null, byline: null, url: '/tools/chapter-health', image: null });
    });
  });

  describe('actions', () => {
    async function rowsFor(view: JobView, summaries: ChapterLookupSummary[]) {
      const { source } = setup(summaries);
      return { source, rows: await source.list(query(view, { owner: null }), viewer(MANAGER, source)) };
    }

    it('offers Cancel on a Queue row while books wait behind the running one', async () => {
      const { source, rows } = await rowsFor('queue', [
        SAM_RUNNING,
        summary({ userId: 9, processing: 1, queueSince: micros('2026-11-14T10:00:00.000Z') }),
      ]);

      expect(
        source.actions(
          rows.find((row) => row.ownerId === 7)!,
          viewer(OWNER, source),
        ),
      ).toEqual({ actions: ['cancel'], note: null });
      expect(
        source.actions(
          rows.find((row) => row.ownerId === 9)!,
          viewer(MANAGER, source),
        ),
      ).toEqual({ actions: [], note: null });
    });

    it('offers Dismiss on a review row and Retry or Dismiss on a failed row', async () => {
      const review = await rowsFor('needs-you', [summary({ review: 2, reviewAt: micros('2026-11-14T11:00:00.000Z') })]);
      const failed = await rowsFor('failed', [summary({ failed: 2, failedAt: micros('2026-11-14T11:00:00.000Z') })]);

      expect(review.source.actions(review.rows[0]!, viewer(OWNER, review.source)).actions).toEqual(['dismiss']);
      expect(failed.source.actions(failed.rows[0]!, viewer(OWNER, failed.source)).actions).toEqual(['retry', 'dismiss']);
    });

    it("offers a manager actions on anyone's rows, and the system rows", async () => {
      const { source, rows } = await rowsFor('needs-you', [ORPHANS]);

      expect(source.actions(rows[0]!, viewer(MANAGER, source)).actions).toEqual(['dismiss']);
      expect(source.actions(rows[0]!, viewer(OWNER, source)).actions).toEqual([]);
    });
  });

  describe('act', () => {
    it("clears one requester's waiting lookups for their owner", async () => {
      const { source, chapterHealth } = setup();

      await expect(source.act('cancel', ['user-7.queue'], viewer(OWNER, source))).resolves.toEqual([
        { id: 'user-7.queue', outcome: 'done', status: null },
      ]);
      expect(chapterHealth.clearQueuedFor).toHaveBeenCalledWith(OWNER, 7);
    });

    it('dismisses every review, and retries or clears every failure, of a row', async () => {
      const { source, chapterHealth } = setup();
      const owner = viewer(OWNER, source);

      await expect(source.act('dismiss', ['user-7.review'], owner)).resolves.toEqual([{ id: 'user-7.review', outcome: 'done', status: null }]);
      await expect(source.act('retry', ['user-7.failed'], owner)).resolves.toEqual([{ id: 'user-7.failed', outcome: 'done', status: 'queued' }]);
      await expect(source.act('dismiss', ['user-7.failed'], owner)).resolves.toEqual([{ id: 'user-7.failed', outcome: 'done', status: null }]);

      expect(chapterHealth.dismissReviewsFor).toHaveBeenCalledWith(OWNER, 7);
      expect(chapterHealth.retryFailedFor).toHaveBeenCalledWith(OWNER, 7);
      expect(chapterHealth.clearFailedFor).toHaveBeenCalledWith(OWNER, 7);
    });

    it("lets a manager act on another account's rows and on the system rows", async () => {
      const { source, chapterHealth } = setup();

      const results = await source.act('dismiss', ['user-8.review', 'system.review'], viewer(MANAGER, source));

      expect(results.map((result) => result.outcome)).toEqual(['done', 'done']);
      expect(chapterHealth.dismissReviewsFor.mock.calls).toEqual([
        [MANAGER, 8],
        [MANAGER, null],
      ]);
    });

    it("treats another account's rows, the system rows and malformed ids as missing for a non-manager", async () => {
      const { source, chapterHealth } = setup();

      const results = await source.act('cancel', ['user-8.queue', 'system.queue', 'user-0.queue', 'user-7.history', 'nobody'], viewer(OWNER, source));

      expect(results.map((result) => result.outcome)).toEqual(['not-found', 'not-found', 'not-found', 'not-found', 'not-found']);
      expect(chapterHealth.clearQueuedFor).not.toHaveBeenCalled();
    });

    it('skips an action the row does not offer, and a row with nothing left to change', async () => {
      const { source, chapterHealth } = setup();
      chapterHealth.clearQueuedFor.mockResolvedValue(0);
      const owner = viewer(OWNER, source);

      await expect(source.act('retry', ['user-7.review'], owner)).resolves.toEqual([{ id: 'user-7.review', outcome: 'skipped', status: null }]);
      await expect(source.act('cancel', ['user-7.queue'], owner)).resolves.toEqual([{ id: 'user-7.queue', outcome: 'skipped', status: null }]);
      expect(chapterHealth.retryFailedFor).not.toHaveBeenCalled();
    });

    it('acts once per row however often it is named, answering every id', async () => {
      const { source, chapterHealth } = setup();

      const results = await source.act('dismiss', ['user-7.review', 'user-7.review'], viewer(OWNER, source));

      expect(results).toHaveLength(2);
      expect(chapterHealth.dismissReviewsFor).toHaveBeenCalledTimes(1);
    });

    it('reports a failed action as an error without failing the others', async () => {
      const { source, chapterHealth } = setup();
      chapterHealth.dismissReviewsFor.mockRejectedValueOnce(new Error('connection terminated'));

      const results = await source.act('dismiss', ['user-7.review', 'user-7.failed'], viewer(OWNER, source));

      expect(results).toEqual([
        { id: 'user-7.review', outcome: 'error', status: null },
        { id: 'user-7.failed', outcome: 'done', status: null },
      ]);
    });
  });
});
