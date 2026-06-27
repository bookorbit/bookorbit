import { MetadataProviderKey, NotificationType } from '@bookorbit/types';

import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';
import { BookMetadataFetchOrchestratorService } from './book-metadata-fetch-orchestrator.service';

function baseConfig(enabled = true, triggerOnImport = true) {
  return {
    enabled,
    triggerOnImport,
    conditions: {
      neverFetched: { enabled: true },
      scoreThreshold: { enabled: false, threshold: 60 },
      missingFields: { enabled: false, fields: [] },
    },
  };
}

function makeService(withGateway = true) {
  const queueRepo = {
    resetAllProcessingOnBoot: vi.fn().mockResolvedValue(0),
    recoverStuckProcessing: vi.fn().mockResolvedValue(0),
    fetchDue: vi.fn().mockResolvedValue([]),
    upsertSchedule: vi.fn().mockResolvedValue(0),
    markProcessing: vi.fn().mockResolvedValue(true),
    markDone: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    getStatusSummary: vi.fn().mockResolvedValue({ queued: 0, processing: 0, failed: 0 }),
    scheduleEligibleBooksInBatches: vi.fn().mockResolvedValue(0),
    cancelPending: vi.fn().mockResolvedValue(0),
    requeueFailed: vi.fn().mockResolvedValue(0),
  };
  const configService = {
    getEffectiveConfig: vi.fn().mockResolvedValue(baseConfig()),
    getGlobalConfig: vi.fn().mockResolvedValue(baseConfig()),
    isPaused: vi.fn().mockResolvedValue(false),
    setPaused: vi.fn().mockResolvedValue(undefined),
    recordLibraryRun: vi.fn().mockResolvedValue(undefined),
  };
  const eligibilityService = {
    isEligible: vi.fn().mockReturnValue(true),
  };
  const bookReadService = {
    findById: vi.fn(),
    updateMetadataFields: vi.fn().mockResolvedValue(undefined),
    replaceCommunityRatings: vi.fn().mockResolvedValue(undefined),
  };
  const pipeline = {
    runWithSources: vi.fn().mockResolvedValue({ resolved: {}, providerIds: {} }),
  };
  const metadataService = {
    replaceAuthors: vi.fn().mockResolvedValue(undefined),
    replaceGenres: vi.fn().mockResolvedValue(undefined),
    replaceNarrators: vi.fn().mockResolvedValue(undefined),
    upsertComicMetadata: vi.fn().mockResolvedValue(undefined),
    downloadAndSaveCover: vi.fn().mockResolvedValue(true),
  };
  const scoreService = {
    calculateAndSave: vi.fn().mockResolvedValue(undefined),
  };
  const bookMetadataLockService = {
    filterResolvedMetadata: vi.fn().mockResolvedValue({
      resolved: {},
      providerIds: {},
      skippedFields: [],
    }),
  };
  const session = new BookMetadataFetchSessionService();
  const throttleTracker = {
    hasAnyActive: vi.fn().mockReturnValue(false),
  };
  const gateway = {
    emitStatus: vi.fn(),
  };
  const notificationService = {
    notify: vi.fn().mockResolvedValue(undefined),
  };

  const service = new BookMetadataFetchOrchestratorService(
    queueRepo as never,
    configService as never,
    eligibilityService as never,
    bookReadService as never,
    pipeline as never,
    metadataService as never,
    scoreService as never,
    bookMetadataLockService as never,
    session,
    throttleTracker as never,
    notificationService as never,
    withGateway ? (gateway as never) : undefined,
  );

  return {
    service,
    queueRepo,
    configService,
    eligibilityService,
    bookReadService,
    pipeline,
    metadataService,
    scoreService,
    bookMetadataLockService,
    session,
    throttleTracker,
    gateway,
    notificationService,
  };
}

describe('BookMetadataFetchOrchestratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggerGlobal returns 0 when no books are queued', async () => {
    const { service, queueRepo, configService } = makeService();
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(0);

    await expect(service.triggerGlobal()).resolves.toBe(0);
    expect(configService.setPaused).not.toHaveBeenCalled();
  });

  it('triggerGlobal unpauses a paused queue when no new books are eligible', async () => {
    const { service, queueRepo, configService } = makeService();
    (service as any).paused = true;
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(0);

    await expect(service.triggerGlobal()).resolves.toBe(0);
    expect(configService.setPaused).toHaveBeenCalledWith(false);
    expect((service as any).paused).toBe(false);
  });

  it('triggerGlobal increments session and emits status when jobs are queued', async () => {
    const { service, queueRepo, session, gateway } = makeService();
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(3);
    vi.spyOn(service as any, 'pollOnce').mockResolvedValue(undefined);

    await expect(service.triggerGlobal()).resolves.toBe(3);
    expect(session.getSnapshot().sessionTotal).toBe(3);
    expect(gateway.emitStatus).toHaveBeenCalled();
  });

  it('triggerForLibrary runs manually even when automatic fetch is disabled', async () => {
    const { service, configService, queueRepo } = makeService();
    configService.getEffectiveConfig.mockResolvedValue(baseConfig(false, true));
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(0);

    await expect(service.triggerForLibrary(11)).resolves.toBe(0);
    expect(queueRepo.scheduleEligibleBooksInBatches).toHaveBeenCalledWith(baseConfig(false, true), 'manual_trigger', 11, 1000);
    expect(configService.recordLibraryRun).toHaveBeenCalledWith(11, 0);
  });

  it('triggerForLibrary unpauses a paused queue when no new books are eligible', async () => {
    const { service, queueRepo, configService } = makeService();
    (service as any).paused = true;
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(0);

    await expect(service.triggerForLibrary(7)).resolves.toBe(0);
    expect(configService.setPaused).toHaveBeenCalledWith(false);
    expect((service as any).paused).toBe(false);
    expect(configService.recordLibraryRun).toHaveBeenCalledWith(7, 0);
  });

  it('triggerForLibrary records run and emits status for queued jobs', async () => {
    const { service, queueRepo, configService, session } = makeService();
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(4);
    vi.spyOn(service as any, 'pollOnce').mockResolvedValue(undefined);

    await expect(service.triggerForLibrary(12)).resolves.toBe(4);
    expect(configService.recordLibraryRun).toHaveBeenCalledWith(12, 4);
    expect(session.getSnapshot().sessionTotal).toBe(4);
  });

  it('scheduleIfEligible only queues when trigger-on-import is enabled and eligibility passes', async () => {
    const { service, configService, eligibilityService, queueRepo, bookReadService, session } = makeService();
    configService.getEffectiveConfig.mockResolvedValue(baseConfig(true, true));
    bookReadService.findById.mockResolvedValue({
      book: {
        books: { libraryId: 7 },
        book_metadata: {
          metadataScore: 50,
          lastMetadataFetchAt: null,
          title: 'Book',
          subtitle: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          pageCount: null,
          communityRating: null,
          seriesName: null,
          seriesIndex: null,
          coverSource: null,
          durationSeconds: null,
          abridged: null,
        },
      },
      authorRows: [],
      genreRows: [],
      narratorRows: [],
      communityRatingRows: [],
    });
    eligibilityService.isEligible.mockReturnValue(true);
    queueRepo.upsertSchedule = vi.fn().mockResolvedValue(1);

    await service.scheduleIfEligible(99, 7, 'import' as any);

    expect(queueRepo.upsertSchedule).toHaveBeenCalledWith([99], 'import');
    expect(session.getSnapshot().sessionTotal).toBe(1);
  });

  it('pause, resume, cancelPending, and requeueFailed update orchestrator/session state', async () => {
    const { service, queueRepo, configService, session } = makeService();
    vi.spyOn(service as any, 'pollOnce').mockResolvedValue(undefined);
    queueRepo.requeueFailed.mockResolvedValue(2);
    session.addToTotal(5);
    session.incrementDone();
    session.setCurrentItemName('Working');

    await service.pause();
    await service.resume();
    await service.cancelPending();
    await expect(service.requeueFailed()).resolves.toBe(2);

    expect(configService.setPaused).toHaveBeenCalledWith(true);
    expect(configService.setPaused).toHaveBeenCalledWith(false);
    expect(queueRepo.cancelPending).toHaveBeenCalled();
    expect(session.getSnapshot()).toEqual({
      sessionTotal: 2,
      sessionDone: 0,
      currentItemName: null,
    });
  });

  it('processOne marks queue row as done when the book no longer exists', async () => {
    const { service, queueRepo, bookReadService, session } = makeService();
    session.addToTotal(1);
    bookReadService.findById.mockResolvedValue(null);

    await (service as any).processOne(15, 'Missing Book');

    expect(queueRepo.markDone).toHaveBeenCalledWith(15);
    expect(session.getSnapshot().sessionDone).toBe(1);
  });

  it('processOne persists resolved metadata and handles provider ids + related entities', async () => {
    const { service, bookMetadataLockService, bookReadService, metadataService } = makeService();
    bookMetadataLockService.filterResolvedMetadata.mockResolvedValue({
      resolved: {
        title: 'Resolved',
        subtitle: 'Sub',
        description: 'Desc',
        publisher: 'Pub',
        publishedYear: 2020,
        language: 'en',
        pageCount: 200,
        communityRatings: [{ provider: MetadataProviderKey.HARDCOVER, rating: 4.25, ratingCount: 12345, updatedAt: '2026-06-25T00:00:00.000Z' }],
        seriesName: 'Series',
        seriesIndex: 2,
        duration: 3600,
        abridged: false,
        hardcoverEditionId: '8941973',
        chapters: [{ title: 'Ch 1', startMs: 0 }],
        authors: ['Author A'],
        genres: ['Genre A'],
        narrators: ['Narrator A'],
        coverUrl: 'https://cover',
        comicMetadata: { issueNumber: '12' } as any,
      },
      providerIds: {
        [MetadataProviderKey.GOOGLE]: 'g1',
        [MetadataProviderKey.HARDCOVER]: 'new-orleans-rush',
        [MetadataProviderKey.AUDIBLE]: 'a1',
        [MetadataProviderKey.KOBO]: 'kobo-1',
      },
      skippedFields: [],
    });

    await (service as any).persistResolved(88, {}, {}, [{ name: 'Old A' }], [{ name: 'Old G' }], [{ name: 'Old N' }]);

    expect(bookReadService.updateMetadataFields).toHaveBeenCalledWith(
      88,
      expect.objectContaining({
        title: 'Resolved',
        subtitle: 'Sub',
        publisher: 'Pub',
        durationSeconds: 3600,
        abridged: false,
        googleBooksId: 'g1',
        hardcoverId: 'new-orleans-rush',
        hardcoverEditionId: '8941973',
        audibleId: 'a1',
        koboId: 'kobo-1',
      }),
    );
    expect(bookReadService.replaceCommunityRatings).toHaveBeenCalledWith(88, [
      { provider: MetadataProviderKey.HARDCOVER, rating: 4.25, ratingCount: 12345 },
    ]);
    expect(metadataService.replaceAuthors).toHaveBeenCalledWith(88, [{ name: 'Author A', sortName: null }]);
    expect(metadataService.replaceGenres).toHaveBeenCalledWith(88, ['Genre A']);
    expect(metadataService.replaceNarrators).toHaveBeenCalledWith(88, [{ name: 'Narrator A', sortName: null }]);
    expect(metadataService.upsertComicMetadata).toHaveBeenCalledWith(88, { issueNumber: '12' });
    expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith('https://cover', 88);
  });

  it('processOne marks failures with extracted http status', async () => {
    const { service, queueRepo, bookReadService, pipeline } = makeService();
    bookReadService.findById.mockResolvedValue({
      book: {
        books: { libraryId: 1 },
        book_metadata: {
          title: 'Book',
          subtitle: null,
          description: null,
          isbn13: null,
          isbn10: null,
          publisher: null,
          publishedYear: null,
          language: null,
          pageCount: null,
          communityRating: null,
          seriesName: null,
          seriesIndex: null,
          coverSource: null,
          durationSeconds: null,
          abridged: null,
        },
      },
      authorRows: [],
      genreRows: [],
      narratorRows: [],
      communityRatingRows: [],
    });
    pipeline.runWithSources.mockRejectedValue(Object.assign(new Error('provider down'), { status: 503 }));

    await (service as any).processOne(90, 'Book');

    expect(queueRepo.markFailed).toHaveBeenCalledWith(90, 'provider down', 503);
  });

  it('emitStatus is a no-op when gateway is not configured', async () => {
    const { service, queueRepo } = makeService(false);
    queueRepo.getStatusSummary.mockResolvedValue({ queued: 1, processing: 0, failed: 0 });

    await expect((service as any).emitStatus()).resolves.toBeUndefined();
  });

  it('onApplicationBootstrap resets processing rows and schedules polling', async () => {
    vi.useFakeTimers();
    try {
      const { service, queueRepo, configService } = makeService();
      const pollSpy = vi.spyOn(service as any, 'pollOnce').mockResolvedValue(undefined);
      configService.isPaused.mockResolvedValue(true);

      await service.onApplicationBootstrap();
      expect(queueRepo.resetAllProcessingOnBoot).toHaveBeenCalledTimes(1);
      expect(configService.isPaused).toHaveBeenCalledTimes(1);
      expect(pollSpy).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(4_000);
      expect(pollSpy).toHaveBeenCalledTimes(2);
      service.onModuleDestroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pollOnce short-circuits when already running', async () => {
    const { service, queueRepo } = makeService();
    (service as any).running = true;

    await (service as any).pollOnce();

    expect(queueRepo.recoverStuckProcessing).not.toHaveBeenCalled();
  });

  it('pollOnce skips queue processing while paused', async () => {
    const { service, queueRepo } = makeService();
    (service as any).paused = true;
    const processSpy = vi.spyOn(service as any, 'processOne').mockResolvedValue(undefined);

    await (service as any).pollOnce();

    expect(queueRepo.recoverStuckProcessing).toHaveBeenCalledTimes(1);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('pollOnce processes due items and waits random delay', async () => {
    const { service, queueRepo } = makeService();
    queueRepo.fetchDue.mockResolvedValue([{ bookId: 44, title: 'Queued Book' }]);
    const processSpy = vi.spyOn(service as any, 'processOne').mockResolvedValue(undefined);
    const delaySpy = vi.spyOn(service as any, 'randomDelay').mockResolvedValue(undefined);

    await (service as any).pollOnce();

    expect(processSpy).toHaveBeenCalledWith(44, 'Queued Book');
    expect(delaySpy).toHaveBeenCalledTimes(1);
  });

  it('processOne exits early when queue row cannot be claimed', async () => {
    const { service, queueRepo, bookReadService } = makeService();
    queueRepo.markProcessing.mockResolvedValue(false);

    await (service as any).processOne(3, 'Book');

    expect(bookReadService.findById).not.toHaveBeenCalled();
    expect(queueRepo.markDone).not.toHaveBeenCalled();
  });

  it('processOne marks done and clears session when metadata pipeline succeeds', async () => {
    const { service, queueRepo, bookReadService, pipeline, scoreService, session } = makeService();
    session.addToTotal(1);
    bookReadService.findById.mockResolvedValue({
      book: {
        books: { libraryId: 2 },
        book_metadata: { title: 'Book', isbn13: null, isbn10: null, durationSeconds: null, audibleId: null },
      },
      authorRows: [{ name: 'Author' }],
      genreRows: [{ name: 'Genre' }],
      narratorRows: [],
      communityRatingRows: [],
    });
    pipeline.runWithSources.mockResolvedValue({ resolved: {}, providerIds: {} });
    vi.spyOn(service as any, 'persistResolved').mockResolvedValue(undefined);
    scoreService.calculateAndSave.mockRejectedValue(new Error('score delayed'));

    await (service as any).processOne(90, 'Book');

    expect(queueRepo.markDone).toHaveBeenCalledWith(90);
    expect(queueRepo.markFailed).not.toHaveBeenCalled();
    expect(session.getSnapshot().sessionDone).toBe(1);
    expect(session.getSnapshot().currentItemName).toBeNull();
  });

  it('randomDelay uses longer delays when provider throttling is active', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const { service, throttleTracker } = makeService();
      throttleTracker.hasAnyActive.mockReturnValue(true);

      const waitPromise = (service as any).randomDelay();
      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      const delayMs = timeoutSpy.mock.calls[0]?.[1] as number;
      expect(delayMs).toBe(10_000);
      vi.runAllTimers();
      await waitPromise;
    } finally {
      randomSpy.mockRestore();
      timeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('unpauseIfNeeded only writes config when paused and resets sessions when queue is empty', async () => {
    const { service, configService, queueRepo, session } = makeService();
    const resetSpy = vi.spyOn(session, 'reset');
    (service as any).paused = false;

    await (service as any).unpauseIfNeeded();
    expect(configService.setPaused).not.toHaveBeenCalledWith(false);

    (service as any).paused = true;
    await (service as any).unpauseIfNeeded();
    expect(configService.setPaused).toHaveBeenCalledWith(false);

    queueRepo.getStatusSummary.mockResolvedValueOnce({ queued: 0, processing: 0, failed: 0 });
    await (service as any).checkAndResetSession();
    expect(resetSpy).toHaveBeenCalledTimes(1);

    queueRepo.getStatusSummary.mockResolvedValueOnce({ queued: 1, processing: 0, failed: 0 });
    await (service as any).checkAndResetSession();
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });

  it('scheduleIfEligible skips queue writes when disabled, import trigger is disabled, book is missing, or eligibility fails', async () => {
    const { service, configService, eligibilityService, queueRepo, bookReadService } = makeService();
    configService.getEffectiveConfig.mockResolvedValue(baseConfig(false, true));

    await service.scheduleIfEligible(1, 2, 'import' as never);
    expect(bookReadService.findById).not.toHaveBeenCalled();
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();

    configService.getEffectiveConfig.mockResolvedValue(baseConfig(true, false));

    await service.scheduleIfEligible(1, 2, 'import' as never);
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();

    configService.getEffectiveConfig.mockResolvedValue(baseConfig(true, true));
    bookReadService.findById.mockResolvedValue(null);
    await service.scheduleIfEligible(1, 2, 'import' as never);
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();

    bookReadService.findById.mockResolvedValue({
      book: {
        books: { libraryId: 2 },
        book_metadata: {
          metadataScore: 50,
          lastMetadataFetchAt: null,
          title: 'Book',
          subtitle: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          pageCount: null,
          communityRating: null,
          seriesName: null,
          seriesIndex: null,
          coverSource: null,
          durationSeconds: null,
          abridged: null,
        },
      },
      authorRows: [],
      genreRows: [],
      narratorRows: [],
      communityRatingRows: [],
    });
    eligibilityService.isEligible.mockReturnValue(false);
    await service.scheduleIfEligible(1, 2, 'import' as never);
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();
  });

  it('requeueFailed returns zero without session update', async () => {
    const { service, gateway, session } = makeService();

    await expect(service.requeueFailed()).resolves.toBe(0);

    expect(session.getSnapshot().sessionTotal).toBe(0);
    expect(gateway.emitStatus).not.toHaveBeenCalled();
  });

  it('onModuleDestroy is a no-op when polling was never started', () => {
    const { service } = makeService();

    expect(() => service.onModuleDestroy()).not.toThrow();
  });

  it('pollOnce logs failures and clears the running flag', async () => {
    const { service, queueRepo } = makeService();
    queueRepo.recoverStuckProcessing.mockRejectedValue(new Error('queue unavailable'));

    await (service as any).pollOnce();

    expect((service as any).running).toBe(false);
    expect(queueRepo.fetchDue).not.toHaveBeenCalled();
  });

  it('processOne passes fallback identifiers and collected provider ids to the pipeline', async () => {
    const { service, bookReadService, pipeline } = makeService();
    bookReadService.findById.mockResolvedValue({
      book: {
        books: { libraryId: 5 },
        book_metadata: {
          title: null,
          subtitle: null,
          description: null,
          isbn13: null,
          isbn10: 'isbn-10',
          publisher: null,
          publishedYear: null,
          language: null,
          pageCount: null,
          communityRating: null,
          seriesName: null,
          seriesIndex: null,
          coverSource: null,
          durationSeconds: null,
          abridged: null,
          googleBooksId: 'google-1',
          goodreadsId: 'goodreads-1',
          amazonId: 'amazon-1',
          hardcoverId: 'hardcover-1',
          openLibraryId: 'open-library-1',
          itunesId: 'itunes-1',
          audibleId: 'audible-1',
          koboId: 'kobo-1',
          comicvineId: 'comicvine-1',
          ranobedbId: 'ranobedb-1',
          lubimyczytacId: 'lubimyczytac-1',
          aladinId: 'aladin-1',
        },
      },
      authorRows: [],
      genreRows: [],
      narratorRows: [],
      communityRatingRows: [],
    });

    await (service as any).processOne(91, 'Book');

    expect(pipeline.runWithSources).toHaveBeenCalledWith(
      expect.objectContaining({
        title: undefined,
        author: undefined,
        isbn: 'isbn-10',
        isAudiobook: true,
        existingProviderIds: {
          [MetadataProviderKey.GOOGLE]: 'google-1',
          [MetadataProviderKey.GOODREADS]: 'goodreads-1',
          [MetadataProviderKey.AMAZON]: 'amazon-1',
          [MetadataProviderKey.HARDCOVER]: 'hardcover-1',
          [MetadataProviderKey.OPEN_LIBRARY]: 'open-library-1',
          [MetadataProviderKey.ITUNES]: 'itunes-1',
          [MetadataProviderKey.AUDIBLE]: 'audible-1',
          [MetadataProviderKey.KOBO]: 'kobo-1',
          [MetadataProviderKey.COMICVINE]: 'comicvine-1',
          [MetadataProviderKey.RANOBEDB]: 'ranobedb-1',
          [MetadataProviderKey.LUBIMYCZYTAC]: 'lubimyczytac-1',
          [MetadataProviderKey.ALADIN]: 'aladin-1',
        },
      }),
      expect.any(Object),
      5,
    );
  });

  it('processOne records non-Error failures without an http status', async () => {
    const { service, queueRepo, bookReadService, pipeline } = makeService();
    bookReadService.findById.mockResolvedValue({
      book: {
        books: { libraryId: 1 },
        book_metadata: {
          title: 'Book',
          subtitle: null,
          description: null,
          isbn13: null,
          isbn10: null,
          publisher: null,
          publishedYear: null,
          language: null,
          pageCount: null,
          communityRating: null,
          seriesName: null,
          seriesIndex: null,
          coverSource: null,
          durationSeconds: null,
          abridged: null,
        },
      },
      authorRows: [],
      genreRows: [],
      narratorRows: [],
      communityRatingRows: [],
    });
    pipeline.runWithSources.mockRejectedValue('provider down');

    await (service as any).processOne(92, 'Book');

    expect(queueRepo.markFailed).toHaveBeenCalledWith(92, 'provider down', undefined);
  });

  it('persistResolved ignores unsupported values and empty new related lists', async () => {
    const { service, bookReadService, bookMetadataLockService, metadataService } = makeService();
    bookMetadataLockService.filterResolvedMetadata.mockResolvedValue({
      resolved: {
        title: 123,
        subtitle: [],
        description: {},
        publisher: false,
        publishedYear: '2020',
        language: 7,
        pageCount: Number.POSITIVE_INFINITY,
        seriesName: Symbol('series'),
        seriesIndex: '2',
        duration: '3600',
        abridged: null,
        authors: [],
        genres: [],
        narrators: [],
      },
      providerIds: {},
      skippedFields: ['title', 'cover'],
    });

    await (service as any).persistResolved(93, {}, {}, [], [], []);

    const fields = bookReadService.updateMetadataFields.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(fields).toEqual({
      lastMetadataFetchAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    expect(metadataService.replaceAuthors).not.toHaveBeenCalled();
    expect(metadataService.replaceGenres).not.toHaveBeenCalled();
    expect(metadataService.replaceNarrators).not.toHaveBeenCalled();
    expect(metadataService.upsertComicMetadata).not.toHaveBeenCalled();
    expect(metadataService.downloadAndSaveCover).not.toHaveBeenCalled();
  });

  it('persistResolved clears existing related rows when providers return empty lists', async () => {
    const { service, bookMetadataLockService, metadataService } = makeService();
    bookMetadataLockService.filterResolvedMetadata.mockResolvedValue({
      resolved: {
        authors: [],
        genres: [],
        narrators: [],
      },
      providerIds: {},
      skippedFields: [],
    });

    await (service as any).persistResolved(94, {}, {}, [{ name: 'Old A' }], [{ name: 'Old G' }], [{ name: 'Old N' }]);

    expect(metadataService.replaceAuthors).toHaveBeenCalledWith(94, []);
    expect(metadataService.replaceGenres).toHaveBeenCalledWith(94, []);
    expect(metadataService.replaceNarrators).toHaveBeenCalledWith(94, []);
  });

  it('randomDelay uses the normal delay window when no provider is throttled', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      const { service } = makeService();

      const waitPromise = (service as any).randomDelay();
      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      const delayMs = timeoutSpy.mock.calls[0]?.[1] as number;
      expect(delayMs).toBe(2_000);
      vi.runAllTimers();
      await waitPromise;
    } finally {
      randomSpy.mockRestore();
      timeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('checkAndResetSession sends completion and failure notifications before resetting', async () => {
    const { service, queueRepo, session, notificationService } = makeService();
    session.addToTotal(2);
    session.incrementDone();
    queueRepo.getStatusSummary.mockResolvedValueOnce({ queued: 0, processing: 0, failed: 0 });

    await (service as any).checkAndResetSession();

    session.addToTotal(3);
    session.incrementDone();
    queueRepo.getStatusSummary.mockResolvedValueOnce({ queued: 0, processing: 0, failed: 1 });

    await (service as any).checkAndResetSession();

    expect(notificationService.notify).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: NotificationType.MetadataFetchCompleted,
        title: 'Metadata fetch completed',
        message: 'Processed 1 of 2 books',
      }),
    );
    expect(notificationService.notify).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: NotificationType.MetadataFetchFailed,
        title: 'Metadata fetch completed with errors',
        message: 'Processed 1 of 3 books, 1 failed',
      }),
    );
  });

  it('metadata value coercion helpers accept only supported shapes', () => {
    const { service } = makeService();

    expect((service as any).asNullableString(undefined)).toBeUndefined();
    expect((service as any).asNullableString(null)).toBeNull();
    expect((service as any).asNullableString(1)).toBeUndefined();
    expect((service as any).asNullableString('value')).toBe('value');
    expect((service as any).asNullableNumber(undefined)).toBeUndefined();
    expect((service as any).asNullableNumber(null)).toBeNull();
    expect((service as any).asNullableNumber(Number.NaN)).toBeUndefined();
    expect((service as any).asNullableNumber(5)).toBe(5);
    expect((service as any).asBoolean(undefined)).toBeUndefined();
    expect((service as any).asBoolean(null)).toBeUndefined();
    expect((service as any).asBoolean('false')).toBeUndefined();
    expect((service as any).asBoolean(false)).toBe(false);
    expect((service as any).asStringArray(undefined)).toBeUndefined();
    expect((service as any).asStringArray('value')).toBeUndefined();
    expect((service as any).asStringArray([1])).toBeUndefined();
    expect((service as any).asStringArray(['value'])).toEqual(['value']);
  });
});
