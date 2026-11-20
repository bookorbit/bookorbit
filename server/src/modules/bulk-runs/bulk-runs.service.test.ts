import { EventEmitter } from 'events';
import { ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditResource, BULK_RUN_ID_HEADER, BULK_RUN_MAX_UNFINISHED, Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunRow } from '../../db/schema';
import { AUDIT_EVENT } from '../audit/audit-events.service';
import { BulkRunHandlerRegistry } from './bulk-run-handler.registry';
import { BulkRunStreams } from './bulk-run-streams.service';
import { BulkRunsService, type StartBulkRun } from './bulk-runs.service';

const editor = {
  id: 7,
  username: 'editor',
  active: true,
  isSuperuser: false,
  permissions: [Permission.LibraryEditMetadata],
} as unknown as RequestUser;
const other = { id: 9, username: 'other', active: true, isSuperuser: false, permissions: [Permission.LibraryEditMetadata] } as unknown as RequestUser;
const manager = {
  id: 2,
  username: 'manager',
  active: true,
  isSuperuser: false,
  permissions: [Permission.ManageAppSettings],
} as unknown as RequestUser;
const admin = { id: 1, username: 'admin', active: true, isSuperuser: true, permissions: [] } as unknown as RequestUser;
const keyActor = {
  ...editor,
  credential: { kind: 'api_key', keyId: 41, keyName: 'Script', audience: 'api', access: 'write', libraryIds: null, ownerIsSuperuser: false },
} as unknown as RequestUser;
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const AT = new Date('2026-11-15T10:00:00.000Z');

function row(change: Partial<BulkRunRow> = {}): BulkRunRow {
  return {
    id: RUN_ID,
    kind: 'book-refresh-metadata',
    requestedBy: editor.id,
    credentialKind: 'session',
    apiKeyId: null,
    status: 'queued',
    subjectIds: [1, 2],
    options: {},
    total: 2,
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
    ...change,
  };
}

function reply() {
  const raw = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  });
  return { raw, request: { ip: '203.0.113.5' } };
}

function written(raw: ReturnType<typeof reply>['raw']): object[] {
  return raw.write.mock.calls
    .filter(([chunk]) => String(chunk).startsWith('data: '))
    .map(
      ([chunk]) =>
        JSON.parse(
          String(chunk)
            .replace(/^data: /, '')
            .trim(),
        ) as object,
    );
}

function setup() {
  const registry = new BulkRunHandlerRegistry();
  const handler = {
    kind: 'book-refresh-metadata' as const,
    prepare: vi.fn(),
    processItem: vi.fn(),
    finish: vi.fn(),
    doneEvent: vi.fn((run: BulkRunRow) => ({ done: true, processed: run.succeeded, failed: run.failed })),
    continuable: vi.fn(() => true),
  };
  registry.register(handler);
  const streams = new BulkRunStreams();
  const repo = {
    insertWithinLimit: vi.fn((values: Partial<BulkRunRow>): Promise<BulkRunRow | null> => Promise.resolve(row(values))),
    findById: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(row())),
    continueWithinLimit: vi.fn((): Promise<BulkRunRow | 'limit' | null> => Promise.resolve(row({ status: 'queued' }))),
    dismiss: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(row({ status: 'failed', dismissedAt: AT }))),
  };
  const dispatcher = {
    wake: vi.fn(),
    cancel: vi.fn((): Promise<BulkRunRow | null> => Promise.resolve(row({ status: 'cancelled' }))),
  };
  const jobChanges = { notify: vi.fn() };
  const audit = { emit: vi.fn() };
  const service = new BulkRunsService(repo as never, registry, streams, dispatcher as never, jobChanges as never, audit as never);
  return { service, handler, streams, repo, dispatcher, jobChanges, audit };
}

const start = (change: Partial<StartBulkRun> = {}): StartBulkRun => ({
  kind: 'book-refresh-metadata',
  subjectIds: [4, 2, 4, 9],
  options: { ignoreCache: true },
  actor: editor,
  audit: {
    action: AuditAction.BookBulkMetadataRefresh,
    resource: AuditResource.Book,
    description: (count) => `Bulk refreshed metadata for ${count} books`,
  },
  ...change,
});

