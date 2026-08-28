import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { CollectionService } from './collection.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 1,
    username: 'collector',
    name: 'Collector',
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

function makeCollection(overrides?: Record<string, unknown>) {
  return {
    id: 10,
    userId: 1,
    name: 'Favorites',
    icon: 'FolderOpen',
    description: null,
    isPublic: false,
    syncToKobo: false,
    displayOrder: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    bookCount: 0,
    ...overrides,
  };
}

function makeService() {
  const collectionRepo = {
    findAllVisibleForUser: vi.fn(),
    findAllOwnedForUserWithMembership: vi.fn(),
    findById: vi.fn(),
    findByIdForViewer: vi.fn().mockResolvedValue([makeCollection()]),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateDisplayOrders: vi.fn(),
    addBooks: vi.fn(),
    removeBooks: vi.fn(),
    findBookIdsPage: vi.fn(),
    findAllBookIds: vi.fn(),
    buildReadableMembershipWhere: vi.fn(),
  };

  const libraryService = {
    verifyUserAccess: vi.fn(),
    findAccessibleLibraryIds: vi.fn().mockResolvedValue([100]),
  };

  const queryBuilder = {
    buildWhere: vi.fn().mockReturnValue({ type: 'where' }),
  };

  const bookService = {
    resolveSelectionToIds: vi.fn(),
    executeBooksQuery: vi.fn(),
    executeJumpBucketsQuery: vi.fn(),
  };

  const achievementEvents = {
    emit: vi.fn(),
  };

  const service = new CollectionService(
    collectionRepo as never,
    libraryService as never,
    queryBuilder as never,
    bookService as never,
    achievementEvents as never,
  );
  return { service, collectionRepo, libraryService, queryBuilder, bookService, achievementEvents };
}

