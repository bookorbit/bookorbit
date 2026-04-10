import { MetadataProviderKey } from '@projectx/types';

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
  };
}

describe('BookMetadataFetchOrchestratorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggerGlobal returns 0 when no books are queued', async () => {
    const { service, queueRepo } = makeService();
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(0);

    await expect(service.triggerGlobal()).resolves.toBe(0);
  });

  it('triggerGlobal increments session and emits status when jobs are queued', async () => {
    const { service, queueRepo, session, gateway } = makeService();
    queueRepo.scheduleEligibleBooksInBatches.mockResolvedValue(3);
    vi.spyOn(service as any, 'pollOnce').mockResolvedValue(undefined);

    await expect(service.triggerGlobal()).resolves.toBe(3);
    expect(session.getSnapshot().sessionTotal).toBe(3);
    expect(gateway.emitStatus).toHaveBeenCalled();
  });

  it('triggerForLibrary skips disabled configs and does not record runs', async () => {
    const { service, configService } = makeService();
    configService.getEffectiveConfig.mockResolvedValue(baseConfig(false, true));

    await expect(service.triggerForLibrary(11)).resolves.toBe(0);
    expect(configService.recordLibraryRun).not.toHaveBeenCalled();
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
        seriesName: 'Series',
        seriesIndex: 2,
        duration: 3600,
        abridged: false,
        chapters: [{ title: 'Ch 1', startMs: 0 }],
        authors: ['Author A'],
        genres: ['Genre A'],
        narrators: ['Narrator A'],
        coverUrl: 'https://cover',
        comicMetadata: { issueNumber: '12' } as any,
      },
      providerIds: {
        [MetadataProviderKey.GOOGLE]: 'g1',
        [MetadataProviderKey.AUDIBLE]: 'a1',
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
        audibleId: 'a1',
      }),
    );
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

  it('scheduleIfEligible skips queue writes when import trigger is disabled or book is missing', async () => {
    const { service, configService, queueRepo, bookReadService } = makeService();
    configService.getEffectiveConfig.mockResolvedValue(baseConfig(true, false));

    await service.scheduleIfEligible(1, 2, 'import' as never);
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();

    configService.getEffectiveConfig.mockResolvedValue(baseConfig(true, true));
    bookReadService.findById.mockResolvedValue(null);
    await service.scheduleIfEligible(1, 2, 'import' as never);
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();
  });
});
