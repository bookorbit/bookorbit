import { Permission, type JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { JobPosition } from '../jobs/job-keyset';
import type { SourceListQuery } from '../jobs/job-source';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import type { BookMetadataFetchJobCounts } from './book-metadata-fetch-queue.repository';
import { METADATA_FETCH_FAILED_VISIBLE_MS, MetadataFetchJobSource, type MetadataFetchJobRow } from './metadata-fetch-job-source';

function user(id: number, permissions: Permission[] = [], isSuperuser = false, active = true): RequestUser {
  return { id, active, isSuperuser, permissions } as unknown as RequestUser;
}

const configurer = user(3, [Permission.ManageMetadataConfig]);
const settingsManager = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);
const reader = user(9, [Permission.LibraryGenerateReadAloud]);

const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const TYPE_INDEX = 8;
const microseconds = (iso: string) => Date.parse(iso) * 1000;
const QUEUED_SINCE = microseconds('2026-11-15T10:00:00.000Z');
const FAILED_AT = microseconds('2026-11-15T11:30:00.000Z');

function counts(change: Partial<BookMetadataFetchJobCounts> = {}): BookMetadataFetchJobCounts {
  return { queued: 0, processing: 0, failed: 0, queueSince: null, failedAt: null, ...change };
}

const RUNNING = counts({ queued: 40, processing: 1, queueSince: QUEUED_SINCE });
const FAILING = counts({ failed: 6, failedAt: FAILED_AT });

interface Setup {
  state?: BookMetadataFetchJobCounts;
  paused?: boolean;
  session?: { sessionTotal: number; sessionDone: number; currentItemName: string | null };
}

function makeSource({ state = counts(), paused = false, session = { sessionTotal: 0, sessionDone: 0, currentItemName: null } }: Setup = {}) {
  const registry = new JobSourceRegistry();
  const queueRepo = { countForJobs: vi.fn(() => Promise.resolve(state)) };
  const configService = { isPaused: vi.fn(() => Promise.resolve(paused)) };
  const sessionService = { getSnapshot: vi.fn(() => session) };
  const orchestrator = {
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    cancelPending: vi.fn(() => Promise.resolve()),
    requeueFailed: vi.fn(() => Promise.resolve(state.failed)),
  };
  const source = new MetadataFetchJobSource(registry, queueRepo as never, configService as never, sessionService as never, orchestrator as never);
  source.onModuleInit();
  return { source, registry, queueRepo, configService, orchestrator };
}

function viewerOf(who: RequestUser) {
  return { user: who, access: makeSource().source.access(who) };
}

function query(view: JobView, change: Partial<SourceListQuery> = {}): SourceListQuery {
  return { view, owner: null, cutoffAt: new Date(NOW - METADATA_FETCH_FAILED_VISIBLE_MS), after: null, typeIndex: TYPE_INDEX, limit: 51, ...change };
}

