import { BadRequestException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import { BookDockService } from './book-dock.service';

vi.mock('fs/promises', () => ({
  unlink: vi.fn(),
  rmdir: vi.fn().mockResolvedValue(undefined),
}));

import { rmdir, unlink } from 'fs/promises';
import { inspectEpubMediaOverlayFields } from '../reader/epub/epub-media-overlay-capability';

vi.mock('../reader/epub/epub-media-overlay-capability', () => ({
  inspectEpubMediaOverlayFields: vi
    .fn()
    .mockResolvedValue({ mediaOverlayAvailable: false, mediaOverlayDurationSeconds: null, mediaOverlayCheckedAt: null }),
}));

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
    uploadedBy: 1,
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
    countsByDock: vi.fn().mockResolvedValue([]),
    holdCountsByDock: vi.fn().mockResolvedValue([]),
    getStatistics: vi.fn(),
    findUnitFiles: vi.fn().mockResolvedValue([]),
    findUnitFilesByDockFileIds: vi.fn().mockResolvedValue(new Map()),
  };
  const ingestService = {
    retryFetch: vi.fn(),
    refetchMetadata: vi.fn(),
    pauseProcessing: vi.fn(),
    resumeProcessing: vi.fn().mockResolvedValue(undefined),
    requeueProcessableFiles: vi.fn().mockResolvedValue(0),
  };
  const finalizeService = {
    pauseProcessing: vi.fn(),
    resumeProcessing: vi.fn().mockResolvedValue(undefined),
    requeueAutoFinalizeCandidates: vi.fn().mockResolvedValue(0),
    reviewHolds: vi.fn(),
    enqueueAutoFinalize: vi.fn(),
  };
  const duplicates = {
    otherLibraryNames: vi.fn().mockResolvedValue(new Map()),
  };
  const libraryService = {
    findAccessibleLibraryIds: vi.fn().mockResolvedValue([5, 6]),
  };
  const keptFiles = {
    keepsOriginals: vi.fn().mockResolvedValue(false),
    keepOriginalCheck: vi.fn().mockResolvedValue(() => Promise.resolve(false)),
    remember: vi.fn().mockResolvedValue(undefined),
    countByDock: vi.fn().mockResolvedValue(new Map()),
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
    emitChanged: vi.fn(),
  };
  const service = new BookDockService(
    db as never,
    repo as never,
    ingestService as never,
    finalizeService as never,
    watcherService as never,
    processingState as never,
    gateway as never,
    duplicates as never,
    libraryService as never,
    keptFiles as never,
  );
  return { service, db, repo, ingestService, finalizeService, watcherService, processingState, gateway, duplicates, libraryService, keptFiles };
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
      canManageAll: false,
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

  it('lists why each file waits, and which other libraries the viewer can see already hold it', async () => {
    const { service, repo, duplicates, libraryService } = makeService();
    const viewer = { id: 1, isSuperuser: false, contentFilters: { tags: {} } } as never;
    repo.findAll.mockResolvedValue({
      items: [
        row({ id: 1, dockId: 11, targetLibraryId: 5, holdReason: 'duplicate', holdDetail: { libraryId: 5, bookId: 300 }, formerLibraryName: null }),
        row({ id: 2, status: 'fetching', holdReason: 'some_future_reason', holdDetail: { threshold: 1 } }),
      ],
      total: 2,
    });
    duplicates.otherLibraryNames.mockResolvedValue(new Map([[1, ['Classics']]]));

    const page = await service.listFiles({ page: 1, limit: 20, sort: 'createdAt', order: 'desc', userId: 1, canManageAll: false }, viewer);

    expect(libraryService.findAccessibleLibraryIds).toHaveBeenCalledWith(viewer);
    // Only ready files are matched, with the viewer's own content filters.
    expect(duplicates.otherLibraryNames).toHaveBeenCalledWith([{ fileId: 1, metadata: { title: 'Embedded' }, targetLibraryId: 5 }], [5, 6], {
      tags: {},
    });
    expect(page.items[0]).toMatchObject({
      dockId: 11,
      holdReason: 'duplicate',
      holdDetail: { libraryId: 5, bookId: 300 },
      formerLibraryName: null,
      alsoIn: ['Classics'],
    });
    // A code this server does not know reads as no reason, never as a broken row.
    expect(page.items[1]).toMatchObject({ holdReason: null, holdDetail: null });
    expect(page.items[1]).not.toHaveProperty('alsoIn');
  });

  it('asks nothing about other libraries without a viewer or a ready file', async () => {
    const { service, repo, duplicates } = makeService();
    repo.findAll.mockResolvedValue({ items: [row({ status: 'pending' })], total: 1 });

    await service.listFiles({ page: 1, limit: 20, sort: 'createdAt', order: 'desc', userId: 1, canManageAll: false });
    await service.listFiles({ page: 1, limit: 20, sort: 'createdAt', order: 'desc', userId: 1, canManageAll: false }, { id: 1 } as never);

    expect(duplicates.otherLibraryNames).not.toHaveBeenCalled();
  });

  it('lists and reads unit members even when books share a directory', async () => {
    const { service, repo } = makeService();
    const shared = row({ unitDirectory: null });
    const member = { fileName: 'track-02.mp3', fileSize: 20, format: 'mp3', role: 'content', sortOrder: 1 };
    repo.findAll.mockResolvedValue({ items: [shared], total: 1 });
    repo.findUnitFilesByDockFileIds.mockResolvedValue(new Map([[shared.id, [member]]]));
    repo.findById.mockResolvedValue(shared);
    repo.findUnitFiles.mockResolvedValue([member]);

    const page = await service.listFiles({ page: 1, limit: 20, sort: 'createdAt', order: 'desc', userId: 1, canManageAll: false });
    const detail = await service.getFile(shared.id, 1, false);
    expect(repo.findUnitFilesByDockFileIds).toHaveBeenCalledWith([shared.id]);
    expect(page.items[0].unitFiles).toEqual([member]);
    expect(detail.unitFiles).toEqual([member]);
  });

  it('says whether a single EPUB is a read-along, and never opens anything else to ask', async () => {
    const { service, repo } = makeService();
    vi.mocked(inspectEpubMediaOverlayFields).mockResolvedValueOnce({
      mediaOverlayAvailable: true,
      mediaOverlayDurationSeconds: 3600,
      mediaOverlayCheckedAt: new Date(),
    });
    repo.findUnitFiles.mockResolvedValue([]);

    repo.findById.mockResolvedValue(row({ format: 'epub', absolutePath: '/dock/dune.epub' }));
    expect((await service.getFile(1, 1, true, { readAlong: true })).readAlong).toBe(true);
    expect(inspectEpubMediaOverlayFields).toHaveBeenCalledWith('/dock/dune.epub', 'epub', expect.any(Function));

    vi.mocked(inspectEpubMediaOverlayFields).mockClear();
    // An ordinary read, which the upload response is too, never opens the file.
    expect((await service.getFile(1, 1, true)).readAlong).toBeUndefined();
    repo.findById.mockResolvedValue(row({ format: 'm4b', absolutePath: '/dock/dune.m4b' }));
    expect((await service.getFile(1, 1, true, { readAlong: true })).readAlong).toBeUndefined();
    expect(inspectEpubMediaOverlayFields).not.toHaveBeenCalled();
  });

  it('discards a shared-folder book and its members without touching sibling books', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(row({ unitDirectory: null }));
    repo.findUnitFiles.mockResolvedValue([{ absolutePath: '/bucket/book.epub' }, { absolutePath: '/bucket/book.mobi' }]);
    await service.discardFile(1, 1, false);
    expect(new Set(vi.mocked(unlink).mock.calls.map(([path]) => path))).toEqual(new Set(['/bucket/book.epub', '/bucket/book.mobi']));
    expect(rmdir).not.toHaveBeenCalled();
    expect(repo.deleteById).toHaveBeenCalledWith(1);
  });

  it('normalizes legacy tainted metadata before returning it through the API', async () => {
    const { service, repo } = makeService();
    const taintedMetadata = {
      title: 'Fetched',
      duration: 1200,
      communityRatings: [
        {
          provider: 'hardcover',
          rating: 4.5,
          ratingCount: 1000,
          updatedAt: '2026-07-22T00:00:00.000Z',
        },
      ],
    };
    repo.findAll.mockResolvedValue({
      items: [
        row({
          selectedMetadata: taintedMetadata,
          fetchedMetadata: taintedMetadata,
          fetchedMetadataSources: { duration: 'audible', communityRating: 'hardcover' },
        }),
      ],
      total: 1,
    });

    const result = await service.listFiles({ page: 1, limit: 20, sort: 'createdAt', order: 'desc', userId: 1, canManageAll: false });

    const normalizedMetadata = {
      title: 'Fetched',
      durationSeconds: 1200,
      communityRatings: [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }],
    };
    expect(result.items[0]?.selectedMetadata).toEqual(normalizedMetadata);
    expect(result.items[0]?.fetchedMetadata).toEqual(normalizedMetadata);
    expect(result.items[0]?.fetchedMetadataSources).toEqual({ durationSeconds: 'audible', communityRatings: 'hardcover' });
  });

  it('getFile throws when row is missing', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(undefined);

    await expect(service.getFile(123, 1, false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enforces ownership for individual file reads and allows Book Dock managers to bypass it', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(row({ uploadedBy: 2 }));

    await expect(service.getFile(1, 1, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getFile(1, 1, true)).resolves.toEqual(expect.objectContaining({ id: 1 }));

    repo.findById.mockResolvedValue(row({ uploadedBy: null }));
    await expect(service.getFile(1, 1, false)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateFile validates destination and stamps metadataEditedAt for selected metadata updates', async () => {
    const { service, repo, finalizeService } = makeService();
    repo.findById.mockResolvedValue(row());
    repo.update.mockResolvedValue(row({ selectedMetadata: { title: 'Edited' } }));
    const assertValidTarget = vi.spyOn(service as any, 'assertValidTarget').mockResolvedValue(undefined);

    await service.updateFile(
      1,
      {
        selectedMetadata: { title: 'Edited' },
        targetLibraryId: 5,
        targetFolderId: 9,
      },
      1,
      false,
    );

    expect(assertValidTarget).toHaveBeenCalledWith(5, 9);
    expect(repo.update).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        selectedMetadata: { title: 'Edited' },
        metadataEditedAt: expect.any(Date),
        // A new destination drops "Keep both" along with the reason.
        holdReason: null,
        holdDetail: null,
      }),
    );
    expect(finalizeService.reviewHolds).toHaveBeenCalledWith([1]);
  });

  it('updateFile keeps "Keep both" through a metadata-only edit, and works out the reason again', async () => {
    const { service, repo, finalizeService } = makeService();
    repo.findById.mockResolvedValue(row());
    repo.update.mockResolvedValue(row());

    await service.updateFile(1, { selectedMetadata: { title: 'Edited' } }, 1, false);

    const written = repo.update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(written.holdReason).toBeNull();
    expect(written).not.toHaveProperty('holdDetail');
    expect(finalizeService.reviewHolds).toHaveBeenCalledWith([1]);
  });

  it('keepBoth waives the duplicate for that file and asks auto-file to look at it again', async () => {
    const { service, repo, finalizeService, gateway } = makeService();
    repo.findById.mockResolvedValue(row({ holdReason: 'duplicate', holdDetail: { libraryId: 5, bookId: 300 } }));
    repo.update.mockResolvedValue(row({ holdReason: null, holdDetail: { keepBoth: true } }));

    const dto = await service.keepBoth(1, 1, false);

    expect(repo.update).toHaveBeenCalledWith(1, { holdReason: null, holdDetail: { keepBoth: true } });
    expect(finalizeService.enqueueAutoFinalize).toHaveBeenCalledWith(1);
    expect(gateway.emitChanged).toHaveBeenCalled();
    expect(dto.holdReason).toBeNull();
    expect(dto.holdDetail).toBeNull();
  });

  it("keepBoth refuses a file that is someone else's", async () => {
    const { service, repo, finalizeService } = makeService();
    repo.findById.mockResolvedValue(row({ uploadedBy: 99 }));

    await expect(service.keepBoth(1, 1, false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
    expect(finalizeService.enqueueAutoFinalize).not.toHaveBeenCalled();
  });

  it('discards a file in a keep-original dock by remembering it, never deleting it', async () => {
    const { service, repo, keptFiles } = makeService();
    const docked = row({ dockId: 11, coverPath: '/covers/book.jpg' });
    repo.findById.mockResolvedValue(docked);
    keptFiles.keepsOriginals.mockResolvedValue(true);

    await service.discardFile(1, 1, false);

    expect(keptFiles.remember).toHaveBeenCalledWith(docked, { discarded: true });
    expect(vi.mocked(unlink).mock.calls.map(([path]) => path)).toEqual(['/covers/book.jpg', '/covers/book_thumb.jpg']);
    expect(repo.deleteById).toHaveBeenCalledWith(1);
  });

  it('bulk discard reads the keep-original settings once and treats each row by its own dock', async () => {
    const { service, repo, keptFiles } = makeService();
    const kept = row({ id: 1, dockId: 11, absolutePath: '/dock/_libraries/Fiction/kept.epub' });
    const plain = row({ id: 2, dockId: null, absolutePath: '/dock/plain.epub' });
    repo.findByIds.mockResolvedValue([kept, plain]);
    const check = vi.fn((candidate: { dockId: number | null }) => Promise.resolve(candidate.dockId === 11));
    keptFiles.keepOriginalCheck.mockResolvedValue(check);

    await service.bulkDiscard([1, 2]);

    expect(keptFiles.keepOriginalCheck).toHaveBeenCalledTimes(1);
    expect(keptFiles.remember).toHaveBeenCalledExactlyOnceWith(kept, { discarded: true });
    const unlinked = vi.mocked(unlink).mock.calls.map(([path]) => path);
    expect(unlinked).toContain('/dock/plain.epub');
    expect(unlinked).not.toContain('/dock/_libraries/Fiction/kept.epub');
    expect(repo.deleteByIds).toHaveBeenCalledWith([1, 2]);
  });

  it('updateFile throws when row disappears during update', async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(row());
    repo.update.mockResolvedValue(undefined);

    await expect(service.updateFile(1, {}, 1, false)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bulkApplyFetched counts applied, skipped, and skipped-edited records', async () => {
    const { service, repo, finalizeService } = makeService();
    repo.findByIds.mockResolvedValue([
      row({ id: 1, metadataEditedAt: new Date() }),
      row({ id: 2, fetchedMetadata: null }),
      row({
        id: 3,
        fetchedMetadata: {
          title: 'Fetched',
          duration: 1200,
          communityRatings: [
            {
              provider: 'hardcover',
              rating: 4.5,
              ratingCount: 1000,
              updatedAt: '2026-07-22T00:00:00.000Z',
            },
          ],
        },
        metadataEditedAt: null,
      }),
    ]);

    const result = await service.bulkApplyFetched([1, 2, 3]);

    expect(result).toEqual({
      total: 3,
      applied: 1,
      skipped: 1,
      skippedEdited: 1,
    });
    expect(repo.update).toHaveBeenCalledWith(3, {
      selectedMetadata: {
        title: 'Fetched',
        durationSeconds: 1200,
        communityRatings: [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }],
      },
      metadataEditedAt: null,
      holdReason: null,
    });
    // Only the row that changed is checked again.
    expect(finalizeService.reviewHolds).toHaveBeenCalledWith([3]);
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

  it('refetchMetadata enforces ownership and queues an eligible file', async () => {
    const { service, repo, ingestService } = makeService();
    repo.findById.mockResolvedValue(row({ id: 7, uploadedBy: 4 }));
    ingestService.refetchMetadata.mockResolvedValue(true);

    await expect(service.refetchMetadata(7, 4, false)).resolves.toBeUndefined();

    expect(ingestService.refetchMetadata).toHaveBeenCalledWith(7);

    await expect(service.refetchMetadata(7, 5, false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(ingestService.refetchMetadata).toHaveBeenCalledTimes(1);
  });

  it('refetchMetadata rejects a file that cannot be queued', async () => {
    const { service, repo, ingestService } = makeService();
    repo.findById.mockResolvedValue(row({ id: 7, uploadedBy: 4 }));
    ingestService.refetchMetadata.mockResolvedValue(false);

    await expect(service.refetchMetadata(7, 4, false)).rejects.toBeInstanceOf(BadRequestException);
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

    await service.discardFile(1, 1, false);
    await service.bulkDiscard([], true, [], undefined, undefined, 1, true, undefined, true, { dock: 'unsorted' });

    expect(vi.mocked(unlink)).toHaveBeenCalledWith('/bucket/book.epub');
    expect(vi.mocked(unlink)).toHaveBeenCalledWith('/covers/1.png');
    expect(vi.mocked(unlink)).toHaveBeenCalledWith('/covers/1_thumb.jpg');
    expect(repo.deleteById).toHaveBeenCalledWith(1);
    expect(repo.deleteByIds).toHaveBeenCalledWith([2]);
    expect(repo.findSelectionBatch).toHaveBeenCalledWith(expect.objectContaining({ readyToFile: true, filter: { dock: 'unsorted' } }));
  });

  it('proxies summary and statistics repository queries', async () => {
    const { service, repo } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 1, ready: 2, error: 3, total: 6 });
    repo.getStatistics.mockResolvedValue({ totalSizeBytes: 10, byFormat: [] });

    await expect(service.getSummary()).resolves.toEqual({
      pending: 1,
      ready: 2,
      error: 3,
      total: 6,
      paused: false,
      docks: [{ dockId: null, total: 0, working: 0, onHold: 0, ready: 0, error: 0, keptForSeeding: 0, onHoldByReason: {} }],
      keptForSeeding: 0,
    });
    await expect(service.getStatistics()).resolves.toEqual({ totalSizeBytes: 10, byFormat: [] });
  });

  it('counts each dock, Unsorted always included, with files kept for seeding for those who manage the dock', async () => {
    const { service, repo, keptFiles } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 0, ready: 3, error: 0, total: 3 });
    repo.countsByDock.mockResolvedValue([{ dockId: 11, total: 3, working: 0, onHold: 1, ready: 2, error: 0 }]);
    repo.holdCountsByDock.mockResolvedValue([{ dockId: 11, reason: 'duplicate', count: 1 }]);
    keptFiles.countByDock.mockResolvedValue(
      new Map<number | null, number>([
        [11, 40],
        [12, 2],
        [null, 1],
      ]),
    );

    const summary = await service.getSummary(1, true);

    expect(repo.countsByDock).toHaveBeenCalledWith(1, true);
    expect(repo.holdCountsByDock).toHaveBeenCalledWith(1, true);
    expect(summary.keptForSeeding).toBe(43);
    expect(summary.docks).toEqual([
      { dockId: null, total: 0, working: 0, onHold: 0, ready: 0, error: 0, keptForSeeding: 1, onHoldByReason: {} },
      { dockId: 11, total: 3, working: 0, onHold: 1, ready: 2, error: 0, keptForSeeding: 40, onHoldByReason: { duplicate: 1 } },
      { dockId: 12, total: 0, working: 0, onHold: 0, ready: 0, error: 0, keptForSeeding: 2, onHoldByReason: {} },
    ]);
  });

  it('keeps kept-for-seeding counts from people who only see their own uploads', async () => {
    const { service, repo, keptFiles } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 0, ready: 0, error: 0, total: 0 });

    const summary = await service.getSummary(1, false);

    expect(keptFiles.countByDock).not.toHaveBeenCalled();
    expect(summary.keptForSeeding).toBe(0);
  });

  it('pauseProcessing persists paused state, pauses queues, and broadcasts summary', async () => {
    const { service, repo, processingState, ingestService, finalizeService, gateway } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 4, ready: 5, error: 0, total: 9 });
    processingState.isPaused.mockResolvedValue(true);

    await expect(service.pauseProcessing()).resolves.toEqual({
      pending: 4,
      ready: 5,
      error: 0,
      total: 9,
      paused: true,
      docks: [{ dockId: null, total: 0, working: 0, onHold: 0, ready: 0, error: 0, keptForSeeding: 0, onHoldByReason: {} }],
      keptForSeeding: 0,
    });

    expect(processingState.pause).toHaveBeenCalledTimes(1);
    expect(ingestService.pauseProcessing).toHaveBeenCalledTimes(1);
    expect(finalizeService.pauseProcessing).toHaveBeenCalledTimes(1);
    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });

  it('resumeProcessing resumes queues, broadcasts summary, and starts recovery once', async () => {
    const { service, repo, processingState, ingestService, finalizeService, watcherService, gateway } = makeService();
    repo.countsByStatus.mockResolvedValue({ pending: 2, ready: 3, error: 1, total: 6 });
    processingState.isPaused.mockResolvedValue(false);
    ingestService.requeueProcessableFiles.mockResolvedValue(7);
    finalizeService.requeueAutoFinalizeCandidates.mockResolvedValue(2);

    await expect(service.resumeProcessing()).resolves.toEqual({
      pending: 2,
      ready: 3,
      error: 1,
      total: 6,
      paused: false,
      docks: [{ dockId: null, total: 0, working: 0, onHold: 0, ready: 0, error: 0, keptForSeeding: 0, onHoldByReason: {} }],
      keptForSeeding: 0,
    });
    await (service as any).resumeWorkPromise;

    expect(processingState.resume).toHaveBeenCalledTimes(1);
    expect(ingestService.resumeProcessing).toHaveBeenCalledTimes(1);
    expect(finalizeService.resumeProcessing).toHaveBeenCalledTimes(1);
    expect(ingestService.requeueProcessableFiles).toHaveBeenCalledTimes(1);
    expect(finalizeService.requeueAutoFinalizeCandidates).toHaveBeenCalledTimes(1);
    expect(watcherService.rescan).toHaveBeenCalledTimes(1);
    expect(gateway.emitChanged).toHaveBeenCalledTimes(1);
  });
});
