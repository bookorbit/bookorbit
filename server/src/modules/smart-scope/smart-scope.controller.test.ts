import { BadRequestException } from '@nestjs/common';

import type { BookQuery } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { SmartScopeController } from './smart-scope.controller';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 12,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

describe('SmartScopeController', () => {
  async function expectBadRequest(fn: () => unknown | Promise<unknown>) {
    await expect(Promise.resolve().then(fn)).rejects.toBeInstanceOf(BadRequestException);
  }

  it('forwards each route handler to SmartScopeService with parsed args', async () => {
    const smartScopeService = {
      findAll: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: 1 }),
      create: vi.fn().mockResolvedValue({ id: 2 }),
      reorder: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue({ id: 1, name: 'Updated' }),
      remove: vi.fn().mockResolvedValue(undefined),
      executeSmartScope: vi.fn().mockResolvedValue({ items: [], total: 0, page: 0, size: 50 }),
      queryBooks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 0, size: 50 }),
      queryJumpBuckets: vi.fn().mockResolvedValue({ buckets: [], total: 0 }),
    };
    const controller = new SmartScopeController(smartScopeService as never);
    const user = makeUser();

    await controller.findAll(user);
    await controller.findOne(1, user);
    await controller.create({ name: 'New Smart Scope', icon: 'Aperture' } as never, user);
    await controller.reorder({ order: [{ id: 1, displayOrder: 0 }] } as never, user);
    await controller.update(1, { name: 'Updated' } as never, user);
    await controller.remove(1, user);
    await controller.executeSmartScope(1, user, 2, 25);
    const query: BookQuery = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } };
    await controller.queryBooks(1, query, user);
    await controller.queryJumpBuckets(1, query, user);

    expect(smartScopeService.findAll).toHaveBeenCalledWith(user);
    expect(smartScopeService.findOne).toHaveBeenCalledWith(1, user);
    expect(smartScopeService.create).toHaveBeenCalledWith({ name: 'New Smart Scope', icon: 'Aperture' }, user);
    expect(smartScopeService.reorder).toHaveBeenCalledWith({ order: [{ id: 1, displayOrder: 0 }] }, user);
    expect(smartScopeService.update).toHaveBeenCalledWith(1, { name: 'Updated' }, user);
    expect(smartScopeService.remove).toHaveBeenCalledWith(1, user);
    expect(smartScopeService.executeSmartScope).toHaveBeenCalledWith(1, user, 2, 25, undefined);
    expect(smartScopeService.queryBooks).toHaveBeenCalledWith(1, user, query);
    expect(smartScopeService.queryJumpBuckets).toHaveBeenCalledWith(1, user, query);
  });

  it('rejects invalid page and size boundaries for legacy GET queries', async () => {
    const smartScopeService = {
      findAll: vi.fn(),
      findOne: vi.fn(),
      create: vi.fn(),
      reorder: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      executeSmartScope: vi.fn(),
      queryBooks: vi.fn(),
    };
    const controller = new SmartScopeController(smartScopeService as never);
    const user = makeUser();

    await expectBadRequest(() => controller.executeSmartScope(1, user, -1, 50));
    await expectBadRequest(() => controller.executeSmartScope(1, user, 0, 0));
    await expectBadRequest(() => controller.executeSmartScope(1, user, 0, 101));
    await expectBadRequest(() => controller.executeSmartScope(1, user, 2_000_000, 100));
    expect(smartScopeService.executeSmartScope).not.toHaveBeenCalled();
  });
});
