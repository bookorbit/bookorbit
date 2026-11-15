import { AuditAction, JOB_TYPES, Permission, type JobView } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AUDIT_EVENT } from '../audit/audit-events.service';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import type { SourceListQuery } from '../jobs/job-source';
import { AUTHOR_ENRICHMENT_FAILED_VISIBLE_MS, AuthorEnrichmentJobSource, type AuthorEnrichmentJobRow } from './author-enrichment-job-source';
import type { AuthorEnrichmentJobCounts } from './author-enrichment.repository';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');
const SINCE = Date.parse('2026-11-15T10:00:00.000Z') * 1000 + 123;
const FAILED_AT = Date.parse('2026-11-15T11:00:00.000Z') * 1000 + 456;
const TYPE_INDEX = JOB_TYPES.indexOf('author-enrichment');

function user(id: number, permissions: Permission[] = [], isSuperuser = false, active = true): RequestUser {
  return { id, username: `user${id}`, active, isSuperuser, permissions } as unknown as RequestUser;
}

const metadataManager = user(3, [Permission.ManageMetadataConfig]);
const settingsManager = user(2, [Permission.ManageAppSettings]);
const admin = user(1, [], true);
const reader = user(9, [Permission.LibraryGenerateReadAloud]);

function counts(change: Partial<AuthorEnrichmentJobCounts> = {}): AuthorEnrichmentJobCounts {
  return { queued: 0, processing: 0, rateLimited: 0, queueSince: null, failed: 0, failedAt: null, ...change };
}

const busy = counts({ queued: 30, processing: 1, rateLimited: 2, queueSince: SINCE, failed: 4, failedAt: FAILED_AT });

function makeSource(state: { counts?: AuthorEnrichmentJobCounts; paused?: boolean } = {}) {
  const registry = new JobSourceRegistry();
  const queueRepo = { countForJobs: vi.fn(() => Promise.resolve(state.counts ?? busy)) };
  const config = { isPaused: vi.fn(() => Promise.resolve(state.paused ?? false)) };
  const session = new AuthorEnrichmentSessionService();
  const orchestrator = {
    pause: vi.fn(() => Promise.resolve()),
    resume: vi.fn(() => Promise.resolve()),
    cancelPending: vi.fn(() => Promise.resolve()),
    requeueFailed: vi.fn(() => Promise.resolve(4)),
  };
  const auditEvents = { emit: vi.fn() };
  const source = new AuthorEnrichmentJobSource(registry, queueRepo as never, config as never, session, orchestrator as never, auditEvents as never);
  source.onModuleInit();
  return { source, registry, queueRepo, config, session, orchestrator, auditEvents };
}

const viewerOf = (who: RequestUser) => ({ user: who, access: { own: false, all: true } });

function query(view: JobView, change: Partial<SourceListQuery> = {}): SourceListQuery {
  return {
    view,
    owner: null,
    cutoffAt: new Date(NOW - AUTHOR_ENRICHMENT_FAILED_VISIBLE_MS),
    after: null,
    typeIndex: TYPE_INDEX,
    limit: 26,
    ...change,
  };
}

