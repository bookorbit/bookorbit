import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AuthorsService } from './authors.service';

function reqUser(id = 7, superuser = false) {
  return { id, isSuperuser: superuser, permissions: [] } as any;
}

describe('AuthorsService', () => {
  const authorsRepo = {
    findPage: vi.fn(),
    findById: vi.fn(),
    findBookIdsPage: vi.fn(),
    updateAuthorById: vi.fn(),
    findVisibleAuthorIds: vi.fn(),
    countDistinctBooks: vi.fn(),
    mergeAuthors: vi.fn(),
    deleteAuthors: vi.fn(),
    findRelatedLibraryIds: vi.fn(),
    findAuthorsForDuplicatePool: vi.fn(),
    findAuthorsAddedSince: vi.fn(),
    findMostReadAuthors: vi.fn(),
    findAuthorBookPairs: vi.fn(),
    findStartedBookIdsForUser: vi.fn(),
    findByIdForEnrichment: vi.fn(),
    updateAuthorDescriptionIfEmpty: vi.fn(),
  };

  const bookRepo = {
    findCards: vi.fn(),
  };

  const libraryService = {
    findAll: vi.fn(),
  };

  const authorMetadataFetchService = {
    listProviders: vi.fn(),
    search: vi.fn(),
    lookupById: vi.fn(),
    quickSearch: vi.fn(),
  };

  const authorImageStorage = {
    saveFromUrl: vi.fn(),
    getThumbnailPath: vi.fn(),
    getThumbnailUrlIfExists: vi.fn(),
    getImagePath: vi.fn(),
    getImageUrlIfExists: vi.fn(),
  };

  const enrichmentExecutor = {
    execute: vi.fn(),
  };

  const enrichmentOrchestrator = {
    schedule: vi.fn(),
    backfillLinkedAuthors: vi.fn(),
  };

  const appSettings = {
    getAuthorsAutoEnrichmentWriteMode: vi.fn(),
  };

  let service: AuthorsService;

  beforeEach(() => {
    vi.resetAllMocks();
    service = new AuthorsService(
      authorsRepo as any,
      bookRepo as any,
      libraryService as any,
      appSettings as any,
      authorMetadataFetchService as any,
      authorImageStorage as any,
      enrichmentExecutor as any,
      enrichmentOrchestrator as any,
    );
    libraryService.findAll.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue(null);
    authorImageStorage.getImageUrlIfExists.mockResolvedValue(null);
    enrichmentOrchestrator.schedule.mockResolvedValue(1);
    enrichmentOrchestrator.backfillLinkedAuthors.mockResolvedValue(8);
    appSettings.getAuthorsAutoEnrichmentWriteMode.mockResolvedValue('missing_only');
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
    expect(enrichmentOrchestrator.schedule).toHaveBeenCalledWith(10, 'author_merge_target');
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
    expect(enrichmentOrchestrator.schedule).toHaveBeenCalledWith(20, 'author_rename');
  });

  it('findOne returns not found when author is outside user-accessible libraries', async () => {
    authorsRepo.findById.mockResolvedValue(null);
    await expect(service.findOne(reqUser(), 404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refreshEnrichment fills description when missing and returns updated author', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([20]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    enrichmentExecutor.execute.mockResolvedValue({
      kind: 'done',
      provider: 'audnexus',
      descriptionUpdated: true,
      imageUpdated: false,
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

    expect(enrichmentExecutor.execute).toHaveBeenCalledWith({
      authorId: 20,
      writeMode: 'missing_only',
      audnexusEnabled: true,
    });
    expect(result.description).toBe('Provider description');
  });

  it('refreshEnrichment stores fetched author image on disk when provider returns one', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([21]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    enrichmentExecutor.execute.mockResolvedValue({
      kind: 'done',
      provider: 'audnexus',
      descriptionUpdated: false,
      imageUpdated: true,
    });
    authorsRepo.findById.mockResolvedValue({
      id: 21,
      name: 'John Doe',
      sortName: 'Doe, John',
      description: 'Existing bio',
      bookCount: 4,
      lastAddedAt: null,
    });

    await service.refreshEnrichment(reqUser(), 21);

    expect(enrichmentExecutor.execute).toHaveBeenCalledWith({
      authorId: 21,
      writeMode: 'missing_only',
      audnexusEnabled: true,
    });
  });
});
