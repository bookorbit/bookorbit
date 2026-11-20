import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResource, Permission, type BookRequestDownloadStatus } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { AUDIT_EVENT } from '../audit/audit-events.service';
import { JobSourceRegistry } from '../jobs/job-source.registry';
import type { JobViewer } from '../jobs/job-source';
import { BookRequestService } from './book-request.service';
import { RequestDownloadJobSource, type RequestDownloadJobRow } from './request-download-job-source';
import type { RequestDownloadActionRow, RequestDownloadPageRow } from './request-download-job.repository';

function user(id: number, permissions: Permission[] = [], isSuperuser = false): RequestUser {
  return { id, username: `user${id}`, active: true, isSuperuser, permissions } as unknown as RequestUser;
}

const requester = user(5, [Permission.BookRequestAccess]);
const fulfiller = user(7, [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill]);
const otherFulfiller = user(8, [Permission.BookRequestAccess, Permission.BookRequestSelfFulfill]);
const moderator = user(2, [Permission.BookRequestAccess, Permission.ManageBookRequests]);
const admin = user(1, [], true);

function page(change: Partial<RequestDownloadPageRow> = {}): RequestDownloadPageRow {
  return {
    id: 11,
    requestId: 40,
    status: 'downloading',
    progressPercent: 42,
    failureCode: null,
    createdAt: new Date('2026-11-15T10:00:00.000Z'),
    grabbedAt: new Date('2026-11-15T10:01:00.000Z'),
    importedAt: null,
    updatedAt: new Date('2026-11-15T11:00:00.000Z'),
    userId: requester.id,
    fulfillerUserId: fulfiller.id,
    ownerName: 'Sam Whitfield',
    title: 'Dune',
    authors: ['Frank Herbert'],
    coverUrl: 'https://covers.example.org/dune.jpg',
    mediaKind: 'ebook',
    key: { prefix: [0, 0], suffix: [1], id: 11 },
    ...change,
  };
}

function stored(change: Partial<RequestDownloadActionRow> = {}): RequestDownloadActionRow {
  return { id: 11, requestId: 40, status: 'downloading', failureCode: null, userId: requester.id, fulfillerUserId: fulfiller.id, ...change };
}

function makeSource() {
  const registry = new JobSourceRegistry();
  const jobs = {
    pageForJobs: vi.fn((): Promise<RequestDownloadPageRow[]> => Promise.resolve([])),
    countForJobs: vi.fn(() => Promise.resolve({ queue: 2, needsYou: 1, failed: 1, running: 1, queued: 1, paused: 0 })),
    findActionRows: vi.fn((): Promise<RequestDownloadActionRow[]> => Promise.resolve([stored()])),
  };
  // The real drive rule, so the adapter cannot drift from the request routes.
  const requests = {
    canManageAll: BookRequestService.prototype.canManageAll,
    canSelfFulfil: BookRequestService.prototype.canSelfFulfil,
    canDrive: BookRequestService.prototype.canDrive,
    cancelDownload: vi.fn(() => Promise.resolve({})),
  };
  const auditEvents = { emit: vi.fn() };
  const source = new RequestDownloadJobSource(registry, jobs as never, requests as never, auditEvents as never);
  source.onModuleInit();
  return { source, registry, jobs, requests, auditEvents };
}

const viewerOf = (who: RequestUser, all = false): JobViewer => ({ user: who, access: { own: true, all } });

async function listed(change: Partial<RequestDownloadPageRow>) {
  const { source, jobs } = makeSource();
  jobs.pageForJobs.mockResolvedValue([page(change)]);
  const [row] = await source.list({ view: 'queue', owner: null, cutoffAt: new Date(), after: null, typeIndex: 6, limit: 50 });
  return row!;
}

