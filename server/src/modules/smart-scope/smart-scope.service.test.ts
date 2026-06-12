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

    await expect(service.findOne(5, makeUser({ id: 12 }))).resolves.toEqual(smartScope);
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
      { ...firstSmartScope, bookCount: 0 },
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
    expect(bookService.executeBooksQuery).toHaveBeenCalledWith(12, 'where', {
      filter: smartScope.filter,
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 1, size: 25 },
    });
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
    });

    expect(queryBuilder.buildWhere).toHaveBeenCalledWith(
      {
        type: 'group',
        join: 'AND',
        rules: [smartScope.filter, requestFilter],
      },
      { accessibleLibraryIds: [9], userId: 12, q: 'needle', timeZone: 'UTC', contentFilters: EMPTY_CONTENT_FILTER_RULES },
    );
    expect(bookService.executeBooksQuery).toHaveBeenCalledWith(12, 'combined-where', {
      filter: {
        type: 'group',
        join: 'AND',
        rules: [smartScope.filter, requestFilter],
      },
      sort: [{ field: 'author', dir: 'desc' }],
      pagination: { page: 0, size: 50 },
      q: 'needle',
    });
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
      expect(result).toEqual({ buckets: [], total: 0 });
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
      bookService.executeJumpBucketsQuery.mockResolvedValue({ buckets: [{ key: 'A', label: 'A', index: 0 }], total: 3 });

      const result = await service.queryJumpBuckets(5, makeUser({ id: 12 }), {
        sort: [],
        pagination: { page: 0, size: 50 },
      });

      expect(bookService.executeJumpBucketsQuery).toHaveBeenCalledWith(
        12,
        'where',
        expect.objectContaining({ sort: [{ field: 'author', dir: 'desc' }] }),
      );
      expect(result).toEqual({ buckets: [{ key: 'A', label: 'A', index: 0 }], total: 3 });
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
      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(12, 'combined-where', {
        ...query,
        filter: {
          type: 'group',
          join: 'AND',
          rules: [smartScope.filter, requestFilter],
        },
      });
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

      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(12, 'scope-where', {
        ...query,
        filter: smartScope.filter,
        sort: [{ field: 'title', dir: 'asc' }],
      });
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
