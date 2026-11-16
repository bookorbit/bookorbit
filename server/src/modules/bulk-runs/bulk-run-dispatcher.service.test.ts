import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import { BulkRunStopped } from './bulk-run-actor.service';
import { BULK_RUN_FINISHED_KEPT_MS, BULK_RUN_INTERRUPTED_KEPT_MS, BulkRunDispatcher } from './bulk-run-dispatcher.service';
import type { BulkItemOutcome, BulkRunHandler } from './bulk-run-handler';
import { BulkRunHandlerRegistry } from './bulk-run-handler.registry';
import { BulkRunStreams } from './bulk-run-streams.service';
import type { EndedBulkRun } from './bulk-runs.repository';

const editor = { id: 7, active: true, isSuperuser: false, permissions: [Permission.LibraryEditMetadata] } as unknown as RequestUser;
const AT = new Date('2026-11-15T10:00:00.000Z');

function run(change: Partial<BulkRunRow> = {}): BulkRunRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'book-refresh-metadata',
    requestedBy: editor.id,
    credentialKind: 'session',
    apiKeyId: null,
    status: 'running',
    subjectIds: [10, 11, 12],
    options: {},
    total: 3,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    stats: {},
    failures: [],
    errorCode: null,
    error: null,
    cancelRequested: false,
    actorUsername: 'editor',
    actorIp: null,
    createdAt: AT,
    startedAt: AT,
    finishedAt: null,
    dismissedAt: null,
    ...change,
  };
}

function handler(change: Partial<BulkRunHandler<{ ready: true }>> = {}) {
  const value = {
    kind: 'book-refresh-metadata' as const,
    prepare: vi.fn((): Promise<{ state: { ready: true } } | 'busy'> => Promise.resolve({ state: { ready: true } })),
    processItem: vi.fn((id: number): Promise<BulkItemOutcome> => Promise.resolve({ outcome: 'succeeded', event: { bookId: id, success: true } })),
    finish: vi.fn(() => Promise.resolve()),
    doneEvent: vi.fn((row: BulkRunRow) => ({ done: true, processed: row.succeeded, failed: row.failed })),
    ...change,
  };
  return value;
}

function setup(options: { maxConcurrent?: number } = {}) {
  const registry = new BulkRunHandlerRegistry();
  const streams = new BulkRunStreams();
  const settled = new Map<string, BulkRunRow>();
  const repo = {
    interruptRunning: vi.fn(() => Promise.resolve([] as EndedBulkRun[])),
    claimNext: vi.fn((): Promise<{ run: BulkRunRow; firstStart: boolean } | null> => Promise.resolve(null)),
    releaseClaim: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(run({ status: 'queued' }))),
    recordItem: vi.fn(() => Promise.resolve(false)),
    cancelRequested: vi.fn(() => Promise.resolve(false)),
    findById: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(null)),
    settle: vi.fn((id: string, status: 'completed' | 'failed' | 'cancelled', failure?: { code: string; error: string | null }) => {
      const row = run({ id, status, finishedAt: AT, subjectIds: [], errorCode: failure?.code ?? null, succeeded: 3 });
      settled.set(id, row);
      return Promise.resolve(row);
    }),
    cancelQueued: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(run({ status: 'cancelled', subjectIds: [] }))),
    requestCancel: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(run({ cancelRequested: true }))),
    autoDismissInterrupted: vi.fn(() => Promise.resolve(0)),
    deleteFinished: vi.fn(() => Promise.resolve(0)),
  };
  const actors = {
    resolve: vi.fn((): Promise<RequestUser> => Promise.resolve(editor)),
    as: vi.fn(<T>(_actor: RequestUser, work: () => Promise<T>) => work()),
  };
  const jobChanges = { notify: vi.fn() };
  const notifier = { ended: vi.fn(() => Promise.resolve()), interrupted: vi.fn(() => Promise.resolve()) };
  const dispatcher = new BulkRunDispatcher(repo as never, registry, streams, actors as never, jobChanges as never, notifier as never, {
    maxConcurrent: options.maxConcurrent ?? 3,
  });
  return { dispatcher, registry, streams, repo, actors, jobChanges, notifier, settled };
}

function follow(streams: BulkRunStreams, runId: string) {
  const events: object[] = [];
  const sink = { write: vi.fn((event: object) => (events.push(event), true)), end: vi.fn() };
  streams.attach(runId, sink);
  return { events, sink };
}

async function boot(dispatcher: BulkRunDispatcher) {
  vi.spyOn(dispatcher, 'wake').mockImplementation(() => undefined);
  await dispatcher.onApplicationBootstrap();
}

