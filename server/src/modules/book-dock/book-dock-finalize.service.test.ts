vi.mock('fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { access, readFile, stat, unlink } from 'fs/promises';

import type { BookDockMetadata } from '@bookorbit/types';
import { BookDockFinalizeService } from './book-dock-finalize.service';

const mockAccess = vi.mocked(access);
const mockReadFile = vi.mocked(readFile);
const mockStat = vi.mocked(stat);
const mockUnlink = vi.mocked(unlink);

function makeService() {
  const db = {
    select: vi.fn(),
    update: vi.fn(),
  };
  const repo = {
    findById: vi.fn(),
    countsByStatus: vi.fn(),
    findByIds: vi.fn(),
    findSelectionBatch: vi.fn(),
    findAllIds: vi.fn(),
    deleteById: vi.fn(),
    deleteByIds: vi.fn(),
  };
  const libraryService = {
    verifyUserAccess: vi.fn().mockResolvedValue(undefined),
  };
  const appSettings = {
    getAutoFinalizeSettings: vi.fn(),
    getUploadPattern: vi.fn().mockResolvedValue(null),
    getUploadPatternBookPerFolder: vi.fn().mockResolvedValue(null),
    isCrossPlatformPathSanitizationEnabled: vi.fn().mockResolvedValue(false),
  };
  const metadataService = {
    downloadAndSaveCover: vi.fn().mockResolvedValue(false),
    saveExtractedCoverBytes: vi.fn().mockResolvedValue(undefined),
    replaceAuthors: vi.fn().mockResolvedValue(undefined),
    replaceGenres: vi.fn().mockResolvedValue(undefined),
    replaceNarrators: vi.fn().mockResolvedValue(undefined),
    upsertComicMetadata: vi.fn().mockResolvedValue(undefined),
  };
  const bookReadService = {
    replaceCommunityRatings: vi.fn().mockResolvedValue(undefined),
  };
  const validator = {
    validateFormat: vi.fn(),
    sanitizeFilename: vi.fn((s: string) => s),
  };
  const storage = {
    moveToPath: vi.fn().mockResolvedValue(undefined),
  };
  const processor = {
    createBookRecord: vi.fn().mockResolvedValue({ bookId: 101 }),
  };
  const events = {
    on: vi.fn(),
  };
  const gateway = {
    emitSummary: vi.fn(),
  };
  const processingState = {
    isPaused: vi.fn().mockResolvedValue(false),
    getCachedPaused: vi.fn().mockReturnValue(false),
  };
  const seriesMemberships = {
    replaceForBook: vi.fn().mockResolvedValue(undefined),
    syncPrimaryFromMetadata: vi.fn().mockResolvedValue(undefined),
  };

  const service = new BookDockFinalizeService(
    db as never,
    repo as never,
    libraryService as never,
    appSettings as never,
    metadataService as never,
    bookReadService as never,
    validator as never,
    storage as never,
    processor as never,
    events as never,
    gateway as never,
    { notify: vi.fn().mockResolvedValue(undefined) } as never,
    processingState as never,
    undefined as never,
    seriesMemberships as never,
  );

  return {
    service,
    db,
    repo,
    libraryService,
    appSettings,
    metadataService,
    bookReadService,
    validator,
    storage,
    processor,
    events,
    gateway,
    processingState,
    seriesMemberships,
  };
}

function makeRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 1,
    fileName: 'book.epub',
    absolutePath: '/tmp/book.epub',
    fileSize: 100,
    format: 'epub',
    status: 'ready',
    embeddedMetadata: { title: 'Embedded Title', genres: ['Embedded Genre'] } as BookDockMetadata,
    selectedMetadata: null as BookDockMetadata | null,
    fetchedMetadata: null as BookDockMetadata | null,
    coverPath: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: 90,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('BookDockFinalizeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockReset();
    mockReadFile.mockReset();
    mockStat.mockReset();
    mockUnlink.mockReset();
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    mockReadFile.mockResolvedValue(Buffer.from('cover-bytes'));
    mockStat.mockResolvedValue({ size: 100 } as never);
    mockUnlink.mockResolvedValue(undefined);
  });

  describe('triggerAutoFinalize', () => {
    it('does not load settings or rows while Book Dock processing is paused', async () => {
      const { service, repo, appSettings, processingState } = makeService();
      processingState.isPaused.mockResolvedValue(true);
      const pauseSpy = vi.spyOn((service as any).autoFinalizeQueue, 'pause');

      await service.triggerAutoFinalize(1);

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(appSettings.getAutoFinalizeSettings).not.toHaveBeenCalled();
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('merges embedded and fetched metadata when auto-finalizing and selected metadata is empty', async () => {
      const { service, repo, appSettings } = makeService();
      const fetched = { title: 'Fetched Title', authors: ['Fetched Author'] } as BookDockMetadata;
      const row = makeRow({ selectedMetadata: null, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookDockMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Fetched Title',
        authors: ['Fetched Author'],
        genres: ['Embedded Genre'],
      });
    });

    it('lets selected metadata override fetched and embedded values during auto-finalize', async () => {
      const { service, repo, appSettings } = makeService();
      const manual = { title: 'Manual Title' } as BookDockMetadata;
      const fetched = { title: 'Fetched Title', authors: ['Fetched Author'] } as BookDockMetadata;
      const row = makeRow({ selectedMetadata: manual, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookDockMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Manual Title',
        authors: ['Fetched Author'],
        genres: ['Embedded Genre'],
      });
    });

    it('uses fetched metadata only (plus manual selection) in fetched_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const manual = { title: 'Manual Title' } as BookDockMetadata;
      const fetched = { authors: ['Fetched Author'] } as BookDockMetadata;
      const row = makeRow({ selectedMetadata: manual, fetchedMetadata: fetched });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'fetched_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookDockMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Manual Title',
        authors: ['Fetched Author'],
      });
    });

    it('uses embedded metadata only (plus manual selection) in embedded_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({
        selectedMetadata: null,
        fetchedMetadata: { title: 'Fetched Title', authors: ['Fetched Author'] } as BookDockMetadata,
      });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'embedded_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      const passedRow = finalizeSpy.mock.calls[0]?.[0] as { selectedMetadata: BookDockMetadata | null } | undefined;
      expect(passedRow?.selectedMetadata).toEqual({
        title: 'Embedded Title',
        genres: ['Embedded Genre'],
      });
    });

    it('ignores confidence threshold in embedded_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({ confidence: null });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'embedded_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
    });

    it('still requires confidence threshold in fetched_only mode', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({ confidence: null, fetchedMetadata: { title: 'Fetched Title' } as BookDockMetadata });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'fetched_only',
      });
      repo.findById.mockResolvedValue(row);

      const finalizeSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: row.id,
        fileName: row.fileName,
        success: true,
        bookId: 42,
      } as never);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).not.toHaveBeenCalled();
    });

    it('requeueAutoFinalizeCandidates queues ready rows that match current settings', async () => {
      const { service, repo, appSettings } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findSelectionBatch
        .mockResolvedValueOnce([
          makeRow({ id: 1, status: 'ready', confidence: 90, fetchedMetadata: { title: 'One' } as BookDockMetadata }),
          makeRow({ id: 2, status: 'ready', confidence: 40, fetchedMetadata: { title: 'Two' } as BookDockMetadata }),
        ])
        .mockResolvedValueOnce([]);
      const enqueueSpy = vi.spyOn((service as any).autoFinalizeQueue, 'enqueue').mockReturnValue(true);

      await expect(service.requeueAutoFinalizeCandidates()).resolves.toBe(1);

      expect(repo.findSelectionBatch).toHaveBeenCalledWith({
        limit: 100,
        afterId: undefined,
        status: 'ready',
        userId: 0,
        isSuperuser: true,
      });
      expect(enqueueSpy).toHaveBeenCalledWith(1);
      expect(enqueueSpy).not.toHaveBeenCalledWith(2);
    });

    it('requeueAutoFinalizeCandidates does no work when paused or disabled', async () => {
      const { service, repo, appSettings, processingState } = makeService();
      processingState.isPaused.mockResolvedValueOnce(true);
      await expect(service.requeueAutoFinalizeCandidates()).resolves.toBe(0);
      expect(repo.findSelectionBatch).not.toHaveBeenCalled();

      processingState.isPaused.mockResolvedValue(false);
      appSettings.getAutoFinalizeSettings.mockResolvedValue({ enabled: false, threshold: 85, libraryId: 5, folderId: 9, metadataMode: 'safe_merge' });
      await expect(service.requeueAutoFinalizeCandidates()).resolves.toBe(0);
      expect(repo.findSelectionBatch).not.toHaveBeenCalled();
    });
  });

  describe('finalize', () => {
    it('returns missing-row failures for explicit ids not found in repository', async () => {
      const { service, repo } = makeService();
      const rowOne = makeRow({ id: 1 });
      repo.findByIds.mockResolvedValue([rowOne]);
      vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
      vi.spyOn(service as never, 'finalizeFile').mockResolvedValueOnce({
        fileId: 1,
        fileName: 'book.epub',
        success: true,
        bookId: 101,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      const result = await service.finalize(7, true, [1, 2], false, [], 5, 9);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          fileId: 2,
          success: false,
          message: 'Book Dock file not found',
        }),
      );
    });

    it('iterates selectAll batches until no rows remain', async () => {
      const { service, repo } = makeService();
      repo.findSelectionBatch.mockResolvedValueOnce([makeRow({ id: 1 }), makeRow({ id: 2 })]).mockResolvedValueOnce([]);
      vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
      vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: 1,
        fileName: 'book.epub',
        success: true,
        bookId: 10,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      const result = await service.finalize(7, true, [], true, [], 5, 9, [], 'ready', 'foo');

      expect(repo.findSelectionBatch).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('finalizeFile', () => {
    it('fails early when destination library or folder is missing', async () => {
      const { service } = makeService();

      await expect((service as any).finalizeFile(makeRow(), undefined, undefined, new Map(), 1, true)).resolves.toEqual({
        fileId: 1,
        fileName: 'book.epub',
        success: false,
        message: 'Destination is not set for this file',
      });
    });

    it('fails when target file already exists at resolved destination', async () => {
      const { service, validator } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/existing.epub' as never);
      mockAccess.mockResolvedValueOnce(undefined as never);

      const result = await (service as any).finalizeFile(
        makeRow({ targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        new Map(),
        1,
        true,
      );

      expect(result).toMatchObject({
        fileId: 1,
        fileName: 'book.epub',
        success: false,
        message: 'A file with this name already exists at the target location',
      });
      expect(validator.validateFormat).toHaveBeenCalled();
    });

    it('marks rows as duplicates when duplicate lookup finds an existing book', async () => {
      const { service } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new.epub' as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(77 as never);

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toEqual(
        expect.objectContaining({
          success: false,
          isDuplicate: true,
          existingBookId: 77,
        }),
      );
    });

    it('rolls back moved files and reports failure when book record creation fails', async () => {
      const { service, storage, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new/book.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      mockStat.mockResolvedValueOnce({ size: 321 } as never);
      processor.createBookRecord.mockRejectedValueOnce(new Error('create failed'));

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toEqual(
        expect.objectContaining({
          success: false,
          message: 'create failed',
        }),
      );
      expect(storage.moveToPath).toHaveBeenNthCalledWith(1, '/tmp/book.epub', '/library/new/book.epub');
      expect(storage.moveToPath).toHaveBeenNthCalledWith(2, '/library/new/book.epub', '/tmp/book.epub');
    });

    it('returns a friendly metadata validation message when book metadata constraints fail', async () => {
      const { service, storage, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new/book.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      mockStat.mockResolvedValueOnce({ size: 321 } as never);
      processor.createBookRecord.mockResolvedValueOnce({ bookId: 808 });
      const constraintError = new Error('Failed query: update "book_metadata" set ...');
      (constraintError as Error & { cause?: unknown }).cause = {
        code: '23514',
        constraint: 'book_metadata_published_year_range_chk',
      };
      vi.spyOn(service as never, 'applyMetadata').mockRejectedValueOnce(constraintError as never);

      const result = await (service as any).finalizeFile(
        makeRow({ targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        new Map(),
        1,
        true,
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          message: 'Invalid metadata: published year must be between 1000 and 2200.',
        }),
      );
      expect(result.message).not.toContain('Failed query');
      expect(storage.moveToPath).toHaveBeenNthCalledWith(1, '/tmp/book.epub', '/library/new/book.epub');
      expect(storage.moveToPath).toHaveBeenNthCalledWith(2, '/library/new/book.epub', '/tmp/book.epub');
    });

    it('returns success with relative newName when finalize flow completes', async () => {
      const { service, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new/book.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      mockStat.mockResolvedValueOnce({ size: 100 } as never);
      processor.createBookRecord.mockResolvedValueOnce({ bookId: 555 });

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toEqual({
        fileId: 1,
        fileName: 'book.epub',
        newName: 'new/book.epub',
        success: true,
        bookId: 555,
      });
      expect(processor.createBookRecord).toHaveBeenCalledWith(5, 9, '/library/new', '/library/new/book.epub', 'new/book.epub', 'epub', 100);
    });

    it('uses the file path as bookFolderPath in book_per_file mode', async () => {
      const { service, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_file',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new/book.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(new Error('missing'));
      mockStat.mockResolvedValueOnce({ size: 100 } as never);
      processor.createBookRecord.mockResolvedValueOnce({ bookId: 556 });

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toMatchObject({ success: true, bookId: 556 });
      expect(processor.createBookRecord).toHaveBeenCalledWith(5, 9, '/library/new/book.epub', '/library/new/book.epub', 'new/book.epub', 'epub', 100);
    });

    describe('skipDuplicateCheck override', () => {
      it('bypasses duplicate detection and succeeds when skipDuplicateCheck is true', async () => {
        const { service, processor } = makeService();
        vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
          id: 5,
          allowedFormats: ['epub', 'pdf'],
          fileNamingPattern: null,
          organizationMode: 'book_per_folder',
        } as never);
        vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
        vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Author/Title/Title.pdf' as never);
        const findDuplicateSpy = vi.spyOn(service as never, 'findDuplicate');
        vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
        vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
        mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
        mockStat.mockResolvedValueOnce({ size: 512 } as never);
        processor.createBookRecord.mockResolvedValueOnce({ bookId: 200 });

        const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, skipDuplicateCheck: true }]]);
        const result = await (service as any).finalizeFile(
          makeRow({ id: 1, fileName: 'Title.pdf', format: 'pdf', targetLibraryId: 5, targetFolderId: 9 }),
          undefined,
          undefined,
          overrideMap,
          1,
          true,
        );

        expect(result).toMatchObject({ success: true, bookId: 200 });
        expect(findDuplicateSpy).not.toHaveBeenCalled();
      });

      it('still blocks import when destination file already exists even with skipDuplicateCheck', async () => {
        const { service } = makeService();
        vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
          id: 5,
          allowedFormats: ['epub'],
          fileNamingPattern: null,
          organizationMode: 'book_per_folder',
        } as never);
        vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
        vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Author/Title/Title.epub' as never);
        mockAccess.mockResolvedValueOnce(undefined as never);

        const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, skipDuplicateCheck: true }]]);
        const result = await (service as any).finalizeFile(
          makeRow({ id: 1, targetLibraryId: 5, targetFolderId: 9 }),
          undefined,
          undefined,
          overrideMap,
          1,
          true,
        );

        expect(result).toMatchObject({
          fileId: 1,
          fileName: 'book.epub',
          success: false,
          message: 'A file with this name already exists at the target location',
        });
      });

      it('calls findDuplicate normally when skipDuplicateCheck is absent', async () => {
        const { service } = makeService();
        vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
          id: 5,
          allowedFormats: ['epub'],
          fileNamingPattern: null,
          organizationMode: 'book_per_folder',
        } as never);
        vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
        vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Author/Title/Title.epub' as never);
        mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
        const findDuplicateSpy = vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(77 as never);

        const overrideMap = new Map([[1, { libraryId: 5, folderId: 9 }]]);
        const result = await (service as any).finalizeFile(
          makeRow({ id: 1, targetLibraryId: 5, targetFolderId: 9 }),
          undefined,
          undefined,
          overrideMap,
          1,
          true,
        );

        expect(findDuplicateSpy).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ success: false, isDuplicate: true, existingBookId: 77 });
      });

      it('calls findDuplicate normally when skipDuplicateCheck is false', async () => {
        const { service } = makeService();
        vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
          id: 5,
          allowedFormats: ['epub'],
          fileNamingPattern: null,
          organizationMode: 'book_per_folder',
        } as never);
        vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
        vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Author/Title/Title.epub' as never);
        mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
        const findDuplicateSpy = vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(88 as never);

        const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, skipDuplicateCheck: false }]]);
        const result = await (service as any).finalizeFile(
          makeRow({ id: 1, targetLibraryId: 5, targetFolderId: 9 }),
          undefined,
          undefined,
          overrideMap,
          1,
          true,
        );

        expect(findDuplicateSpy).toHaveBeenCalledOnce();
        expect(result).toMatchObject({ success: false, isDuplicate: true, existingBookId: 88 });
      });

      it('attaches pdf to existing book folder in book_per_folder mode', async () => {
        const { service, processor } = makeService();
        vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
          id: 5,
          allowedFormats: ['epub', 'pdf'],
          fileNamingPattern: null,
          organizationMode: 'book_per_folder',
        } as never);
        vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
        // Naming pattern resolves PDF into the same folder as the existing EPUB
        vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Author/Dune/Dune.pdf' as never);
        vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
        vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
        mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
        mockStat.mockResolvedValueOnce({ size: 1024 } as never);
        processor.createBookRecord.mockResolvedValueOnce({ bookId: 42 });

        const overrideMap = new Map([[7, { libraryId: 5, folderId: 9, skipDuplicateCheck: true }]]);
        const result = await (service as any).finalizeFile(
          makeRow({ id: 7, fileName: 'Dune.pdf', format: 'pdf', absolutePath: '/tmp/Dune.pdf', targetLibraryId: 5, targetFolderId: 9 }),
          undefined,
          undefined,
          overrideMap,
          1,
          true,
        );

        expect(result).toMatchObject({ success: true, bookId: 42 });
        // book_per_folder: folderPath = dirname(destPath) = /library/Author/Dune
        expect(processor.createBookRecord).toHaveBeenCalledWith(
          5,
          9,
          '/library/Author/Dune',
          '/library/Author/Dune/Dune.pdf',
          'Author/Dune/Dune.pdf',
          'pdf',
          1024,
        );
      });

      it('creates a separate book record in book_per_file mode with skipDuplicateCheck', async () => {
        const { service, processor } = makeService();
        vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
          id: 6,
          allowedFormats: ['epub', 'pdf'],
          fileNamingPattern: null,
          organizationMode: 'book_per_file',
        } as never);
        vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 10, libraryId: 6, path: '/library2' } as never);
        vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library2/Dune.pdf' as never);
        vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
        vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
        mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
        mockStat.mockResolvedValueOnce({ size: 2048 } as never);
        processor.createBookRecord.mockResolvedValueOnce({ bookId: 300 });

        const overrideMap = new Map([[8, { libraryId: 6, folderId: 10, skipDuplicateCheck: true }]]);
        const result = await (service as any).finalizeFile(
          makeRow({ id: 8, fileName: 'Dune.pdf', format: 'pdf', absolutePath: '/tmp/Dune.pdf', targetLibraryId: 6, targetFolderId: 10 }),
          undefined,
          undefined,
          overrideMap,
          1,
          true,
        );

        expect(result).toMatchObject({ success: true, bookId: 300 });
        // book_per_file: folderPath = destPath itself (each file is its own book)
        expect(processor.createBookRecord).toHaveBeenCalledWith(6, 10, '/library2/Dune.pdf', '/library2/Dune.pdf', 'Dune.pdf', 'pdf', 2048);
      });

      it('passes skipDuplicateCheck through the finalize public API via overrides array', async () => {
        const { service, repo } = makeService();
        repo.findByIds.mockResolvedValue([makeRow({ id: 3, targetLibraryId: 5, targetFolderId: 9 })]);
        vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
        const finalizeFileSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
          fileId: 3,
          fileName: 'book.pdf',
          success: true,
          bookId: 99,
        } as never);
        vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

        await service.finalize(1, true, [3], false, [], 5, 9, [{ fileId: 3, skipDuplicateCheck: true }]);

        const overrideMapPassed = finalizeFileSpy.mock.calls[0]?.[3] as Map<number, unknown>;
        expect(overrideMapPassed.get(3)).toMatchObject({ fileId: 3, skipDuplicateCheck: true });
      });
    });
  });

  describe('targetFileName override', () => {
    it('replaces the basename of the resolved destination with the sanitized targetFileName', async () => {
      const { service, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Unknown Author/1/1.epub' as never);
      const findDuplicateSpy = vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      mockStat.mockResolvedValueOnce({ size: 993 } as never);
      processor.createBookRecord.mockResolvedValueOnce({ bookId: 500 });

      const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, targetFileName: '1_alt' }]]);
      const result = await (service as any).finalizeFile(
        makeRow({ id: 1, fileName: '1.epub', format: 'epub', targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        overrideMap,
        1,
        true,
      );

      expect(result).toMatchObject({ success: true, bookId: 500 });
      // basename replaced: 1.epub → 1_alt.epub, directory unchanged
      expect(processor.createBookRecord).toHaveBeenCalledWith(
        5,
        9,
        '/library/Unknown Author/1',
        '/library/Unknown Author/1/1_alt.epub',
        'Unknown Author/1/1_alt.epub',
        'epub',
        993,
      );
      expect(findDuplicateSpy).toHaveBeenCalledOnce();
    });

    it('still blocks duplicate books when targetFileName is provided', async () => {
      const { service } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Unknown Author/1/1.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(77 as never);

      const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, targetFileName: '1_alt' }]]);
      const result = await (service as any).finalizeFile(
        makeRow({ id: 1, fileName: '1.epub', format: 'epub', targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        overrideMap,
        1,
        true,
      );

      expect(result).toMatchObject({
        success: false,
        isDuplicate: true,
        existingBookId: 77,
      });
      expect(mockAccess).not.toHaveBeenCalled();
    });

    it('targetFileName still fails when the renamed dest also already exists', async () => {
      const { service } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Unknown Author/1/1.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      // 1_alt.epub also already exists
      mockAccess.mockResolvedValueOnce(undefined as never);

      const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, targetFileName: '1_alt' }]]);
      const result = await (service as any).finalizeFile(
        makeRow({ id: 1, fileName: '1.epub', format: 'epub', targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        overrideMap,
        1,
        true,
      );

      expect(result).toMatchObject({
        fileId: 1,
        fileName: '1.epub',
        success: false,
        message: 'A file with this name already exists at the target location',
      });
    });

    it('passes targetFileName through the finalize public API via overrides array', async () => {
      const { service, repo } = makeService();
      repo.findByIds.mockResolvedValue([makeRow({ id: 4, targetLibraryId: 5, targetFolderId: 9 })]);
      vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
      const finalizeFileSpy = vi.spyOn(service as never, 'finalizeFile').mockResolvedValue({
        fileId: 4,
        fileName: '1.epub',
        success: true,
        bookId: 99,
      } as never);
      vi.spyOn(service as never, 'emitSummary').mockResolvedValue(undefined as never);

      await service.finalize(1, true, [4], false, [], 5, 9, [{ fileId: 4, targetFileName: '1_alt' }]);

      const overrideMapPassed = finalizeFileSpy.mock.calls[0]?.[3] as Map<number, unknown>;
      expect(overrideMapPassed.get(4)).toMatchObject({ fileId: 4, targetFileName: '1_alt' });
    });

    it('strips extension from targetFileName if user includes it to avoid double extension', async () => {
      const { service, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Author/Title/Title.epub' as never);
      vi.spyOn(service as never, 'findDuplicate').mockResolvedValue(null as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'));
      mockStat.mockResolvedValueOnce({ size: 200 } as never);
      processor.createBookRecord.mockResolvedValueOnce({ bookId: 600 });

      // User types "Title (alt).epub" - should NOT produce "Title (alt).epub.epub"
      const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, targetFileName: 'Title (alt).epub' }]]);
      const result = await (service as any).finalizeFile(
        makeRow({ id: 1, fileName: 'Title.epub', format: 'epub', targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        overrideMap,
        1,
        true,
      );

      expect(result).toMatchObject({ success: true });
      expect(processor.createBookRecord).toHaveBeenCalledWith(
        5,
        9,
        '/library/Author/Title',
        '/library/Author/Title/Title (alt).epub',
        'Author/Title/Title (alt).epub',
        'epub',
        200,
      );
    });

    it('rejects targetFileName that would escape the destination directory', async () => {
      const { service } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Author/Title/Title.epub' as never);
      // Simulate a sanitizeFilename that still returns something with path separators
      // (defense-in-depth: guard fires even if upstream sanitization is incomplete)
      vi.spyOn((service as any).validator, 'sanitizeFilename').mockReturnValue('../escape.epub');

      const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, targetFileName: '../escape' }]]);
      const result = await (service as any).finalizeFile(
        makeRow({ id: 1, fileName: 'Title.epub', format: 'epub', targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        overrideMap,
        1,
        true,
      );

      expect(result).toEqual(
        expect.objectContaining({
          success: false,
          message: 'Invalid file name',
        }),
      );
    });
  });

  describe('finalize preflight and duplicate discard', () => {
    it('previews ready, duplicate, and destination conflict candidates', async () => {
      const { service, repo } = makeService();
      const duplicateRow = makeRow({ id: 1, fileName: 'duplicate.epub', targetLibraryId: 5, targetFolderId: 9 });
      const conflictRow = makeRow({ id: 2, fileName: 'conflict.epub', targetLibraryId: 5, targetFolderId: 9 });
      const readyRow = makeRow({ id: 3, fileName: 'ready.epub', targetLibraryId: 5, targetFolderId: 9 });
      repo.findByIds.mockResolvedValue([duplicateRow, conflictRow, readyRow]);
      vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockImplementation((_, __, row: { fileName: string }) =>
        Promise.resolve(`/library/${row.fileName}`),
      );
      vi.spyOn(service as never, 'findDuplicate')
        .mockResolvedValueOnce(77 as never)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(null as never);
      mockAccess.mockImplementation((path) => {
        if (String(path).includes('conflict.epub')) return Promise.resolve(undefined) as never;
        return Promise.reject(new Error('ENOENT')) as never;
      });

      const preview = await service.previewFinalize(1, true, [1, 2, 3], false, [], undefined, undefined);

      expect(preview).toMatchObject({
        total: 3,
        ready: 1,
        duplicates: 1,
        destinationConflicts: 1,
        missingDestination: 0,
        blocked: 0,
      });
      expect(preview.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fileId: 1, status: 'duplicate', existingBookId: 77 }),
          expect.objectContaining({ fileId: 2, status: 'destination_conflict' }),
          expect.objectContaining({ fileId: 3, status: 'ready' }),
        ]),
      );
    });

    it('discards only duplicate candidates and cleans their files', async () => {
      const { service, repo } = makeService();
      const duplicateRow = makeRow({
        id: 1,
        fileName: 'duplicate.epub',
        absolutePath: '/dock/duplicate.epub',
        targetLibraryId: 5,
        targetFolderId: 9,
      });
      const conflictRow = makeRow({ id: 2, fileName: 'conflict.epub', absolutePath: '/dock/conflict.epub', targetLibraryId: 5, targetFolderId: 9 });
      const readyRow = makeRow({ id: 3, fileName: 'ready.epub', absolutePath: '/dock/ready.epub', targetLibraryId: 5, targetFolderId: 9 });
      repo.findByIds.mockResolvedValue([duplicateRow, conflictRow, readyRow]);
      repo.countsByStatus.mockResolvedValue({ pending: 0, ready: 2, error: 0, total: 2 });
      vi.spyOn(service as never, 'buildDuplicateLookup').mockResolvedValue(new Map() as never);
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockImplementation((_, __, row: { fileName: string }) =>
        Promise.resolve(`/library/${row.fileName}`),
      );
      vi.spyOn(service as never, 'findDuplicate')
        .mockResolvedValueOnce(77 as never)
        .mockResolvedValueOnce(null as never)
        .mockResolvedValueOnce(null as never);
      mockAccess.mockImplementation((path) => {
        if (String(path).includes('conflict.epub')) return Promise.resolve(undefined) as never;
        return Promise.reject(new Error('ENOENT')) as never;
      });

      const result = await service.discardDuplicateCandidates(1, true, [1, 2, 3], false, [], undefined, undefined);

      expect(result).toEqual({ total: 3, discarded: 1, skipped: 2, discardedFileIds: [1] });
      expect(mockUnlink).toHaveBeenCalledWith('/dock/duplicate.epub');
      expect(mockUnlink).not.toHaveBeenCalledWith('/dock/conflict.epub');
      expect(mockUnlink).not.toHaveBeenCalledWith('/dock/ready.epub');
      expect(repo.deleteByIds).toHaveBeenCalledWith([1]);
    });
  });

  it('previewNames returns [] for empty explicit selection', async () => {
    const { service } = makeService();

    await expect(service.previewNames([], false, [], 5, 1, true)).resolves.toEqual([]);
  });

  it('previewNames uses selectAll ids and preserves original filename when no pattern resolves', async () => {
    const { service, repo, appSettings, db } = makeService();
    repo.findAllIds.mockResolvedValue([1]);
    repo.findByIds.mockResolvedValue([makeRow({ id: 1 })]);
    appSettings.getUploadPattern.mockResolvedValue(null);
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await expect(service.previewNames([], true, [], undefined, 1, true, 'ready', 'title')).resolves.toEqual([
      { fileId: 1, fileName: 'book.epub', newName: 'book.epub' },
    ]);
  });

  it('previewNames uses folder-mode global pattern for book_per_folder library', async () => {
    const { service, repo, appSettings, db } = makeService();
    repo.findByIds.mockResolvedValue([makeRow({ id: 1, targetLibraryId: 10, selectedMetadata: { title: 'Dune' } as BookDockMetadata })]);
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{title}/');
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 10, fileNamingPattern: null, organizationMode: 'book_per_folder' }]),
      }),
    });

    const result = await service.previewNames([1], false, [], undefined, 1, true);
    expect(result[0].newName).toBe('Dune/book.epub');
  });

  it('previewNames uses file-mode global pattern for book_per_file library', async () => {
    const { service, repo, appSettings, db } = makeService();
    repo.findByIds.mockResolvedValue([makeRow({ id: 1, targetLibraryId: 10, selectedMetadata: { title: 'Dune' } as BookDockMetadata })]);
    appSettings.getUploadPattern.mockResolvedValue('{title}.{extension}');
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 10, fileNamingPattern: null, organizationMode: 'book_per_file' }]),
      }),
    });

    const result = await service.previewNames([1], false, [], undefined, 1, true);
    expect(result[0].newName).toBe('Dune.epub');
  });

  it('previewNames library-specific pattern wins over mode-specific global pattern', async () => {
    const { service, repo, appSettings, db } = makeService();
    repo.findByIds.mockResolvedValue([makeRow({ id: 1, targetLibraryId: 10, selectedMetadata: { title: 'Dune' } as BookDockMetadata })]);
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{authors:first}/{title}/');
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 10, fileNamingPattern: '{title}.{extension}', organizationMode: 'book_per_folder' }]),
      }),
    });

    const result = await service.previewNames([1], false, [], undefined, 1, true);
    expect(result[0].newName).toBe('Dune.epub');
  });

  it('previewNames sanitizes generated names when cross-platform mode is enabled', async () => {
    const { service, repo, appSettings, db } = makeService();
    appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(true);
    appSettings.getUploadPattern.mockResolvedValue('{authors:first}/{title}');
    repo.findByIds.mockResolvedValue([makeRow({ id: 1, selectedMetadata: { title: 'AUX', authors: ['CON'] } as BookDockMetadata })]);
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await service.previewNames([1], false, [], undefined, 1, true);
    expect(result[0].newName).toBe('CON_/AUX_.epub');
  });

  it('applyMetadata updates scalar metadata fields and related author/genre rows', async () => {
    const { service, db, metadataService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    const bucketRow = makeRow({
      selectedMetadata: {
        title: 'New Title',
        subtitle: 'Sub',
        description: 'Desc',
        isbn13: '9780306406157',
        publisher: 'Pub',
        publishedYear: 2022,
        language: 'en-US',
        pageCount: 300,
        seriesName: 'Saga',
        seriesIndex: 2.5,
        authors: ['Author A'],
        genres: ['Fantasy'],
      } as BookDockMetadata,
      coverPath: null,
    });

    await (service as any).applyMetadata(15, bucketRow);

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New Title',
        subtitle: 'Sub',
        description: 'Desc',
        isbn13: '9780306406157',
        publisher: 'Pub',
        publishedYear: 2022,
        language: 'en-US',
        pageCount: 300,
        seriesName: 'Saga',
        seriesIndex: 2.5,
      }),
    );
    expect(metadataService.replaceAuthors).toHaveBeenCalledWith(15, [{ name: 'Author A', sortName: null }]);
    expect(metadataService.replaceGenres).toHaveBeenCalledWith(15, ['Fantasy']);
  });

  it('applyMetadata nulls publishedYear when it is outside database bounds', async () => {
    const { service, db } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      16,
      makeRow({
        selectedMetadata: {
          title: 'The Black Company',
          publishedYear: 101,
        } as BookDockMetadata,
        coverPath: null,
      }),
    );

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        publishedYear: null,
      }),
    );
  });

  it('applyMetadata persists provider IDs and every structured field emitted by metadata search', async () => {
    const { service, db, metadataService, bookReadService, seriesMemberships } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      19,
      makeRow({
        coverPath: null,
        selectedMetadata: {
          title: 'Dune',
          pageCount: 688,
          narrators: ['Simon Vance'],
          durationSeconds: 1200,
          abridged: false,
          seriesMemberships: [
            { seriesName: 'Dune', seriesIndex: 1 },
            { seriesName: 'Dune Chronicles', seriesIndex: 1 },
          ],
          communityRatings: [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }],
          googleBooksId: 'google-id',
          goodreadsId: 'goodreads-id',
          amazonId: 'amazon-id',
          hardcoverId: 'hardcover-book',
          hardcoverEditionId: 'hardcover-edition',
          openLibraryId: 'OL1W',
          itunesId: 'itunes-id',
          audibleId: 'audible-id',
          librofmId: 'librofm-id',
          koboId: 'kobo-id',
          comicvineId: 'comicvine-id',
          ranobedbId: 'ranobedb-id',
          lubimyczytacId: 'lubimyczytac-id',
          aladinId: 'aladin-id',
          comicMetadata: { issueNumber: '1', pencillers: ['Artist'] },
        } as BookDockMetadata,
      }),
    );

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        pageCount: 688,
        durationSeconds: 1200,
        abridged: false,
        googleBooksId: 'google-id',
        goodreadsId: 'goodreads-id',
        amazonId: 'amazon-id',
        hardcoverId: 'hardcover-book',
        hardcoverEditionId: 'hardcover-edition',
        openLibraryId: 'OL1W',
        itunesId: 'itunes-id',
        audibleId: 'audible-id',
        librofmId: 'librofm-id',
        koboId: 'kobo-id',
        comicvineId: 'comicvine-id',
        ranobedbId: 'ranobedb-id',
        lubimyczytacId: 'lubimyczytac-id',
        aladinId: 'aladin-id',
      }),
    );
    expect(seriesMemberships.replaceForBook).toHaveBeenCalledWith(19, [
      { seriesName: 'Dune', seriesIndex: 1 },
      { seriesName: 'Dune Chronicles', seriesIndex: 1 },
    ]);
    expect(bookReadService.replaceCommunityRatings).toHaveBeenCalledWith(19, [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }]);
    expect(metadataService.upsertComicMetadata).toHaveBeenCalledWith(19, { issueNumber: '1', pencillers: ['Artist'] });
    expect(metadataService.replaceNarrators).toHaveBeenCalledWith(19, [{ name: 'Simon Vance', sortName: null }]);
  });

  it('applyMetadata prefers selected coverUrl and skips extracted cover copy when download succeeds', async () => {
    const { service, db, metadataService } = makeService();
    metadataService.downloadAndSaveCover.mockResolvedValueOnce(true);
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    mockReadFile.mockResolvedValue(Buffer.from('cover-bytes'));

    await (service as any).applyMetadata(
      20,
      makeRow({
        coverPath: '/tmp/cover.jpg',
        selectedMetadata: { title: 'T', coverUrl: 'https://covers.example/1.jpg' } as BookDockMetadata,
      }),
    );

    expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith('https://covers.example/1.jpg', 20);
    expect(metadataService.saveExtractedCoverBytes).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('applyMetadata persists duration, chapters and narrators extracted from the audiobook', async () => {
    const { service, db, metadataService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      30,
      makeRow({
        format: 'm4b',
        fileName: 'book.m4b',
        selectedMetadata: null,
        coverPath: null,
        embeddedMetadata: {
          title: 'Artificial Condition',
          authors: ['Martha Wells'],
          narrators: ['Kevin R. Free'],
          durationSeconds: 12218,
          chapters: [
            { title: 'Chapter 1', startMs: 0 },
            { title: 'Chapter 2', startMs: 804850 },
          ],
        } as BookDockMetadata,
      }),
    );

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSeconds: 12218,
        chapters: [
          { title: 'Chapter 1', startMs: 0 },
          { title: 'Chapter 2', startMs: 804850 },
        ],
      }),
    );
    expect(metadataService.replaceAuthors).toHaveBeenCalledWith(30, [{ name: 'Martha Wells', sortName: null }]);
    expect(metadataService.replaceNarrators).toHaveBeenCalledWith(30, [{ name: 'Kevin R. Free', sortName: null }]);
  });

  it('applyMetadata keeps audio facts from embeddedMetadata even when scalar fields were edited', async () => {
    const { service, db, metadataService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      31,
      makeRow({
        format: 'm4b',
        selectedMetadata: { title: 'Edited Title' } as BookDockMetadata,
        coverPath: null,
        embeddedMetadata: {
          title: 'Original Title',
          durationSeconds: 555,
          narrators: ['Reader One'],
          chapters: [{ title: 'Intro', startMs: 10 }],
        } as BookDockMetadata,
      }),
    );

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Edited Title',
        durationSeconds: 555,
        chapters: [{ title: 'Intro', startMs: 10 }],
      }),
    );
    expect(metadataService.replaceNarrators).toHaveBeenCalledWith(31, [{ name: 'Reader One', sortName: null }]);
  });

  it('applyMetadata omits audio fields and skips narrators when none were extracted', async () => {
    const { service, db, metadataService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      32,
      makeRow({
        selectedMetadata: null,
        coverPath: null,
        embeddedMetadata: { title: 'Just a Book' } as BookDockMetadata,
      }),
    );

    const patch = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('durationSeconds');
    expect(patch).not.toHaveProperty('chapters');
    expect(metadataService.replaceNarrators).not.toHaveBeenCalled();
  });

  it('applyMetadata sanitizes malformed chapters and drops non-positive duration before persisting', async () => {
    const { service, db, metadataService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      33,
      makeRow({
        selectedMetadata: null,
        coverPath: null,
        embeddedMetadata: {
          durationSeconds: 0,
          chapters: [
            { title: 'Good', startMs: 1000 },
            { title: 'NoStart' },
            { title: 'Negative', startMs: -5 },
            { startMs: 2000 },
            'garbage',
            { title: 'Stringy', startMs: '3000.7' },
          ],
        } as unknown as BookDockMetadata,
      }),
    );

    const patch = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('durationSeconds');
    expect(patch.chapters).toEqual([
      { title: 'Good', startMs: 1000 },
      { title: '', startMs: 2000 },
      { title: 'Stringy', startMs: 3001 },
    ]);
    expect(metadataService.replaceNarrators).not.toHaveBeenCalled();
  });

  it('applyMetadata coerces a string-typed duration into a rounded integer', async () => {
    const { service, db } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      34,
      makeRow({
        selectedMetadata: null,
        coverPath: null,
        embeddedMetadata: { durationSeconds: '999.6' } as unknown as BookDockMetadata,
      }),
    );

    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 1000 }));
  });

  it('applyMetadata falls back to extracted cover bytes when cover download is unavailable', async () => {
    const { service, db, metadataService } = makeService();
    metadataService.downloadAndSaveCover.mockResolvedValueOnce(false);
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    mockReadFile.mockResolvedValueOnce(Buffer.from('cover-bytes'));

    await (service as any).applyMetadata(
      21,
      makeRow({
        coverPath: '/tmp/cover.jpg',
        selectedMetadata: { title: 'T', coverUrl: 'https://covers.example/1.jpg' } as BookDockMetadata,
      }),
    );

    expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledWith(21, Buffer.from('cover-bytes'));
  });

  it('cleanupBookDockRecord deletes cover files and bucket row id', async () => {
    const { service, repo } = makeService();
    mockUnlink.mockResolvedValue(undefined);

    await (service as any).cleanupBookDockRecord(makeRow({ id: 44, coverPath: '/tmp/cover.png' }));

    expect(mockUnlink).toHaveBeenCalledWith('/tmp/cover.png');
    expect(mockUnlink).toHaveBeenCalledWith('/tmp/cover_thumb.jpg');
    expect(repo.deleteById).toHaveBeenCalledWith(44);
  });

  it('findLibraryOrFail and findFolderOrFail throw typed errors for invalid destination records', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 9, libraryId: 4, path: '/x' }]);
    db.select.mockReturnValue(selectChain);

    await expect((service as any).findLibraryOrFail(2)).rejects.toBeInstanceOf(NotFoundException);
    await expect((service as any).findFolderOrFail(9, 5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('buildDuplicateLookup collects isbn and title+author keys per library', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where
      .mockResolvedValueOnce([{ bookId: 11, isbn13: '9780306406157' }])
      .mockResolvedValueOnce([{ bookId: 12, isbn10: '0306406152' }])
      .mockResolvedValueOnce([{ bookId: 13, normalizedTitle: 'dune', normalizedAuthor: 'frank herbert' }]);
    db.select.mockReturnValue(selectChain);

    const lookup = await (service as any).buildDuplicateLookup(
      [
        makeRow({ id: 1, targetLibraryId: 5, selectedMetadata: { isbn13: '9780306406157' } }),
        makeRow({ id: 2, targetLibraryId: 5, selectedMetadata: { isbn10: '0306406152' } }),
        makeRow({ id: 3, targetLibraryId: 5, selectedMetadata: { title: 'Dune', authors: ['Frank Herbert'] } }),
      ],
      undefined,
      new Map(),
    );

    expect(lookup.get('library:5|isbn13:9780306406157')).toBe(11);
    expect(lookup.get('library:5|isbn10:0306406152')).toBe(12);
    expect(lookup.get('library:5|title:dune|author:frank herbert')).toBe(13);
  });

  it('buildDuplicateLookup keeps only requested title+author pairs', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockResolvedValueOnce([
      { bookId: 13, normalizedTitle: 'dune', normalizedAuthor: 'frank herbert' },
      { bookId: 14, normalizedTitle: 'dune', normalizedAuthor: 'isaac asimov' },
    ]);
    db.select.mockReturnValue(selectChain);

    const lookup = await (service as any).buildDuplicateLookup(
      [
        makeRow({ id: 1, targetLibraryId: 5, selectedMetadata: { title: 'Dune', authors: ['Frank Herbert'] } }),
        makeRow({ id: 2, targetLibraryId: 5, selectedMetadata: { title: 'Foundation', authors: ['Isaac Asimov'] } }),
      ],
      undefined,
      new Map(),
    );

    expect(lookup.get('library:5|title:dune|author:frank herbert')).toBe(13);
    expect(lookup.get('library:5|title:dune|author:isaac asimov')).toBeUndefined();
  });

  it('findDuplicate queries by isbn and title+author when prebuilt lookup misses', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit.mockResolvedValueOnce([{ bookId: 91 }]).mockResolvedValueOnce([{ bookId: 92 }]);
    db.select.mockReturnValue(selectChain);

    await expect((service as any).findDuplicate(4, { isbn13: '9780306406157', isbn10: null, title: null, authors: [] })).resolves.toBe(91);
    await expect((service as any).findDuplicate(4, { isbn13: null, isbn10: null, title: 'Dune', authors: ['Frank Herbert'] })).resolves.toBe(92);
    await expect((service as any).findDuplicate(4, { isbn13: null, isbn10: null, title: 'Dune', authors: [] })).resolves.toBeNull();
  });

  it('findDuplicate does not treat title-only prebuilt entries as duplicates when author differs', async () => {
    const { service, db } = makeService();
    const selectChain = {
      from: vi.fn(),
      innerJoin: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
    };
    selectChain.from.mockReturnValue(selectChain);
    selectChain.innerJoin.mockReturnValue(selectChain);
    selectChain.where.mockReturnValue(selectChain);
    selectChain.limit.mockResolvedValueOnce([]);
    db.select.mockReturnValue(selectChain);

    const duplicateLookup = new Map([['library:4|title:dune', 77]]);
    await expect(
      (service as any).findDuplicate(4, { isbn13: null, isbn10: null, title: 'Dune', authors: ['Brian Herbert'] }, duplicateLookup),
    ).resolves.toBeNull();
  });

  it('resolveDestination builds names from patterns and falls back to original filename', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPattern.mockResolvedValue(null);
    const rowWithMeta = makeRow({
      fileName: 'original.epub',
      selectedMetadata: { title: 'Dune', seriesIndex: 2.5 } as BookDockMetadata,
    });

    await expect((service as any).resolveDestination({ fileNamingPattern: '{title}-{seriesIndex}' }, '/library', rowWithMeta, 'epub')).resolves.toBe(
      '/library/Dune-02.5.epub',
    );
    await expect((service as any).resolveDestination({ fileNamingPattern: null }, '/library', rowWithMeta, 'epub')).resolves.toBe(
      '/library/original.epub',
    );
  });

  it('resolveDestination uses folder-mode global pattern for book_per_folder libraries', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{title}/');
    const row = makeRow({ fileName: 'book.epub', selectedMetadata: { title: 'Foundation' } as BookDockMetadata });

    await expect(
      (service as any).resolveDestination({ fileNamingPattern: null, organizationMode: 'book_per_folder' }, '/library', row, 'epub'),
    ).resolves.toBe('/library/Foundation/book.epub');
    expect(appSettings.getUploadPatternBookPerFolder).toHaveBeenCalled();
    expect(appSettings.getUploadPattern).not.toHaveBeenCalled();
  });

  it('resolveDestination uses file-mode global pattern for book_per_file libraries', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPattern.mockResolvedValue('{title}.{extension}');
    const row = makeRow({ fileName: 'book.epub', selectedMetadata: { title: 'Foundation' } as BookDockMetadata });

    await expect(
      (service as any).resolveDestination({ fileNamingPattern: null, organizationMode: 'book_per_file' }, '/library', row, 'epub'),
    ).resolves.toBe('/library/Foundation.epub');
    expect(appSettings.getUploadPattern).toHaveBeenCalled();
    expect(appSettings.getUploadPatternBookPerFolder).not.toHaveBeenCalled();
  });

  it('resolveDestination library pattern wins over mode-specific global pattern', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{authors:first}/{title}/');
    const row = makeRow({ fileName: 'book.epub', selectedMetadata: { title: 'Dune' } as BookDockMetadata });

    await expect(
      (service as any).resolveDestination({ fileNamingPattern: '{title}.{extension}', organizationMode: 'book_per_folder' }, '/library', row, 'epub'),
    ).resolves.toBe('/library/Dune.epub');
    expect(appSettings.getUploadPatternBookPerFolder).not.toHaveBeenCalled();
    expect(appSettings.getUploadPattern).not.toHaveBeenCalled();
  });

  it('resolveDestination sanitizes token-derived names when cross-platform mode is enabled', async () => {
    const { service, appSettings } = makeService();
    appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(true);
    const row = makeRow({ fileName: 'book.epub', selectedMetadata: { title: 'AUX', authors: ['CON'] } as BookDockMetadata });

    await expect((service as any).resolveDestination({ fileNamingPattern: '{authors:first}/{title}' }, '/library', row, 'epub')).resolves.toBe(
      '/library/CON_/AUX_.epub',
    );
  });

  it('findDuplicate resolves from prebuilt lookup before querying database', async () => {
    const { service, db } = makeService();
    const duplicateLookup = new Map([['library:4|isbn13:9780306406157', 88]]);

    await expect((service as any).findDuplicate(4, { isbn13: '9780306406157', isbn10: null, title: null }, duplicateLookup)).resolves.toBe(88);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('findDuplicate resolves title+author from prebuilt lookup before querying database', async () => {
    const { service, db } = makeService();
    const duplicateLookup = new Map([['library:4|title:dune|author:frank herbert', 89]]);

    await expect(
      (service as any).findDuplicate(4, { isbn13: null, isbn10: null, title: 'Dune', authors: ['Frank Herbert'] }, duplicateLookup),
    ).resolves.toBe(89);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('triggerAutoFinalize skips when auto-finalize is disabled or destination is incomplete', async () => {
    const { service, appSettings, repo } = makeService();
    appSettings.getAutoFinalizeSettings.mockResolvedValueOnce({
      enabled: false,
      threshold: 80,
      libraryId: 1,
      folderId: 2,
      metadataMode: 'safe_merge',
    });
    appSettings.getAutoFinalizeSettings.mockResolvedValueOnce({
      enabled: true,
      threshold: 80,
      libraryId: null,
      folderId: 2,
      metadataMode: 'safe_merge',
    });

    await service.triggerAutoFinalize(1);
    await service.triggerAutoFinalize(1);

    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('onModuleInit subscribes to ingestion events and triggers auto-finalize callback', async () => {
    const { service, events } = makeService();
    const triggerSpy = vi.spyOn(service, 'triggerAutoFinalize').mockResolvedValue(undefined);

    service.onModuleInit();
    const handler = events.on.mock.calls[0]?.[1] as ((fileId: number) => void) | undefined;
    expect(handler).toBeDefined();
    handler?.(77);
    await (service as any).autoFinalizeQueue.waitForIdle();

    expect(triggerSpy).toHaveBeenCalledWith(77);
  });
});