describe('CollectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns all collections for user when membership ids are absent', async () => {
      const { service, collectionRepo } = makeService();
      const user = makeUser();
      collectionRepo.findAllVisibleForUser.mockResolvedValue([makeCollection()]);

      const result = await service.findAll(user);

      expect(collectionRepo.findAllVisibleForUser).toHaveBeenCalledWith(user.id, expect.anything());
      expect(collectionRepo.findAllOwnedForUserWithMembership).not.toHaveBeenCalled();
      expect(result).toEqual([{ ...makeCollection(), isOwner: true }]);
    });

    it('returns public collections as read-only viewer projections with content-filtered counts', async () => {
      const { service, collectionRepo, queryBuilder } = makeService();
      const user = makeUser({ id: 8 });
      const shared = makeCollection({ id: 20, userId: 99, isPublic: true, bookCount: 2 });
      collectionRepo.findAllVisibleForUser.mockResolvedValue([shared]);

      const result = await service.findAll(user);

      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(undefined, {
        accessibleLibraryIds: [100],
        userId: 8,
        timeZone: 'UTC',
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
      });
      expect(result).toEqual([{ ...shared, isOwner: false }]);
    });

    it('returns membership counts when book ids are provided', async () => {
      const { service, collectionRepo } = makeService();
      const user = makeUser();
      collectionRepo.findAllOwnedForUserWithMembership.mockResolvedValue([makeCollection({ memberCount: 2 })]);

      const result = await service.findAll(user, [4, 5]);

      expect(collectionRepo.findAllOwnedForUserWithMembership).toHaveBeenCalledWith(user.id, [4, 5], expect.anything());
      expect(result[0]).toEqual(expect.objectContaining({ memberCount: 2 }));
    });

    it('falls back to the non-membership query when book ids are empty', async () => {
      const { service, collectionRepo } = makeService();
      const user = makeUser();
      collectionRepo.findAllVisibleForUser.mockResolvedValue([makeCollection()]);

      await service.findAll(user, []);

      expect(collectionRepo.findAllVisibleForUser).toHaveBeenCalledWith(user.id, expect.anything());
      expect(collectionRepo.findAllOwnedForUserWithMembership).not.toHaveBeenCalled();
    });

    it('resolves selection payloads before loading membership counts', async () => {
      const { service, collectionRepo, bookService } = makeService();
      const user = makeUser();
      const selection = { query: { libraryId: 5, q: 'dune' } };
      bookService.resolveSelectionToIds.mockResolvedValue([10, 11, 10]);
      collectionRepo.findAllOwnedForUserWithMembership.mockResolvedValue([makeCollection({ memberCount: 2 })]);

      const result = await service.findAllWithSelectionMembership(selection, user);

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(selection, user);
      expect(collectionRepo.findAllOwnedForUserWithMembership).toHaveBeenCalledWith(user.id, [10, 11], expect.anything());
      expect(result[0]).toEqual(expect.objectContaining({ memberCount: 2 }));
    });

    it('uses the plain collection list when a selection resolves to zero books', async () => {
      const { service, collectionRepo, bookService } = makeService();
      bookService.resolveSelectionToIds.mockResolvedValue([]);
      collectionRepo.findAllVisibleForUser.mockResolvedValue([makeCollection()]);

      await service.findAllWithSelectionMembership({ query: { libraryId: 5 } }, makeUser());

      expect(collectionRepo.findAllVisibleForUser).toHaveBeenCalledWith(1, expect.anything());
      expect(collectionRepo.findAllOwnedForUserWithMembership).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when collection does not exist', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([]);

      await expect(service.findOne(10, makeUser())).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a non-owner accesses another user collection', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 99 })]);

      await expect(service.findOne(10, makeUser())).rejects.toThrow(ForbiddenException);
    });

    it('allows superuser access to another user collection', async () => {
      const { service, collectionRepo } = makeService();
      const collection = makeCollection({ userId: 99 });
      collectionRepo.findById.mockResolvedValue([collection]);
      collectionRepo.findByIdForViewer.mockResolvedValue([collection]);

      const result = await service.findOne(10, makeUser({ isSuperuser: true }));

      expect(result).toEqual({ ...collection, isOwner: false });
    });

    it('allows a non-owner to read a public collection and preserves viewer-filtered counts', async () => {
      const { service, collectionRepo } = makeService();
      const shared = makeCollection({ userId: 99, isPublic: true, bookCount: 40 });
      const viewerProjection = makeCollection({ userId: 99, isPublic: true, bookCount: 3 });
      collectionRepo.findById.mockResolvedValue([shared]);
      collectionRepo.findByIdForViewer.mockResolvedValue([viewerProjection]);

      const result = await service.findOne(10, makeUser({ id: 8 }));

      expect(result).toEqual({ ...viewerProjection, isOwner: false });
    });
  });

  describe('update', () => {
    it('rejects updates from a non-owner even when the collection is public', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 99, isPublic: true })]);

      await expect(service.update(10, { name: 'Hijacked' }, makeUser({ id: 8 }))).rejects.toThrow(ForbiddenException);
      expect(collectionRepo.update).not.toHaveBeenCalled();
    });

    it('returns the hydrated collection so derived counts remain available', async () => {
      const { service, collectionRepo } = makeService();
      const existing = makeCollection({ bookCount: 3 });
      const hydrated = makeCollection({ name: 'Updated Favorites', icon: 'FolderHeart', syncToKobo: true, bookCount: 3 });
      collectionRepo.findById.mockResolvedValueOnce([existing]).mockResolvedValueOnce([hydrated]);
      collectionRepo.findByIdForViewer.mockResolvedValue([hydrated]);
      collectionRepo.update.mockResolvedValue([
        {
          id: existing.id,
          userId: existing.userId,
          name: 'Updated Favorites',
          icon: 'FolderHeart',
          description: existing.description,
          syncToKobo: true,
          displayOrder: existing.displayOrder,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        },
      ]);

      const result = await service.update(existing.id, { name: 'Updated Favorites', icon: 'FolderHeart', syncToKobo: true }, makeUser());

      expect(collectionRepo.update).toHaveBeenCalledWith(existing.id, existing.userId, {
        name: 'Updated Favorites',
        icon: 'FolderHeart',
        syncToKobo: true,
      });
      expect(collectionRepo.findById).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ...hydrated, isOwner: true });
    });

    it('maps unique constraint errors to ConflictException semantics', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      collectionRepo.update.mockRejectedValue({ code: '23505' });

      await expect(service.update(10, { name: 'Favorites' }, makeUser())).rejects.toThrow('A collection with this name already exists');
    });

    it('maps wrapped unique constraint errors to ConflictException semantics', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      collectionRepo.update.mockRejectedValue(new Error('duplicate key', { cause: { code: '23505' } }));

      await expect(service.update(10, { name: 'Favorites' }, makeUser())).rejects.toThrow('A collection with this name already exists');
    });

    it('rethrows non-unique update errors', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      collectionRepo.update.mockRejectedValue(new Error('db write failed'));

      await expect(service.update(10, { name: 'Favorites' }, makeUser())).rejects.toThrow('db write failed');
    });

    it('rejects changes that would leave a collection without an icon', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ icon: null })]);

      await expect(service.update(10, { name: 'Favorites' }, makeUser())).rejects.toThrow(BadRequestException);
      expect(collectionRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('create/remove', () => {
    it('creates collection for current user and returns hydrated row', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.insert.mockResolvedValue([{ id: 25 }]);
      collectionRepo.findByIdForViewer.mockResolvedValue([makeCollection({ id: 25, userId: 9, name: 'New Collection' })]);

      const result = await service.create({ name: 'New Collection', icon: '⭐' } as any, makeUser({ id: 9 }));

      expect(collectionRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 9,
          name: 'New Collection',
          icon: '⭐',
          isPublic: false,
          syncToKobo: false,
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 25, name: 'New Collection' }));
    });

    it('persists explicit public visibility on create', async () => {
      const { service, collectionRepo } = makeService();
      const created = makeCollection({ id: 26, userId: 9, isPublic: true });
      collectionRepo.insert.mockResolvedValue([created]);
      collectionRepo.findByIdForViewer.mockResolvedValue([created]);

      await service.create({ name: 'Shared', icon: 'Globe', isPublic: true } as never, makeUser({ id: 9 }));

      expect(collectionRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ userId: 9, isPublic: true }));
    });

    it('rejects create when icon is empty after trimming', async () => {
      const { service, collectionRepo } = makeService();

      await expect(service.create({ name: 'No Icon', icon: '   ' } as any, makeUser({ id: 9 }))).rejects.toThrow(BadRequestException);
      expect(collectionRepo.insert).not.toHaveBeenCalled();
    });

    it('maps unique violations from wrapped database errors during create', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.insert.mockRejectedValue(new Error('constraint fail', { cause: { code: '23505' } }));

      await expect(service.create({ name: 'Favorites', icon: '⭐' } as any, makeUser({ id: 9 }))).rejects.toThrow(
        'A collection with this name already exists',
      );
    });

    it('rethrows non-unique create errors', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.insert.mockRejectedValue(new Error('insert timeout'));

      await expect(service.create({ name: 'Favorites', icon: '⭐' } as any, makeUser({ id: 9 }))).rejects.toThrow('insert timeout');
    });

    it('propagates ownership checks on remove and deletes using owner id', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ id: 12, userId: 4 })]);

      await service.remove(12, makeUser({ id: 4 }));
      expect(collectionRepo.delete).toHaveBeenCalledWith(12, 4);
    });

    it('rejects non-owner remove attempts', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 9 })]);

      await expect(service.remove(12, makeUser({ id: 4 }))).rejects.toThrow(ForbiddenException);
      expect(collectionRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('addBooks', () => {
    it('verifies collection ownership and resolves the selection before adding books', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 2 })]);
      collectionRepo.findByIdForViewer.mockResolvedValue([makeCollection({ bookCount: 2 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([7, 8]);
      collectionRepo.addBooks.mockResolvedValue([]);
      const selection = { bookIds: [7, 8] };

      const user = makeUser();
      const result = await service.addBooks(10, selection, user);

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(selection, user);
      expect(collectionRepo.addBooks).toHaveBeenCalledWith(10, [7, 8]);
      expect(result).toEqual(expect.objectContaining({ bookCount: 2 }));
    });

    it('deduplicates resolved book ids before writing membership rows', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 1 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([7, 7]);

      await service.addBooks(10, { bookIds: [7, 7] }, makeUser());

      expect(collectionRepo.addBooks).toHaveBeenCalledWith(10, [7]);
    });

    it('does not write membership rows when the selection resolves to zero books', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 0 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([]);

      const result = await service.addBooks(10, { query: { libraryId: 5 } }, makeUser());

      expect(collectionRepo.addBooks).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ bookCount: 0 }));
    });

    it('propagates selection resolution errors and does not write membership rows', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      bookService.resolveSelectionToIds.mockRejectedValue(new NotFoundException('One or more books were not found'));

      await expect(service.addBooks(10, { bookIds: [7, 8] }, makeUser())).rejects.toThrow(NotFoundException);
      expect(collectionRepo.addBooks).not.toHaveBeenCalled();
    });

    it('skips per-library access lookups for superusers', async () => {
      const { service, collectionRepo, bookService, libraryService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection({ userId: 88 })]).mockResolvedValueOnce([makeCollection({ bookCount: 2 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([7, 8]);

      await service.addBooks(10, { bookIds: [7, 8] }, makeUser({ id: 42, isSuperuser: true }));

      expect(libraryService.verifyUserAccess).not.toHaveBeenCalled();
      expect(collectionRepo.addBooks).toHaveBeenCalledWith(10, [7, 8]);
    });

    it('propagates selection access errors and does not write membership rows', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      bookService.resolveSelectionToIds.mockRejectedValue(new ForbiddenException('No access to this library'));

      await expect(service.addBooks(10, { bookIds: [7] }, makeUser())).rejects.toThrow(ForbiddenException);
      expect(collectionRepo.addBooks).not.toHaveBeenCalled();
    });

    it('resolves query selections before adding all matching books', async () => {
      const { service, collectionRepo, bookService } = makeService();
      const selection = { query: { libraryId: 5, q: 'space opera' } };
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 3 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([10, 11, 12]);

      await service.addBooks(10, selection, makeUser());

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(selection, expect.objectContaining({ id: 1 }));
      expect(collectionRepo.addBooks).toHaveBeenCalledWith(10, [10, 11, 12]);
    });
  });

  describe('getBooks', () => {
    it('returns an empty page when no collection books are visible to the user', async () => {
      const { service, collectionRepo, libraryService, queryBuilder, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([100]);
      collectionRepo.buildReadableMembershipWhere.mockReturnValue('membership-where');
      bookService.executeBooksQuery.mockResolvedValue({ items: [], total: 0, page: 0, size: 50 });
      const user = makeUser();

      const result = await service.getBooks(10, user, 0, 50);

      expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(undefined, {
        accessibleLibraryIds: [100],
        userId: 1,
        q: undefined,
        timeZone: 'UTC',
        contentFilters: EMPTY_CONTENT_FILTER_RULES,
      });
      expect(collectionRepo.buildReadableMembershipWhere).toHaveBeenCalledWith(10, user.id, user.isSuperuser);
      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(
        1,
        expect.anything(),
        {
          sort: [{ field: 'collectionOrder', dir: 'asc' }],
          pagination: { page: 0, size: 50 },
        },
        { defaultCollectionId: 10 },
      );
    });

    it('passes collapse, search, and query filters into the shared book query pipeline', async () => {
      const { service, collectionRepo, libraryService, queryBuilder, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([100, 101]);
      collectionRepo.buildReadableMembershipWhere.mockReturnValue('membership-where');
      queryBuilder.buildWhere.mockReturnValue('filter-where');
      bookService.executeBooksQuery.mockResolvedValue({ items: [{ id: 2 }, { id: 1 }], total: 2, page: 0, size: 50 });

      const result = await service.queryBooks(10, makeUser(), {
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Two' }] },
        sort: [{ field: 'title', dir: 'desc' }],
        pagination: { page: 0, size: 50 },
        collapseSeries: true,
        q: 'science',
      });

      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(
        { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'Two' }] },
        {
          accessibleLibraryIds: [100, 101],
          userId: 1,
          q: 'science',
          timeZone: 'UTC',
          contentFilters: EMPTY_CONTENT_FILTER_RULES,
        },
      );
      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          sort: [{ field: 'title', dir: 'desc' }],
          pagination: { page: 0, size: 50 },
          collapseSeries: true,
          q: 'science',
        }),
        { defaultCollectionId: 10 },
      );
      expect(result).toEqual({ items: [{ id: 2 }, { id: 1 }], total: 2, page: 0, size: 50 });
    });

    it('propagates ownership errors before loading collection books', async () => {
      const { service, collectionRepo, libraryService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 999 })]);

      await expect(service.getBooks(10, makeUser(), 0, 50)).rejects.toThrow(ForbiddenException);
      expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    });

    it('allows a non-owner to query a public collection through the viewer access predicate', async () => {
      const { service, collectionRepo, libraryService, queryBuilder, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 99, isPublic: true })]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([100]);
      collectionRepo.buildReadableMembershipWhere.mockReturnValue('membership-where');
      queryBuilder.buildWhere.mockReturnValue('viewer-where');
      bookService.executeBooksQuery.mockResolvedValue({ items: [{ id: 7 }], total: 1, page: 0, size: 50 });

      await service.getBooks(10, makeUser({ id: 8 }), 0, 50);

      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          accessibleLibraryIds: [100],
          userId: 8,
          contentFilters: EMPTY_CONTENT_FILTER_RULES,
        }),
      );
      expect(bookService.executeBooksQuery).toHaveBeenCalled();
    });

    it('queryJumpBuckets intersects the membership filter like queryBooks', async () => {
      const { service, collectionRepo, libraryService, queryBuilder, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([100]);
      collectionRepo.buildReadableMembershipWhere.mockReturnValue('membership-where');
      queryBuilder.buildWhere.mockReturnValue('filter-where');
      bookService.executeJumpBucketsQuery.mockResolvedValue({ buckets: [], total: 0, kind: 'letter', granularity: null });

      const query = { sort: [{ field: 'title', dir: 'asc' as const }], pagination: { page: 0, size: 50 } };
      const user = makeUser();
      await service.queryJumpBuckets(10, user, query as never);

      expect(collectionRepo.buildReadableMembershipWhere).toHaveBeenCalledWith(10, user.id, user.isSuperuser);
      expect(bookService.executeJumpBucketsQuery).toHaveBeenCalledWith(1, expect.anything(), query, 'UTC');
    });

    it('queryJumpBuckets propagates ownership errors before delegating', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 999 })]);

      await expect(service.queryJumpBuckets(10, makeUser(), { sort: [], pagination: { page: 0, size: 50 } } as never)).rejects.toThrow(
        ForbiddenException,
      );
      expect(bookService.executeJumpBucketsQuery).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('delegates reorder writes to repository with current user id', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.updateDisplayOrders.mockResolvedValue(2);
      const user = makeUser({ id: 33 });

      await service.reorder(
        {
          order: [
            { id: 1, displayOrder: 2 },
            { id: 2, displayOrder: 3 },
          ],
        },
        user,
      );

      expect(collectionRepo.updateDisplayOrders).toHaveBeenCalledWith(33, [
        { id: 1, displayOrder: 2 },
        { id: 2, displayOrder: 3 },
      ]);
    });

    it('rethrows repository errors from reorder operations', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.updateDisplayOrders.mockRejectedValue(new Error('db unavailable'));

      await expect(service.reorder({ order: [{ id: 1, displayOrder: 0 }] }, makeUser({ id: 1 }))).rejects.toThrow('db unavailable');
    });

    it('rejects duplicate or non-owned collection IDs instead of silently reordering a subset', async () => {
      const { service, collectionRepo } = makeService();

      await expect(
        service.reorder(
          {
            order: [
              { id: 1, displayOrder: 0 },
              { id: 1, displayOrder: 1 },
            ],
          },
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(collectionRepo.updateDisplayOrders).not.toHaveBeenCalled();

      collectionRepo.updateDisplayOrders.mockResolvedValue(1);
      await expect(
        service.reorder(
          {
            order: [
              { id: 1, displayOrder: 0 },
              { id: 99, displayOrder: 1 },
            ],
          },
          makeUser(),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeBooks', () => {
    it('updates collection membership and returns hydrated collection', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 1 })]);
      collectionRepo.findByIdForViewer.mockResolvedValue([makeCollection({ bookCount: 1 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([7]);
      collectionRepo.removeBooks.mockResolvedValue([{ collectionId: 10, bookId: 7 }]);

      const result = await service.removeBooks(10, { bookIds: [7] }, makeUser());

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith({ bookIds: [7] }, expect.objectContaining({ id: 1 }));
      expect(collectionRepo.removeBooks).toHaveBeenCalledWith(10, [7]);
      expect(result).toEqual(expect.objectContaining({ bookCount: 1 }));
    });

    it('deduplicates resolved ids before removing membership rows', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 0 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([7, 7]);
      collectionRepo.removeBooks.mockResolvedValue([{ collectionId: 10, bookId: 7 }]);

      await service.removeBooks(10, { bookIds: [7, 7] }, makeUser());

      expect(collectionRepo.removeBooks).toHaveBeenCalledWith(10, [7]);
    });

    it('resolves query selections before removing all matching books', async () => {
      const { service, collectionRepo, bookService } = makeService();
      const selection = { query: { libraryId: 5, q: 'finished' } };
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 0 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([10, 11]);

      await service.removeBooks(10, selection, makeUser());

      expect(bookService.resolveSelectionToIds).toHaveBeenCalledWith(selection, expect.objectContaining({ id: 1 }));
      expect(collectionRepo.removeBooks).toHaveBeenCalledWith(10, [10, 11]);
    });

    it('does not write membership rows when a remove selection resolves to zero books', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 0 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([]);

      const result = await service.removeBooks(10, { query: { libraryId: 5 } }, makeUser());

      expect(collectionRepo.removeBooks).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ bookCount: 0 }));
    });

    it('rejects removeBooks calls from non-owners', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 88 })]);

      await expect(service.removeBooks(10, { bookIds: [7] }, makeUser({ id: 1 }))).rejects.toThrow(ForbiddenException);
      expect(bookService.resolveSelectionToIds).not.toHaveBeenCalled();
      expect(collectionRepo.removeBooks).not.toHaveBeenCalled();
    });

    it('allows superusers to remove books from collections they do not own', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById
        .mockResolvedValueOnce([makeCollection({ userId: 88 })])
        .mockResolvedValueOnce([makeCollection({ userId: 88, bookCount: 0 })]);
      collectionRepo.findByIdForViewer.mockResolvedValue([makeCollection({ userId: 88, bookCount: 0 })]);
      bookService.resolveSelectionToIds.mockResolvedValue([7]);
      collectionRepo.removeBooks.mockResolvedValue([{ collectionId: 10, bookId: 7 }]);

      const result = await service.removeBooks(10, { bookIds: [7] }, makeUser({ id: 1, isSuperuser: true }));

      expect(collectionRepo.removeBooks).toHaveBeenCalledWith(10, [7]);
      expect(result).toEqual(expect.objectContaining({ userId: 88, bookCount: 0 }));
    });

    it('throws NotFoundException when removing books from a missing collection', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([]);

      await expect(service.removeBooks(10, { bookIds: [7] }, makeUser())).rejects.toThrow(NotFoundException);
      expect(bookService.resolveSelectionToIds).not.toHaveBeenCalled();
      expect(collectionRepo.removeBooks).not.toHaveBeenCalled();
    });

    it('rethrows repository errors while removing books', async () => {
      const { service, collectionRepo, bookService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      bookService.resolveSelectionToIds.mockResolvedValue([7]);
      collectionRepo.removeBooks.mockRejectedValue(new Error('remove failed'));

      await expect(service.removeBooks(10, { bookIds: [7] }, makeUser())).rejects.toThrow('remove failed');
    });
  });
});