describe('BulkRunDispatcher', () => {
  it('starts nothing before boot has marked interrupted runs', async () => {
    const { dispatcher, repo } = setup();
    await dispatcher.tick();
    expect(repo.claimNext).not.toHaveBeenCalled();
  });

  it('marks runs left running as interrupted at boot and tells their owners', async () => {
    const { dispatcher, repo, jobChanges, notifier } = setup();
    const interrupted = [
      run({ id: 'a', status: 'interrupted' }),
      run({ id: 'b', status: 'interrupted' }),
      run({ id: 'c', requestedBy: null, status: 'interrupted' }),
    ];
    repo.interruptRunning.mockResolvedValue(interrupted);
    await boot(dispatcher);
    expect(jobChanges.notify).toHaveBeenCalledTimes(2);
    expect(jobChanges.notify).toHaveBeenCalledWith({ type: 'bulk-run', ownerId: 7, state: true });
    expect(jobChanges.notify).toHaveBeenCalledWith({ type: 'bulk-run', ownerId: null, state: true });
    expect(notifier.interrupted).toHaveBeenCalledWith(interrupted);
  });

  it('tells the notifier whether a tab watched the run end', async () => {
    const { dispatcher, registry, streams, repo, notifier } = setup();
    registry.register(handler());
    const watched = run({ id: 'watched' });
    const unwatched = run({ id: 'unwatched' });
    repo.claimNext
      .mockResolvedValueOnce({ run: watched, firstStart: true })
      .mockResolvedValueOnce({ run: unwatched, firstStart: true })
      .mockResolvedValue(null);
    follow(streams, watched.id);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(notifier.ended).toHaveBeenCalledWith(expect.objectContaining({ id: 'watched', status: 'completed' }), {
      watched: true,
      completionHandled: false,
    });
    expect(notifier.ended).toHaveBeenCalledWith(expect.objectContaining({ id: 'unwatched', status: 'completed' }), {
      watched: false,
      completionHandled: false,
    });
  });

  it('leaves a completed run to a kind that reports its own completion', async () => {
    const { dispatcher, registry, repo, notifier } = setup();
    registry.register({ ...handler(), notifiesCompletion: true });
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(notifier.ended).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }), { watched: false, completionHandled: true });
  });

  it('works every item from where the run stopped, streams each event and ends with done', async () => {
    const { dispatcher, registry, streams, repo } = setup();
    const kind = handler();
    registry.register(kind);
    const claimed = run({ processed: 1 });
    repo.claimNext.mockResolvedValueOnce({ run: claimed, firstStart: false }).mockResolvedValue(null);
    const followed = follow(streams, claimed.id);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(kind.processItem.mock.calls.map(([id]) => id)).toEqual([11, 12]);
    expect(repo.recordItem).toHaveBeenCalledTimes(2);
    expect(repo.settle).toHaveBeenCalledWith(claimed.id, 'completed', undefined);
    expect(kind.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }), { ready: true }, 'completed');
    expect(followed.events).toEqual([
      { bookId: 11, success: true },
      { bookId: 12, success: true },
      { done: true, processed: 3, failed: 0 },
    ]);
    expect(followed.sink.end).toHaveBeenCalled();
  });

  it('records a thrown item as failed and keeps going', async () => {
    const { dispatcher, registry, repo } = setup();
    const kind = handler({
      processItem: vi.fn((id: number) => (id === 11 ? Promise.reject(new Error('disk full')) : Promise.resolve({ outcome: 'succeeded' as const }))),
    });
    registry.register(kind);
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(repo.recordItem).toHaveBeenCalledWith(run().id, {
      outcome: 'failed',
      stats: undefined,
      failure: { id: 11, code: 'error', message: 'disk full' },
    });
    expect(repo.settle).toHaveBeenCalledWith(run().id, 'completed', undefined);
  });

  it('stops before the next item once a cancel is recorded', async () => {
    const { dispatcher, registry, repo, streams } = setup();
    const kind = handler();
    registry.register(kind);
    repo.recordItem.mockResolvedValueOnce(true);
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    const followed = follow(streams, run().id);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(kind.processItem).toHaveBeenCalledTimes(1);
    expect(repo.settle).toHaveBeenCalledWith(run().id, 'cancelled', undefined);
    expect(kind.finish).toHaveBeenCalledWith(expect.anything(), { ready: true }, 'cancelled');
    expect(followed.events.at(-1)).toEqual({ done: true, processed: 3, failed: 0 });
  });

  it('fails the run without a done event when its key is revoked', async () => {
    const { dispatcher, registry, repo, actors, streams } = setup();
    const kind = handler();
    registry.register(kind);
    const ids = Array.from({ length: 150 }, (_, index) => index + 1);
    actors.resolve.mockResolvedValueOnce(editor).mockRejectedValue(new BulkRunStopped('credential-revoked'));
    repo.claimNext.mockResolvedValueOnce({ run: run({ subjectIds: ids, total: ids.length }), firstStart: true }).mockResolvedValue(null);
    const followed = follow(streams, run().id);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(kind.processItem).toHaveBeenCalledTimes(100);
    expect(repo.settle).toHaveBeenCalledWith(run().id, 'failed', { code: 'credential-revoked', error: null });
    expect(kind.finish).toHaveBeenCalledWith(expect.anything(), { ready: true }, 'failed');
    expect(followed.events.some((event) => 'done' in event)).toBe(false);
    expect(followed.sink.end).toHaveBeenCalled();
  });

  it('puts a busy run back in line and tries the next one in the same tick', async () => {
    const { dispatcher, registry, repo } = setup();
    const busy = run({ id: '22222222-2222-4222-8222-222222222222', kind: 'book-move' });
    registry.register(handler({ kind: 'book-move' as never, prepare: vi.fn(() => Promise.resolve('busy' as const)) }));
    registry.register(handler());
    repo.claimNext
      .mockResolvedValueOnce({ run: busy, firstStart: true })
      .mockResolvedValueOnce({ run: run(), firstStart: true })
      .mockResolvedValue(null);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(repo.releaseClaim).toHaveBeenCalledWith(busy.id, true);
    expect(repo.claimNext).toHaveBeenNthCalledWith(2, [busy.id]);
    expect(repo.settle).toHaveBeenCalledWith(run().id, 'completed', undefined);
  });

  it('never runs more than the configured number at once', async () => {
    const { dispatcher, registry, repo } = setup({ maxConcurrent: 2 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    registry.register(handler({ processItem: vi.fn(() => gate.then(() => ({ outcome: 'succeeded' as const }))) }));
    const ids = ['a', 'b', 'c'].map((letter) => `${letter.repeat(8)}-aaaa-4aaa-8aaa-${letter.repeat(12)}`);
    for (const id of ids) repo.claimNext.mockResolvedValueOnce({ run: run({ id }), firstStart: true });
    await boot(dispatcher);
    await dispatcher.tick();

    expect(dispatcher.activeRunIds).toEqual(ids.slice(0, 2));
    release();
    await dispatcher.idle();
  });

  it('fails a run whose account may no longer do this before it starts', async () => {
    const { dispatcher, registry, repo, actors } = setup();
    const kind = handler();
    registry.register(kind);
    actors.resolve.mockRejectedValue(new BulkRunStopped('access-revoked'));
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    await boot(dispatcher);
    await dispatcher.tick();

    expect(kind.prepare).not.toHaveBeenCalled();
    expect(repo.settle).toHaveBeenCalledWith(run().id, 'failed', { code: 'access-revoked', error: null });
    expect(kind.finish).toHaveBeenCalledWith(expect.anything(), null, 'failed');
  });

  it('cancels a waiting run at once and ends its stream with done', async () => {
    const { dispatcher, registry, repo, streams } = setup();
    const kind = handler();
    registry.register(kind);
    const followed = follow(streams, run().id);
    const cancelled = await dispatcher.cancel(run().id);

    expect(cancelled?.status).toBe('cancelled');
    expect(kind.finish).toHaveBeenCalledWith(expect.anything(), null, 'cancelled');
    expect(followed.events).toEqual([{ done: true, processed: 0, failed: 0 }]);
    expect(repo.requestCancel).not.toHaveBeenCalled();
  });

  it('asks a run claimed meanwhile to stop instead', async () => {
    const { dispatcher, repo } = setup();
    repo.cancelQueued.mockResolvedValue(null);
    const result = await dispatcher.cancel(run().id);
    expect(repo.requestCancel).toHaveBeenCalledWith(run().id);
    expect(result?.cancelRequested).toBe(true);
  });

  it('tries again when the run moved back to waiting between the two steps', async () => {
    const { dispatcher, repo } = setup();
    repo.cancelQueued.mockResolvedValueOnce(null).mockResolvedValueOnce(run({ status: 'cancelled', subjectIds: [] }));
    repo.requestCancel.mockResolvedValueOnce(null);
    repo.findById.mockResolvedValueOnce(run({ status: 'queued' }));
    const result = await dispatcher.cancel(run().id);

    expect(repo.cancelQueued).toHaveBeenCalledTimes(2);
    expect(result?.status).toBe('cancelled');
  });

  it('answers null when the run ended before it could be cancelled', async () => {
    const { dispatcher, repo } = setup();
    repo.cancelQueued.mockResolvedValue(null);
    repo.requestCancel.mockResolvedValue(null);
    repo.findById.mockResolvedValue(run({ status: 'completed' }));
    expect(await dispatcher.cancel(run().id)).toBeNull();
    expect(repo.cancelQueued).toHaveBeenCalledTimes(1);
  });

  it('reaches a run that is still preparing', async () => {
    const { dispatcher, registry, repo } = setup();
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => (ready = resolve));
    const kind = handler({ prepare: vi.fn(() => gate.then(() => ({ state: { ready: true as const } }))) });
    registry.register(kind);
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    repo.cancelQueued.mockResolvedValue(null);
    await boot(dispatcher);
    const ticking = dispatcher.tick();
    await vi.waitFor(() => expect(kind.prepare).toHaveBeenCalled());
    await dispatcher.cancel(run().id);
    ready();
    await ticking;
    await dispatcher.idle();

    expect(kind.processItem).not.toHaveBeenCalled();
    expect(repo.settle).toHaveBeenCalledWith(run().id, 'cancelled', undefined);
  });

  it('stops before the first item when a cancel reached only the database', async () => {
    const { dispatcher, registry, repo } = setup();
    const kind = handler();
    registry.register(kind);
    repo.cancelRequested.mockResolvedValue(true);
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();

    expect(kind.processItem).not.toHaveBeenCalled();
    expect(repo.settle).toHaveBeenCalledWith(run().id, 'cancelled', undefined);
  });

  it('ends a busy run that was cancelled while it was claimed', async () => {
    const { dispatcher, registry, repo, streams } = setup();
    const kind = handler({ prepare: vi.fn(() => Promise.resolve('busy' as const)) });
    registry.register(kind);
    repo.releaseClaim.mockResolvedValue(run({ status: 'cancelled', subjectIds: [], cancelRequested: true }));
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    const followed = follow(streams, run().id);
    await boot(dispatcher);
    await dispatcher.tick();

    expect(kind.finish).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }), null, 'cancelled');
    expect(followed.events).toEqual([{ done: true, processed: 0, failed: 0 }]);
    expect(dispatcher.activeRunIds).toEqual([]);
  });

  it('settles a run on a later tick when saving its end failed', async () => {
    const { dispatcher, registry, repo, jobChanges } = setup();
    registry.register(handler());
    repo.settle.mockRejectedValueOnce(new Error('connection reset'));
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    await boot(dispatcher);
    await dispatcher.tick();
    await dispatcher.idle();
    expect(repo.settle).toHaveBeenCalledTimes(1);

    jobChanges.notify.mockClear();
    await dispatcher.tick();
    expect(repo.settle).toHaveBeenCalledTimes(2);
    expect(repo.settle).toHaveBeenLastCalledWith(run().id, 'completed', undefined);
    expect(jobChanges.notify).toHaveBeenCalledWith({ type: 'bulk-run', ownerId: editor.id, state: true });

    await dispatcher.tick();
    expect(repo.settle).toHaveBeenCalledTimes(2);
  });

  it('leaves a run unsettled when the server stops, for the next boot to mark interrupted', async () => {
    const { dispatcher, registry, repo, streams } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    registry.register(handler({ processItem: vi.fn(() => gate.then(() => ({ outcome: 'succeeded' as const }))) }));
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    const followed = follow(streams, run().id);
    await boot(dispatcher);
    await dispatcher.tick();
    const stopping = dispatcher.onModuleDestroy();
    expect(followed.sink.end).toHaveBeenCalled();
    release();
    await stopping;

    expect(repo.recordItem).toHaveBeenCalledTimes(1);
    expect(repo.settle).not.toHaveBeenCalled();
    expect(followed.events.some((event) => 'done' in event)).toBe(false);
  });

  it('leaves an item that failed during shutdown for Continue to retry', async () => {
    const { dispatcher, registry, repo } = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    registry.register(handler({ processItem: vi.fn(() => gate.then(() => Promise.reject(new Error('pool closed')))) }));
    repo.claimNext.mockResolvedValueOnce({ run: run(), firstStart: true }).mockResolvedValue(null);
    await boot(dispatcher);
    await dispatcher.tick();
    const stopping = dispatcher.onModuleDestroy();
    release();
    await stopping;

    expect(repo.recordItem).not.toHaveBeenCalled();
    expect(repo.settle).not.toHaveBeenCalled();
  });

  it('clears old runs on housekeeping', async () => {
    const { dispatcher, repo } = setup();
    vi.useFakeTimers({ now: AT });
    try {
      await dispatcher.housekeeping();
      expect(repo.autoDismissInterrupted).toHaveBeenCalledWith(new Date(AT.getTime() - BULK_RUN_INTERRUPTED_KEPT_MS));
      expect(repo.deleteFinished).toHaveBeenCalledWith(new Date(AT.getTime() - BULK_RUN_FINISHED_KEPT_MS));
    } finally {
      vi.useRealTimers();
    }
  });
});
