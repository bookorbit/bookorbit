import type { RequestUser } from '../../common/types/request-user';
import { StatisticsService } from './statistics.service';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';

function makeUser(isSuperuser = false): RequestUser {
  return {
    id: 2,
    username: 'reader',
    name: 'Reader',
    email: null,
    active: true,
    isSuperuser,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],

    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const repo = {
    formatDistribution: vi.fn(),
    languageDistribution: vi.fn(),
    booksAddedOverTime: vi.fn(),
    metadataScoreDistribution: vi.fn(),
    libraryMetadataCompleteness: vi.fn(),
    formatShareOverTime: vi.fn(),
    pageCountDistributionByFormat: vi.fn(),
    storageByFormat: vi.fn(),
    publicationDecade: vi.fn(),
    publicationYearTimeline: vi.fn(),
    topAuthors: vi.fn(),
    metadataCompleteness: vi.fn(),
    genreDistribution: vi.fn(),
    metadataFreshnessGauge: vi.fn(),
    libraryIntegrityGauge: vi.fn(),
    acquisitionLagScatter: vi.fn(),
    getSummary: vi.fn(),
    getGenreCooccurrence: vi.fn(),
    largestBooks: vi.fn(),
    topSeries: vi.fn(),
  };
  return {
    repo,
    service: new StatisticsService(repo as never),
  };
}

