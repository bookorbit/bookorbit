import type { Mocked } from 'vitest';

import { BookMetadataFetchController } from './book-metadata-fetch.controller';
import { BookMetadataFetchSessionService } from './book-metadata-fetch-session.service';
import { BookMetadataFetchQueueRepository } from './book-metadata-fetch-queue.repository';
import { BookMetadataFetchConfigService } from './book-metadata-fetch-config.service';
import { BookMetadataFetchOrchestratorService } from './book-metadata-fetch-orchestrator.service';

describe('BookMetadataFetchController', () => {
  let configService: Mocked<BookMetadataFetchConfigService>;
  let orchestrator: Mocked<BookMetadataFetchOrchestratorService>;
  let queueRepo: Mocked<BookMetadataFetchQueueRepository>;
  let session: Mocked<BookMetadataFetchSessionService>;
  let controller: BookMetadataFetchController;

  beforeEach(() => {
    configService = {
      getGlobalConfig: vi.fn(),
      setGlobalConfig: vi.fn(),
      getLibraryConfigWithLastRun: vi.fn(),
      setLibraryOverride: vi.fn(),
      getEffectiveConfig: vi.fn(),
      isPaused: vi.fn(),
    } as unknown as Mocked<BookMetadataFetchConfigService>;

    orchestrator = {
      triggerGlobal: vi.fn(),
      triggerForLibrary: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      cancelPending: vi.fn(),
      requeueFailed: vi.fn(),
    } as unknown as Mocked<BookMetadataFetchOrchestratorService>;

    queueRepo = {
      getStatusSummary: vi.fn(),
      countEligibleBooks: vi.fn(),
      getFailedItems: vi.fn(),
    } as unknown as Mocked<BookMetadataFetchQueueRepository>;

    session = {
      getSnapshot: vi.fn(),
    } as unknown as Mocked<BookMetadataFetchSessionService>;

    controller = new BookMetadataFetchController(configService, orchestrator, queueRepo, session);
  });

  it('clamps failed-item pagination inputs to safe bounds', async () => {
    queueRepo.getFailedItems.mockResolvedValueOnce({ items: [], total: 0 });

    const result = await controller.getFailedItems(0, 999);

    expect(queueRepo.getFailedItems).toHaveBeenCalledWith(1, 100);
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 100 });
  });

  it('uses minimum limit of 1 for failed items', async () => {
    queueRepo.getFailedItems.mockResolvedValueOnce({ items: [], total: 0 });

    await controller.getFailedItems(3, 0);

    expect(queueRepo.getFailedItems).toHaveBeenCalledWith(3, 1);
  });

  it('builds preview config from dto conditions and libraryId', async () => {
    queueRepo.countEligibleBooks.mockResolvedValueOnce(12);

    const result = await controller.previewCount({
      conditions: {
        neverFetched: { enabled: true },
        scoreThreshold: { enabled: true, threshold: 60 },
        missingFields: { enabled: true, fields: ['description', 'narrators'] },
      },
      libraryId: 9,
    });

    expect(queueRepo.countEligibleBooks).toHaveBeenCalledWith(
      {
        enabled: true,
        triggerOnImport: false,
        conditions: {
          neverFetched: { enabled: true },
          scoreThreshold: { enabled: true, threshold: 60 },
          missingFields: { enabled: true, fields: ['description', 'narrators'] },
        },
      },
      9,
    );
    expect(result).toEqual({ count: 12 });
  });

  it('gets and updates global config through config service', async () => {
    configService.getGlobalConfig.mockResolvedValueOnce({ enabled: false }).mockResolvedValueOnce({ enabled: true });
    configService.setGlobalConfig.mockResolvedValue(undefined);

    await expect(controller.getConfig()).resolves.toEqual({ enabled: false });
    await expect(controller.updateConfig({ enabled: true } as never)).resolves.toEqual({ enabled: true });
    expect(configService.setGlobalConfig).toHaveBeenCalledWith({ enabled: true });
  });

  it('gets library config and writes null override for empty payloads', async () => {
    configService.getLibraryConfigWithLastRun.mockResolvedValue({ enabled: true });
    configService.getEffectiveConfig.mockResolvedValue({ enabled: false });
    configService.setLibraryOverride.mockResolvedValue(undefined);

    await expect(controller.getLibraryConfig(22)).resolves.toEqual({ enabled: true });
    await expect(controller.updateLibraryConfig(22, {} as never)).resolves.toEqual({ enabled: false });
    expect(configService.setLibraryOverride).toHaveBeenCalledWith(22, null);
  });

  it('returns status summary merged with paused state and session snapshot', async () => {
    queueRepo.getStatusSummary.mockResolvedValue({ queued: 3, processing: 1, failed: 2 });
    configService.isPaused.mockResolvedValue(true);
    session.getSnapshot.mockReturnValue({ sessionTotal: 7, sessionDone: 3, currentItemName: 'Book' });

    await expect(controller.getStatus()).resolves.toEqual({
      queued: 3,
      processing: 1,
      failed: 2,
      paused: true,
      sessionTotal: 7,
      sessionDone: 3,
      currentItemName: 'Book',
    });
  });

  it('run and control endpoints proxy orchestrator return shapes', async () => {
    orchestrator.triggerGlobal.mockResolvedValue(5);
    orchestrator.triggerForLibrary.mockResolvedValue(2);
    orchestrator.requeueFailed.mockResolvedValue(4);
    orchestrator.pause.mockResolvedValue(undefined);
    orchestrator.resume.mockResolvedValue(undefined);
    orchestrator.cancelPending.mockResolvedValue(undefined);

    await expect(controller.triggerGlobal()).resolves.toEqual({ queued: 5 });
    await expect(controller.triggerForLibrary(9)).resolves.toEqual({ queued: 2 });
    await expect(controller.pause()).resolves.toEqual({ paused: true });
    await expect(controller.resume()).resolves.toEqual({ paused: false });
    await expect(controller.cancel()).resolves.toEqual({ cancelled: true });
    await expect(controller.retryFailed()).resolves.toEqual({ requeued: 4 });
  });
});
