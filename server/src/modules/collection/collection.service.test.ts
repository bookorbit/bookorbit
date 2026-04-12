import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { CollectionService } from './collection.service';

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
  };
}

function makeCollection(overrides?: Record<string, unknown>) {
  return {
    id: 10,
    userId: 1,
    name: 'Favorites',
    icon: 'FolderOpen',
    description: null,
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
    findAllForUser: vi.fn(),
    findAllForUserWithMembership: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    updateDisplayOrders: vi.fn(),
    addBooks: vi.fn(),
    removeBooks: vi.fn(),
    findBookIdsPage: vi.fn(),
  };

  const bookReadService = {
    findLibraryIdsByBookIds: vi.fn(),
    findCardsByBookIds: vi.fn(),
  };

  const libraryService = {
    verifyUserAccess: vi.fn(),
    findAccessibleLibraryIds: vi.fn(),
  };

  const service = new CollectionService(collectionRepo as never, bookReadService as never, libraryService as never);
  return { service, collectionRepo, bookReadService, libraryService };
}

describe('CollectionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns all collections for user when membership ids are absent', async () => {
      const { service, collectionRepo } = makeService();
      const user = makeUser();
      collectionRepo.findAllForUser.mockResolvedValue([makeCollection()]);

      const result = await service.findAll(user);

      expect(collectionRepo.findAllForUser).toHaveBeenCalledWith(user.id);
      expect(collectionRepo.findAllForUserWithMembership).not.toHaveBeenCalled();
      expect(result).toEqual([makeCollection()]);
    });

    it('returns membership counts when book ids are provided', async () => {
      const { service, collectionRepo } = makeService();
      const user = makeUser();
      collectionRepo.findAllForUserWithMembership.mockResolvedValue([makeCollection({ memberCount: 2 })]);

      const result = await service.findAll(user, [4, 5]);

      expect(collectionRepo.findAllForUserWithMembership).toHaveBeenCalledWith(user.id, [4, 5]);
      expect(result[0]).toEqual(expect.objectContaining({ memberCount: 2 }));
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

      const result = await service.findOne(10, makeUser({ isSuperuser: true }));

      expect(result).toEqual(collection);
    });
  });

  describe('update', () => {
    it('returns the hydrated collection so derived counts remain available', async () => {
      const { service, collectionRepo } = makeService();
      const existing = makeCollection({ bookCount: 3 });
      const hydrated = makeCollection({ name: 'Updated Favorites', icon: 'FolderHeart', syncToKobo: true, bookCount: 3 });
      collectionRepo.findById.mockResolvedValueOnce([existing]).mockResolvedValueOnce([hydrated]);
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
      expect(result).toEqual(hydrated);
    });

    it('maps unique constraint errors to ConflictException semantics', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      collectionRepo.update.mockRejectedValue({ code: '23505' });

      await expect(service.update(10, { name: 'Favorites' }, makeUser())).rejects.toThrow('A collection with this name already exists');
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
      collectionRepo.findById.mockResolvedValue([makeCollection({ id: 25, name: 'New Collection' })]);

      const result = await service.create({ name: 'New Collection', icon: '⭐' } as any, makeUser({ id: 9 }));

      expect(collectionRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 9,
          name: 'New Collection',
          icon: '⭐',
          syncToKobo: false,
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 25, name: 'New Collection' }));
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
    it('verifies collection ownership and library access before adding books', async () => {
      const { service, collectionRepo, bookReadService, libraryService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 2 })]);
      bookReadService.findLibraryIdsByBookIds.mockResolvedValue([
        { id: 7, libraryId: 100 },
        { id: 8, libraryId: 101 },
      ]);
      libraryService.verifyUserAccess.mockResolvedValue(undefined);
      collectionRepo.addBooks.mockResolvedValue([]);

      const result = await service.addBooks(10, { bookIds: [7, 8] }, makeUser());

      expect(bookReadService.findLibraryIdsByBookIds).toHaveBeenCalledWith([7, 8]);
      expect(libraryService.verifyUserAccess).toHaveBeenCalledTimes(2);
      expect(collectionRepo.addBooks).toHaveBeenCalledWith(10, [7, 8]);
      expect(result).toEqual(expect.objectContaining({ bookCount: 2 }));
    });

    it('deduplicates repeated book ids for access checks', async () => {
      const { service, collectionRepo, bookReadService, libraryService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 1 })]);
      bookReadService.findLibraryIdsByBookIds.mockResolvedValue([{ id: 7, libraryId: 100 }]);
      libraryService.verifyUserAccess.mockResolvedValue(undefined);

      await service.addBooks(10, { bookIds: [7, 7] }, makeUser());

      expect(bookReadService.findLibraryIdsByBookIds).toHaveBeenCalledWith([7]);
      expect(libraryService.verifyUserAccess).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when at least one book id is missing', async () => {
      const { service, collectionRepo, bookReadService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      bookReadService.findLibraryIdsByBookIds.mockResolvedValue([{ id: 7, libraryId: 100 }]);

      await expect(service.addBooks(10, { bookIds: [7, 8] }, makeUser())).rejects.toThrow(NotFoundException);
      expect(collectionRepo.addBooks).not.toHaveBeenCalled();
    });

    it('skips per-library access lookups for superusers', async () => {
      const { service, collectionRepo, bookReadService, libraryService } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection({ userId: 88 })]).mockResolvedValueOnce([makeCollection({ bookCount: 2 })]);
      bookReadService.findLibraryIdsByBookIds.mockResolvedValue([
        { id: 7, libraryId: 100 },
        { id: 8, libraryId: 101 },
      ]);

      await service.addBooks(10, { bookIds: [7, 8] }, makeUser({ id: 42, isSuperuser: true }));

      expect(libraryService.verifyUserAccess).not.toHaveBeenCalled();
      expect(collectionRepo.addBooks).toHaveBeenCalledWith(10, [7, 8]);
    });

    it('propagates library access errors and does not write membership rows', async () => {
      const { service, collectionRepo, bookReadService, libraryService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      bookReadService.findLibraryIdsByBookIds.mockResolvedValue([{ id: 7, libraryId: 100 }]);
      libraryService.verifyUserAccess.mockRejectedValue(new ForbiddenException('No access to this library'));

      await expect(service.addBooks(10, { bookIds: [7] }, makeUser())).rejects.toThrow(ForbiddenException);
      expect(collectionRepo.addBooks).not.toHaveBeenCalled();
    });
  });

  describe('getBooks', () => {
    it('returns an empty page when no collection books are visible to the user', async () => {
      const { service, collectionRepo, libraryService, bookReadService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([100]);
      collectionRepo.findBookIdsPage.mockResolvedValue({ bookIds: [], total: 0, page: 0, size: 50 });

      const result = await service.getBooks(10, makeUser(), 0, 50);

      expect(result).toEqual({ items: [], total: 0, page: 0, size: 50 });
      expect(bookReadService.findCardsByBookIds).not.toHaveBeenCalled();
    });

    it('loads page ids via repository and returns ordered cards with read status', async () => {
      const { service, collectionRepo, libraryService, bookReadService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection()]);
      libraryService.findAccessibleLibraryIds.mockResolvedValue([100, 101]);
      collectionRepo.findBookIdsPage.mockResolvedValue({ bookIds: [2, 1], total: 2, page: 0, size: 50 });
      bookReadService.findCardsByBookIds.mockResolvedValue({
        rows: [
          {
            id: 1,
            status: 'present',
            primaryFileId: 11,
            folderPath: '/books/one',
            addedAt: new Date('2026-01-01T00:00:00Z'),
            title: 'One',
            seriesName: null,
            seriesIndex: null,
            publishedYear: null,
            language: null,
            rating: null,
          },
          {
            id: 2,
            status: 'present',
            primaryFileId: 22,
            folderPath: '/books/two',
            addedAt: new Date('2026-01-02T00:00:00Z'),
            title: 'Two',
            seriesName: null,
            seriesIndex: null,
            publishedYear: null,
            language: null,
            rating: null,
          },
        ],
        authorRows: [],
        fileRows: [
          { bookId: 1, id: 11, format: 'epub', role: 'primary' },
          { bookId: 2, id: 22, format: 'epub', role: 'primary' },
        ],
        genreRows: [],
        progressRows: [
          { bookFileId: 11, percentage: 35 },
          { bookFileId: 22, percentage: 95 },
        ],
        statusRows: [
          {
            bookId: 1,
            status: 'reading',
            source: 'manual',
            startedAt: new Date('2026-01-03T00:00:00Z'),
            finishedAt: null,
            updatedAt: new Date('2026-01-03T00:00:00Z'),
          },
        ],
        total: 2,
      });

      const result = await service.getBooks(10, makeUser(), 0, 50);

      expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
      expect(collectionRepo.findBookIdsPage).toHaveBeenCalledWith(10, [100, 101], 0, 50);
      expect(bookReadService.findCardsByBookIds).toHaveBeenCalledWith([2, 1], 1);
      expect(result.total).toBe(2);
      expect(result.items.map((item) => item.id)).toEqual([2, 1]);
      expect(result.items[1]?.readStatus).toEqual(expect.objectContaining({ status: 'reading' }));
    });

    it('propagates ownership errors before loading collection books', async () => {
      const { service, collectionRepo, libraryService } = makeService();
      collectionRepo.findById.mockResolvedValue([makeCollection({ userId: 999 })]);

      await expect(service.getBooks(10, makeUser(), 0, 50)).rejects.toThrow(ForbiddenException);
      expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('delegates reorder writes to repository with current user id', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.updateDisplayOrders.mockResolvedValue(undefined);
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
  });

  describe('removeBooks', () => {
    it('updates collection membership and returns hydrated collection', async () => {
      const { service, collectionRepo } = makeService();
      collectionRepo.findById.mockResolvedValueOnce([makeCollection()]).mockResolvedValueOnce([makeCollection({ bookCount: 1 })]);
      collectionRepo.removeBooks.mockResolvedValue([{ collectionId: 10, bookId: 7 }]);

      const result = await service.removeBooks(10, { bookIds: [7] }, makeUser());

      expect(collectionRepo.removeBooks).toHaveBeenCalledWith(10, [7]);
      expect(result).toEqual(expect.objectContaining({ bookCount: 1 }));
    });
  });
});
