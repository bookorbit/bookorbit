import { StatisticsController } from './statistics.controller';

describe('StatisticsController', () => {
  const service = {
    getFormatDistribution: vi.fn(),
    getLanguageDistribution: vi.fn(),
    getBooksAddedOverTime: vi.fn(),
    getStorageByFormat: vi.fn(),
    getMetadataScoreDistribution: vi.fn(),
    getLibraryMetadataCompleteness: vi.fn(),
    getFormatShareOverTime: vi.fn(),
    getPageCountDistribution: vi.fn(),
    getPublicationDecade: vi.fn(),
    getPublicationYearTimeline: vi.fn(),
    getTopAuthors: vi.fn(),
    getMetadataCompleteness: vi.fn(),
    getGenreDistribution: vi.fn(),
    getSummary: vi.fn(),
    getGenreCooccurrence: vi.fn(),
    getMetadataFreshnessGauge: vi.fn(),
    getLibraryIntegrityGauge: vi.fn(),
    getAcquisitionLagScatter: vi.fn(),
    getLargestBooks: vi.fn(),
    getTopSeries: vi.fn(),
  };

  const controller = new StatisticsController(service as never);
  const user = { id: 10 } as never;
  const query = { libraryIds: [1, 2] } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(service)) {
      fn.mockResolvedValue({ ok: true });
    }
  });

  it('forwards every endpoint request to the matching service method with user and query', async () => {
    const methodMap: Array<[keyof StatisticsController, keyof typeof service]> = [
      ['getFormatDistribution', 'getFormatDistribution'],
      ['getLanguageDistribution', 'getLanguageDistribution'],
      ['getBooksAddedOverTime', 'getBooksAddedOverTime'],
      ['getStorageByFormat', 'getStorageByFormat'],
      ['getMetadataScoreDistribution', 'getMetadataScoreDistribution'],
      ['getLibraryMetadataCompleteness', 'getLibraryMetadataCompleteness'],
      ['getFormatShareOverTime', 'getFormatShareOverTime'],
      ['getPageCountDistribution', 'getPageCountDistribution'],
      ['getPublicationDecade', 'getPublicationDecade'],
      ['getPublicationYearTimeline', 'getPublicationYearTimeline'],
      ['getTopAuthors', 'getTopAuthors'],
      ['getMetadataCompleteness', 'getMetadataCompleteness'],
      ['getGenreDistribution', 'getGenreDistribution'],
      ['getSummary', 'getSummary'],
      ['getGenreCooccurrence', 'getGenreCooccurrence'],
      ['getMetadataFreshnessGauge', 'getMetadataFreshnessGauge'],
      ['getLibraryIntegrityGauge', 'getLibraryIntegrityGauge'],
      ['getAcquisitionLagScatter', 'getAcquisitionLagScatter'],
      ['getLargestBooks', 'getLargestBooks'],
      ['getTopSeries', 'getTopSeries'],
    ];

    for (const [controllerMethod, serviceMethod] of methodMap) {
      await (controller[controllerMethod] as (u: unknown, q: unknown) => Promise<unknown>)(user, query);
      expect(service[serviceMethod]).toHaveBeenCalledWith(user, query);
    }
  });
});
