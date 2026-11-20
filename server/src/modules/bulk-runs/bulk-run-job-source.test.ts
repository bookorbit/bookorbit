import { ConflictException, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import { BulkRunHandlerRegistry } from './bulk-run-handler.registry';
import { BulkRunJobSource } from './bulk-run-job-source';
import type { BulkRunPageRow } from './bulk-runs.repository';

function user(id: number, permissions: Permission[] = [], isSuperuser = false): RequestUser {
  return { id, active: true, isSuperuser, permissions } as unknown as RequestUser;
}

const editor = user(7, [Permission.LibraryEditMetadata]);
const stranger = user(9, [Permission.LibraryEditMetadata]);
const manager = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const AT = new Date('2026-11-15T10:00:00.000Z');
const LATER = new Date('2026-11-15T10:05:00.000Z');

function page(change: Partial<BulkRunPageRow> = {}): BulkRunPageRow {
  return {
    id: RUN_ID,
    kind: 'book-refresh-metadata',
    requestedBy: editor.id,
    credentialKind: 'session',
    apiKeyId: null,
    status: 'queued',
    options: {},
    total: 40,
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
    startedAt: null,
    finishedAt: null,
    dismissedAt: null,
    requesterName: 'Sam Whitfield',
    rank: 2,
    key: { prefix: [1, 2], suffix: [1], id: RUN_ID },
    ...change,
  };
}

function makeSource() {
  const registry = new JobSourceRegistry();
  const handlers = new BulkRunHandlerRegistry();
  const move = {
    kind: 'book-move' as const,
    prepare: vi.fn(),
    processItem: vi.fn(),
    finish: vi.fn(),
    doneEvent: vi.fn(),
    continuable: vi.fn(() => true),
  };
  handlers.register(move);
  const runs = {
    pageForJobs: vi.fn((): Promise<BulkRunPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ running: 1, queued: 2, failed: 3 })),
    findByIds: vi.fn((): Promise<Omit<BulkRunRow, 'subjectIds'>[]> => Promise.resolve([page()])),
    findById: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(null)),
  };
  const service = {
    cancel: vi.fn(() => Promise.resolve({ ...page({ status: 'cancelled' }), subjectIds: [] })),
    continueRun: vi.fn(() => Promise.resolve({ ...page({ status: 'queued' }), subjectIds: [] })),
    dismiss: vi.fn(() => Promise.resolve({ ...page({ status: 'failed', dismissedAt: LATER }), subjectIds: [] })),
  };
  const source = new BulkRunJobSource(registry, runs as never, service as never, handlers);
  source.onModuleInit();
  return { source, registry, runs, service, move };
}

const viewerOf = (who: RequestUser, all = false) => ({ user: who, access: { own: true, all } });
const QUERY = { view: 'queue' as const, owner: null, cutoffAt: AT, after: null, typeIndex: 11, limit: 50 };

async function listed(change: Partial<BulkRunPageRow>) {
  const { source, runs } = makeSource();
  runs.pageForJobs.mockResolvedValue([page(change)]);
  const [row] = await source.list(QUERY);
  return row!;
}

