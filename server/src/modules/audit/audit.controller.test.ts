import { AuditAction, AuditResource } from '@bookorbit/types';

import { AuditController } from './audit.controller';

describe('AuditController', () => {
  it('maps query DTO values and converts date strings to Date objects', async () => {
    const auditService = {
      getAuditLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getActors: vi.fn(),
    };
    const controller = new AuditController(auditService as never);

    const action = Object.values(AuditAction)[0];
    const resource = Object.values(AuditResource)[0];

    await controller.getAuditLogs({
      userId: 9,
      search: 'Dune',
      actorUsername: 'reader',
      action,
      resource,
      dateFrom: '2026-02-01T00:00:00.000Z',
      dateTo: '2026-02-15T12:34:56.000Z',
      page: 2,
      pageSize: 25,
    });

    expect(auditService.getAuditLogs).toHaveBeenCalledWith({
      userId: 9,
      search: 'Dune',
      actorUsername: 'reader',
      action,
      resource,
      dateFrom: new Date('2026-02-01T00:00:00.000Z'),
      dateTo: new Date('2026-02-15T12:34:56.000Z'),
      page: 2,
      pageSize: 25,
    });
  });

  it('passes undefined filters when optional query values are omitted', async () => {
    const auditService = {
      getAuditLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getActors: vi.fn(),
    };
    const controller = new AuditController(auditService as never);

    await controller.getAuditLogs({
      page: 1,
      pageSize: 50,
    });

    expect(auditService.getAuditLogs).toHaveBeenCalledWith({
      userId: undefined,
      search: undefined,
      actorUsername: undefined,
      action: undefined,
      resource: undefined,
      dateFrom: undefined,
      dateTo: undefined,
      page: 1,
      pageSize: 50,
    });
  });

  it('delegates actor suggestions to the audit service', async () => {
    const actors = [{ userId: 9, username: 'reader' }];
    const auditService = {
      getAuditLogs: vi.fn(),
      getActors: vi.fn().mockResolvedValue(actors),
    };
    const controller = new AuditController(auditService as never);

    await expect(controller.getActors({ q: 'read', limit: 20 })).resolves.toEqual(actors);
    expect(auditService.getActors).toHaveBeenCalledWith('read', 20);
  });

  it('passes the view, category and target filters through to the list and the summary', async () => {
    const auditService = {
      getAuditLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
      getSummary: vi.fn().mockResolvedValue({}),
    };
    const controller = new AuditController(auditService as never);
    const filters = { kind: 'security' as const, category: 'users' as const, securityGroup: 'permissions' as const, resourceId: 40, ip: '127.0.0.1' };

    await controller.getAuditLogs({ ...filters, dateFrom: '2026-10-10T06:00:00.000Z', page: 1, pageSize: 50 });
    await controller.getSummary({ ...filters });

    expect(auditService.getAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ ...filters, dateFrom: new Date('2026-10-10T06:00:00.000Z'), page: 1, pageSize: 50 }),
    );
    expect(auditService.getSummary).toHaveBeenCalledWith(expect.objectContaining(filters));
  });

  it('groups sign-ins in the requested time zone', async () => {
    const auditService = { getSignIns: vi.fn().mockResolvedValue({ data: [], total: 0 }) };
    const controller = new AuditController(auditService as never);

    await controller.getSignIns({ tz: 'America/Denver', actorUsername: 'test1', dateTo: '2026-10-16T09:12:00.000Z', page: 2, pageSize: 25 });

    expect(auditService.getSignIns).toHaveBeenCalledWith({
      search: undefined,
      actorUsername: 'test1',
      ip: undefined,
      dateFrom: undefined,
      dateTo: new Date('2026-10-16T09:12:00.000Z'),
      tz: 'America/Denver',
      page: 2,
      pageSize: 25,
    });
  });

  it('streams the export as a dated attachment', () => {
    function* rows() {
      yield 'id\n';
    }
    const auditService = { exportEvents: vi.fn().mockReturnValue(rows()) };
    const controller = new AuditController(auditService as never);
    const reply = { type: vi.fn(), header: vi.fn(), send: vi.fn() };
    reply.type.mockReturnValue(reply);
    reply.header.mockReturnValue(reply);

    controller.exportEvents({ format: 'json', kind: 'changes' }, reply as never);

    expect(auditService.exportEvents).toHaveBeenCalledWith(expect.objectContaining({ kind: 'changes' }), 'json');
    expect(reply.type).toHaveBeenCalledWith('application/json; charset=utf-8');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringMatching(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.json"/),
    );
    expect(reply.send).toHaveBeenCalledTimes(1);
  });
});
