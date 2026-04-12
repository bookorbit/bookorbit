import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import type { Lens } from '../../db/schema/lenses';
import { LensService } from './lens.service';

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

function makeLens(overrides: Partial<Lens> = {}): Lens {
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
  const lensRepo = {
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

  const service = new LensService(lensRepo as never, bookReadService as never, queryBuilder as never, libraryService as never);
  return { service, lensRepo, bookReadService, queryBuilder, libraryService };
}

describe('LensService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('findOne throws NotFoundException when lens does not exist', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.findById.mockResolvedValue([]);

    await expect(service.findOne(99, makeUser())).rejects.toThrow(NotFoundException);
  });

  it('findOne rejects private lens access for non-owner non-superuser', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.findById.mockResolvedValue([makeLens({ userId: 20, isPublic: false })]);

    await expect(service.findOne(5, makeUser({ id: 12, isSuperuser: false }))).rejects.toThrow(ForbiddenException);
  });

  it('findOne allows access to public lenses', async () => {
    const { service, lensRepo } = makeService();
    const lens = makeLens({ userId: 20, isPublic: true });
    lensRepo.findById.mockResolvedValue([lens]);

    await expect(service.findOne(5, makeUser({ id: 12 }))).resolves.toEqual(lens);
  });

  it('findAll builds counts with user-accessible library IDs', async () => {
    const { service, lensRepo, libraryService, queryBuilder, bookReadService } = makeService();
    const user = makeUser({ id: 8 });
    const firstLens = makeLens({ id: 1, filter: null });
    const secondLens = makeLens({
      id: 2,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'space' }] },
    });

    lensRepo.findAllForUser.mockResolvedValue([firstLens, secondLens]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([2, 3]);
    queryBuilder.buildWhere.mockReturnValueOnce('where-1').mockReturnValueOnce('where-2');
    bookReadService.countWhere.mockResolvedValueOnce(4).mockResolvedValueOnce(7);

    const result = await service.findAll(user);

    expect(queryBuilder.buildWhere).toHaveBeenNthCalledWith(1, firstLens.filter, { accessibleLibraryIds: [2, 3], userId: 8 });
    expect(queryBuilder.buildWhere).toHaveBeenNthCalledWith(2, secondLens.filter, { accessibleLibraryIds: [2, 3], userId: 8 });
    expect(result).toEqual([
      { ...firstLens, bookCount: 4 },
      { ...secondLens, bookCount: 7 },
    ]);
  });

  it('create sets defaults and persists validated values', async () => {
    const { service, lensRepo } = makeService();
    const created = makeLens({ id: 7, isPublic: false, defaultSort: [{ field: 'title', dir: 'asc' }] });
    lensRepo.insert.mockResolvedValue([created]);

    const result = await service.create({ name: 'New Lens', icon: 'Aperture', defaultSort: [{ field: 'title', dir: 'asc' }] }, makeUser({ id: 44 }));

    expect(lensRepo.insert).toHaveBeenCalledWith({
      userId: 44,
      name: 'New Lens',
      icon: 'Aperture',
      filter: null,
      defaultSort: [{ field: 'title', dir: 'asc' }],
      isPublic: false,
    });
    expect(result).toEqual(created);
  });

  it('create rejects missing icons', async () => {
    const { service, lensRepo } = makeService();

    await expect(service.create({ name: 'New Lens', defaultSort: [] } as never, makeUser())).rejects.toThrow(BadRequestException);
    expect(lensRepo.insert).not.toHaveBeenCalled();
  });

  it('update blocks non-owner changes for non-superusers', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.findById.mockResolvedValue([makeLens({ userId: 77 })]);

    await expect(service.update(5, { name: 'Rename' }, makeUser({ id: 12, isSuperuser: false }))).rejects.toThrow(ForbiddenException);
  });

  it('update permits superuser edits and uses lens owner for repository write guard', async () => {
    const { service, lensRepo } = makeService();
    const existing = makeLens({ id: 9, userId: 77 });
    const updated = { ...existing, name: 'Renamed' };
    lensRepo.findById.mockResolvedValue([existing]);
    lensRepo.update.mockResolvedValue([updated]);

    const result = await service.update(9, { name: 'Renamed' }, makeUser({ id: 1, isSuperuser: true }));

    expect(lensRepo.update).toHaveBeenCalledWith(9, 77, {
      name: 'Renamed',
      icon: undefined,
      filter: undefined,
      defaultSort: undefined,
      isPublic: undefined,
    });
    expect(result).toEqual(updated);
  });

  it('update rejects changes that would leave a lens without an icon', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.findById.mockResolvedValue([makeLens({ icon: null })]);

    await expect(service.update(5, { name: 'Rename' }, makeUser())).rejects.toThrow(BadRequestException);
    expect(lensRepo.update).not.toHaveBeenCalled();
  });

  it('update can clear filter when filter is explicitly null', async () => {
    const { service, lensRepo } = makeService();
    const existing = makeLens({
      id: 3,
      userId: 12,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'old' }] },
    });
    lensRepo.findById.mockResolvedValue([existing]);
    lensRepo.update.mockResolvedValue([{ ...existing, filter: null }]);

    await service.update(3, { filter: null }, makeUser({ id: 12 }));

    expect(lensRepo.update).toHaveBeenCalledWith(
      3,
      12,
      expect.objectContaining({
        filter: null,
      }),
    );
  });

  it('remove blocks non-owner deletes for non-superusers', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.findById.mockResolvedValue([makeLens({ userId: 42 })]);

    await expect(service.remove(5, makeUser({ id: 12, isSuperuser: false }))).rejects.toThrow(ForbiddenException);
  });

  it('remove deletes lens for owner', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.findById.mockResolvedValue([makeLens({ id: 5, userId: 12 })]);

    await service.remove(5, makeUser({ id: 12 }));

    expect(lensRepo.delete).toHaveBeenCalledWith(5, 12);
  });

  it('reorder rejects duplicate lens IDs before reaching repository', async () => {
    const { service, lensRepo } = makeService();
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

    expect(lensRepo.updateDisplayOrders).not.toHaveBeenCalled();
  });

  it('reorder fails when not all requested lens rows are updated', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.updateDisplayOrders.mockResolvedValue(1);

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
    const { service, lensRepo } = makeService();
    lensRepo.updateDisplayOrders.mockResolvedValue(2);

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

  it('executeLens rejects private lens access for non-owner non-superuser', async () => {
    const { service, lensRepo } = makeService();
    lensRepo.findById.mockResolvedValue([makeLens({ userId: 100, isPublic: false })]);

    await expect(service.executeLens(5, makeUser({ id: 12, isSuperuser: false }), 0, 20)).rejects.toThrow(ForbiddenException);
  });

  it('executeLens builds query and returns paginated books page', async () => {
    const { service, lensRepo, libraryService, queryBuilder, bookReadService } = makeService();
    const lens = makeLens({
      id: 5,
      userId: 12,
      isPublic: false,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'test' }] },
      defaultSort: [{ field: 'title', dir: 'asc' }],
    });
    lensRepo.findById.mockResolvedValue([lens]);
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

    const result = await service.executeLens(5, makeUser({ id: 12 }), 1, 25);

    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(lens.filter, { accessibleLibraryIds: [9], userId: 12 });
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
