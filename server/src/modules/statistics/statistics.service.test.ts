import type { RequestUser } from '../../common/types/request-user';
import { StatisticsService } from './statistics.service';

function makeUser(isSuperuser = false): RequestUser {
  return {
    id: 42,
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

describe('StatisticsService', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('clips format distribution to top N and aggregates the remaining counts as Other', async () => {
    const { service, repo } = makeService();
    repo.formatDistribution.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        format: `f${index + 1}`,
        count: index + 1,
      })),
    );

    const result = await service.getFormatDistribution(makeUser(), {});

    expect(result.unknownCount).toBe(0);
    expect(result.items).toHaveLength(11);
    expect(result.items[10]).toEqual({ format: 'Other', count: 23 });
  });

  it('drops null formats from distribution payload mapping', async () => {
    const { service, repo } = makeService();
    repo.formatDistribution.mockResolvedValue([
      { format: 'epub', count: 4 },
      { format: null, count: 99 },
      { format: 'pdf', count: 3 },
    ]);

    const result = await service.getFormatDistribution(makeUser(), {});

    expect(result.items).toEqual([
      { format: 'epub', count: 4 },
      { format: 'pdf', count: 3 },
    ]);
  });

  it('fills metadata score bins from 0-100 and preserves percentile metrics', async () => {
    const { service, repo } = makeService();
    repo.metadataScoreDistribution.mockResolvedValue({
      bins: [
        { minScore: 0, count: 2 },
        { minScore: 20, count: 5 },
        { minScore: 90, count: 1 },
      ],
      unknownCount: 7,
      totalCount: 8,
      percentile25: 10,
      percentile50: 25,
      percentile75: 40,
      percentile90: 90,
    });

    const result = await service.getMetadataScoreDistribution(makeUser(), {});

    expect(result.bins).toHaveLength(10);
    expect(result.bins[0]).toEqual({ minScore: 0, maxScore: 9, count: 2 });
    expect(result.bins[1]).toEqual({ minScore: 10, maxScore: 19, count: 0 });
    expect(result.bins[2]).toEqual({ minScore: 20, maxScore: 29, count: 5 });
    expect(result.bins[9]).toEqual({ minScore: 90, maxScore: 100, count: 1 });
    expect(result.percentile90).toBe(90);
    expect(result.unknownCount).toBe(7);
  });

  it('groups non-top and unknown formats into OTHER in format share over time', async () => {
    const { service, repo } = makeService();
    repo.formatShareOverTime.mockResolvedValue([
      { year: 2025, month: 1, format: 'epub', count: 10 },
      { year: 2025, month: 1, format: 'pdf', count: 9 },
      { year: 2025, month: 1, format: 'cbz', count: 8 },
      { year: 2025, month: 1, format: 'cbr', count: 7 },
      { year: 2025, month: 1, format: 'mobi', count: 6 },
      { year: 2025, month: 1, format: 'azw3', count: 5 },
      { year: 2025, month: 1, format: 'fb2', count: 4 },
      { year: 2025, month: 1, format: 'mp3', count: 3 },
      { year: 2025, month: 1, format: 'flac', count: 2 },
      { year: 2025, month: 1, format: null, count: 1 },
      { year: 2025, month: 1, format: null, count: 2 },
    ]);

    const result = await service.getFormatShareOverTime(makeUser(), {});
    const other = result.items.find((item) => item.format === 'OTHER');

    expect(other).toEqual({ year: 2025, month: 1, format: 'OTHER', count: 5 });
    expect(result.items.some((item) => item.format === 'UNKNOWN')).toBe(false);
  });

  it('clips storage by format and aggregates tail size into Other bucket', async () => {
    const { service, repo } = makeService();
    repo.storageByFormat.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        format: `f${index + 1}`,
        sizeBytes: index + 1,
      })),
    );

    const result = await service.getStorageByFormat(makeUser(), {});

    expect(result.items).toHaveLength(11);
    expect(result.items[10]).toEqual({ format: 'Other', sizeBytes: 23 });
  });

  it('uses shared metadata field definitions for overall completeness and sorts by presence', async () => {
    const { service, repo } = makeService();
    repo.metadataCompleteness.mockResolvedValue({
      total: 20,
      hasTitle: 20,
      hasCover: 19,
      hasAuthor: 18,
      hasDescription: 7,
      hasPublisher: 6,
      hasYear: 5,
      hasLanguage: 4,
      hasPageCount: 3,
      hasRating: 2,
      hasSeries: 1,
      hasIsbn: 0,
      hasGenre: 15,
      hasTag: 14,
    });

    const result = await service.getMetadataCompleteness(makeUser(), {});

    expect(result.items).toHaveLength(10);
    expect(result.items[0]).toEqual({ field: 'Cover', presentCount: 19, totalCount: 20 });
    expect(result.items[9]).toEqual({ field: 'ISBN', presentCount: 0, totalCount: 20 });
    expect(result.items.find((item) => item.field === 'Title')).toBeUndefined();
    expect(result.items.find((item) => item.field === 'Genres')).toBeUndefined();
    expect(result.items.find((item) => item.field === 'Tags')).toBeUndefined();
  });

  it('returns zeroed metadata completeness when repository row is unexpectedly missing', async () => {
    const { service, repo } = makeService();
    repo.metadataCompleteness.mockResolvedValue(undefined);

    const result = await service.getMetadataCompleteness(makeUser(), {});

    expect(result.items.every((item) => item.totalCount === 0 && item.presentCount === 0)).toBe(true);
  });

  it('filters invalid largest-books rows with missing required fields', async () => {
    const { service, repo } = makeService();
    repo.largestBooks.mockResolvedValue([
      { id: 1, title: null, sizeBytes: 100, format: 'epub' },
      { id: 2, title: 'Valid Title', sizeBytes: 200, format: null },
      { id: 3, title: 'Another', sizeBytes: 300, format: 'pdf' },
    ]);

    const result = await service.getLargestBooks(makeUser(), {});

    expect(result.items).toEqual([{ id: 3, title: 'Another', sizeBytes: 300, format: 'pdf' }]);
  });

  it('filters invalid top-series rows with null names', async () => {
    const { service, repo } = makeService();
    repo.topSeries.mockResolvedValue([
      { name: null, count: 5 },
      { name: 'Saga', count: 4 },
    ]);

    const result = await service.getTopSeries(makeUser(), {});

    expect(result.items).toEqual([{ name: 'Saga', count: 4 }]);
  });
});
