import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';

import { BookDockService } from './book-dock.service';

vi.mock('fs/promises', () => ({
  unlink: vi.fn(),
}));

import { unlink } from 'fs/promises';

function row(overrides?: Record<string, unknown>) {
  return {
    id: 1,
    fileName: 'book.epub',
    fileSize: 1024,
    format: 'epub',
    status: 'ready',
    embeddedMetadata: { title: 'Embedded' },
    selectedMetadata: null,
    fetchedMetadata: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: 80,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    absolutePath: '/bucket/book.epub',
    coverPath: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeService() {
  const db = { select: vi.fn() };
  const repo = {
    findAll: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    deleteById: vi.fn(),
    deleteByIds: vi.fn(),
    findByIds: vi.fn(),
    findSelectionBatch: vi.fn(),
    setTargetsByIds: vi.fn(),
    countsByStatus: vi.fn(),
    getStatistics: vi.fn(),
  };
  const ingestService = {
    retryFetch: vi.fn(),
    pauseProcessing: vi.fn(),
    resumeProcessing: vi.fn().mockResolvedValue(undefined),
    requeueProcessableFiles: vi.fn().mockResolvedValue(0),
  };
  const finalizeService = {
    pauseProcessing: vi.fn(),
    resumeProcessing: vi.fn().mockResolvedValue(undefined),
    requeueAutoFinalizeCandidates: vi.fn().mockResolvedValue(0),
  };
  const watcherService = {
    rescan: vi.fn().mockResolvedValue(undefined),
  };
  const processingState = {
    isPaused: vi.fn().mockResolvedValue(false),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = {
    emitSummary: vi.fn(),
  };
  const service = new BookDockService(
    db as never,
    repo as never,
    ingestService as never,
    finalizeService as never,
    watcherService as never,
    processingState as never,
    gateway as never,
  );
  return { service, db, repo, ingestService, finalizeService, watcherService, processingState, gateway };
}

describe('BookDockService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps list rows to API DTOs with pagination fields', async () => {
    const { service, repo } = makeService();
    repo.findAll.mockResolvedValue({ items: [row()], total: 1 });

    const result = await service.listFiles({
      page: 2,
      limit: 25,
      sort: 'createdAt',
      order: 'desc',
      userId: 1,
      isSuperuser: false,
    });

    expect(result.total).toBe(1);
    expect(result.page).toBe(2);
    expect(result.size).toBe(25);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 1,
        fileName: 'book.epub',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
  });

  it('getFile throws when row is missing', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(undefined);

    await expect(service.getFile(123)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateFile validates destination and stamps metadataEditedAt for selected metadata updates', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(row());
    repo.update.mockResolvedValue(row({ selectedMetadata: { title: 'Edited' } }));
    const assertValidTarget = vi.spyOn(service as any, 'assertValidTarget').mockResolvedValue(undefined);

    await service.updateFile(1, {
      selectedMetadata: { title: 'Edited' },
      targetLibraryId: 5,
      targetFolderId: 9,
    });

    expect(assertValidTarget).toHaveBeenCalledWith(5, 9);
    expect(repo.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        selectedMetadata: { title: 'Edited' },
        metadataEditedAt: expect.any(Date),
      }),
    );
  });

  it('updateFile throws when row disappears during update', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(row());
    repo.update.mockResolvedValue(undefined);

    await expect(service.updateFile(1, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bulkApplyFetched counts applied, skipped, and skipped-edited records', async () => {
    const { service, repo } = makeService();
    repo.findByIds.mockResolvedValue([
      row({ id: 1, metadataEditedAt: new Date() }),
      row({ id: 2, fetchedMetadata: null }),
      row({ id: 3, fetchedMetadata: { title: 'Fetched' }, metadataEditedAt: null }),
    ]);

    const result = await service.bulkApplyFetched([1, 2, 3]);

    expect(result).toEqual({
      total: 3,
      applied: 1,
      skipped: 1,
      skippedEdited: 1,
    });
    expect(repo.update).toHaveBeenCalledWith(3, {
      selectedMetadata: { title: 'Fetched' },
      metadataEditedAt: null,
    });
  });

  it('bulkRetryFetch only queues rows currently in error status', async () => {
    const { service, repo, ingestService } = makeService();
    repo.findByIds.mockResolvedValue([row({ id: 1, status: 'error' }), row({ id: 2, status: 'ready' }), row({ id: 3, status: 'error' })]);

    const result = await service.bulkRetryFetch([1, 2, 3, 3]);

    expect(result).toEqual({ total: 3, queued: 2 });
    expect(ingestService.retryFetch).toHaveBeenCalledTimes(2);
    expect(ingestService.retryFetch).toHaveBeenCalledWith(1);
    expect(ingestService.retryFetch).toHaveBeenCalledWith(3);
  });

  it('bulkSetTarget enforces complete destination tuple and returns update counts', async () => {
    const { service, repo } = makeService();
    await expect(service.bulkSetTarget([1], false, [], 10, undefined)).rejects.toBeInstanceOf(BadRequestException);

    const assertValidTarget = vi.spyOn(service as any, 'assertValidTarget').mockResolvedValue(undefined);
    repo.findByIds.mockResolvedValue([row({ id: 1 }), row({ id: 2 })]);
    repo.setTargetsByIds.mockResolvedValue(1);

    await expect(service.bulkSetTarget([1, 2], false, [], 11, 22)).resolves.toEqual({
      total: 2,
      updated: 1,
      failed: 1,
    });
    expect(assertValidTarget).toHaveBeenCalledWith(11, 22);
  });

  it('selectionSummary counts valid destination mappings by folder-library match', async () => {
    const { service, repo, db } = makeService();
    repo.findByIds.mockResolvedValue([
      row({ id: 1, targetLibraryId: 1, targetFolderId: 10 }),
      row({ id: 2, targetLibraryId: 1, targetFolderId: 11 }),
      row({ id: 3, targetLibraryId: null, targetFolderId: null }),
    ]);
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 10, libraryId: 1 },
          { id: 11, libraryId: 2 },
        ]),
      }),
    });

    await expect(service.selectionSummary([1, 2, 3])).resolves.toEqual({
      total: 3,
      withDestination: 1,
      withoutDestination: 2,
    });
  });

  it('discard and bulkDiscard clean file/cover artifacts before deleting rows', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(row({ id: 1, coverPath: '/covers/1.png' }));
    repo.findSelectionBatch
      .mockResolvedValueOnce([row({ id: 2, absolutePath: '/bucket/2.epub', coverPath: '/covers/2.png' })])
      .mockResolvedValueOnce([]);

    await service.discardFile(1);
    await service.bulkDiscard([], true);

    expect(vi.mocked(unlink)).toHaveBeenCalledWith('/bucket/book.epub');
    expect(vi.mocked(unlink)).toHaveBeenCalledWith('/covers/1.png');
    expect(vi.mocked(unlink)).toHaveBeenCalledWith('/covers/1_thumb.jpg');
    expect(repo.deleteById).toHaveBeenCalledWith(1);
    expect(repo.deleteByIds).toHaveBeenCalledWith([2]);
  });

  it('proxies summary and statistics repository queries', async () => {
    const { service, repo } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 1, ready: 2, error: 3, total: 6 });
    repo.getStatistics.mockResolvedValue({ totalSizeBytes: 10, byFormat: [] });

    await expect(service.getSummary()).resolves.toEqual({ pending: 1, ready: 2, error: 3, total: 6, paused: false });
    await expect(service.getStatistics()).resolves.toEqual({ totalSizeBytes: 10, byFormat: [] });
  });

  it('pauseProcessing persists paused state, pauses queues, and broadcasts summary', async () => {
    const { service, repo, processingState, ingestService, finalizeService, gateway } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 4, ready: 5, error: 0, total: 9 });
    processingState.isPaused.mockResolvedValue(true);

    await expect(service.pauseProcessing()).resolves.toEqual({ pending: 4, ready: 5, error: 0, total: 9, paused: true });

    expect(processingState.pause).toHaveBeenCalledTimes(1);
    expect(ingestService.pauseProcessing).toHaveBeenCalledTimes(1);
    expect(finalizeService.pauseProcessing).toHaveBeenCalledTimes(1);
    expect(gateway.emitSummary).toHaveBeenCalledWith({ pending: 4, ready: 5, error: 0, total: 9, paused: true });
  });

  it('resumeProcessing resumes queues, broadcasts summary, and starts recovery once', async () => {
    const { service, repo, processingState, ingestService, finalizeService, watcherService, gateway } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 2, ready: 3, error: 1, total: 6 });
    processingState.isPaused.mockResolvedValue(false);
    ingestService.requeueProcessableFiles.mockResolvedValue(7);
    finalizeService.requeueAutoFinalizeCandidates.mockResolvedValue(2);

    await expect(service.resumeProcessing()).resolves.toEqual({ pending: 2, ready: 3, error: 1, total: 6, paused: false });
    await (service as any).resumeWorkPromise;

    expect(processingState.resume).toHaveBeenCalledTimes(1);
    expect(ingestService.resumeProcessing).toHaveBeenCalledTimes(1);
    expect(finalizeService.resumeProcessing).toHaveBeenCalledTimes(1);
    expect(ingestService.requeueProcessableFiles).toHaveBeenCalledTimes(1);
    expect(finalizeService.requeueAutoFinalizeCandidates).toHaveBeenCalledTimes(1);
    expect(watcherService.rescan).toHaveBeenCalledTimes(1);
    expect(gateway.emitSummary).toHaveBeenCalledWith({ pending: 2, ready: 3, error: 1, total: 6, paused: false });
  });
});
