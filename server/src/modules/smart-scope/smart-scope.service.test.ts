import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { SmartScope } from '../../db/schema/smart-scopes';
import { SmartScopeService } from './smart-scope.service';

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
  };
}

function makeSmartScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return {
    id: 5,
    userId: 12,
    name: 'Favorites',
    icon: 'Aperture',
    filter: null,
    defaultSort: [],
    isPublic: false,
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService() {
  const smartScopeRepo = {
    findAllForUser: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateDisplayOrders: vi.fn(),
  };
  const bookReadService = {
    countWhere: vi.fn(),
    findCards: vi.fn(),
  };
  const queryBuilder = {
    buildWhere: vi.fn(),
    buildOrderBy: vi.fn(),
  };
  const libraryService = {
    findAccessibleLibraryIds: vi.fn(),
  };

  const service = new SmartScopeService(smartScopeRepo as never, bookReadService as never, queryBuilder as never, libraryService as never);
  return { service, smartScopeRepo, bookReadService, queryBuilder, libraryService };
}

describe('SmartScopeService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('findOne throws NotFoundException when smartScope does not exist', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.findById.mockResolvedValue([]);

    await expect(service.findOne(99, makeUser())).rejects.toThrow(NotFoundException);
  });

  it('findOne rejects private smartScope access for non-owner non-superuser', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ userId: 20, isPublic: false })]);

    await expect(service.findOne(5, makeUser({ id: 12, isSuperuser: false }))).rejects.toThrow(ForbiddenException);
  });

  it('findOne allows access to public smartScopes', async () => {
    const { service, smartScopeRepo } = makeService();
    const smartScope = makeSmartScope({ userId: 20, isPublic: true });
    smartScopeRepo.findById.mockResolvedValue([smartScope]);

    await expect(service.findOne(5, makeUser({ id: 12 }))).resolves.toEqual(smartScope);
  });

  it('findAll builds counts with user-accessible library IDs', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookReadService } = makeService();
    const user = makeUser({ id: 8 });
    const firstSmartScope = makeSmartScope({ id: 1, filter: null });
    const secondSmartScope = makeSmartScope({
      id: 2,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'space' }] },
    });

    smartScopeRepo.findAllForUser.mockResolvedValue([firstSmartScope, secondSmartScope]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([2, 3]);
    queryBuilder.buildWhere.mockReturnValueOnce('where-1').mockReturnValueOnce('where-2');
    bookReadService.countWhere.mockResolvedValueOnce(4).mockResolvedValueOnce(7);

    const result = await service.findAll(user);

    expect(queryBuilder.buildWhere).toHaveBeenNthCalledWith(1, firstSmartScope.filter, { accessibleLibraryIds: [2, 3], userId: 8 });
    expect(queryBuilder.buildWhere).toHaveBeenNthCalledWith(2, secondSmartScope.filter, { accessibleLibraryIds: [2, 3], userId: 8 });
    expect(result).toEqual([
      { ...firstSmartScope, bookCount: 4 },
      { ...secondSmartScope, bookCount: 7 },
    ]);
  });

  it('create sets defaults and persists validated values', async () => {
    const { service, smartScopeRepo } = makeService();
    const created = makeSmartScope({ id: 7, isPublic: false, defaultSort: [{ field: 'title', dir: 'asc' }] });
    smartScopeRepo.insert.mockResolvedValue([created]);

    const result = await service.create(
      { name: 'New Smart Scope', icon: 'Aperture', defaultSort: [{ field: 'title', dir: 'asc' }] },
      makeUser({ id: 44 }),
    );

    expect(smartScopeRepo.insert).toHaveBeenCalledWith({
      userId: 44,
      name: 'New Smart Scope',
      icon: 'Aperture',
      filter: null,
      defaultSort: [{ field: 'title', dir: 'asc' }],
      isPublic: false,
    });
    expect(result).toEqual(created);
  });

  it('create rejects missing icons', async () => {
    const { service, smartScopeRepo } = makeService();

    await expect(service.create({ name: 'New Smart Scope', defaultSort: [] } as never, makeUser())).rejects.toThrow(BadRequestException);
    expect(smartScopeRepo.insert).not.toHaveBeenCalled();
  });

  it('update blocks non-owner changes for non-superusers', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ userId: 77 })]);

    await expect(service.update(5, { name: 'Rename' }, makeUser({ id: 12, isSuperuser: false }))).rejects.toThrow(ForbiddenException);
  });

  it('update permits superuser edits and uses smartScope owner for repository write guard', async () => {
    const { service, smartScopeRepo } = makeService();
    const existing = makeSmartScope({ id: 9, userId: 77 });
    const updated = { ...existing, name: 'Renamed' };
    smartScopeRepo.findById.mockResolvedValue([existing]);
    smartScopeRepo.update.mockResolvedValue([updated]);

    const result = await service.update(9, { name: 'Renamed' }, makeUser({ id: 1, isSuperuser: true }));

    expect(smartScopeRepo.update).toHaveBeenCalledWith(9, 77, {
      name: 'Renamed',
      icon: undefined,
      filter: undefined,
      defaultSort: undefined,
      isPublic: undefined,
    });
    expect(result).toEqual(updated);
  });

  it('update rejects changes that would leave a smartScope without an icon', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ icon: null })]);

    await expect(service.update(5, { name: 'Rename' }, makeUser())).rejects.toThrow(BadRequestException);
    expect(smartScopeRepo.update).not.toHaveBeenCalled();
  });

  it('update can clear filter when filter is explicitly null', async () => {
    const { service, smartScopeRepo } = makeService();
    const existing = makeSmartScope({
      id: 3,
      userId: 12,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'old' }] },
    });
    smartScopeRepo.findById.mockResolvedValue([existing]);
    smartScopeRepo.update.mockResolvedValue([{ ...existing, filter: null }]);

    await service.update(3, { filter: null }, makeUser({ id: 12 }));

    expect(smartScopeRepo.update).toHaveBeenCalledWith(
      3,
      12,
      expect.objectContaining({
        filter: null,
      }),
    );
  });

  it('remove blocks non-owner deletes for non-superusers', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ userId: 42 })]);

    await expect(service.remove(5, makeUser({ id: 12, isSuperuser: false }))).rejects.toThrow(ForbiddenException);
  });

  it('remove deletes smartScope for owner', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 5, userId: 12 })]);

    await service.remove(5, makeUser({ id: 12 }));

    expect(smartScopeRepo.delete).toHaveBeenCalledWith(5, 12);
  });

  it('reorder rejects duplicate smartScope IDs before reaching repository', async () => {
    const { service, smartScopeRepo } = makeService();
    const user = makeUser({ id: 12 });

    await expect(
      service.reorder(
        {
          order: [
            { id: 1, displayOrder: 0 },
            { id: 1, displayOrder: 1 },
          ],
        },
        user,
      ),
    ).rejects.toThrow(BadRequestException);

    expect(smartScopeRepo.updateDisplayOrders).not.toHaveBeenCalled();
  });

  it('reorder fails when not all requested smartScope rows are updated', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.updateDisplayOrders.mockResolvedValue(1);

    await expect(
      service.reorder(
        {
          order: [
            { id: 1, displayOrder: 0 },
            { id: 2, displayOrder: 1 },
          ],
        },
        makeUser({ id: 12 }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('reorder succeeds when all requested rows are updated', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.updateDisplayOrders.mockResolvedValue(2);

    await expect(
      service.reorder(
        {
          order: [
            { id: 1, displayOrder: 0 },
            { id: 2, displayOrder: 1 },
          ],
        },
        makeUser({ id: 12 }),
      ),
    ).resolves.toBeUndefined();
  });

  it('executeSmartScope rejects private smartScope access for non-owner non-superuser', async () => {
    const { service, smartScopeRepo } = makeService();
    smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ userId: 100, isPublic: false })]);

    await expect(service.executeSmartScope(5, makeUser({ id: 12, isSuperuser: false }), 0, 20)).rejects.toThrow(ForbiddenException);
  });

  it('executeSmartScope builds query and returns paginated books page', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookReadService } = makeService();
    const smartScope = makeSmartScope({
      id: 5,
      userId: 12,
      isPublic: false,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'test' }] },
      defaultSort: [{ field: 'title', dir: 'asc' }],
    });
    smartScopeRepo.findById.mockResolvedValue([smartScope]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
    queryBuilder.buildWhere.mockReturnValue('where');
    queryBuilder.buildOrderBy.mockReturnValue(['orderBy']);
    bookReadService.findCards.mockResolvedValue({
      rows: [],
      authorRows: [],
      fileRows: [],
      genreRows: [],
      progressRows: [],
      total: 0,
    });

    const result = await service.executeSmartScope(5, makeUser({ id: 12 }), 1, 25);

    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(smartScope.filter, { accessibleLibraryIds: [9], userId: 12 });
    expect(queryBuilder.buildOrderBy).toHaveBeenCalledWith([{ field: 'title', dir: 'asc' }], 12);
    expect(bookReadService.findCards).toHaveBeenCalledWith({
      where: 'where',
      orderBy: ['orderBy'],
      limit: 25,
      offset: 25,
      userId: 12,
    });
    expect(result).toEqual({ items: [], total: 0, page: 1, size: 25 });
  });
});
