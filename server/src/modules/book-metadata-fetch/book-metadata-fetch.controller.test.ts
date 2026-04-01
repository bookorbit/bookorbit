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
});
