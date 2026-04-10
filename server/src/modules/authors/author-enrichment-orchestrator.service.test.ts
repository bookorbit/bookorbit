import { AuthorAutoEnrichmentWriteMode } from '@projectx/types';

import { AUTHOR_ENRICHMENT_REASONS } from './author-enrichment-reasons';
import { AuthorEnrichmentSessionService } from './author-enrichment-session.service';
import { AuthorEnrichmentOrchestratorService } from './author-enrichment-orchestrator.service';

describe('AuthorEnrichmentOrchestratorService', () => {
  const queueRepo = {
    upsertSchedule: vi.fn(),
    enqueueAllLinkedAuthors: vi.fn(),
    enqueueEligibleLinkedAuthors: vi.fn(),
    filterEligibleAuthorIds: vi.fn(),
    cancelPending: vi.fn(),
    requeueFailed: vi.fn(),
    getFailedItems: vi.fn(),
    getStatusSummary: vi.fn(),
    recoverStuckProcessing: vi.fn(),
    resetAllProcessingOnBoot: vi.fn(),
    fetchDue: vi.fn(),
    markProcessing: vi.fn(),
    markDone: vi.fn(),
    markFailed: vi.fn(),
  };

  const executor = {
    execute: vi.fn(),
  };

  const appSettings = {
    isAuthorsProviderAudnexusEnabled: vi.fn(),
  };

  const enrichmentConfig = {
    getConfig: vi.fn(),
    isPaused: vi.fn(),
    setPaused: vi.fn(),
  };

  const metadataEvents = {
    on: vi.fn(),
    off: vi.fn(),
  };

  const gateway = {
    emitStatus: vi.fn(),
  };

  let session: AuthorEnrichmentSessionService;
  let service: AuthorEnrichmentOrchestratorService;

  beforeEach(() => {
    vi.resetAllMocks();
    session = new AuthorEnrichmentSessionService();

    queueRepo.upsertSchedule.mockResolvedValue(0);
    queueRepo.enqueueAllLinkedAuthors.mockResolvedValue(0);
    queueRepo.enqueueEligibleLinkedAuthors.mockResolvedValue(0);
    queueRepo.filterEligibleAuthorIds.mockImplementation((ids: number[]) => Promise.resolve(ids));
    queueRepo.cancelPending.mockResolvedValue(0);
    queueRepo.requeueFailed.mockResolvedValue(0);
    queueRepo.getFailedItems.mockResolvedValue({ items: [], total: 0 });
    queueRepo.resetAllProcessingOnBoot.mockResolvedValue(0);
    queueRepo.recoverStuckProcessing.mockResolvedValue(0);
    queueRepo.getStatusSummary.mockResolvedValue({
      queued: 0,
      processing: 0,
      rateLimited: 0,
      failed: 0,
      done: 0,
      total: 0,
    });
    queueRepo.fetchDue.mockResolvedValue([]);
    queueRepo.markProcessing.mockResolvedValue(true);
    queueRepo.markDone.mockResolvedValue(undefined);
    queueRepo.markFailed.mockResolvedValue(undefined);

    executor.execute.mockResolvedValue({
      kind: 'done',
      provider: 'audnexus',
      descriptionUpdated: true,
      imageUpdated: false,
    });

    appSettings.isAuthorsProviderAudnexusEnabled.mockResolvedValue(true);
    enrichmentConfig.getConfig.mockResolvedValue({
      enabled: true,
      triggerOnImport: true,
      writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
      conditions: { neverEnriched: true, missingBio: false, missingPhoto: false },
    });
    enrichmentConfig.isPaused.mockResolvedValue(false);
    enrichmentConfig.setPaused.mockResolvedValue(undefined);

    service = new AuthorEnrichmentOrchestratorService(
      queueRepo as never,
      executor as never,
      appSettings as never,
      enrichmentConfig as never,
      metadataEvents as never,
      session,
      gateway as never,
    );
  });

  it('does not auto-schedule when auto enrichment is disabled', async () => {
    enrichmentConfig.getConfig.mockResolvedValue({
      enabled: false,
      triggerOnImport: true,
      writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
      conditions: { neverEnriched: true, missingBio: false, missingPhoto: false },
    });

    await expect(service.scheduleMany([1, 2], AUTHOR_ENRICHMENT_REASONS.METADATA_REPLACE)).resolves.toBe(0);
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();
  });

  it('pollOnce processes due rows and marks them done on success', async () => {
    queueRepo.fetchDue.mockResolvedValue([{ authorId: 22, attemptCount: 0, authorName: null }]);
    vi.spyOn(service as any, 'randomDelay').mockResolvedValue(undefined);

    await (service as any).pollOnce();

    expect(queueRepo.markProcessing).toHaveBeenCalledWith(22);
    expect(executor.execute).toHaveBeenCalledWith({
      authorId: 22,
      writeMode: AuthorAutoEnrichmentWriteMode.MISSING_ONLY,
      audnexusEnabled: true,
    });
    expect(queueRepo.markDone).toHaveBeenCalledWith(22, false);
    expect(queueRepo.markFailed).not.toHaveBeenCalled();
  });

  it('marks rate-limited failures for retry with delayed nextAttemptAt', async () => {
    executor.execute.mockResolvedValue({
      kind: 'failed',
      message: 'Audnexus 429',
      provider: 'audnexus',
      httpStatus: 429,
      retryAfterMs: 45_000,
      transient: true,
      descriptionUpdated: false,
      imageUpdated: false,
    });

    await (service as any).processOne(44, 1);

    expect(queueRepo.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 44,
        httpStatus: 429,
        rateLimited: true,
        nextAttemptAt: expect.any(Date),
      }),
    );
  });

  it('marks non-transient failures as final', async () => {
    executor.execute.mockResolvedValue({
      kind: 'failed',
      message: 'bad request',
      provider: 'audnexus',
      httpStatus: 400,
      retryAfterMs: null,
      transient: false,
      descriptionUpdated: false,
      imageUpdated: false,
    });

    await (service as any).processOne(77, 0);

    expect(queueRepo.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        authorId: 77,
        httpStatus: 400,
        nextAttemptAt: null,
        rateLimited: false,
      }),
    );
  });

  it('resets processing rows and starts polling on bootstrap', async () => {
    await service.onApplicationBootstrap();
    service.onModuleDestroy();

    expect(queueRepo.resetAllProcessingOnBoot).toHaveBeenCalled();
    expect(enrichmentConfig.isPaused).toHaveBeenCalled();
  });

  it('scheduleMany skips queueing when orchestrator is paused and request is not manual override', async () => {
    (service as any).paused = true;

    const queued = await service.scheduleMany([1, 2], AUTHOR_ENRICHMENT_REASONS.AUTHOR_RENAME);

    expect(queued).toBe(0);
    expect(queueRepo.upsertSchedule).not.toHaveBeenCalled();
  });

  it('metadata_replace queueing stays silent in session status', async () => {
    queueRepo.upsertSchedule.mockResolvedValue(2);

    const queued = await service.scheduleMany([1, 2], AUTHOR_ENRICHMENT_REASONS.METADATA_REPLACE, { ignoreEnabled: true });

    expect(queued).toBe(2);
    expect(session.getSnapshot().sessionTotal).toBe(0);
    expect(gateway.emitStatus).not.toHaveBeenCalled();
  });

  it('manual queueing increments session total and emits status', async () => {
    queueRepo.upsertSchedule.mockResolvedValue(3);

    const queued = await service.scheduleMany([1, 2, 3], AUTHOR_ENRICHMENT_REASONS.AUTHOR_RENAME, { ignoreEnabled: true });

    expect(queued).toBe(3);
    expect(session.getSnapshot().sessionTotal).toBe(3);
    expect(gateway.emitStatus).toHaveBeenCalled();
  });

  it('backfillLinkedAuthors unpauses orchestrator when work is queued', async () => {
    (service as any).paused = true;
    queueRepo.enqueueEligibleLinkedAuthors.mockResolvedValue(5);

    const queued = await service.backfillLinkedAuthors();

    expect(queued).toBe(5);
    expect(enrichmentConfig.setPaused).toHaveBeenCalledWith(false);
    expect(gateway.emitStatus).toHaveBeenCalled();
  });

  it('cancelPending pauses and resets session counters', async () => {
    session.sessionTotal = 10;
    session.sessionDone = 4;
    session.currentItemName = 'Someone';

    await service.cancelPending();

    expect(queueRepo.cancelPending).toHaveBeenCalled();
    expect(enrichmentConfig.setPaused).toHaveBeenCalledWith(true);
    expect(session.getSnapshot()).toEqual({
      sessionTotal: 0,
      sessionDone: 0,
      currentItemName: null,
    });
  });

  it('requeueFailed increments session total when rows are requeued', async () => {
    queueRepo.requeueFailed.mockResolvedValue(4);

    await expect(service.requeueFailed()).resolves.toBe(4);
    expect(session.getSnapshot().sessionTotal).toBe(4);
    expect(gateway.emitStatus).toHaveBeenCalled();
  });
});