describe('BulkRunJobSource', () => {
  it('registers as bulk-run', () => {
    const { registry, source } = makeSource();
    expect(registry.get('bulk-run')).toBe(source);
  });

  it("lets editors see their own runs and app settings managers see everyone's", () => {
    const { source } = makeSource();
    expect(source.access(editor)).toEqual({ own: true, all: false });
    expect(source.access(manager)).toEqual({ own: false, all: true });
    expect(source.access(admin)).toEqual({ own: true, all: true });
    expect(source.access(user(5))).toEqual({ own: false, all: false });
  });

  it("shows a waiting run with its place in its account's line", async () => {
    const row = await listed({});
    expect(row.nativeId).toBe(RUN_ID);
    expect(row.item).toMatchObject({
      kind: 'book-refresh-metadata',
      status: 'queued',
      position: 2,
      done: 0,
      total: 40,
      startedAt: null,
      finishedAt: null,
    });
    expect(row.item.requester).toEqual({ id: editor.id, name: 'Sam Whitfield' });
  });

  it('shows a running run with its progress and a pending cancel as its phase', async () => {
    const row = await listed({ status: 'running', processed: 12, startedAt: AT, cancelRequested: true, failed: 2 });
    expect(row.item).toMatchObject({
      status: 'running',
      done: 12,
      phase: 'cancelling',
      position: null,
      startedAt: AT.toISOString(),
      extra: { failed: 2 },
    });
  });

  it('shows an interrupted run as failed with its own reason', async () => {
    const row = await listed({ status: 'interrupted', processed: 5, startedAt: AT, finishedAt: LATER });
    expect(row.item).toMatchObject({ status: 'failed', reason: 'interrupted', finishedAt: LATER.toISOString() });
  });

  it('shows a failed run with its error code', async () => {
    const row = await listed({ status: 'failed', errorCode: 'credential-revoked', startedAt: AT, finishedAt: LATER });
    expect(row.item).toMatchObject({ status: 'failed', reason: 'credential-revoked' });
  });

  it('passes the owner filter through, ownerless runs included for managers', async () => {
    const { source, runs } = makeSource();
    const owner = { id: 2, ownerless: true };
    await source.list({ ...QUERY, owner });
    await source.counts({ owner, cutoffAt: AT });
    expect(runs.pageForJobs).toHaveBeenCalledWith(expect.objectContaining({ owner }));
    expect(runs.countForJobs).toHaveBeenCalledWith(owner, AT);
  });

  it('counts running and waiting runs into the queue', async () => {
    const { source } = makeSource();
    await expect(source.counts({ owner: { id: 7, ownerless: false }, cutoffAt: AT })).resolves.toEqual({
      queue: 3,
      needsYou: 0,
      failed: 3,
      running: 1,
      queued: 2,
      paused: 0,
    });
  });

  describe('actions', () => {
    it('offers cancel to the requester and to managers while the run waits or runs', async () => {
      const { source } = makeSource();
      const row = await listed({});
      expect(source.actions(row, viewerOf(editor)).actions).toEqual(['cancel']);
      expect(source.actions(row, viewerOf(manager, true)).actions).toEqual(['cancel']);
      const asked = await listed({ status: 'running', cancelRequested: true });
      expect(source.actions(asked, viewerOf(editor)).actions).toEqual([]);
    });

    it('offers continue to the requester or a superuser and dismiss to managers too', async () => {
      const { source } = makeSource();
      const row = await listed({ status: 'interrupted', finishedAt: LATER });
      expect(source.actions(row, viewerOf(editor)).actions).toEqual(['continue', 'dismiss']);
      expect(source.actions(row, viewerOf(manager, true)).actions).toEqual(['dismiss']);
      expect(source.actions(row, viewerOf(admin, true)).actions).toEqual(['continue', 'dismiss']);
    });

    it('holds continue back with a note while the kind cannot continue yet', async () => {
      const { source, move } = makeSource();
      move.continuable.mockReturnValue(false);
      const row = await listed({ kind: 'book-move', status: 'interrupted', finishedAt: LATER });
      expect(source.actions(row, viewerOf(editor))).toEqual({ actions: ['dismiss'], note: 'bulk-run-continue-later' });
    });

    it('offers only dismiss on a failed run and nothing on an ended one', async () => {
      const { source } = makeSource();
      expect(source.actions(await listed({ status: 'failed', finishedAt: LATER }), viewerOf(editor)).actions).toEqual(['dismiss']);
      expect(source.actions(await listed({ status: 'completed', finishedAt: LATER }), viewerOf(editor)).actions).toEqual([]);
    });
  });

  describe('act', () => {
    it('cancels through the service', async () => {
      const { source, service } = makeSource();
      await expect(source.act('cancel', [RUN_ID], viewerOf(editor))).resolves.toEqual([{ id: RUN_ID, outcome: 'done', status: 'cancelled' }]);
      expect(service.cancel).toHaveBeenCalledWith(RUN_ID, editor);
    });

    it("hides another account's run from a viewer who does not manage runs", async () => {
      const { source, service } = makeSource();
      await expect(source.act('cancel', [RUN_ID], viewerOf(stranger))).resolves.toEqual([{ id: RUN_ID, outcome: 'not-found', status: null }]);
      expect(service.cancel).not.toHaveBeenCalled();
    });

    it('answers not-found for an id that is not a run id', async () => {
      const { source, runs } = makeSource();
      runs.findByIds.mockResolvedValue([]);
      await expect(source.act('cancel', ['12'], viewerOf(editor))).resolves.toEqual([{ id: '12', outcome: 'not-found', status: null }]);
      expect(runs.findByIds).toHaveBeenCalledWith([]);
    });

    it("skips an action the run's state does not allow and refuses one the viewer may not take", async () => {
      const { source, runs } = makeSource();
      await expect(source.act('continue', [RUN_ID], viewerOf(editor))).resolves.toEqual([{ id: RUN_ID, outcome: 'skipped', status: 'queued' }]);
      runs.findByIds.mockResolvedValue([page({ status: 'interrupted', finishedAt: LATER })]);
      await expect(source.act('continue', [RUN_ID], viewerOf(manager, true))).resolves.toEqual([
        { id: RUN_ID, outcome: 'refused', status: 'failed' },
      ]);
    });

    it("maps the service's refusals", async () => {
      const { source, service, runs } = makeSource();
      service.cancel.mockRejectedValueOnce(new ForbiddenException());
      await expect(source.act('cancel', [RUN_ID], viewerOf(editor))).resolves.toEqual([{ id: RUN_ID, outcome: 'refused', status: 'queued' }]);
      service.cancel.mockRejectedValueOnce(new ConflictException());
      runs.findById.mockResolvedValue({ ...page({ status: 'completed' }), subjectIds: [] });
      await expect(source.act('cancel', [RUN_ID], viewerOf(editor))).resolves.toEqual([{ id: RUN_ID, outcome: 'skipped', status: 'completed' }]);
      runs.findByIds.mockResolvedValue([page({ status: 'interrupted', finishedAt: LATER })]);
      service.continueRun.mockRejectedValueOnce(new HttpException('busy', HttpStatus.TOO_MANY_REQUESTS));
      await expect(source.act('continue', [RUN_ID], viewerOf(editor))).resolves.toEqual([{ id: RUN_ID, outcome: 'refused', status: 'failed' }]);
      service.continueRun.mockRejectedValueOnce(new Error('database down'));
      await expect(source.act('continue', [RUN_ID], viewerOf(editor))).resolves.toEqual([{ id: RUN_ID, outcome: 'error', status: 'failed' }]);
    });
  });
});
