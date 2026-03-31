import type { MetadataScoreWeights } from '@projectx/types';

import type { ScorePage } from './metadata-score.repository';
import { MetadataRecalculationTrigger, MetadataScoreService } from './metadata-score.service';

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeWeights(): MetadataScoreWeights {
  return {
    title: 10,
    subtitle: 0,
    description: 8,
    coverSource: 10,
    genres: 6,
    isbn13: 7,
    publisher: 4,
    publishedYear: 4,
    language: 4,
    isbn10: 2,
    pageCount: 2,
    rating: 1,
    seriesName: 0,
    seriesIndex: 0,
    tags: 2,
    authors: 10,
    googleBooksId: 1,
    goodreadsId: 1,
    amazonId: 1,
    hardcoverId: 1,
    openLibraryId: 1,
    itunesId: 1,
  };
}

function makeService() {
  const repo = {
    loadScoreData: vi.fn(),
    loadScoreDataPage: vi.fn(),
    updateMetadataScore: vi.fn(),
  };
  const scorer = {
    compute: vi.fn(),
  };
  const appSettings = {
    getMetadataScoreWeights: vi.fn(),
    setMetadataScoreWeights: vi.fn(),
  };

  const service = new MetadataScoreService(repo as never, scorer as never, appSettings as never);
  return { service, repo, scorer, appSettings };
}

async function waitForNonRunningStatus(service: MetadataScoreService): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (service.getRecalculationStatus().state !== 'running') return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Recalculation did not finish within timeout');
}

