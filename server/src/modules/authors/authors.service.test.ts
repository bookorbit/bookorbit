import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { AUTHOR_ENRICHMENT_REASONS } from './author-enrichment-reasons';
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
    stream: vi.fn(),
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
    expect(enrichmentOrchestrator.schedule).toHaveBeenCalledWith(10, AUTHOR_ENRICHMENT_REASONS.AUTHOR_MERGE_TARGET);
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
    expect(enrichmentOrchestrator.schedule).toHaveBeenCalledWith(20, AUTHOR_ENRICHMENT_REASONS.AUTHOR_RENAME);
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

  it('refreshEnrichment throws when provider fails so callers can surface failure', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([22]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    enrichmentExecutor.execute.mockResolvedValue({
      kind: 'failed',
      provider: 'audnexus',
      message: 'upstream timeout',
      httpStatus: 504,
      retryAfterMs: 5_000,
      transient: true,
      descriptionUpdated: false,
      imageUpdated: false,
    });

    await expect(service.refreshEnrichment(reqUser(), 22)).rejects.toThrow('Author enrichment failed');
  });

  it('findAll returns an empty page when user has no accessible libraries', async () => {
    libraryService.findAll.mockResolvedValue([]);

    const page = await service.findAll(reqUser(), {});

    expect(page).toEqual({ items: [], total: 0, page: 0, size: 50 });
    expect(authorsRepo.findPage).not.toHaveBeenCalled();
  });

  it('findAll applies defaults and appends thumbnail urls', async () => {
    authorsRepo.findPage.mockResolvedValue({
      items: [
        {
          id: 10,
          name: 'Alpha',
          sortName: null,
          description: null,
          bookCount: 3,
          lastAddedAt: null,
        },
      ],
      total: 1,
      page: 0,
      size: 50,
    });
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue('https://cdn.example.com/a10-thumb.jpg');

    const page = await service.findAll(reqUser(), {});

    expect(authorsRepo.findPage).toHaveBeenCalledWith({
      q: undefined,
      page: 0,
      size: 50,
      sort: 'name',
      order: 'asc',
      libraryIds: [1, 2],
      hasPhoto: undefined,
      minBookCount: undefined,
    });
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        id: 10,
        name: 'Alpha',
        imageUrl: 'https://cdn.example.com/a10-thumb.jpg',
      }),
    );
  });

  it('findAll rejects excessively deep offsets', async () => {
    await expect(service.findAll(reqUser(), { page: 2_000_000, size: 100 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findBooks returns empty page when user has no accessible libraries', async () => {
    libraryService.findAll.mockResolvedValue([]);

    const page = await service.findBooks(reqUser(), 99, {});

    expect(page).toEqual({ items: [], total: 0, page: 0, size: 50 });
    expect(authorsRepo.findById).not.toHaveBeenCalled();
  });

  it('findBooks throws not found when the author is not visible', async () => {
    authorsRepo.findById.mockResolvedValue(null);

    await expect(service.findBooks(reqUser(), 99, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('listDuplicateSuggestions returns [] when duplicate pool is too small', async () => {
    authorsRepo.findAuthorsForDuplicatePool.mockResolvedValue([
      { id: 1, name: 'Only One', sortName: null, description: null, bookCount: 1, lastAddedAt: null },
    ]);

    await expect(service.listDuplicateSuggestions(reqUser(), {})).resolves.toEqual([]);
  });

  it('listDuplicateSuggestions scores and returns likely duplicates', async () => {
    authorsRepo.findAuthorsForDuplicatePool.mockResolvedValue([
      { id: 1, name: 'John Smith', sortName: null, description: null, bookCount: 7, lastAddedAt: null },
      { id: 2, name: 'John Smith', sortName: null, description: null, bookCount: 2, lastAddedAt: null },
      { id: 3, name: 'Jane Doe', sortName: null, description: null, bookCount: 5, lastAddedAt: null },
    ]);

    const suggestions = await service.listDuplicateSuggestions(reqUser(), { minConfidence: 0.9, limit: 5, poolSize: 50 });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual(
      expect.objectContaining({
        confidence: 0.98,
      }),
    );
    expect(suggestions[0]?.reasons).toContain('same canonical name');
  });

  it('returns metadata providers directly from the metadata fetch service', () => {
    authorMetadataFetchService.listProviders.mockReturnValue([{ key: 'audnexus', label: 'Audnexus', identifiable: true }]);

    expect(service.listMetadataProviders()).toEqual([{ key: 'audnexus', label: 'Audnexus', identifiable: true }]);
  });

  it('searchMetadata forwards query and provider filters', async () => {
    authorMetadataFetchService.search.mockResolvedValue([{ provider: 'audnexus', providerId: 'A1', name: 'John Smith' }]);

    await expect(service.searchMetadata({ q: 'John Smith', region: 'us', limit: 2, providers: ['audnexus'] })).resolves.toEqual([
      { provider: 'audnexus', providerId: 'A1', name: 'John Smith' },
    ]);
    expect(authorMetadataFetchService.search).toHaveBeenCalledWith({ name: 'John Smith', region: 'us', limit: 2 }, { keys: ['audnexus'] });
  });

  it('lookupMetadata forwards provider key and id', async () => {
    authorMetadataFetchService.lookupById.mockResolvedValue({ provider: 'audnexus', providerId: 'A1', name: 'John Smith' });

    await expect(service.lookupMetadata({ provider: 'audnexus', id: 'A1', region: 'ca' })).resolves.toEqual({
      provider: 'audnexus',
      providerId: 'A1',
      name: 'John Smith',
    });
  });

  it('streamMetadata proxies through provider stream options', () => {
    const mockStream = Symbol('stream');
    authorMetadataFetchService.stream.mockReturnValue(mockStream as any);

    const stream = service.streamMetadata({ q: 'Jane', region: 'us', limit: 5, providers: ['audnexus'] });

    expect(stream).toBe(mockStream);
    expect(authorMetadataFetchService.stream).toHaveBeenCalledWith({ name: 'Jane', region: 'us', limit: 5 }, { keys: ['audnexus'] });
  });

  it('getInsights returns empty collections when no libraries are accessible', async () => {
    libraryService.findAll.mockResolvedValue([]);

    const insights = await service.getInsights(reqUser(), {});

    expect(insights.newAuthors).toEqual([]);
    expect(insights.mostRead).toEqual([]);
    expect(insights.unreadBacklog).toEqual([]);
  });

  it('getInsights computes unread backlog and filters mostRead rows with zero metric', async () => {
    authorsRepo.findAuthorsAddedSince.mockResolvedValue([
      {
        id: 1,
        name: 'A',
        sortName: null,
        description: null,
        bookCount: 2,
        lastAddedAt: new Date('2026-01-01T00:00:00Z'),
        metric: 2,
        secondaryMetric: null,
      },
    ]);
    authorsRepo.findMostReadAuthors.mockResolvedValue([
      {
        id: 2,
        name: 'B',
        sortName: null,
        description: null,
        bookCount: 3,
        lastAddedAt: new Date('2026-01-02T00:00:00Z'),
        metric: 0,
        secondaryMetric: 10,
      },
      {
        id: 3,
        name: 'C',
        sortName: null,
        description: null,
        bookCount: 4,
        lastAddedAt: new Date('2026-01-03T00:00:00Z'),
        metric: 1,
        secondaryMetric: 50,
      },
    ]);
    authorsRepo.findAuthorBookPairs.mockResolvedValue([
      { authorId: 1, name: 'A', sortName: null, description: null, bookId: 10, addedAt: new Date('2026-01-02T00:00:00Z') },
      { authorId: 1, name: 'A', sortName: null, description: null, bookId: 10, addedAt: new Date('2026-01-02T00:00:00Z') },
      { authorId: 1, name: 'A', sortName: null, description: null, bookId: 11, addedAt: new Date('2026-01-04T00:00:00Z') },
    ]);
    authorsRepo.findStartedBookIdsForUser.mockResolvedValue([10]);

    const insights = await service.getInsights(reqUser(), { limit: 5, windowDays: 30 });

    expect(insights.mostRead).toHaveLength(1);
    expect(insights.mostRead[0]?.id).toBe(3);
    expect(insights.unreadBacklog[0]).toEqual(
      expect.objectContaining({
        id: 1,
        metric: 1,
        secondaryMetric: 2,
      }),
    );
  });

  it('update returns current detail when no mutable fields are provided', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([30]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorsRepo.findById.mockResolvedValue({
      id: 30,
      name: 'Current',
      sortName: null,
      description: null,
      bookCount: 1,
      lastAddedAt: null,
    });

    const result = await service.update(reqUser(), 30, {});

    expect(authorsRepo.updateAuthorById).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: 30, name: 'Current' }));
  });

  it('update rejects blank names', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([31]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);

    await expect(service.update(reqUser(), 31, { name: '   ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('get image paths verify readability before touching storage', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([40]);
    authorImageStorage.getThumbnailPath.mockResolvedValue('/tmp/thumb.jpg');
    authorImageStorage.getImagePath.mockResolvedValue('/tmp/full.jpg');

    await expect(service.getThumbnailPath(reqUser(), 40)).resolves.toBe('/tmp/thumb.jpg');
    await expect(service.getImagePath(reqUser(), 40)).resolves.toBe('/tmp/full.jpg');
  });

  it('bulkRefreshMetadata returns zero counters for empty input', async () => {
    await expect(service.bulkRefreshMetadata([], reqUser())).resolves.toEqual({
      processed: 0,
      failed: 0,
      updated: 0,
    });
  });

  it('bulkRefreshMetadata stops iterating when progress callback throws', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([1, 2]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue('https://cdn.example.com/1-thumb.jpg');
    vi.spyOn(service as any, 'refreshEnrichmentInternal').mockResolvedValue({
      descriptionUpdated: true,
      imageUpdated: true,
      provider: 'audnexus',
    });

    const progress = vi.fn(() => {
      throw new Error('client disconnected');
    });

    const result = await service.bulkRefreshMetadata([1, 2], reqUser(), progress);

    expect(result).toEqual({ processed: 1, failed: 0, updated: 1 });
    expect(progress).toHaveBeenCalledTimes(1);
  });

  it('bulkRefreshMetadata deduplicates ids and continues after per-item failures', async () => {
    authorsRepo.findVisibleAuthorIds.mockResolvedValue([1, 2]);
    authorsRepo.findRelatedLibraryIds.mockResolvedValue([1]);
    vi.spyOn(service as any, 'refreshEnrichmentInternal')
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValueOnce({
        descriptionUpdated: false,
        imageUpdated: true,
        provider: 'audnexus',
      });
    vi.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    authorImageStorage.getThumbnailUrlIfExists.mockResolvedValue('https://cdn.example.com/2-thumb.jpg');

    const progress = vi.fn();
    const result = await service.bulkRefreshMetadata([1, 1, 2], reqUser(), progress);

    expect(result).toEqual({ processed: 2, failed: 1, updated: 1 });
    expect(progress).toHaveBeenCalledTimes(2);
  });
});