describe('StatisticsService additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps language and page-count distribution payloads with normalization', async () => {
    const { service, repo } = makeService();
    repo.languageDistribution.mockResolvedValue({
      items: [
        { language: 'en', count: 6 },
        { language: 'fr', count: 4 },
      ],
      unknownCount: 3,
    });
    repo.pageCountDistributionByFormat.mockResolvedValue({
      items: [{ format: 'epub', count: 1, min: 12, q1: '15.5', median: '21.2', q3: 30, max: 35 }],
      unknownCount: 2,
    });

    await expect(service.getLanguageDistribution(makeUser(), {})).resolves.toEqual({
      items: [
        { language: 'en', count: 6 },
        { language: 'fr', count: 4 },
      ],
      unknownCount: 3,
    });

    await expect(service.getPageCountDistribution(makeUser(), {})).resolves.toEqual({
      items: [{ format: 'EPUB', count: 1, min: 12, q1: 15.5, median: 21.2, q3: 30, max: 35 }],
      unknownCount: 2,
    });
  });

  it('calculates metadata freshness and library integrity gauges with weighted scores', async () => {
    const { service, repo } = makeService();
    repo.metadataFreshnessGauge.mockResolvedValue({
      totalBooks: 100,
      neverFetchedCount: 10,
      fresh30dCount: 50,
      stale31To90dCount: 20,
      stale91To180dCount: 20,
      staleOver180dCount: 10,
    });
    repo.libraryIntegrityGauge.mockResolvedValue({
      totalBooks: 80,
      presentCount: 72,
      primaryFileCount: 76,
      metadataCount: 64,
    });

    await expect(service.getMetadataFreshnessGauge(makeUser(), {})).resolves.toEqual({
      totalBooks: 100,
      neverFetchedCount: 10,
      fresh30dCount: 50,
      stale31To90dCount: 20,
      stale91To180dCount: 20,
      staleOver180dCount: 10,
      freshnessScore: 74,
    });

    await expect(service.getLibraryIntegrityGauge(makeUser(), {})).resolves.toEqual({
      totalBooks: 80,
      presentCount: 72,
      primaryFileCount: 76,
      metadataCount: 64,
      integrityScore: 88,
    });
  });

  it('delegates scatter, decade, timeline, author, and genre endpoints', async () => {
    const { service, repo } = makeService();
    repo.publicationDecade.mockResolvedValue({ items: [{ decade: 2000, count: 2 }], unknownCount: 1 });
    repo.publicationYearTimeline.mockResolvedValue({ items: [{ year: 2020, count: 3, topTitles: ['A'] }], unknownCount: 2 });
    repo.topAuthors.mockResolvedValue([{ name: 'Author A', count: 5 }]);
    repo.genreDistribution.mockResolvedValue({ items: [{ genre: 'Sci-Fi', count: 7 }], unknownCount: 3 });
    repo.acquisitionLagScatter.mockResolvedValue({ items: [{ addedYear: 2024, lagYears: 5, count: 3 }], unknownCount: 4 });

    await expect(service.getPublicationDecade(makeUser(), {})).resolves.toEqual({
      items: [{ decade: 2000, count: 2 }],
      unknownCount: 1,
    });
    await expect(service.getPublicationYearTimeline(makeUser(), {})).resolves.toEqual({
      items: [{ year: 2020, count: 3, topTitles: ['A'] }],
      unknownCount: 2,
    });
    await expect(service.getTopAuthors(makeUser(), {})).resolves.toEqual({
      items: [{ name: 'Author A', count: 5 }],
      unknownCount: 0,
    });
    await expect(service.getGenreDistribution(makeUser(), {})).resolves.toEqual({
      items: [{ genre: 'Sci-Fi', count: 7 }],
      unknownCount: 3,
    });
    await expect(service.getAcquisitionLagScatter(makeUser(), {})).resolves.toEqual({
      items: [{ addedYear: 2024, lagYears: 5, count: 3 }],
      unknownCount: 4,
    });
  });

  it('caches summary and genre-cooccurrence results for repeated identical requests', async () => {
    const { service, repo } = makeService();
    repo.getSummary.mockResolvedValue({ totalBooks: 5 });
    repo.getGenreCooccurrence.mockResolvedValue({ nodes: [{ name: 'A' }], links: [] });

    await service.getSummary(makeUser(), { libraryIds: [3, 1, 3] });
    await service.getSummary(makeUser(), { libraryIds: [1, 3] });
    await service.getGenreCooccurrence(makeUser(), { libraryIds: [1, 3] });
    await service.getGenreCooccurrence(makeUser(), { libraryIds: [3, 1] });

    expect(repo.getSummary).toHaveBeenCalledTimes(1);
    expect(repo.getGenreCooccurrence).toHaveBeenCalledTimes(1);
  });

  it('caches results per user scope: two different users get independent cache entries', async () => {
    const { service, repo } = makeService();
    repo.getSummary.mockResolvedValueOnce({ totalBooks: 10 }).mockResolvedValueOnce({ totalBooks: 20 });

    const userA = makeUser();
    const userB = { ...makeUser(), id: 3 };

    const firstA = await service.getSummary(userA, { libraryIds: [] });
    const firstB = await service.getSummary(userB, { libraryIds: [] });

    expect(repo.getSummary).toHaveBeenCalledTimes(2);
    expect(firstA.totalBooks).toBe(10);
    expect(firstB.totalBooks).toBe(20);

    const secondA = await service.getSummary(userA, { libraryIds: [] });
    const secondB = await service.getSummary(userB, { libraryIds: [] });

    expect(repo.getSummary).toHaveBeenCalledTimes(2);
    expect(secondA.totalBooks).toBe(10);
    expect(secondB.totalBooks).toBe(20);
  });

  it('filters invalid entries for largest-books and top-series payloads', async () => {
    const { service, repo } = makeService();
    repo.largestBooks.mockResolvedValue([
      { id: 1, title: null, sizeBytes: 123, format: 'epub' },
      { id: 2, title: 'Book', sizeBytes: 456, format: 'pdf' },
    ]);
    repo.topSeries.mockResolvedValue([
      { name: null, count: 8 },
      { name: 'Saga', count: 7 },
    ]);

    await expect(service.getLargestBooks(makeUser(), {})).resolves.toEqual({
      items: [{ id: 2, title: 'Book', sizeBytes: 456, format: 'pdf' }],
      unknownCount: 0,
    });
    await expect(service.getTopSeries(makeUser(), {})).resolves.toEqual({
      items: [{ name: 'Saga', count: 7 }],
      unknownCount: 0,
    });
  });
});