describe('RequestDownloadJobSource', () => {
  it('registers itself as the request-download type with a seven day failed window', () => {
    const { source, registry } = makeSource();

    expect(registry.get('request-download')).toBe(source);
    expect(source.failedWindowMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  describe('access', () => {
    it('shows a self-fulfiller their own downloads and a moderator everyone', () => {
      const { source } = makeSource();

      expect(source.access(fulfiller)).toEqual({ own: true, all: false });
      expect(source.access(moderator)).toEqual({ own: false, all: true });
      expect(source.access(admin)).toEqual({ own: true, all: true });
    });

    /** Decision 20: an ordinary requester follows their request on the requests page, not here. */
    it('shows a requester who cannot fulfil nothing', () => {
      const { source } = makeSource();

      expect(source.access(requester)).toEqual({ own: false, all: false });
    });

    it('asks for request access beside the permission, and for an active account', () => {
      const { source } = makeSource();

      expect(source.access(user(9, [Permission.BookRequestSelfFulfill, Permission.ManageBookRequests]))).toEqual({ own: false, all: false });
      expect(source.access({ ...admin, active: false } as RequestUser)).toEqual({ own: false, all: false });
    });
  });

  describe('list', () => {
    it('passes the view, cursor and owner through, without an ownerless flag', async () => {
      const { source, jobs } = makeSource();
      const cutoffAt = new Date('2026-11-08T12:00:00.000Z');
      const after = { prefix: [1], suffix: [], id: 3, typeIndex: 6 };

      await source.list({ view: 'failed', owner: { id: 7, ownerless: true }, cutoffAt, after, typeIndex: 6, limit: 25 });

      expect(jobs.pageForJobs).toHaveBeenCalledWith({ view: 'failed', owner: { id: 7 }, cutoffAt, after, typeIndex: 6, limit: 25 });
    });

    it('maps a downloading attempt to a running row with its percentage', async () => {
      const row = await listed({});

      expect(row.nativeId).toBe('11');
      expect(row.key).toEqual({ prefix: [0, 0], suffix: [1], id: 11 });
      expect(row.item).toEqual({
        kind: 'ebook',
        shape: 'job',
        status: 'running',
        reason: null,
        phase: 'downloading',
        done: null,
        total: null,
        percent: 42,
        position: null,
        requester: { id: fulfiller.id, name: 'Sam Whitfield' },
        cost: null,
        createdAt: '2026-11-15T10:00:00.000Z',
        startedAt: '2026-11-15T10:01:00.000Z',
        pausedAt: null,
        finishedAt: null,
        extra: null,
      });
    });

    it.each<[BookRequestDownloadStatus, string, string | null]>([
      ['completed', 'running', 'downloaded'],
      ['importing', 'running', 'importing'],
    ])('maps a %s attempt to %s in the %s phase, with no percentage', async (status, expected, phase) => {
      const row = await listed({ status });

      expect(row.item).toMatchObject({ status: expected, phase, percent: null, finishedAt: null });
    });

    /** Download clients run their own queues, so no queued attempt claims a place in one lane. */
    it('maps a queued attempt to queued with no position and no start', async () => {
      const row = await listed({ status: 'queued', progressPercent: 0 });

      expect(row.item).toMatchObject({ status: 'queued', phase: null, percent: null, position: null, startedAt: null });
    });

    it('names the requester as the owner when nobody took the request on', async () => {
      const row = await listed({ fulfillerUserId: null, ownerName: 'Riley Brooks' });

      expect(row.item.requester).toEqual({ id: requester.id, name: 'Riley Brooks' });
    });

    it('puts an import waiting on review in Needs you', async () => {
      const row = await listed({ status: 'needs_review' });

      expect(row.item).toMatchObject({ status: 'needs-you', reason: 'review', finishedAt: null });
    });

    it('finishes an imported attempt when it was filed', async () => {
      const row = await listed({ status: 'imported', importedAt: new Date('2026-11-15T11:30:00.000Z') });

      expect(row.item).toMatchObject({ status: 'completed', reason: null, startedAt: null, finishedAt: '2026-11-15T11:30:00.000Z' });
    });

    it('reads a failure nobody caused as failed, with no code', async () => {
      const row = await listed({ status: 'failed' });

      expect(row.item).toMatchObject({ status: 'failed', reason: null, finishedAt: '2026-11-15T11:00:00.000Z' });
    });

    it.each(['removed', 'discarded'])('reads an attempt a person %s as cancelled', async (failureCode) => {
      const row = await listed({ status: 'failed', failureCode });

      expect(row.item).toMatchObject({ status: 'cancelled', reason: failureCode });
    });
  });

  it('counts for the owner, without an ownerless flag', async () => {
    const { source, jobs } = makeSource();
    const cutoffAt = new Date('2026-11-08T12:00:00.000Z');

    await expect(source.counts({ owner: { id: 7, ownerless: false }, cutoffAt })).resolves.toEqual({
      queue: 2,
      needsYou: 1,
      failed: 1,
      running: 1,
      queued: 1,
      paused: 0,
    });
    expect(jobs.countForJobs).toHaveBeenCalledWith({ id: 7 }, cutoffAt);

    await source.counts({ owner: null, cutoffAt });
    expect(jobs.countForJobs).toHaveBeenLastCalledWith(null, cutoffAt);
  });

  it('names each row from its request and links to the request', async () => {
    const { source } = makeSource();
    const rows = [await listed({}), await listed({ id: 12, requestId: 41, authors: [], coverUrl: null })];

    const subjects = await source.describe(rows as RequestDownloadJobRow[]);

    expect(subjects.get('11')).toEqual({ label: 'Dune', byline: 'Frank Herbert', url: '/requests/40', image: 'https://covers.example.org/dune.jpg' });
    expect(subjects.get('12')).toEqual({ label: 'Dune', byline: null, url: '/requests/41', image: null });
  });

  describe('actions', () => {
    it('offers cancel on a queued or downloading attempt to whoever may drive it', async () => {
      const { source } = makeSource();
      const downloading = (await listed({})) as RequestDownloadJobRow;
      const queued = (await listed({ status: 'queued' })) as RequestDownloadJobRow;

      expect(source.actions(downloading, viewerOf(fulfiller))).toEqual({ actions: ['cancel'], note: null });
      expect(source.actions(queued, viewerOf(moderator, true))).toEqual({ actions: ['cancel'], note: null });
      expect(source.actions(downloading, viewerOf(admin, true))).toEqual({ actions: ['cancel'], note: null });
    });

    it.each<BookRequestDownloadStatus>(['completed', 'importing', 'needs_review', 'imported', 'failed'])(
      'offers nothing on a %s attempt, which cancel no longer applies to',
      async (status) => {
        const { source } = makeSource();
        const row = (await listed({ status })) as RequestDownloadJobRow;

        expect(source.actions(row, viewerOf(moderator, true))).toEqual({ actions: [], note: null });
      },
    );

    it('says why a viewer who sees the attempt cannot stop it', async () => {
      const { source } = makeSource();
      const row = (await listed({})) as RequestDownloadJobRow;

      expect(source.actions(row, viewerOf(otherFulfiller, true))).toEqual({ actions: [], note: 'request-download-driver' });
    });
  });

  describe('act', () => {
    it('cancels through the request service and records it in the audit trail', async () => {
      const { source, requests, auditEvents } = makeSource();

      await expect(source.act('cancel', ['11'], viewerOf(fulfiller))).resolves.toEqual([{ id: '11', outcome: 'done', status: 'cancelled' }]);

      expect(requests.cancelDownload).toHaveBeenCalledWith(40, 11, fulfiller);
      expect(auditEvents.emit).toHaveBeenCalledWith(AUDIT_EVENT, {
        userId: fulfiller.id,
        actorUsername: fulfiller.username,
        action: AuditAction.BookRequestRemoveDownload,
        resource: AuditResource.BookRequest,
        resourceId: 40,
        description: 'Cancelled an active book request download',
        meta: { downloadId: 11 },
      });
    });

    it('lets a moderator cancel a download somebody else drives', async () => {
      const { source, requests } = makeSource();

      await expect(source.act('cancel', ['11'], viewerOf(moderator, true))).resolves.toEqual([{ id: '11', outcome: 'done', status: 'cancelled' }]);
      expect(requests.cancelDownload).toHaveBeenCalledWith(40, 11, moderator);
    });

    it('cannot tell a download another person drives from a missing one or a malformed id', async () => {
      const { source, jobs, requests } = makeSource();
      jobs.findActionRows.mockResolvedValue([stored()]);

      const results = await source.act('cancel', ['11', '99', 'abc', '0'], viewerOf(otherFulfiller));

      expect(results.map((result) => result.outcome)).toEqual(['not-found', 'not-found', 'not-found', 'not-found']);
      expect(jobs.findActionRows).toHaveBeenCalledWith([11, 99]);
      expect(requests.cancelDownload).not.toHaveBeenCalled();
    });

    it('skips an attempt that already finished downloading, and any other action', async () => {
      const { source, jobs, requests } = makeSource();
      jobs.findActionRows.mockResolvedValue([stored({ status: 'importing' })]);

      await expect(source.act('cancel', ['11'], viewerOf(fulfiller))).resolves.toEqual([{ id: '11', outcome: 'skipped', status: 'running' }]);
      await expect(source.act('retry', ['11'], viewerOf(fulfiller))).resolves.toEqual([{ id: '11', outcome: 'skipped', status: 'running' }]);
      expect(requests.cancelDownload).not.toHaveBeenCalled();
    });

    it('refuses a viewer who sees the attempt but may not drive it', async () => {
      const { source, requests } = makeSource();

      await expect(source.act('cancel', ['11'], viewerOf(otherFulfiller, true))).resolves.toEqual([
        { id: '11', outcome: 'refused', status: 'running' },
      ]);
      expect(requests.cancelDownload).not.toHaveBeenCalled();
    });

    /** The transfer can finish between the read and the cancel; the service refuses it then. */
    it('reports the state an attempt moved on to while it was being cancelled', async () => {
      const { source, jobs, requests, auditEvents } = makeSource();
      requests.cancelDownload.mockRejectedValueOnce(new BadRequestException('The download finished before it could be cancelled'));
      jobs.findActionRows.mockResolvedValueOnce([stored()]).mockResolvedValueOnce([stored({ status: 'completed' })]);

      await expect(source.act('cancel', ['11'], viewerOf(fulfiller))).resolves.toEqual([{ id: '11', outcome: 'skipped', status: 'running' }]);
      expect(auditEvents.emit).not.toHaveBeenCalled();
    });

    it('maps the service refusing, losing the request, or failing outright', async () => {
      const { source, requests } = makeSource();
      requests.cancelDownload
        .mockRejectedValueOnce(new ForbiddenException('no'))
        .mockRejectedValueOnce(new NotFoundException('gone'))
        .mockRejectedValueOnce(new Error('client unreachable'));

      const viewer = viewerOf(fulfiller);
      await expect(source.act('cancel', ['11'], viewer)).resolves.toEqual([{ id: '11', outcome: 'refused', status: 'running' }]);
      await expect(source.act('cancel', ['11'], viewer)).resolves.toEqual([{ id: '11', outcome: 'not-found', status: null }]);
      await expect(source.act('cancel', ['11'], viewer)).resolves.toEqual([{ id: '11', outcome: 'error', status: 'running' }]);
    });

    it('answers every id it was given, in order, acting once per attempt', async () => {
      const { source, requests } = makeSource();

      const results = await source.act('cancel', ['11', '11'], viewerOf(fulfiller));

      expect(results).toEqual([
        { id: '11', outcome: 'done', status: 'cancelled' },
        { id: '11', outcome: 'done', status: 'cancelled' },
      ]);
      expect(requests.cancelDownload).toHaveBeenCalledTimes(1);
    });
  });
});