describe('MetadataScoreService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the current weights from settings', async () => {
    const { service, appSettings } = makeService();
    const weights = makeWeights();
    appSettings.getMetadataScoreWeights.mockResolvedValue(weights);

    await expect(service.getWeights()).resolves.toEqual(weights);
  });

  it('updates score for a single book when metadata exists', async () => {
    const { service, repo, scorer, appSettings } = makeService();
    const weights = makeWeights();
    const data = {
      title: 'Dune',
      subtitle: null,
      description: null,
      isbn10: null,
      isbn13: null,
      publisher: null,
      publishedYear: null,
      language: null,
      pageCount: null,
      seriesName: null,
      seriesIndex: null,
      rating: null,
      coverSource: null,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      authorCount: 1,
      genreCount: 0,
      tagCount: 0,
    };

    repo.loadScoreData.mockResolvedValue(data);
    appSettings.getMetadataScoreWeights.mockResolvedValue(weights);
    scorer.compute.mockReturnValue(87);

    await service.calculateAndSave(12);

    expect(scorer.compute).toHaveBeenCalledWith(data, weights);
    expect(repo.updateMetadataScore).toHaveBeenCalledWith(12, 87);
  });

  it('skips score update when the metadata row is missing', async () => {
    const { service, repo, scorer, appSettings } = makeService();
    repo.loadScoreData.mockResolvedValue(null);
    appSettings.getMetadataScoreWeights.mockResolvedValue(makeWeights());

    await service.calculateAndSave(99);

    expect(scorer.compute).not.toHaveBeenCalled();
    expect(repo.updateMetadataScore).not.toHaveBeenCalled();
  });

  it('starts manual recalculation and reports completed status with success/failure counters', async () => {
    const { service, repo, scorer, appSettings } = makeService();
    const weights = makeWeights();
    appSettings.getMetadataScoreWeights.mockResolvedValue(weights);

    const page1: ScorePage = {
      rows: [
        {
          bookId: 1,
          data: {
            title: 'A',
            subtitle: null,
            description: null,
            isbn10: null,
            isbn13: null,
            publisher: null,
            publishedYear: null,
            language: null,
            pageCount: null,
            seriesName: null,
            seriesIndex: null,
            rating: null,
            coverSource: null,
            googleBooksId: null,
            goodreadsId: null,
            amazonId: null,
            hardcoverId: null,
            openLibraryId: null,
            itunesId: null,
            authorCount: 1,
            genreCount: 0,
            tagCount: 0,
          },
        },
        {
          bookId: 2,
          data: {
            title: 'B',
            subtitle: null,
            description: null,
            isbn10: null,
            isbn13: null,
            publisher: null,
            publishedYear: null,
            language: null,
            pageCount: null,
            seriesName: null,
            seriesIndex: null,
            rating: null,
            coverSource: null,
            googleBooksId: null,
            goodreadsId: null,
            amazonId: null,
            hardcoverId: null,
            openLibraryId: null,
            itunesId: null,
            authorCount: 1,
            genreCount: 0,
            tagCount: 0,
          },
        },
      ],
      nextCursor: 2,
    };
    const page2: ScorePage = {
      rows: [
        {
          bookId: 3,
          data: {
            title: 'C',
            subtitle: null,
            description: null,
            isbn10: null,
            isbn13: null,
            publisher: null,
            publishedYear: null,
            language: null,
            pageCount: null,
            seriesName: null,
            seriesIndex: null,
            rating: null,
            coverSource: null,
            googleBooksId: null,
            goodreadsId: null,
            amazonId: null,
            hardcoverId: null,
            openLibraryId: null,
            itunesId: null,
            authorCount: 1,
            genreCount: 0,
            tagCount: 0,
          },
        },
      ],
      nextCursor: 3,
    };

    repo.loadScoreDataPage.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2).mockResolvedValueOnce({ rows: [], nextCursor: null });
    scorer.compute.mockReturnValue(80);
    repo.updateMetadataScore.mockResolvedValue(undefined);
    repo.updateMetadataScore.mockRejectedValueOnce(new Error('write failed'));

    const started = service.requestRecalculation(MetadataRecalculationTrigger.MANUAL);
    expect(started.started).toBe(true);
    expect(started.status.state).toBe('running');

    await waitForNonRunningStatus(service);
    const status = service.getRecalculationStatus();

    expect(status.state).toBe('completed');
    expect(status.processed).toBe(3);
    expect(status.succeeded).toBe(2);
    expect(status.failed).toBe(1);
    expect(status.trigger).toBe(MetadataRecalculationTrigger.MANUAL);
    expect(status.error).toBeNull();
  });

  it('rejects duplicate start requests while recalculation is already running', async () => {
    const { service, repo, appSettings } = makeService();
    appSettings.getMetadataScoreWeights.mockResolvedValue(makeWeights());
    const slowPage = deferred<ScorePage>();
    repo.loadScoreDataPage.mockReturnValueOnce(slowPage.promise);

    const first = service.requestRecalculation(MetadataRecalculationTrigger.MANUAL);
    const second = service.requestRecalculation(MetadataRecalculationTrigger.MANUAL);

    expect(first.started).toBe(true);
    expect(second.started).toBe(false);
    expect(second.status.state).toBe('running');

    slowPage.resolve({ rows: [], nextCursor: null });
    await waitForNonRunningStatus(service);
  });

  it('marks status as failed when a fatal page load error occurs', async () => {
    const { service, repo, appSettings } = makeService();
    appSettings.getMetadataScoreWeights.mockResolvedValue(makeWeights());
    repo.loadScoreDataPage.mockRejectedValue(new Error('db unavailable'));

    service.requestRecalculation(MetadataRecalculationTrigger.MANUAL);
    await waitForNonRunningStatus(service);

    const status = service.getRecalculationStatus();
    expect(status.state).toBe('failed');
    expect(status.error).toBe('db unavailable');
    expect(status.trigger).toBe(MetadataRecalculationTrigger.MANUAL);
  });

  it('triggers a background recalculation after updating weights', async () => {
    const { service, appSettings } = makeService();
    const weights = makeWeights();
    appSettings.setMetadataScoreWeights.mockResolvedValue(weights);
    const requestSpy = vi.spyOn(service, 'requestRecalculation').mockReturnValue({
      started: true,
      status: {
        state: 'running',
        trigger: MetadataRecalculationTrigger.WEIGHTS_UPDATE,
        startedAt: new Date(),
        endedAt: null,
        processed: 0,
        succeeded: 0,
        failed: 0,
        error: null,
      },
    });

    await expect(service.updateWeights(weights)).resolves.toEqual(weights);
    expect(appSettings.setMetadataScoreWeights).toHaveBeenCalledWith(weights);
    expect(requestSpy).toHaveBeenCalledWith(MetadataRecalculationTrigger.WEIGHTS_UPDATE);
  });
});
