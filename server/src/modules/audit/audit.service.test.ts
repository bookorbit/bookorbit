import { APP_SETTING_KEYS, DEFAULT_AUDIT_RETENTION_DAYS } from '../../common/constants/app-settings.constants';
import { AuditAction, AuditResource } from '@bookorbit/types';
import { AUDIT_EVENT, AuditEventsService } from './audit-events.service';
import { AuditService } from './audit.service';

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makePayload(overrides?: Record<string, unknown>) {
  return {
    userId: 12,
    actorUsername: 'admin',
    action: AuditAction.BookMetadataUpdate,
    resource: undefined,
    resourceId: undefined,
    description: 'updated book metadata',
    ip: undefined,
    meta: undefined,
    ...overrides,
  };
}

function makeService() {
  const auditEvents = new AuditEventsService();
  const auditRepository = {
    insert: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn(),
    findActors: vi.fn(),
    findReadingInsightsAccess: vi.fn(),
    deleteOlderThan: vi.fn().mockResolvedValue(undefined),
    summarize: vi.fn(),
    findSignInGroups: vi.fn(),
    findExportBatch: vi.fn(),
  };
  const appSettings = {
    getValue: vi.fn(),
  };
  const targetLabels = {
    attach: vi.fn((rows: Array<Record<string, unknown>>) =>
      Promise.resolve(rows.map(({ resourceLabel, ...row }) => ({ ...row, targetLabel: resourceLabel ?? null, targetExists: null }))),
    ),
    resolveForWrite: vi.fn().mockResolvedValue(null),
    actorNames: vi.fn().mockResolvedValue(new Map([[2, 'Test One']])),
  };

  const service = new AuditService(auditEvents as never, auditRepository as never, appSettings as never, targetLabels as never);
  return { service, auditEvents, auditRepository, appSettings, targetLabels };
}

