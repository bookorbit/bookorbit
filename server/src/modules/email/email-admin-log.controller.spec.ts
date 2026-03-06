import { ForbiddenException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { EmailAdminLogController } from './email-admin-log.controller';
import type { QuerySendLogDto } from './dto/query-send-log.dto';
import { EmailSendLogService } from './email-send-log.service';

describe('EmailAdminLogController', () => {
  const superuser: RequestUser = {
    id: 1,
    username: 'admin',
    name: 'Admin User',
    email: 'admin@example.com',
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'manual',
    roles: [{ id: 1, name: 'Admin', description: '', isSuperuser: true, isSystem: false, permissions: [] }],
  };

  const normalUser: RequestUser = {
    ...superuser,
    id: 2,
    roles: [{ id: 2, name: 'User', description: '', isSuperuser: false, isSystem: false, permissions: [] }],
  };

  it('uses default pagination values when query is empty', async () => {
    const service = { findAllAdmin: jest.fn().mockResolvedValue([]) } as unknown as EmailSendLogService;
    const controller = new EmailAdminLogController(service);

    await controller.findAll({} as QuerySendLogDto, superuser);

    expect(service.findAllAdmin).toHaveBeenCalledWith(0, 20);
  });

  it('forwards explicit page and size to service', async () => {
    const service = { findAllAdmin: jest.fn().mockResolvedValue([]) } as unknown as EmailSendLogService;
    const controller = new EmailAdminLogController(service);

    await controller.findAll({ page: 3, size: 50 }, superuser);

    expect(service.findAllAdmin).toHaveBeenCalledWith(3, 50);
  });

  it('rejects non-superusers before hitting service', () => {
    const service = { findAllAdmin: jest.fn() } as unknown as EmailSendLogService;
    const controller = new EmailAdminLogController(service);

    expect(() => controller.findAll({ page: 1, size: 10 }, normalUser)).toThrow(ForbiddenException);
    expect(service.findAllAdmin).not.toHaveBeenCalled();
  });
});