async function only(source: AuthorEnrichmentJobSource, view: JobView, change: Partial<SourceListQuery> = {}): Promise<AuthorEnrichmentJobRow> {
  const rows = await source.list(query(view, change));
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('AuthorEnrichmentJobSource', () => {
  it('registers itself on init', () => {
    const { source, registry } = makeSource();
    expect(registry.get('author-enrichment')).toBe(source);
  });

  describe('access', () => {
    it('shows the ownerless queue to metadata managers, settings managers and superusers only', () => {
      const { source } = makeSource();
      expect(source.access(metadataManager)).toEqual({ own: false, all: true });
      expect(source.access(settingsManager)).toEqual({ own: false, all: true });
      expect(source.access(admin)).toEqual({ own: false, all: true });
      expect(source.access(reader)).toEqual({ own: false, all: false });
      expect(source.access(user(4, [Permission.ManageMetadataConfig], false, false))).toEqual({ own: false, all: false });
    });
  });

  describe('list', () => {
    it('summarises waiting, running and rate-limited entries as one running queue row', async () => {
      const { source, session } = makeSource();
      session.addToTotal(40);
      for (let index = 0; index < 7; index += 1) session.incrementDone();

      const row = await only(source, 'queue');

      expect(row.nativeId).toBe('queue');
      expect(row.key).toEqual({ prefix: [0, 0], suffix: [SINCE], id: 'queue' });
      expect(row.item).toEqual({
        kind: null,
        shape: 'queue',
        status: 'running',
        reason: null,
        phase: null,
        done: 7,
        total: 40,
        percent: null,
        position: null,
        requester: null,
        cost: null,
        createdAt: '2026-11-15T10:00:00.000Z',
        startedAt: null,
        pausedAt: null,
        finishedAt: null,
        extra: { rateLimited: 2 },
      });
    });

    it('shows remaining only when the session does not account for what waits', async () => {
      const { source, session } = makeSource();

      expect((await only(source, 'queue')).item).toMatchObject({ done: null, total: 33 });

      // A restart lost the earlier session; the new one covers only part of the queue.
      session.addToTotal(5);
      expect((await only(source, 'queue')).item).toMatchObject({ done: null, total: 33 });
    });

    it('places a waiting queue in the queued band and a paused one last, whatever is running', async () => {
      const waiting = makeSource({ counts: counts({ queued: 3, queueSince: SINCE }) });
      expect(await only(waiting.source, 'queue')).toMatchObject({ key: { prefix: [1, 1] }, item: { status: 'queued', reason: null } });

      const paused = makeSource({ paused: true });
      expect(await only(paused.source, 'queue')).toMatchObject({ key: { prefix: [2, 0] }, item: { status: 'paused', reason: 'user' } });
    });

    it('says when only rate-limited entries are waiting', async () => {
      const { source } = makeSource({ counts: counts({ rateLimited: 5, queueSince: SINCE }) });
      expect((await only(source, 'queue')).item).toMatchObject({ status: 'queued', reason: 'rate-limited', extra: { rateLimited: 5 } });
    });

    it('has no queue row once nothing tracked waits, even with failures or a pause', async () => {
      const { source } = makeSource({ counts: counts({ failed: 2, failedAt: FAILED_AT }), paused: true });
      await expect(source.list(query('queue'))).resolves.toEqual([]);
    });

    it('summarises failures as one failed row that finished at the latest failure', async () => {
      const { source } = makeSource();

      const row = await only(source, 'failed');

      expect(row.key).toEqual({ prefix: [FAILED_AT], suffix: [], id: 'failed' });
      expect(row.item).toMatchObject({
        shape: 'queue',
        status: 'failed',
        reason: 'failed',
        done: null,
        total: null,
        createdAt: '2026-11-15T11:00:00.000Z',
        finishedAt: '2026-11-15T11:00:00.000Z',
        extra: { failed: 4 },
      });
    });

    it('lets the failed row age out of Failed and never lists one in History', async () => {
      const { source } = makeSource();
      await expect(source.list(query('failed', { cutoffAt: new Date(Math.ceil(FAILED_AT / 1000)) }))).resolves.toEqual([]);
      // The cutoff has millisecond precision; a failure later inside that millisecond is still recent.
      await expect(source.list(query('failed', { cutoffAt: new Date(Math.floor(FAILED_AT / 1000)) }))).resolves.toHaveLength(1);
      await expect(source.list(query('history'))).resolves.toEqual([]);
    });

    it('lists nothing in Needs you or for a read of one account without ownerless rows', async () => {
      const { source, queueRepo } = makeSource();
      await expect(source.list(query('needs-you'))).resolves.toEqual([]);
      await expect(source.list(query('queue', { owner: { id: 3, ownerless: false } }))).resolves.toEqual([]);
      await expect(source.list(query('queue', { owner: { id: 3, ownerless: true } }))).resolves.toHaveLength(1);
      expect(queueRepo.countForJobs).toHaveBeenCalledTimes(1);
    });

    it('keeps the row only when it comes after the cursor in the merged order', async () => {
      const { source } = makeSource();
      const row = await only(source, 'queue');
      const at = { ...row.key, typeIndex: TYPE_INDEX };

      await expect(source.list(query('queue', { after: at }))).resolves.toEqual([]);
      await expect(source.list(query('queue', { after: { ...at, typeIndex: TYPE_INDEX + 1 } }))).resolves.toEqual([]);
      await expect(source.list(query('queue', { after: { ...at, typeIndex: TYPE_INDEX - 1 } }))).resolves.toHaveLength(1);
      await expect(
        source.list(query('queue', { after: { prefix: [0, 0], suffix: [SINCE - 1], id: 'queue', typeIndex: TYPE_INDEX } })),
      ).resolves.toHaveLength(1);

      const failed = await only(source, 'failed');
      await expect(source.list(query('failed', { after: { ...failed.key, typeIndex: TYPE_INDEX } }))).resolves.toEqual([]);
      await expect(source.list(query('failed', { after: { prefix: [FAILED_AT + 1], suffix: [], id: 'x', typeIndex: 0 } }))).resolves.toHaveLength(1);
    });
  });

  describe('counts', () => {
    it('counts each summary row once in its view, with the queue row in its status', async () => {
      await expect(makeSource().source.counts(query('queue'))).resolves.toEqual({
        queue: 1,
        needsYou: 0,
        failed: 1,
        running: 1,
        queued: 0,
        paused: 0,
      });
      await expect(makeSource({ paused: true }).source.counts(query('queue'))).resolves.toEqual({
        queue: 1,
        needsYou: 0,
        failed: 1,
        running: 0,
        queued: 0,
        paused: 1,
      });
      await expect(makeSource({ counts: counts({ queued: 2, queueSince: SINCE }) }).source.counts(query('queue'))).resolves.toEqual({
        queue: 1,
        needsYou: 0,
        failed: 0,
        running: 0,
        queued: 1,
        paused: 0,
      });
    });

    it('leaves out an aged failure and reads nothing for one account alone', async () => {
      const aged = makeSource();
      await expect(aged.source.counts({ owner: null, cutoffAt: new Date(Math.ceil(FAILED_AT / 1000)) })).resolves.toMatchObject({
        failed: 0,
        queue: 1,
      });

      const { source, queueRepo } = makeSource();
      await expect(source.counts({ owner: { id: 3, ownerless: false }, cutoffAt: new Date(0) })).resolves.toEqual({
        queue: 0,
        needsYou: 0,
        failed: 0,
        running: 0,
        queued: 0,
        paused: 0,
      });
      expect(queueRepo.countForJobs).not.toHaveBeenCalled();
    });
  });

  describe('describe', () => {
    it('opens the settings page for metadata managers and nothing for a settings-only viewer', async () => {
      const { source } = makeSource();
      const rows = await source.list(query('queue'));

      await expect(source.describe(rows, viewerOf(metadataManager))).resolves.toEqual(
        new Map([['queue', { label: null, byline: null, url: '/settings/metadata/authors', image: null }]]),
      );
      await expect(source.describe(rows, viewerOf(settingsManager))).resolves.toEqual(
        new Map([['queue', { label: null, byline: null, url: null, image: null }]]),
      );
    });
  });

  describe('actions', () => {
    it('offers pause and cancel on a live queue and retry on failures to metadata managers', async () => {
      const { source } = makeSource();
      const queue = await only(source, 'queue');
      const failed = await only(source, 'failed');

      expect(source.actions(queue, viewerOf(metadataManager))).toEqual({ actions: ['pause', 'cancel'], note: null });
      expect(source.actions(failed, viewerOf(admin))).toEqual({ actions: ['retry'], note: null });
    });

    it('offers resume on a paused queue, and cancel only while something waits', async () => {
      const paused = makeSource({ paused: true });
      expect(paused.source.actions(await only(paused.source, 'queue'), viewerOf(metadataManager))).toEqual({
        actions: ['resume', 'cancel'],
        note: null,
      });

      const finishing = makeSource({ paused: true, counts: counts({ processing: 1, queueSince: SINCE }) });
      expect(finishing.source.actions(await only(finishing.source, 'queue'), viewerOf(metadataManager))).toEqual({ actions: ['resume'], note: null });
    });

    it('explains to a settings-only viewer why nothing is offered', async () => {
      const { source } = makeSource();
      expect(source.actions(await only(source, 'queue'), viewerOf(settingsManager))).toEqual({ actions: [], note: 'metadata-config' });
      expect(source.actions(await only(source, 'failed'), viewerOf(settingsManager))).toEqual({ actions: [], note: 'metadata-config' });
    });
  });

  describe('act', () => {
    it('pauses, resumes and cancels through the orchestrator and audits each as the routes do', async () => {
      const running = makeSource();
      await expect(running.source.act('pause', ['queue'], viewerOf(metadataManager))).resolves.toEqual([
        { id: 'queue', outcome: 'done', status: 'paused' },
      ]);
      expect(running.orchestrator.pause).toHaveBeenCalledTimes(1);
      expect(running.auditEvents.emit).toHaveBeenCalledWith(AUDIT_EVENT, {
        userId: metadataManager.id,
        actorUsername: metadataManager.username,
        action: AuditAction.AuthorEnrichmentPause,
        description: 'Paused author enrichment',
      });

      await expect(running.source.act('cancel', ['queue'], viewerOf(admin))).resolves.toEqual([{ id: 'queue', outcome: 'done', status: 'paused' }]);
      expect(running.orchestrator.cancelPending).toHaveBeenCalledTimes(1);
      expect(running.auditEvents.emit).toHaveBeenLastCalledWith(AUDIT_EVENT, expect.objectContaining({ action: AuditAction.AuthorEnrichmentCancel }));

      const paused = makeSource({ paused: true, counts: counts({ queued: 3, queueSince: SINCE }) });
      await expect(paused.source.act('resume', ['queue'], viewerOf(metadataManager))).resolves.toEqual([
        { id: 'queue', outcome: 'done', status: 'queued' },
      ]);
      expect(paused.orchestrator.resume).toHaveBeenCalledTimes(1);
      expect(paused.auditEvents.emit).toHaveBeenCalledWith(AUDIT_EVENT, expect.objectContaining({ action: AuditAction.AuthorEnrichmentResume }));
    });

    it('reports a cancelled queue with nothing running as gone', async () => {
      const { source } = makeSource({ counts: counts({ queued: 3, queueSince: SINCE }) });
      await expect(source.act('cancel', ['queue'], viewerOf(metadataManager))).resolves.toEqual([{ id: 'queue', outcome: 'done', status: null }]);
    });

    it('retries every failure, and skips when another request already did', async () => {
      const { source, orchestrator, auditEvents } = makeSource();
      await expect(source.act('retry', ['failed'], viewerOf(metadataManager))).resolves.toEqual([
        { id: 'failed', outcome: 'done', status: 'queued' },
      ]);
      expect(orchestrator.requeueFailed).toHaveBeenCalledTimes(1);
      expect(auditEvents.emit).not.toHaveBeenCalled();

      orchestrator.requeueFailed.mockResolvedValueOnce(0);
      await expect(source.act('retry', ['failed'], viewerOf(metadataManager))).resolves.toEqual([{ id: 'failed', outcome: 'skipped', status: null }]);
    });

    it('skips an action the row does not take now, and refuses a settings-only viewer', async () => {
      const { source, orchestrator } = makeSource();
      await expect(source.act('resume', ['queue'], viewerOf(metadataManager))).resolves.toEqual([
        { id: 'queue', outcome: 'skipped', status: 'running' },
      ]);
      await expect(source.act('pause', ['failed'], viewerOf(metadataManager))).resolves.toEqual([
        { id: 'failed', outcome: 'skipped', status: 'failed' },
      ]);
      await expect(source.act('pause', ['queue'], viewerOf(settingsManager))).resolves.toEqual([
        { id: 'queue', outcome: 'refused', status: 'running' },
      ]);
      expect(orchestrator.pause).not.toHaveBeenCalled();
      expect(orchestrator.resume).not.toHaveBeenCalled();
    });

    it('skips a row that has emptied since the page loaded', async () => {
      const { source } = makeSource({ counts: counts() });
      await expect(source.act('retry', ['failed'], viewerOf(metadataManager))).resolves.toEqual([{ id: 'failed', outcome: 'skipped', status: null }]);
      await expect(source.act('pause', ['queue'], viewerOf(metadataManager))).resolves.toEqual([{ id: 'queue', outcome: 'skipped', status: null }]);
    });

    it('answers not-found for unknown ids and for a viewer without the grant, in request order', async () => {
      const { source, queueRepo } = makeSource();
      await expect(source.act('pause', ['nope', 'queue', 'queue'], viewerOf(metadataManager))).resolves.toEqual([
        { id: 'nope', outcome: 'not-found', status: null },
        { id: 'queue', outcome: 'done', status: 'paused' },
        { id: 'queue', outcome: 'done', status: 'paused' },
      ]);

      queueRepo.countForJobs.mockClear();
      await expect(source.act('pause', ['queue'], { user: reader, access: { own: false, all: false } })).resolves.toEqual([
        { id: 'queue', outcome: 'not-found', status: null },
      ]);
      expect(queueRepo.countForJobs).not.toHaveBeenCalled();
    });

    it('turns an orchestrator failure into an error outcome', async () => {
      const { source, orchestrator } = makeSource();
      orchestrator.pause.mockRejectedValueOnce(new Error('db down'));
      await expect(source.act('pause', ['queue'], viewerOf(metadataManager))).resolves.toEqual([{ id: 'queue', outcome: 'error', status: null }]);
    });
  });
});