describe('AuditService', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers and unregisters the audit event listener', async () => {
    const { service, auditEvents } = makeService();
    const onSpy = vi.spyOn(auditEvents, 'on');
    const offSpy = vi.spyOn(auditEvents, 'off');

    service.onModuleInit();
    expect(onSpy).toHaveBeenCalledWith(AUDIT_EVENT, expect.any(Function));

    await service.onModuleDestroy();
    expect(offSpy).toHaveBeenCalledWith(AUDIT_EVENT, expect.any(Function));
  });

  it('writes normalized audit records when events are emitted', async () => {
    const { service, auditEvents, auditRepository } = makeService();
    service.onModuleInit();

    auditEvents.emit(AUDIT_EVENT, makePayload());
    await flushMicrotasks();

    expect(auditRepository.insert).toHaveBeenCalledWith({
      userId: 12,
      actorUsername: 'admin',
      action: AuditAction.BookMetadataUpdate,
      resource: null,
      resourceId: null,
      resourceLabel: null,
      description: 'updated book metadata',
      ip: null,
      meta: null,
    });

    await service.onModuleDestroy();
  });

  it('snapshots the target name with the event so a deleted target can still be named', async () => {
    const { service, auditRepository, targetLabels } = makeService();
    targetLabels.resolveForWrite.mockResolvedValue('Science Fiction');

    await service.record(makePayload({ action: AuditAction.LibraryUpdate, resource: AuditResource.Library, resourceId: 7 }));

    expect(targetLabels.resolveForWrite).toHaveBeenCalledWith(AuditResource.Library, 7);
    expect(auditRepository.insert).toHaveBeenCalledWith(expect.objectContaining({ resourceId: 7, resourceLabel: 'Science Fiction' }));
  });

  it('keeps a name read before the target was deleted instead of looking it up again', async () => {
    const { service, auditRepository, targetLabels } = makeService();

    await service.record(
      makePayload({ action: AuditAction.LibraryDelete, resource: AuditResource.Library, resourceId: 7, resourceLabel: 'Old Shelf' }),
    );

    expect(targetLabels.resolveForWrite).not.toHaveBeenCalled();
    expect(auditRepository.insert).toHaveBeenCalledWith(expect.objectContaining({ resourceLabel: 'Old Shelf' }));
  });

  it('drops writes when queue reaches max concurrent capacity', async () => {
    const { service, auditEvents, auditRepository } = makeService();
    const allPending = Array.from({ length: 20 }, () => deferred());
    const queue = [...allPending];
    auditRepository.insert.mockImplementation(() => queue.shift()!.promise);
    const warnSpy = vi.spyOn((service as { logger: { warn: (message: string) => void } }).logger, 'warn').mockImplementation(() => undefined);

    service.onModuleInit();

    for (let i = 0; i < 21; i += 1) {
      auditEvents.emit(AUDIT_EVENT, makePayload({ description: `event-${i}` }));
    }

    expect(auditRepository.insert).toHaveBeenCalledTimes(20);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('write queue full'));

    for (const item of allPending) {
      item.resolve();
    }
    await service.onModuleDestroy();
  });

  it('logs insert failures without throwing to callers', async () => {
    const { service, auditEvents, auditRepository } = makeService();
    auditRepository.insert.mockRejectedValueOnce(new Error('database unavailable'));
    const errorSpy = vi.spyOn((service as { logger: { error: (message: string) => void } }).logger, 'error').mockImplementation(() => undefined);

    service.onModuleInit();
    auditEvents.emit(AUDIT_EVENT, makePayload());
    await flushMicrotasks();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('database unavailable'));
    await service.onModuleDestroy();
  });

  it('waits for pending writes during module destroy', async () => {
    const { service, auditEvents, auditRepository } = makeService();
    const pendingWrite = deferred();
    auditRepository.insert.mockImplementationOnce(() => pendingWrite.promise);
    service.onModuleInit();
    auditEvents.emit(AUDIT_EVENT, makePayload());

    let completed = false;
    const destroyPromise = service.onModuleDestroy().then(() => {
      completed = true;
    });

    await flushMicrotasks();
    expect(completed).toBe(false);

    pendingWrite.resolve();
    await destroyPromise;
    expect(completed).toBe(true);
  });

  it('delegates getAuditLogs query to repository', async () => {
    const { service, auditRepository } = makeService();
    const query = { page: 1, pageSize: 50 };
    auditRepository.findAll.mockResolvedValue({ data: [{ id: 1 }], total: 1 });

    const result = await service.getAuditLogs(query);

    expect(auditRepository.findAll).toHaveBeenCalledWith(query);
    expect(result).toEqual({ data: [{ id: 1, targetLabel: null, targetExists: null }], total: 1 });
  });

  it('returns view counts with the configured retention', async () => {
    const { service, auditRepository, appSettings } = makeService();
    appSettings.getValue.mockResolvedValue('30');
    auditRepository.summarize.mockResolvedValue({
      kinds: { all: 10, changes: 4, signins: 6, security: 2 },
      categories: { access: 6, libraries: 4 },
      securityGroups: { failed: 1, accounts: 1, passwords: 0, permissions: 0, access: 0, links: 0 },
      oldestAt: new Date('2026-08-15T04:32:57.000Z'),
    });

    const summary = await service.getSummary({ kind: 'changes' });

    expect(auditRepository.summarize).toHaveBeenCalledWith({ kind: 'changes' });
    expect(summary).toEqual({
      kinds: { all: 10, changes: 4, signins: 6, security: 2 },
      categories: { access: 6, libraries: 4 },
      securityGroups: { failed: 1, accounts: 1, passwords: 0, permissions: 0, access: 0, links: 0 },
      retentionDays: 30,
      oldestAt: '2026-08-15T04:32:57.000Z',
    });
  });

  it('serialises sign-in group times as ISO strings', async () => {
    const { service, auditRepository } = makeService();
    auditRepository.findSignInGroups.mockResolvedValue({
      data: [
        {
          day: '2026-10-15',
          actorUsername: 'test1',
          userId: 2,
          ip: '192.168.8.230',
          signIns: 1,
          signOuts: 1,
          failed: 1,
          failedUsernames: ['test1'],
          firstAt: new Date('2026-10-16T01:49:37Z'),
          lastAt: '2026-10-16T02:02:00Z',
        },
      ],
      total: '1',
    });

    const page = await service.getSignIns({ tz: 'America/Denver', page: 1, pageSize: 50 });

    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      actorName: 'Test One',
      firstAt: '2026-10-16T01:49:37.000Z',
      lastAt: '2026-10-16T02:02:00.000Z',
      failedUsernames: ['test1'],
    });
  });

  it('exports CSV in id batches and defuses spreadsheet formulas', async () => {
    const { service, auditRepository } = makeService();
    const row = (id: number, description: string) => ({
      id,
      userId: 1,
      actorUsername: 'neon',
      action: AuditAction.LibraryCreate,
      resource: AuditResource.Library,
      resourceId: id,
      resourceLabel: '=HYPERLINK("x")',
      description,
      ip: '127.0.0.1',
      meta: null,
      createdAt: new Date('2026-10-14T22:37:27Z'),
    });
    auditRepository.findExportBatch
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => row(i + 1, 'Created library')))
      .mockResolvedValueOnce([row(501, 'Says "hi", twice')]);

    const chunks: string[] = [];
    for await (const chunk of service.exportEvents({ kind: 'changes' }, 'csv')) chunks.push(chunk);

    expect(auditRepository.findExportBatch).toHaveBeenNthCalledWith(1, { kind: 'changes' }, 0, 500);
    expect(auditRepository.findExportBatch).toHaveBeenNthCalledWith(2, { kind: 'changes' }, 500, 500);
    expect(chunks).toHaveLength(502);
    expect(chunks[0]).toBe('id,occurred_at,actor,user_id,action,category,target_type,target_id,target,ip,description,meta\n');
    expect(chunks[501]).toBe(
      `501,2026-10-14T22:37:27.000Z,neon,1,library.create,libraries,library,501,"'=HYPERLINK(""x"")",127.0.0.1,"Says ""hi"", twice",\n`,
    );
  });

  it('exports JSON as one array', async () => {
    const { service, auditRepository } = makeService();
    auditRepository.findExportBatch.mockResolvedValueOnce([
      {
        id: 3,
        userId: null,
        actorUsername: 'system',
        action: AuditAction.BookRequestImport,
        resource: AuditResource.BookRequest,
        resourceId: 9,
        resourceLabel: null,
        description: 'Imported',
        ip: null,
        meta: { format: 'm4b' },
        createdAt: new Date('2026-10-14T23:56:00Z'),
      },
    ]);

    let body = '';
    for await (const chunk of service.exportEvents({}, 'json')) body += chunk;

    expect(JSON.parse(body)).toEqual([
      {
        id: 3,
        occurredAt: '2026-10-14T23:56:00.000Z',
        actorUsername: 'system',
        userId: null,
        action: 'book_request.import',
        category: 'requests',
        resource: 'book_request',
        resourceId: 9,
        targetLabel: null,
        ip: null,
        description: 'Imported',
        meta: { format: 'm4b' },
      },
    ]);
  });

  it('delegates actor suggestions to the repository', async () => {
    const { service, auditRepository } = makeService();
    auditRepository.findActors.mockResolvedValue([
      { userId: 2, username: 'test1' },
      { userId: null, username: 'system' },
    ]);

    await expect(service.getActors('adm', 25)).resolves.toEqual([
      { userId: 2, username: 'test1', name: 'Test One' },
      { userId: null, username: 'system', name: null },
    ]);
    expect(auditRepository.findActors).toHaveBeenCalledWith('adm', 25);
  });

  it('writes critical audit records synchronously', async () => {
    const { service, auditRepository } = makeService();
    const payload = makePayload({ action: AuditAction.ReadingInsightsProfileView });

    await service.record(payload);

    expect(auditRepository.insert).toHaveBeenCalledWith(expect.objectContaining({ action: AuditAction.ReadingInsightsProfileView }));
  });

  it('scopes reading-insights access history to the subject user', async () => {
    const { service, auditRepository } = makeService();
    auditRepository.findReadingInsightsAccess.mockResolvedValue({ items: [], total: 0 });

    await service.getReadingInsightsAccess(12, 2, 20);

    expect(auditRepository.findReadingInsightsAccess).toHaveBeenCalledWith(12, 2, 20);
  });

  it('returns default retention days when setting is missing or invalid', async () => {
    const { service, appSettings } = makeService();
    appSettings.getValue.mockResolvedValueOnce(null).mockResolvedValueOnce('0').mockResolvedValueOnce('not-a-number');

    await expect(service.getRetentionDays()).resolves.toBe(DEFAULT_AUDIT_RETENTION_DAYS);
    await expect(service.getRetentionDays()).resolves.toBe(DEFAULT_AUDIT_RETENTION_DAYS);
    await expect(service.getRetentionDays()).resolves.toBe(DEFAULT_AUDIT_RETENTION_DAYS);
  });

  it('parses positive configured retention days', async () => {
    const { service, appSettings } = makeService();
    appSettings.getValue.mockResolvedValue('45');

    await expect(service.getRetentionDays()).resolves.toBe(45);
    expect(appSettings.getValue).toHaveBeenCalledWith(APP_SETTING_KEYS.AUDIT_RETENTION_DAYS);
  });

  it('falls back to default retention days when settings lookup throws', async () => {
    const { service, appSettings } = makeService();
    appSettings.getValue.mockRejectedValue(new Error('settings read failed'));
    const errorSpy = vi.spyOn((service as { logger: { error: (message: string) => void } }).logger, 'error').mockImplementation(() => undefined);

    await expect(service.getRetentionDays()).resolves.toBe(DEFAULT_AUDIT_RETENTION_DAYS);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('settings read failed'));
  });

  it('runRetentionCleanup deletes old records based on configured retention window', async () => {
    const { service, appSettings, auditRepository } = makeService();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-21T00:00:00.000Z'));
    appSettings.getValue.mockResolvedValue('10');

    await service.runRetentionCleanup();

    expect(auditRepository.deleteOlderThan).toHaveBeenCalledTimes(1);
    const cutoff = auditRepository.deleteOlderThan.mock.calls[0][0] as Date;
    expect(cutoff.toISOString()).toBe('2026-04-11T00:00:00.000Z');
  });

  it('runRetentionCleanup rethrows repository failures', async () => {
    const { service, appSettings, auditRepository } = makeService();
    appSettings.getValue.mockResolvedValue('14');
    auditRepository.deleteOlderThan.mockRejectedValue(new Error('cleanup failed'));

    await expect(service.runRetentionCleanup()).rejects.toThrow('cleanup failed');
  });
});