describe('BulkRunsService', () => {
  describe('startAndStream', () => {
    it('queues the run with its ids deduplicated in order, audits the count and streams with the run id', async () => {
      const { service, repo, audit, dispatcher, streams } = setup();
      const response = reply();
      const following = service.startAndStream(response as never, start());
      await vi.waitFor(() => expect(response.raw.writeHead).toHaveBeenCalled());

      expect(repo.insertWithinLimit).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectIds: [4, 2, 9],
          total: 3,
          credentialKind: 'session',
          apiKeyId: null,
          actorIp: '203.0.113.5',
          options: { ignoreCache: true },
        }),
        BULK_RUN_MAX_UNFINISHED,
      );
      expect(response.raw.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ [BULK_RUN_ID_HEADER]: RUN_ID, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }),
      );
      // A comment goes first so proxies pass the headers on before the run writes anything.
      expect(response.raw.write).toHaveBeenNthCalledWith(1, ': open\n\n');
      expect(audit.emit).toHaveBeenCalledWith(
        AUDIT_EVENT,
        expect.objectContaining({
          userId: editor.id,
          action: AuditAction.BookBulkMetadataRefresh,
          description: 'Bulk refreshed metadata for 3 books',
          meta: { bulkRunId: RUN_ID, count: 3 },
        }),
      );
      expect(dispatcher.wake).toHaveBeenCalled();

      streams.emit(RUN_ID, { bookId: 4, success: true });
      streams.close(RUN_ID, { done: true, processed: 3, failed: 0 });
      await following;
      expect(written(response.raw)).toEqual([
        { bookId: 4, success: true },
        { done: true, processed: 3, failed: 0 },
      ]);
      expect(response.raw.end).toHaveBeenCalled();
    });

    it('records a key run against its key', async () => {
      const { service, repo, audit, streams } = setup();
      const response = reply();
      const following = service.startAndStream(response as never, start({ actor: keyActor }));
      await vi.waitFor(() => expect(response.raw.writeHead).toHaveBeenCalled());
      expect(repo.insertWithinLimit).toHaveBeenCalledWith(
        expect.objectContaining({ credentialKind: 'api_key', apiKeyId: 41 }),
        BULK_RUN_MAX_UNFINISHED,
      );
      expect(audit.emit).toHaveBeenCalledWith(AUDIT_EVENT, expect.objectContaining({ apiKeyId: 41 }));
      streams.close(RUN_ID, null);
      await following;
    });

    it('refuses before the stream starts when the account already has the most unfinished runs', async () => {
      const { service, repo } = setup();
      repo.insertWithinLimit.mockResolvedValue(null);
      const response = reply();
      const refused = await service.startAndStream(response as never, start()).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(HttpException);
      expect((refused as HttpException).getStatus()).toBe(429);
      expect(response.raw.writeHead).not.toHaveBeenCalled();
    });

    it('answers an empty selection at once with the empty done and creates nothing', async () => {
      const { service, repo, audit } = setup();
      const response = reply();
      await service.startAndStream(response as never, start({ subjectIds: [] }));
      expect(repo.insertWithinLimit).not.toHaveBeenCalled();
      expect(audit.emit).not.toHaveBeenCalled();
      expect(written(response.raw)).toEqual([{ done: true, processed: 0, failed: 0 }]);
      expect(response.raw.end).toHaveBeenCalled();
    });

    it('answers from the row when the run settled before the stream attached', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(row({ status: 'completed', succeeded: 2, finishedAt: AT }));
      const response = reply();
      await service.startAndStream(response as never, start());
      expect(written(response.raw)).toEqual([{ done: true, processed: 2, failed: 0 }]);
    });

    it('only detaches when the client leaves; the run is not cancelled', async () => {
      const { service, streams, dispatcher } = setup();
      const response = reply();
      const following = service.startAndStream(response as never, start());
      await vi.waitFor(() => expect(response.raw.writeHead).toHaveBeenCalled());
      response.raw.emit('close');
      await following;
      expect(dispatcher.cancel).not.toHaveBeenCalled();
      streams.emit(RUN_ID, { bookId: 1 });
      expect(written(response.raw)).toEqual([]);
    });
  });

  describe('cancel', () => {
    it('hands the cancel to the dispatcher and answers its row', async () => {
      const { service, dispatcher, audit } = setup();
      await expect(service.cancel(RUN_ID, editor)).resolves.toMatchObject({ status: 'cancelled' });
      expect(dispatcher.cancel).toHaveBeenCalledWith(RUN_ID);
      expect(audit.emit).not.toHaveBeenCalled();
    });

    it('refuses when the run ended while the cancel was on its way', async () => {
      const { service, repo, dispatcher } = setup();
      repo.findById.mockResolvedValue(row({ status: 'running' }));
      dispatcher.cancel.mockResolvedValue(null);
      await expect(service.cancel(RUN_ID, editor)).rejects.toBeInstanceOf(ConflictException);
    });

    it("lets a manager cancel another account's run and audits it", async () => {
      const { service, audit } = setup();
      await service.cancel(RUN_ID, manager);
      expect(audit.emit).toHaveBeenCalledWith(AUDIT_EVENT, expect.objectContaining({ userId: manager.id, action: AuditAction.BulkRunCancel }));
    });

    it("hides another account's run from someone who does not manage runs", async () => {
      const { service } = setup();
      await expect(service.cancel(RUN_ID, other)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a run that already ended', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(row({ status: 'completed' }));
      await expect(service.cancel(RUN_ID, editor)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('continueRun', () => {
    it('returns an interrupted run to the line', async () => {
      const { service, repo, dispatcher } = setup();
      repo.findById.mockResolvedValue(row({ status: 'interrupted', processed: 1, finishedAt: AT }));
      await expect(service.continueRun(RUN_ID, editor)).resolves.toMatchObject({ status: 'queued' });
      expect(repo.continueWithinLimit).toHaveBeenCalledWith(RUN_ID, editor.id, BULK_RUN_MAX_UNFINISHED);
      expect(dispatcher.wake).toHaveBeenCalled();
    });

    it('refuses with 429 when the account already has the most unfinished runs', async () => {
      const { service, repo, dispatcher } = setup();
      repo.findById.mockResolvedValue(row({ status: 'interrupted', finishedAt: AT }));
      repo.continueWithinLimit.mockResolvedValue('limit');
      const refused = await service.continueRun(RUN_ID, editor).catch((error: unknown) => error);
      expect((refused as HttpException).getStatus()).toBe(429);
      expect(dispatcher.wake).not.toHaveBeenCalled();
    });

    it('belongs to the requester or a superuser only', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(row({ status: 'interrupted', finishedAt: AT }));
      await expect(service.continueRun(RUN_ID, manager)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.continueRun(RUN_ID, admin)).resolves.toBeTruthy();
    });

    it('waits while the kind says the run cannot continue yet', async () => {
      const { service, repo, handler } = setup();
      handler.continuable.mockReturnValue(false);
      repo.findById.mockResolvedValue(row({ status: 'interrupted', finishedAt: AT }));
      await expect(service.continueRun(RUN_ID, editor)).rejects.toBeInstanceOf(ConflictException);
      expect(repo.continueWithinLimit).not.toHaveBeenCalled();
    });

    it('refuses a dismissed or never-interrupted run', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValue(row({ status: 'interrupted', dismissedAt: AT }));
      await expect(service.continueRun(RUN_ID, editor)).rejects.toBeInstanceOf(ConflictException);
      repo.findById.mockResolvedValue(row({ status: 'failed' }));
      await expect(service.continueRun(RUN_ID, editor)).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('dismiss', () => {
    it('moves a failed run out of Failed', async () => {
      const { service, repo, jobChanges } = setup();
      repo.findById.mockResolvedValue(row({ status: 'failed' }));
      await service.dismiss(RUN_ID, editor);
      expect(repo.dismiss).toHaveBeenCalledWith(RUN_ID);
      expect(jobChanges.notify).toHaveBeenCalledWith({ type: 'bulk-run', ownerId: editor.id, state: true });
    });

    it('refuses what cannot be dismissed', async () => {
      const { service, repo } = setup();
      repo.dismiss.mockResolvedValue(null);
      await expect(service.dismiss(RUN_ID, editor)).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
