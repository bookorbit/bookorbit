import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AuthorsService } from './authors.service';

function reqUser(id = 7, superuser = false) {
  return { id, roles: [{ isSuperuser: superuser, permissions: [] }] } as any;
}

describe('AuthorsService', () => {
  const authorsRepo = {
    findPage: jest.fn(),
    findById: jest.fn(),
    findBookIdsPage: jest.fn(),
    updateAuthorById: jest.fn(),
    findVisibleAuthorIds: jest.fn(),
    countDistinctBooks: jest.fn(),
    mergeAuthors: jest.fn(),
    deleteAuthors: jest.fn(),
    findRelatedLibraryIds: jest.fn(),
    findAuthorsForDuplicatePool: jest.fn(),
    findAuthorsAddedSince: jest.fn(),
    findMostReadAuthors: jest.fn(),
    findAuthorBookPairs: jest.fn(),
    findStartedBookIdsForUser: jest.fn(),
    findByIdForEnrichment: jest.fn(),
    updateAuthorDescriptionIfEmpty: jest.fn(),
  };

  const bookRepo = {
    findCards: jest.fn(),
  };

  const libraryService = {
    findAll: jest.fn(),
  };

  const authorMetadataFetchService = {
    listProviders: jest.fn(),
    search: jest.fn(),
    lookupById: jest.fn(),
    quickSearch: jest.fn(),
  };

  const authorImageStorage = {
    saveFromUrl: jest.fn(),
    getThumbnailPath: jest.fn(),
    getThumbnailUrlIfExists: jest.fn(),
    getImagePath: jest.fn(),
    getImageUrlIfExists: jest.fn(),
  };

  let service: AuthorsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AuthorsService(
      authorsRepo as any,
      bookRepo as any,
      libraryService as any,
      authorMetadataFetchService as any,
      authorImageStorage as any,
    );
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue(null);
    authorImageStorage.getImageUrlIfExists.mockResolvedValue(null);
  });

  it('merge rejects when sources do not contain any id different from target', async () => {
    await expect(service.merge(reqUser(7, true), { targetAuthorId: 10, sourceAuthorIds: [10, 10] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merge requires superuser', async () => {
    await expect(service.merge(reqUser(), { targetAuthorId: 10, sourceAuthorIds: [11] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delete requires superuser', async () => {
    await expect(service.delete(reqUser(), { authorIds: [11] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('merge blocks mutation when selected authors are linked to inaccessible libraries', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([10, 11]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1, 999]);

    await expect(service.merge(reqUser(7, true), { targetAuthorId: 10, sourceAuthorIds: [11] })).rejects.toBeInstanceOf(ForbiddenException);
    expect(authorsRepo.mergeAuthors).not.toHaveBeenCalled();
  });

  it('delete removes authors and returns impacted count', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([10, 11]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1, 2]);
    authorsRepo.countDistinctBooks.mockResolvedValue(6);
    authorsRepo.deleteAuthors.mockResolvedValue(undefined);

    const result = await service.delete(reqUser(7, true), { authorIds: [10, 11, 11] });

    expect(authorsRepo.deleteAuthors).toHaveBeenCalledWith([10, 11]);
    expect(result.deletedAuthorIds).toEqual([10, 11]);
    expect(result.affectedBookCount).toBe(6);
  });

  it('merge deduplicates sources, merges, and returns impacted count', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([10, 11, 12]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1, 2]);
    authorsRepo.countDistinctBooks.mockResolvedValue(8);
    authorsRepo.mergeAuthors.mockResolvedValue(undefined);
    authorsRepo.findById.mockResolvedValue({
      id: 10,
      name: 'Target',
      sortName: 'Target',
      description: null,
      bookCount: 3,
      lastAddedAt: null,
    });

    const result = await service.merge(reqUser(7, true), { targetAuthorId: 10, sourceAuthorIds: [10, 11, 11, 12] });

    expect(authorsRepo.mergeAuthors).toHaveBeenCalledWith(10, [11, 12]);
    expect(result.mergedAuthorIds).toEqual([11, 12]);
    expect(result.affectedBookCount).toBe(8);
  });

  it('update trims values and normalizes blank optional fields to null', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([20]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorsRepo.updateAuthorById.mockResolvedValue({ id: 20, name: 'Updated', sortName: null, description: 'Bio' });
    authorsRepo.findById.mockResolvedValue({
      id: 20,
      name: 'Updated',
      sortName: null,
      description: 'Bio',
      bookCount: 4,
      lastAddedAt: null,
    });

    await service.update(reqUser(), 20, {
      name: '  Updated  ',
      sortName: '   ',
      description: '  Bio  ',
    });

    expect(authorsRepo.updateAuthorById).toHaveBeenCalledWith(20, {
      name: 'Updated',
      sortName: null,
      description: 'Bio',
    });
  });

  it('findOne returns not found when author is outside user-accessible libraries', async () => {
    authorsRepo.findById.mockResolvedValue(null);
    await expect(service.findOne(reqUser(), 404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refreshEnrichment fills description when missing and returns updated author', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([20]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 20,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: null,
      bookCount: 2,
      lastAddedAt: null,
    });
    authorsRepo.updateAuthorDescriptionIfEmpty.mockResolvedValue(true);
    authorMetadataFetchService.quickSearch.mockResolvedValue({
      provider: 'audnexus',
      providerId: 'B123',
      name: 'Jane Doe',
      description: 'Provider description',
    });
    authorsRepo.findById.mockResolvedValue({
      id: 20,
      name: 'Jane Doe',
      sortName: 'Doe, Jane',
      description: 'Provider description',
      bookCount: 2,
      lastAddedAt: null,
    });

    const result = await service.refreshEnrichment(reqUser(), 20);

    expect(authorsRepo.updateAuthorDescriptionIfEmpty).toHaveBeenCalledWith(20, 'Provider description');
    expect(result.description).toBe('Provider description');
  });

  it('refreshEnrichment stores fetched author image on disk when provider returns one', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([21]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorsRepo.findByIdForEnrichment.mockResolvedValue({
      id: 21,
      name: 'John Doe',
      sortName: 'Doe, John',
      description: 'Existing bio',
      bookCount: 4,
      lastAddedAt: null,
    });
    authorMetadataFetchService.quickSearch.mockResolvedValue({
      provider: 'audnexus',
      providerId: 'B999',
      name: 'John Doe',
      imageUrl: 'https://images.example.com/john.jpg',
    });
    authorImageStorage.saveFromUrl.mockResolvedValue(true);
    authorsRepo.findById.mockResolvedValue({
      id: 21,
      name: 'John Doe',
      sortName: 'Doe, John',
      description: 'Existing bio',
      bookCount: 4,
      lastAddedAt: null,
    });

    await service.refreshEnrichment(reqUser(), 21);

    expect(authorImageStorage.saveFromUrl).toHaveBeenCalledWith(21, 'https://images.example.com/john.jpg');
  });
});