async function only(setup: Setup, view: JobView = 'queue'): Promise<MetadataFetchJobRow> {
  const rows = await makeSource(setup).source.list(query(view));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('MetadataFetchJobSource', () => {
  it('registers itself as the metadata-fetch type', () => {
    const { source, registry } = makeSource();
    expect(registry.get('metadata-fetch')).toBe(source);
  });

  it('shows the rows to metadata and settings managers only, and to nobody as their own', () => {
    const { source } = makeSource();
    expect(source.access(configurer)).toEqual({ own: false, all: true });
    expect(source.access(settingsManager)).toEqual({ own: false, all: true });
    expect(source.access(admin)).toEqual({ own: false, all: true });
    expect(source.access(reader)).toEqual({ own: false, all: false });
    expect(source.access(user(3, [Permission.ManageMetadataConfig], false, false))).toEqual({ own: false, all: false });
  });

  describe('queue row', () => {
    it('stands for the running queue with the session progress', async () => {
      const row = await only({ state: RUNNING, session: { sessionTotal: 50, sessionDone: 9, currentItemName: 'Dune' } });

      expect(row.nativeId).toBe('queue');
      expect(row.key).toEqual({ prefix: [0, 0], suffix: [QUEUED_SINCE], id: 'queue' });
      expect(row.item).toEqual({
        kind: null,
        shape: 'queue',
        status: 'running',
        reason: null,
        phase: null,
        done: 9,
        total: 50,
        percent: null,
        position: null,
        requester: null,
        cost: null,
        createdAt: '2026-11-15T10:00:00.000Z',
        startedAt: null,
        pausedAt: null,
        finishedAt: null,
        extra: null,
      });
    });

    it('is queued in the first band while no book is being fetched', async () => {
      const row = await only({
        state: counts({ queued: 12, queueSince: QUEUED_SINCE }),
        session: { sessionTotal: 12, sessionDone: 0, currentItemName: null },
      });

      expect(row.item.status).toBe('queued');
      expect(row.key.prefix).toEqual([1, 1]);
    });

    it('is paused whenever the pause flag is set, even while the last book finishes', async () => {
      const row = await only({ state: RUNNING, paused: true });

      expect(row.item.status).toBe('paused');
      expect(row.key.prefix).toEqual([2, 0]);
    });

    it('shows only what remains once the session has reset', async () => {
      const row = await only({ state: RUNNING });

      expect(row.item.done).toBeNull();
      expect(row.item.total).toBe(41);
    });

    it('is absent while nothing waits', async () => {
      const { source } = makeSource({ state: FAILING });
      await expect(source.list(query('queue'))).resolves.toEqual([]);
    });
  });

  describe('failed row', () => {
    it('carries the failure count and finishes at the latest failure', async () => {
      const row = await only({ state: FAILING }, 'failed');

      expect(row.nativeId).toBe('failed');
      expect(row.key).toEqual({ prefix: [FAILED_AT], suffix: [], id: 'failed' });
      expect(row.item).toMatchObject({
        shape: 'queue',
        status: 'failed',
        reason: 'failed',
        done: null,
        total: null,
        createdAt: '2026-11-15T11:30:00.000Z',
        finishedAt: '2026-11-15T11:30:00.000Z',
        extra: { failed: 6 },
      });
    });

    it('leaves Failed once a week passes with no new failure', async () => {
      const { source } = makeSource({ state: FAILING });
      const cutoffAt = new Date(FAILED_AT / 1000);

      await expect(source.list(query('failed', { cutoffAt }))).resolves.toEqual([]);
      await expect(source.counts({ owner: null, cutoffAt })).resolves.toMatchObject({ failed: 0 });
    });
  });

  it('has no rows in Needs you or History and reads nothing for them', async () => {
    const { source, queueRepo } = makeSource({ state: { ...RUNNING, failed: 6, failedAt: FAILED_AT } });

    await expect(source.list(query('needs-you'))).resolves.toEqual([]);
    await expect(source.list(query('history'))).resolves.toEqual([]);
    expect(queueRepo.countForJobs).not.toHaveBeenCalled();
  });

  it('lists the ownerless rows only for reads that cover them', async () => {
    const { source, queueRepo } = makeSource({ state: RUNNING });

    await expect(source.list(query('queue', { owner: { id: 3, ownerless: false } }))).resolves.toEqual([]);
    await expect(source.counts({ owner: { id: 3, ownerless: false }, cutoffAt: new Date(0) })).resolves.toMatchObject({ queue: 0 });
    expect(queueRepo.countForJobs).not.toHaveBeenCalled();
    await expect(source.list(query('queue', { owner: { id: 3, ownerless: true } }))).resolves.toHaveLength(1);
  });

  it('keeps a row only when it comes strictly after the cursor', async () => {
    const { source } = makeSource({ state: { ...RUNNING, failed: 6, failedAt: FAILED_AT } });
    const at = (view: JobView, after: JobPosition) => source.list(query(view, { after }));

    await expect(at('queue', { prefix: [0, 0], suffix: [QUEUED_SINCE], id: 'queue', typeIndex: TYPE_INDEX })).resolves.toEqual([]);
    await expect(at('queue', { prefix: [0, 0], suffix: [0], id: 'x', typeIndex: TYPE_INDEX + 1 })).resolves.toEqual([]);
    await expect(at('queue', { prefix: [0, 0], suffix: [0], id: 'x', typeIndex: TYPE_INDEX - 1 })).resolves.toHaveLength(1);
    await expect(at('queue', { prefix: [1, 1], suffix: [0], id: 'x', typeIndex: 0 })).resolves.toEqual([]);

    await expect(at('failed', { prefix: [FAILED_AT + 1], suffix: [], id: 'x', typeIndex: 0 })).resolves.toHaveLength(1);
    await expect(at('failed', { prefix: [FAILED_AT], suffix: [], id: 'failed', typeIndex: TYPE_INDEX })).resolves.toEqual([]);
    await expect(at('failed', { prefix: [FAILED_AT - 1], suffix: [], id: 'x', typeIndex: 0 })).resolves.toEqual([]);
  });

  it('counts each summary row once in its view', async () => {
    const both = { ...RUNNING, failed: 6, failedAt: FAILED_AT };
    const cutoffAt = new Date(NOW - METADATA_FETCH_FAILED_VISIBLE_MS);

    await expect(makeSource({ state: both }).source.counts({ owner: null, cutoffAt })).resolves.toEqual({
      queue: 1,
      needsYou: 0,
      failed: 1,
      running: 1,
      queued: 0,
      paused: 0,
    });
    await expect(makeSource({ state: RUNNING, paused: true }).source.counts({ owner: null, cutoffAt })).resolves.toEqual({
      queue: 1,
      needsYou: 0,
      failed: 0,
      running: 0,
      queued: 0,
      paused: 1,
    });
    await expect(makeSource().source.counts({ owner: null, cutoffAt })).resolves.toEqual({
      queue: 0,
      needsYou: 0,
      failed: 0,
      running: 0,
      queued: 0,
      paused: 0,
    });
  });

  it('links to the settings page for viewers who may open it and names the book being fetched', async () => {
    const setup = { state: RUNNING, session: { sessionTotal: 50, sessionDone: 9, currentItemName: 'Dune' } };
    const { source } = makeSource(setup);
    const rows = await source.list(query('queue'));

    await expect(source.describe(rows, viewerOf(configurer))).resolves.toEqual(
      new Map([['queue', { label: null, byline: 'Dune', url: '/settings/metadata/auto-fetch', image: null }]]),
    );
    await expect(source.describe(rows, viewerOf(settingsManager))).resolves.toEqual(
      new Map([['queue', { label: null, byline: 'Dune', url: null, image: null }]]),
    );
    const paused = await makeSource({ ...setup, paused: true }).source.list(query('queue'));
    expect((await source.describe(paused, viewerOf(admin))).get('queue')?.byline).toBeNull();
  });

  describe('actions', () => {
    it('offers pause and cancel on a running queue and resume on a paused one', async () => {
      const { source } = makeSource();
      const running = await only({ state: RUNNING });
      const paused = await only({ state: RUNNING, paused: true });
      const finishing = await only({ state: counts({ processing: 1, queueSince: QUEUED_SINCE }), paused: true });

      expect(source.actions(running, viewerOf(configurer))).toEqual({ actions: ['pause', 'cancel'], note: null });
      expect(source.actions(paused, viewerOf(admin))).toEqual({ actions: ['resume', 'cancel'], note: null });
      expect(source.actions(finishing, viewerOf(configurer))).toEqual({ actions: ['resume'], note: null });
    });

    it('offers retry on the failed row', async () => {
      const { source } = makeSource();
      expect(source.actions(await only({ state: FAILING }, 'failed'), viewerOf(configurer))).toEqual({ actions: ['retry'], note: null });
    });

    it('explains to a settings manager that the metadata settings permission is needed', async () => {
      const { source } = makeSource();
      expect(source.actions(await only({ state: RUNNING }), viewerOf(settingsManager))).toEqual({ actions: [], note: 'metadata-config' });
      expect(source.actions(await only({ state: FAILING }, 'failed'), viewerOf(settingsManager))).toEqual({ actions: [], note: 'metadata-config' });
    });
  });

  describe('act', () => {
    it('pauses, resumes and cancels through the orchestrator', async () => {
      const running = makeSource({ state: RUNNING });
      await expect(running.source.act('pause', ['queue'], viewerOf(configurer))).resolves.toEqual([
        { id: 'queue', outcome: 'done', status: 'paused' },
      ]);
      expect(running.orchestrator.pause).toHaveBeenCalledTimes(1);

      await expect(running.source.act('cancel', ['queue'], viewerOf(configurer))).resolves.toEqual([
        { id: 'queue', outcome: 'done', status: 'paused' },
      ]);
      expect(running.orchestrator.cancelPending).toHaveBeenCalledTimes(1);

      const idle = makeSource({ state: counts({ queued: 3, queueSince: QUEUED_SINCE }), paused: true });
      await expect(idle.source.act('resume', ['queue'], viewerOf(admin))).resolves.toEqual([{ id: 'queue', outcome: 'done', status: 'queued' }]);
      expect(idle.orchestrator.resume).toHaveBeenCalledTimes(1);
      await expect(idle.source.act('cancel', ['queue'], viewerOf(admin))).resolves.toEqual([{ id: 'queue', outcome: 'done', status: 'cancelled' }]);
    });

    it('retries every failure', async () => {
      const { source, orchestrator } = makeSource({ state: FAILING });

      await expect(source.act('retry', ['failed'], viewerOf(configurer))).resolves.toEqual([{ id: 'failed', outcome: 'done', status: 'queued' }]);
      expect(orchestrator.requeueFailed).toHaveBeenCalledTimes(1);

      orchestrator.requeueFailed.mockResolvedValueOnce(0);
      await expect(source.act('retry', ['failed'], viewerOf(configurer))).resolves.toEqual([{ id: 'failed', outcome: 'skipped', status: null }]);
    });

    it('refuses a settings manager and changes nothing', async () => {
      const { source, orchestrator } = makeSource({ state: { ...RUNNING, failed: 6, failedAt: FAILED_AT } });

      await expect(source.act('pause', ['queue'], viewerOf(settingsManager))).resolves.toEqual([
        { id: 'queue', outcome: 'refused', status: 'running' },
      ]);
      await expect(source.act('retry', ['failed'], viewerOf(settingsManager))).resolves.toEqual([
        { id: 'failed', outcome: 'refused', status: 'failed' },
      ]);
      expect(orchestrator.pause).not.toHaveBeenCalled();
      expect(orchestrator.requeueFailed).not.toHaveBeenCalled();
    });

    it('skips actions the row state does not allow and rows that have gone', async () => {
      const { source, orchestrator } = makeSource({ state: RUNNING });

      await expect(source.act('resume', ['queue', 'failed'], viewerOf(configurer))).resolves.toEqual([
        { id: 'queue', outcome: 'skipped', status: 'running' },
        { id: 'failed', outcome: 'skipped', status: null },
      ]);
      await expect(source.act('retry', ['queue'], viewerOf(configurer))).resolves.toEqual([{ id: 'queue', outcome: 'skipped', status: 'running' }]);
      expect(orchestrator.resume).not.toHaveBeenCalled();
      expect(orchestrator.requeueFailed).not.toHaveBeenCalled();
    });

    it('does not find unknown rows, nor any row for a viewer who cannot see them', async () => {
      const { source, queueRepo } = makeSource({ state: RUNNING });

      await expect(source.act('pause', ['user-3.queue', 'queue'], viewerOf(configurer))).resolves.toEqual([
        { id: 'user-3.queue', outcome: 'not-found', status: null },
        { id: 'queue', outcome: 'done', status: 'paused' },
      ]);
      queueRepo.countForJobs.mockClear();
      await expect(source.act('pause', ['queue'], viewerOf(reader))).resolves.toEqual([{ id: 'queue', outcome: 'not-found', status: null }]);
      expect(queueRepo.countForJobs).not.toHaveBeenCalled();
    });

    it('answers every id once per position, acting once for repeats', async () => {
      const { source, orchestrator } = makeSource({ state: RUNNING });

      await expect(source.act('pause', ['queue', 'queue'], viewerOf(configurer))).resolves.toEqual([
        { id: 'queue', outcome: 'done', status: 'paused' },
        { id: 'queue', outcome: 'done', status: 'paused' },
      ]);
      expect(orchestrator.pause).toHaveBeenCalledTimes(1);
    });

    it('reports an error when the orchestrator fails', async () => {
      const { source, orchestrator } = makeSource({ state: RUNNING });
      orchestrator.pause.mockRejectedValueOnce(new Error('database unavailable'));

      await expect(source.act('pause', ['queue'], viewerOf(configurer))).resolves.toEqual([{ id: 'queue', outcome: 'error', status: null }]);
    });
  });
});
