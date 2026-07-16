import { APP_SETTING_KEYS, DEFAULT_AUDIT_RETENTION_DAYS } from '../../common/constants/app-settings.constants';
import { AuditAction } from '@bookorbit/types';
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
    findReadingInsightsAccess: vi.fn(),
    deleteOlderThan: vi.fn().mockResolvedValue(undefined),
  };
  const appSettings = {
    getValue: vi.fn(),
  };

  const service = new AuditService(auditEvents as never, auditRepository as never, appSettings as never);
  return { service, auditEvents, auditRepository, appSettings };
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
      description: 'updated book metadata',
      ip: null,
      meta: null,
    });

    await service.onModuleDestroy();
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
    expect(result).toEqual({ data: [{ id: 1 }], total: 1 });
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
