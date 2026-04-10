import { StatisticsRepository } from './statistics.repository';

function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    from: vi.fn(),
    where: vi.fn(),
    innerJoin: vi.fn(),
    leftJoin: vi.fn(),
    groupBy: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    as: vi.fn(),
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
    catch: (onRejected: (error: unknown) => unknown) => Promise.resolve(result).catch(onRejected),
  };

  for (const key of ['from', 'where', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy', 'limit', 'offset', 'as']) {
    (chain[key] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
  }

  return chain;
}

function makeDb(selectQueue: unknown[] = [], executeQueue: unknown[] = []) {
  const selects = [...selectQueue];
  const executes = [...executeQueue];

  return {
    select: vi.fn(() => makeChain(selects.shift() ?? [])),
    execute: vi.fn(() => Promise.resolve({ rows: executes.shift() ?? [] })),
  };
}

describe('StatisticsRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles helper library-scope methods for superusers and restricted users', async () => {
    const db = makeDb([[{ libraryId: 1 }, { libraryId: 3 }]]);
    const repo = new StatisticsRepository(db as never);

    await expect((repo as any).getAccessibleLibraryIds(2, true)).resolves.toBeNull();
    await expect((repo as any).getAccessibleLibraryIds(2, false)).resolves.toEqual([1, 3]);

    expect((repo as any).intersectLibraryIds(null, undefined)).toBeNull();
    expect((repo as any).intersectLibraryIds(null, [5, 6])).toEqual([5, 6]);
    expect((repo as any).intersectLibraryIds([1, 2, 3], [2, 8])).toEqual([2]);

    expect((repo as any).libraryFilter(null)).toBeUndefined();
    expect((repo as any).libraryFilter([])).toBeDefined();
    expect((repo as any).libraryFilter([1])).toBeDefined();
  });

  it('executes all public statistic queries with expected return shaping', async () => {
    const db = makeDb(
      [
        [{ format: 'epub', count: 4 }],
        [{ language: 'en', count: 8 }],
        [{ unknownCount: 2 }],
        [{ year: 2026, month: 0, count: 5 }],
        [{ year: 2026, month: 4, count: 3 }],
        [{ minScore: 20, count: 7 }],
        [{ unknownCount: 1 }],
        [{ totalCount: 7, percentile25: 10, percentile50: 20, percentile75: 30, percentile90: 40 }],
        [
          {
            libraryId: 1,
            libraryName: 'Main',
            total: 10,
            hasTitle: 10,
            hasCover: 8,
            hasAuthor: 7,
            hasGenre: 6,
            hasTag: 5,
            hasDescription: 4,
            hasPublisher: 3,
            hasYear: 2,
            hasLanguage: 1,
            hasPageCount: 9,
            hasRating: 8,
            hasSeries: 7,
            hasIsbn: 6,
          },
        ],
        [{ year: 2026, month: 1, format: 'epub', count: 10 }],
        [{ format: 'epub', count: 2, min: 50, q1: 100, median: 200, q3: 300, max: 500 }],
        [{ unknownCount: 6 }],
        [{ format: 'epub', sizeBytes: 1024 }],
        [{ year: 2020, count: 4, topTitles: ['A'] }],
        [{ year: 2020, title: 'A' }],
        [{ unknownCount: 1 }],
        [{ decade: 1990, count: 2 }],
        [{ unknownCount: 3 }],
        [{ name: 'Author A', count: 11 }],
        [
          {
            total: 10,
            hasTitle: 10,
            hasCover: 9,
            hasDescription: 8,
            hasPublisher: 7,
            hasYear: 6,
            hasLanguage: 5,
            hasPageCount: 4,
            hasRating: 3,
            hasSeries: 2,
            hasIsbn: 1,
            hasAuthor: 9,
          },
        ],
        [{ genre: 'Sci-Fi', count: 9 }],
        [{ unknownCount: 4 }],
        [{ count: 12 }],
        [{ count: 8 }],
        [{ count: 4 }],
        [{ count: 3 }],
        [{ total: 1024 }],
        [{ count: 6 }],
        [{ count: 5 }],
        [{ minYear: 1950, maxYear: 2020 }],
        [{ count: 2 }],
        [{ id: 1, name: 'Sci-Fi' }],
        [{ totalBooks: 100, neverFetchedCount: 10, fresh30dCount: 40, stale31To90dCount: 20, stale91To180dCount: 15, staleOver180dCount: 15 }],
        [{ totalBooks: 100, presentCount: 98, primaryFileCount: 97, metadataCount: 96 }],
        [{ addedYear: 2026, lagYears: 4, count: 9 }],
        [{ unknownCount: 1 }],
        [{ id: 3, title: 'Big Book', sizeBytes: 9999, format: 'epub' }],
        [{ name: 'Saga', count: 4 }],
        [
          { id: 1, name: 'Sci-Fi' },
          { id: 2, name: 'Fantasy' },
        ],
      ],
      [[{ source: 'Sci-Fi', target: 'Fantasy', value: 3 }]],
    );
    const repo = new StatisticsRepository(db as never);

    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([1, 2, 3]);
    vi.spyOn(repo as any, 'resolveLibraryFilter').mockResolvedValue({ op: 'filter' });

    await expect(repo.formatDistribution(1, false, [1])).resolves.toEqual([{ format: 'epub', count: 4 }]);
    await expect(repo.languageDistribution(1, false, [1])).resolves.toEqual({
      items: [{ language: 'en', count: 8 }],
      unknownCount: 2,
    });

    await expect(repo.booksAddedOverTime(1, false, [1], 'yearly', 'last-year')).resolves.toEqual([{ year: 2026, month: 0, count: 5 }]);
    await expect(repo.booksAddedOverTime(1, false, [1], 'monthly', 'all-time')).resolves.toEqual([{ year: 2026, month: 4, count: 3 }]);

    await expect(repo.metadataScoreDistribution(1, false, [1])).resolves.toEqual({
      bins: [{ minScore: 20, count: 7 }],
      unknownCount: 1,
      totalCount: 7,
      percentile25: 10,
      percentile50: 20,
      percentile75: 30,
      percentile90: 40,
    });

    await expect(repo.libraryMetadataCompleteness(1, false, [1])).resolves.toHaveLength(1);
    await expect(repo.formatShareOverTime(1, false, [1])).resolves.toEqual([{ year: 2026, month: 1, format: 'epub', count: 10 }]);
    await expect(repo.pageCountDistributionByFormat(1, false, [1])).resolves.toEqual({
      items: [{ format: 'epub', count: 2, min: 50, q1: 100, median: 200, q3: 300, max: 500 }],
      unknownCount: 6,
    });
    await expect(repo.storageByFormat(1, false, [1])).resolves.toEqual([{ format: 'epub', sizeBytes: 1024 }]);

    const publicationTimeline = await repo.publicationYearTimeline(1, false, [1]);
    expect(publicationTimeline.items).toEqual([
      expect.objectContaining({
        year: 2020,
      }),
    ]);
    const publicationDecade = await repo.publicationDecade(1, false, [1]);
    expect(publicationDecade.items).toHaveLength(1);
    await expect(repo.topAuthors(1, false, [1])).resolves.toEqual(expect.any(Array));

    const metadataCompleteness = await repo.metadataCompleteness(1, false, [1]);
    expect(metadataCompleteness).toBeDefined();

    const genreDistribution = await repo.genreDistribution(1, false, [1]);
    expect(genreDistribution).toHaveProperty('items');
    expect(genreDistribution).toHaveProperty('unknownCount');

    const summary = await repo.getSummary(1, false, [1]);
    expect(summary).toBeDefined();

    const freshness = await repo.metadataFreshnessGauge(1, false, [1]);
    expect(freshness).toHaveProperty('totalBooks');

    const integrity = await repo.libraryIntegrityGauge(1, false, [1]);
    expect(integrity).toHaveProperty('totalBooks');

    const lagScatter = await repo.acquisitionLagScatter(1, false, [1]);
    expect(lagScatter).toHaveProperty('items');

    await expect(repo.largestBooks(1, false, [1])).resolves.toEqual(expect.any(Array));
    await expect(repo.topSeries(1, false, [1])).resolves.toEqual(expect.any(Array));

    const cooccurrence = await repo.getGenreCooccurrence(1, false, [1], 15);
    expect(cooccurrence).toHaveProperty('nodes');
    expect(cooccurrence).toHaveProperty('links');
  });

  it('returns fallback structures when optional query rows are missing', async () => {
    const db = makeDb([[{ id: 1, name: 'Only one' }], []]);
    const repo = new StatisticsRepository(db as never);
    vi.spyOn(repo as any, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    vi.spyOn(repo as any, 'resolveLibraryFilter').mockResolvedValue({ op: 'filter' });

    await expect(repo.getGenreCooccurrence(1, false, [1], 15)).resolves.toEqual({
      nodes: [{ name: 'Only one' }],
      links: [],
    });
    await expect(repo.metadataCompleteness(1, false, [1])).resolves.toEqual({
      total: 0,
      hasTitle: 0,
      hasCover: 0,
      hasDescription: 0,
      hasPublisher: 0,
      hasYear: 0,
      hasLanguage: 0,
      hasPageCount: 0,
      hasRating: 0,
      hasSeries: 0,
      hasIsbn: 0,
      hasAuthor: 0,
    });
  });
});
