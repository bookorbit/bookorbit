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
});
