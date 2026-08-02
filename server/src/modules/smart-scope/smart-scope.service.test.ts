import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { BookQuery } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { SmartScope } from '../../db/schema/smart-scopes';
import { SmartScopeService } from './smart-scope.service';
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

function makeSmartScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return {
    id: 5,
    userId: 12,
    name: 'Favorites',
    icon: 'Aperture',
    filter: null,
    defaultSort: [],
    isPublic: false,
    syncToKobo: false,
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
    findKoboSyncScopesForUser: vi.fn(),
    findKoboSubscribedScopeIds: vi.fn().mockResolvedValue([]),
    subscribeToKobo: vi.fn(),
    unsubscribeFromKobo: vi.fn(),
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
  const bookService = {
    executeBooksQuery: vi.fn(),
    executeJumpBucketsQuery: vi.fn(),
  };

  const service = new SmartScopeService(
    smartScopeRepo as never,
    bookReadService as never,
    queryBuilder as never,
    libraryService as never,
    bookService as never,
  );
  return { service, smartScopeRepo, bookReadService, queryBuilder, libraryService, bookService };
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

    await expect(service.findOne(5, makeUser({ id: 12 }))).resolves.toEqual({ ...smartScope, isOwner: false, koboSyncEnabled: false });
  });

  it('findAll returns bookCount=0 without querying for filter-less smart scopes', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookReadService } = makeService();
    const user = makeUser({ id: 8 });
    const firstSmartScope = makeSmartScope({ id: 1, filter: null });
    const secondSmartScope = makeSmartScope({
      id: 2,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'space' }] },
    });

    smartScopeRepo.findAllForUser.mockResolvedValue([firstSmartScope, secondSmartScope]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([2, 3]);
    queryBuilder.buildWhere.mockReturnValueOnce('where-2');
    bookReadService.countWhere.mockResolvedValueOnce(7);

    const result = await service.findAll(user);

    expect(queryBuilder.buildWhere).toHaveBeenCalledTimes(1);
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(secondSmartScope.filter, { accessibleLibraryIds: [2, 3], userId: 8, timeZone: 'UTC' });
    expect(result).toEqual([
      { ...firstSmartScope, isOwner: false, koboSyncEnabled: false, bookCount: 0 },
      { ...secondSmartScope, isOwner: false, koboSyncEnabled: false, bookCount: 7 },
    ]);
  });

  it('findAll marks a single broken scope count unavailable instead of failing the whole list (issue #787 regression)', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookReadService } = makeService();
    const logger = (service as unknown as { logger: Logger }).logger;
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const user = makeUser({ id: 8 });
    const brokenScope = makeSmartScope({
      id: 1,
      name: 'Broken Scope',
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'finishedAt', operator: 'after', value: '21-12-31' }] },
    });
    const healthyScope = makeSmartScope({
      id: 2,
      name: 'Healthy Scope',
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'space' }] },
    });

    smartScopeRepo.findAllForUser.mockResolvedValue([brokenScope, healthyScope]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([2, 3]);
    queryBuilder.buildWhere.mockReturnValueOnce('where-2');
    bookReadService.countWhere.mockResolvedValueOnce(7);

    const result = await service.findAll(user);

    expect(result).toEqual([
      { ...brokenScope, isOwner: false, koboSyncEnabled: false, bookCount: null },
      { ...healthyScope, isOwner: false, koboSyncEnabled: false, bookCount: 7 },
    ]);
    expect(queryBuilder.buildWhere).toHaveBeenCalledTimes(1);
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(healthyScope.filter, { accessibleLibraryIds: [2, 3], userId: 8, timeZone: 'UTC' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[smart_scope.count] [fail] scopeId=1 userId=8'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('durationMs='));
  });

  describe('Kobo sync opt-in for shared scopes', () => {
    it('reports the owner flag for own scopes and the opt-in for shared ones', async () => {
      const { service, smartScopeRepo, libraryService } = makeService();
      const user = makeUser({ id: 8 });
      const own = makeSmartScope({ id: 1, userId: 8, filter: null, syncToKobo: true });
      const subscribedShare = makeSmartScope({ id: 2, userId: 20, filter: null, isPublic: true, syncToKobo: false });
      const ignoredShare = makeSmartScope({ id: 3, userId: 20, filter: null, isPublic: true, syncToKobo: true });

      smartScopeRepo.findAllForUser.mockResolvedValue([own, subscribedShare, ignoredShare]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
      smartScopeRepo.findKoboSubscribedScopeIds.mockResolvedValue([2]);

      const result = await service.findAll(user);

      // Only shared scopes need a subscription lookup; the user's own rows carry their own flag.
      expect(smartScopeRepo.findKoboSubscribedScopeIds).toHaveBeenCalledWith(8, [2, 3]);
      expect(result).toEqual([
        expect.objectContaining({ id: 1, isOwner: true, koboSyncEnabled: true }),
        expect.objectContaining({ id: 2, isOwner: false, koboSyncEnabled: true }),
        // Shared and flagged by its owner, but this user never opted in.
        expect.objectContaining({ id: 3, isOwner: false, koboSyncEnabled: false }),
      ]);
    });

    it('does not leak the owner Kobo preference as the viewer own sync state', async () => {
      const { service, smartScopeRepo } = makeService();
      const shared = makeSmartScope({ id: 4, userId: 20, isPublic: true, syncToKobo: true });
      smartScopeRepo.findById.mockResolvedValue([shared]);
      smartScopeRepo.findKoboSubscribedScopeIds.mockResolvedValue([]);

      const result = await service.findOne(4, makeUser({ id: 8 }));

      expect(result).toEqual(expect.objectContaining({ syncToKobo: true, koboSyncEnabled: false, isOwner: false }));
    });

    it('writes the scope flag when the owner toggles their own scope', async () => {
      const { service, smartScopeRepo } = makeService();
      const own = makeSmartScope({ id: 5, userId: 8, syncToKobo: false });
      smartScopeRepo.findById.mockResolvedValue([own]);
      smartScopeRepo.update.mockResolvedValue([{ ...own, syncToKobo: true }]);

      const result = await service.setKoboSync(5, makeUser({ id: 8 }), true);

      expect(smartScopeRepo.update).toHaveBeenCalledWith(5, 8, { syncToKobo: true });
      expect(smartScopeRepo.subscribeToKobo).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ isOwner: true, koboSyncEnabled: true, syncToKobo: true }));
    });

    it('subscribes a non-owner without touching the shared scope row', async () => {
      const { service, smartScopeRepo } = makeService();
      const shared = makeSmartScope({ id: 6, userId: 20, isPublic: true, syncToKobo: false });
      smartScopeRepo.findById.mockResolvedValue([shared]);

      const result = await service.setKoboSync(6, makeUser({ id: 8 }), true);

      expect(smartScopeRepo.subscribeToKobo).toHaveBeenCalledWith(8, 6);
      expect(smartScopeRepo.update).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ isOwner: false, koboSyncEnabled: true, syncToKobo: false }));
    });

    it('unsubscribes a non-owner without touching the shared scope row', async () => {
      const { service, smartScopeRepo } = makeService();
      const shared = makeSmartScope({ id: 6, userId: 20, isPublic: true, syncToKobo: true });
      smartScopeRepo.findById.mockResolvedValue([shared]);

      const result = await service.setKoboSync(6, makeUser({ id: 8 }), false);

      expect(smartScopeRepo.unsubscribeFromKobo).toHaveBeenCalledWith(8, 6);
      expect(smartScopeRepo.update).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ koboSyncEnabled: false }));
    });

    it('opts a superuser in for themselves instead of flipping another user scope flag', async () => {
      const { service, smartScopeRepo } = makeService();
      const shared = makeSmartScope({ id: 7, userId: 20, isPublic: true, syncToKobo: false });
      smartScopeRepo.findById.mockResolvedValue([shared]);

      await service.setKoboSync(7, makeUser({ id: 1, isSuperuser: true }), true);

      expect(smartScopeRepo.subscribeToKobo).toHaveBeenCalledWith(1, 7);
      expect(smartScopeRepo.update).not.toHaveBeenCalled();
    });

    it('rejects a non-owner opting into a scope that is not shared', async () => {
      const { service, smartScopeRepo } = makeService();
      smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 8, userId: 20, isPublic: false })]);

      await expect(service.setKoboSync(8, makeUser({ id: 8 }), true)).rejects.toThrow(ForbiddenException);
      expect(smartScopeRepo.subscribeToKobo).not.toHaveBeenCalled();
    });

    it('rejects a superuser opting into a private scope of another user', async () => {
      const { service, smartScopeRepo } = makeService();
      smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 9, userId: 20, isPublic: false })]);

      await expect(service.setKoboSync(9, makeUser({ id: 1, isSuperuser: true }), true)).rejects.toThrow(ForbiddenException);
      expect(smartScopeRepo.subscribeToKobo).not.toHaveBeenCalled();
      expect(smartScopeRepo.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing scope', async () => {
      const { service, smartScopeRepo } = makeService();
      smartScopeRepo.findById.mockResolvedValue([]);

      await expect(service.setKoboSync(99, makeUser(), true)).rejects.toThrow(NotFoundException);
    });

    it('delegates Kobo sync scope resolution to the repository', async () => {
      const { service, smartScopeRepo } = makeService();
      const scopes = [makeSmartScope({ id: 1 })];
      smartScopeRepo.findKoboSyncScopesForUser.mockResolvedValue(scopes);

      await expect(service.findKoboSyncScopes(8)).resolves.toBe(scopes);
      expect(smartScopeRepo.findKoboSyncScopesForUser).toHaveBeenCalledWith(8);
    });
  });

  it('findAll propagates unexpected count query failures', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookReadService } = makeService();
    const user = makeUser({ id: 8 });
    const brokenScope = makeSmartScope({
      id: 3,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'space' }] },
    });

    smartScopeRepo.findAllForUser.mockResolvedValue([brokenScope]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([2, 3]);
    queryBuilder.buildWhere.mockReturnValueOnce('where-3');
    bookReadService.countWhere.mockRejectedValueOnce(new Error('date/time field value out of range: "21-12-31"'));

    await expect(service.findAll(user)).rejects.toThrow('date/time field value out of range');
  });

  it('findAll propagates unexpected filter builder failures', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder } = makeService();
    const user = makeUser({ id: 8 });
    const brokenScope = makeSmartScope({
      id: 3,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'space' }] },
    });

    smartScopeRepo.findAllForUser.mockResolvedValue([brokenScope]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([2, 3]);
    queryBuilder.buildWhere.mockImplementationOnce(() => {
      throw new TypeError('unexpected builder failure');
    });

    await expect(service.findAll(user)).rejects.toThrow('unexpected builder failure');
  });

  it('create sets defaults and persists validated values', async () => {
    const { service, smartScopeRepo } = makeService();
    const created = makeSmartScope({ id: 7, userId: 44, isPublic: false, defaultSort: [{ field: 'title', dir: 'asc' }] });
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
      syncToKobo: false,
    });
    expect(result).toEqual({ ...created, isOwner: true, koboSyncEnabled: false });
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
    expect(result).toEqual({ ...updated, isOwner: false, koboSyncEnabled: false });
  });

  describe('sharing an existing smartScope (issue #805)', () => {
    it('update shares a private smartScope without recreating it', async () => {
      const { service, smartScopeRepo } = makeService();
      const existing = makeSmartScope({ id: 3, userId: 12, isPublic: false });
      const shared = { ...existing, isPublic: true };
      smartScopeRepo.findById.mockResolvedValue([existing]);
      smartScopeRepo.update.mockResolvedValue([shared]);

      const result = await service.update(3, { isPublic: true }, makeUser({ id: 12 }));

      expect(smartScopeRepo.update).toHaveBeenCalledWith(3, 12, expect.objectContaining({ isPublic: true }));
      expect(result).toEqual({ ...shared, isOwner: true, koboSyncEnabled: false });
    });

    it('update unshares a public smartScope', async () => {
      const { service, smartScopeRepo } = makeService();
      const existing = makeSmartScope({ id: 3, userId: 12, isPublic: true });
      smartScopeRepo.findById.mockResolvedValue([existing]);
      smartScopeRepo.update.mockResolvedValue([{ ...existing, isPublic: false }]);

      const result = await service.update(3, { isPublic: false }, makeUser({ id: 12 }));

      expect(smartScopeRepo.update).toHaveBeenCalledWith(3, 12, expect.objectContaining({ isPublic: false }));
      expect(result).toEqual(expect.objectContaining({ isPublic: false }));
    });

    it('update leaves the sharing flag alone when the payload omits it', async () => {
      const { service, smartScopeRepo } = makeService();
      const existing = makeSmartScope({ id: 3, userId: 12, isPublic: true });
      smartScopeRepo.findById.mockResolvedValue([existing]);
      smartScopeRepo.update.mockResolvedValue([existing]);

      await service.update(3, { name: 'Renamed' }, makeUser({ id: 12 }));

      const [, , values] = smartScopeRepo.update.mock.calls[0] as [number, number, Record<string, unknown>];
      expect(values.isPublic).toBeUndefined();
    });

    it('update carries sharing and Kobo sync together without cross-writing either flag', async () => {
      const { service, smartScopeRepo } = makeService();
      const existing = makeSmartScope({ id: 3, userId: 12, isPublic: false, syncToKobo: false });
      const updated = { ...existing, isPublic: true, syncToKobo: true };
      smartScopeRepo.findById.mockResolvedValue([existing]);
      smartScopeRepo.update.mockResolvedValue([updated]);

      const result = await service.update(3, { isPublic: true, syncToKobo: true }, makeUser({ id: 12 }));

      expect(smartScopeRepo.update).toHaveBeenCalledWith(3, 12, expect.objectContaining({ isPublic: true, syncToKobo: true }));
      expect(result).toEqual(expect.objectContaining({ isPublic: true, syncToKobo: true, koboSyncEnabled: true }));
    });

    it('update lets a superuser share another user smartScope against the owner row', async () => {
      const { service, smartScopeRepo } = makeService();
      const existing = makeSmartScope({ id: 4, userId: 77, isPublic: false });
      const shared = { ...existing, isPublic: true };
      smartScopeRepo.findById.mockResolvedValue([existing]);
      smartScopeRepo.update.mockResolvedValue([shared]);
      smartScopeRepo.findKoboSubscribedScopeIds.mockResolvedValue([]);

      const result = await service.update(4, { isPublic: true }, makeUser({ id: 1, isSuperuser: true }));

      expect(smartScopeRepo.update).toHaveBeenCalledWith(4, 77, expect.objectContaining({ isPublic: true }));
      // The superuser is not the owner, so the owner Kobo flag must not leak into their own sync state.
      expect(result).toEqual(expect.objectContaining({ isOwner: false, koboSyncEnabled: false }));
    });

    it('update rejects a non-owner sharing someone else smartScope', async () => {
      const { service, smartScopeRepo } = makeService();
      smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 5, userId: 77, isPublic: false })]);

      await expect(service.update(5, { isPublic: true }, makeUser({ id: 12, isSuperuser: false }))).rejects.toThrow(ForbiddenException);
      expect(smartScopeRepo.update).not.toHaveBeenCalled();
    });

    it('update reports the shared scope Kobo opt-in of the caller, not the owner flag', async () => {
      const { service, smartScopeRepo } = makeService();
      const existing = makeSmartScope({ id: 6, userId: 77, isPublic: true, syncToKobo: true });
      smartScopeRepo.findById.mockResolvedValue([existing]);
      smartScopeRepo.update.mockResolvedValue([existing]);
      smartScopeRepo.findKoboSubscribedScopeIds.mockResolvedValue([6]);

      const result = await service.update(6, { name: 'Renamed by admin' }, makeUser({ id: 1, isSuperuser: true }));

      expect(smartScopeRepo.findKoboSubscribedScopeIds).toHaveBeenCalledWith(1, [6]);
      expect(result).toEqual(expect.objectContaining({ isOwner: false, koboSyncEnabled: true }));
    });
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

  it('executeSmartScope returns empty page without querying when filter is null', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookReadService, bookService } = makeService();
    smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 5, userId: 12, filter: null })]);

    const result = await service.executeSmartScope(5, makeUser({ id: 12 }), 0, 25);

    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(queryBuilder.buildWhere).not.toHaveBeenCalled();
    expect(bookReadService.findCards).not.toHaveBeenCalled();
    expect(bookService.executeBooksQuery).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], total: 0, page: 0, size: 25 });
  });

  it('executeSmartScope seeds sort from the smartScope when the request does not override it', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
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
    bookService.executeBooksQuery.mockResolvedValue({ items: [], total: 0, page: 1, size: 25 });

    const result = await service.executeSmartScope(5, makeUser({ id: 12 }), 1, 25);

    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(smartScope.filter, {
      accessibleLibraryIds: [9],
      userId: 12,
      timeZone: 'UTC',
      contentFilters: EMPTY_CONTENT_FILTER_RULES,
    });
    expect(bookService.executeBooksQuery).toHaveBeenCalledWith(
      12,
      'where',
      {
        filter: smartScope.filter,
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 1, size: 25 },
      },
      { seriesSelectionFilter: undefined },
    );
    expect(result).toEqual({ items: [], total: 0, page: 1, size: 25 });
  });

  it('queryBooks combines smartScope rules with temporary table filters and sort overrides', async () => {
    const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
    const smartScope = makeSmartScope({
      id: 5,
      filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'scope' }] },
      defaultSort: [{ field: 'title', dir: 'asc' }],
    });
    const requestFilter = {
      type: 'group',
      join: 'AND' as const,
      rules: [{ type: 'rule' as const, field: 'language' as const, operator: 'eq' as const, value: 'en' }],
    };
    smartScopeRepo.findById.mockResolvedValue([smartScope]);
    libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
    queryBuilder.buildWhere.mockReturnValue('combined-where');
    bookService.executeBooksQuery.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

    await service.queryBooks(5, makeUser({ id: 12 }), {
      filter: requestFilter,
      sort: [{ field: 'author', dir: 'desc' }],
      pagination: { page: 0, size: 50 },
      q: 'needle',
      collapseSeries: true,
    });

    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(
      {
        type: 'group',
        join: 'AND',
        rules: [smartScope.filter, requestFilter],
      },
      { accessibleLibraryIds: [9], userId: 12, q: 'needle', timeZone: 'UTC', contentFilters: EMPTY_CONTENT_FILTER_RULES },
    );
    expect(bookService.executeBooksQuery).toHaveBeenCalledWith(
      12,
      'combined-where',
      {
        filter: {
          type: 'group',
          join: 'AND',
          rules: [smartScope.filter, requestFilter],
        },
        sort: [{ field: 'author', dir: 'desc' }],
        pagination: { page: 0, size: 50 },
        q: 'needle',
        collapseSeries: true,
      },
      { seriesSelectionFilter: requestFilter },
    );
  });

  describe('queryJumpBuckets', () => {
    it('returns empty buckets immediately when the smartScope has no filter', async () => {
      const { service, smartScopeRepo, bookService } = makeService();
      smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 5, userId: 12, filter: null })]);

      const result = await service.queryJumpBuckets(5, makeUser({ id: 12 }), {
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: 50 },
      });

      expect(bookService.executeJumpBucketsQuery).not.toHaveBeenCalled();
      expect(result).toEqual({ buckets: [], total: 0, kind: 'letter', granularity: null });
    });

    it('resolves the scope default sort before delegating so eligibility is checked post-resolution', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      const smartScope = makeSmartScope({
        id: 5,
        userId: 12,
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'scope' }] },
        defaultSort: [{ field: 'author', dir: 'desc' }],
      });
      smartScopeRepo.findById.mockResolvedValue([smartScope]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
      queryBuilder.buildWhere.mockReturnValue('where');
      bookService.executeJumpBucketsQuery.mockResolvedValue({
        buckets: [{ key: 'A', label: 'A', index: 0 }],
        total: 3,
        kind: 'letter',
        granularity: null,
      });

      const result = await service.queryJumpBuckets(5, makeUser({ id: 12 }), {
        sort: [],
        pagination: { page: 0, size: 50 },
      });

      expect(bookService.executeJumpBucketsQuery).toHaveBeenCalledWith(
        12,
        'where',
        expect.objectContaining({ sort: [{ field: 'author', dir: 'desc' }] }),
        'UTC',
        { seriesSelectionFilter: undefined },
      );
      expect(result).toEqual({ buckets: [{ key: 'A', label: 'A', index: 0 }], total: 3, kind: 'letter', granularity: null });
    });

    it('keeps a saved series rule out of collapse eligibility while retaining it in the jump-bucket query', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      const smartScope = makeSmartScope({
        filter: {
          type: 'group',
          join: 'OR',
          rules: [{ type: 'rule', field: 'series', operator: 'contains', value: 'Batman' }],
        },
      });
      smartScopeRepo.findById.mockResolvedValue([smartScope]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
      queryBuilder.buildWhere.mockReturnValue('series-scope-where');
      bookService.executeJumpBucketsQuery.mockResolvedValue({
        buckets: [],
        total: 0,
        kind: 'letter',
        granularity: null,
      });

      await service.queryJumpBuckets(5, makeUser(), {
        sort: [{ field: 'title', dir: 'asc' }],
        pagination: { page: 0, size: 50 },
        collapseSeries: true,
      });

      expect(bookService.executeJumpBucketsQuery).toHaveBeenCalledWith(
        12,
        'series-scope-where',
        expect.objectContaining({
          filter: smartScope.filter,
          collapseSeries: true,
        }),
        'UTC',
        { seriesSelectionFilter: undefined },
      );
    });

    it('denies access to private scopes of other users', async () => {
      const { service, smartScopeRepo, bookService } = makeService();
      smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 5, userId: 99, isPublic: false, filter: null })]);

      await expect(service.queryJumpBuckets(5, makeUser({ id: 12 }), { sort: [], pagination: { page: 0, size: 50 } })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(bookService.executeJumpBucketsQuery).not.toHaveBeenCalled();
    });
  });

  describe('queryBooks', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns an empty result immediately when the smartScope has no filter', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      smartScopeRepo.findById.mockResolvedValue([makeSmartScope({ id: 5, userId: 12, filter: null })]);

      const result = await service.queryBooks(5, makeUser({ id: 12 }), {
        pagination: { page: 3, size: 25 },
        sort: [],
      });

      expect(result).toEqual({ items: [], total: 0, page: 3, size: 25 });
      expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
      expect(queryBuilder.buildWhere).not.toHaveBeenCalled();
      expect(bookService.executeBooksQuery).not.toHaveBeenCalled();
    });

    it('builds a combined filter and calls executeBooksQuery with the effective query', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      const smartScope = makeSmartScope({
        id: 5,
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'scope' }] },
        defaultSort: [{ field: 'title', dir: 'asc' }],
      });
      const requestFilter = {
        type: 'group',
        join: 'AND' as const,
        rules: [{ type: 'rule' as const, field: 'language' as const, operator: 'eq' as const, value: 'en' }],
      };
      const query: BookQuery = {
        filter: requestFilter,
        sort: [{ field: 'author', dir: 'desc' }],
        pagination: { page: 0, size: 50 },
        q: 'needle',
      };
      smartScopeRepo.findById.mockResolvedValue([smartScope]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
      queryBuilder.buildWhere.mockReturnValue('combined-where');
      bookService.executeBooksQuery.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await service.queryBooks(5, makeUser({ id: 12 }), query);

      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(
        {
          type: 'group',
          join: 'AND',
          rules: [smartScope.filter, requestFilter],
        },
        { accessibleLibraryIds: [9], userId: 12, q: 'needle', timeZone: 'UTC', contentFilters: EMPTY_CONTENT_FILTER_RULES },
      );
      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(
        12,
        'combined-where',
        {
          ...query,
          filter: {
            type: 'group',
            join: 'AND',
            rules: [smartScope.filter, requestFilter],
          },
        },
        { seriesSelectionFilter: requestFilter },
      );
    });

    it('keeps a saved series rule out of collapse eligibility while retaining it in the books query', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      const smartScope = makeSmartScope({
        filter: {
          type: 'group',
          join: 'OR',
          rules: [
            { type: 'rule', field: 'series', operator: 'contains', value: 'Batman' },
            { type: 'rule', field: 'series', operator: 'contains', value: 'Detective Comics' },
          ],
        },
      });
      smartScopeRepo.findById.mockResolvedValue([smartScope]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
      queryBuilder.buildWhere.mockReturnValue('series-scope-where');
      bookService.executeBooksQuery.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });

      await service.queryBooks(5, makeUser(), {
        sort: [{ field: 'series', dir: 'asc' }],
        pagination: { page: 0, size: 50 },
        collapseSeries: true,
      });

      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(
        12,
        'series-scope-where',
        expect.objectContaining({
          filter: smartScope.filter,
          collapseSeries: true,
        }),
        { seriesSelectionFilter: undefined },
      );
    });

    it('uses the smartScope defaultSort when the query has no sort', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      const smartScope = makeSmartScope({
        id: 5,
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'scope' }] },
        defaultSort: [{ field: 'title', dir: 'asc' }],
      });
      const query: BookQuery = {
        filter: undefined,
        sort: [],
        pagination: { page: 1, size: 25 },
      };
      smartScopeRepo.findById.mockResolvedValue([smartScope]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
      queryBuilder.buildWhere.mockReturnValue('scope-where');
      bookService.executeBooksQuery.mockResolvedValue({ items: [], total: 0, page: 1, size: 25 });

      await service.queryBooks(5, makeUser({ id: 12 }), query);

      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(
        12,
        'scope-where',
        {
          ...query,
          filter: smartScope.filter,
          sort: [{ field: 'title', dir: 'asc' }],
        },
        { seriesSelectionFilter: undefined },
      );
    });

    it('logs a warning when queryBooks takes at least 500ms', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      const logger = (service as unknown as { logger: Logger }).logger;
      vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(600);
      smartScopeRepo.findById.mockResolvedValue([
        makeSmartScope({
          id: 5,
          filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'scope' }] },
        }),
      ]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
      queryBuilder.buildWhere.mockReturnValue('scope-where');
      bookService.executeBooksQuery.mockResolvedValue({ items: [{ id: 1 }, { id: 2 }, { id: 3 }] as never[], total: 3, page: 0, size: 50 });

      await service.queryBooks(5, makeUser({ id: 12 }), {
        filter: undefined,
        sort: [],
        pagination: { page: 0, size: 50 },
      });

      expect(warnSpy).toHaveBeenCalledWith('[smart_scope.query_books] [end] scopeId=5 userId=12 resultCount=3 durationMs=600 - slow query');
    });

    it('logs an error and re-throws when executeBooksQuery fails', async () => {
      const { service, smartScopeRepo, libraryService, queryBuilder, bookService } = makeService();
      const logger = (service as unknown as { logger: Logger }).logger;
      vi.spyOn(logger, 'debug').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(600);
      smartScopeRepo.findById.mockResolvedValue([
        makeSmartScope({
          id: 5,
          filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'scope' }] },
        }),
      ]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([9]);
      queryBuilder.buildWhere.mockReturnValue('scope-where');
      bookService.executeBooksQuery.mockRejectedValue(new Error('boom'));

      await expect(
        service.queryBooks(5, makeUser({ id: 12 }), {
          filter: undefined,
          sort: [],
          pagination: { page: 0, size: 50 },
        }),
      ).rejects.toThrow('boom');

      expect(errorSpy).toHaveBeenCalledWith(
        '[smart_scope.query_books] [fail] scopeId=5 userId=12 durationMs=600 errorClass=Error error="boom" - query failed',
      );
    });
  });
});
