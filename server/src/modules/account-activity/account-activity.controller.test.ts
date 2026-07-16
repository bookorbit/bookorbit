import 'reflect-metadata';

import { Permission } from '@bookorbit/types';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AccountActivityController } from './account-activity.controller';

describe('AccountActivityController', () => {
  it('requires the dedicated view-user-activity permission', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, AccountActivityController)).toBe(Permission.ViewUserActivity);
  });

  it('delegates list, summary, and detail requests', async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [] }),
      getSummary: vi.fn().mockResolvedValue({ recent: 0, dormant: 0, never: 0, disabled: 0 }),
      getDetail: vi.fn().mockResolvedValue({ id: 7 }),
    };
    const controller = new AccountActivityController(service as never);
    const query = { page: 1, pageSize: 50, sortBy: 'lastAuthenticatedAt' as const, sortDir: 'desc' as const };

    await expect(controller.list(query)).resolves.toEqual({ items: [] });
    await expect(controller.getSummary()).resolves.toMatchObject({ recent: 0 });
    await expect(controller.getDetail(7)).resolves.toEqual({ id: 7 });
    expect(service.getDetail).toHaveBeenCalledWith(7);
  });
});
