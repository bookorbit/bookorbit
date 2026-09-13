import type { Mocked } from 'vitest';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

function requestUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 7,
    isSuperuser: false,
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
    ...overrides,
  } as RequestUser;
}

function makeService(libraryIds: number[] = [1, 2]) {
  const catalogRepository = {
    searchAuthors: vi.fn(),
    searchGenres: vi.fn(),
    searchTags: vi.fn(),
    searchNarrators: vi.fn(),
    searchPublishers: vi.fn(),
    searchSeries: vi.fn(),
    searchLanguages: vi.fn(),
    searchCollections: vi.fn(),
  } as unknown as Mocked<CatalogRepository>;
  const libraryService = {
    findAccessibleLibraryIds: vi.fn().mockResolvedValue(libraryIds),
  };

  return {
    service: new CatalogService(catalogRepository, libraryService as never),
    catalogRepository,
    libraryService,
  };
}

describe('CatalogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not resolve library access or query the repository for blank terms', async () => {
    const { service, catalogRepository, libraryService } = makeService();

    await expect(service.searchAuthors(requestUser(), '   ')).resolves.toEqual([]);

    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
    expect(catalogRepository.searchAuthors).not.toHaveBeenCalled();
  });

  it('returns no suggestions without an accessible library', async () => {
    const { service, catalogRepository, libraryService } = makeService([]);
    const user = requestUser();

    await expect(service.searchTags(user, 'history')).resolves.toEqual([]);

    expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(user);
    expect(catalogRepository.searchTags).not.toHaveBeenCalled();
  });

  it('passes accessible libraries and content filters for a regular user', async () => {
    const { service, catalogRepository } = makeService([4, 9]);
    const contentFilters = { ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [3] };
    const user = requestUser({ contentFilters });
    catalogRepository.searchGenres.mockResolvedValue([{ id: 11, name: 'History' }]);

    await expect(service.searchGenres(user, 'history')).resolves.toEqual([{ id: 11, name: 'History' }]);

    expect(catalogRepository.searchGenres).toHaveBeenCalledWith('history', {
      libraryIds: [4, 9],
      contentFilters,
    });
  });

  it('omits content filters for a superuser', async () => {
    const { service, catalogRepository } = makeService([1, 2]);
    const user = requestUser({
      isSuperuser: true,
      contentFilters: { ...EMPTY_CONTENT_FILTER_RULES, excludeGenreIds: [5] },
    });

    await service.searchPublishers(user, 'orbit');

    expect(catalogRepository.searchPublishers).toHaveBeenCalledWith('orbit', {
      libraryIds: [1, 2],
      contentFilters: undefined,
    });
  });

  it.each([
    ['authors', 'searchAuthors'],
    ['tags', 'searchTags'],
    ['narrators', 'searchNarrators'],
    ['publishers', 'searchPublishers'],
    ['series', 'searchSeries'],
    ['languages', 'searchLanguages'],
  ] as const)('scopes %s searches before delegating', async (_label, method) => {
    const { service, catalogRepository } = makeService([12]);
    const user = requestUser();

    await service[method](user, 'term');

    expect(catalogRepository[method]).toHaveBeenCalledWith('term', {
      libraryIds: [12],
      contentFilters: EMPTY_CONTENT_FILTER_RULES,
    });
  });

  it('keeps collection searches scoped directly by owner id', async () => {
    const { service, catalogRepository, libraryService } = makeService();
    catalogRepository.searchCollections.mockResolvedValue([{ name: 'Favorites' }]);

    await expect(service.searchCollections(42, 'favorites')).resolves.toEqual([{ name: 'Favorites' }]);

    expect(catalogRepository.searchCollections).toHaveBeenCalledWith(42, 'favorites');
    expect(libraryService.findAccessibleLibraryIds).not.toHaveBeenCalled();
  });
});
