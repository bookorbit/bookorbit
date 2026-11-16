vi.mock('fs/promises', () => ({
  access: vi.fn(),
  lstat: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn().mockResolvedValue(undefined),
}));

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { access, lstat, readdir, readFile, stat, unlink } from 'fs/promises';
import { DatabaseError } from 'pg';

import {
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE,
  DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER,
  NotificationType,
  Permission,
  type BookDockMetadata,
} from '@bookorbit/types';
import type { BookDockFileRow } from '../../db/schema/book-dock';
import { BookDockFinalizeService } from './book-dock-finalize.service';
import { joinError } from './book-dock-join.service';

const mockAccess = vi.mocked(access);
const mockLstat = vi.mocked(lstat);
const mockReaddir = vi.mocked(readdir);
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
    findExistingBooksByAbsolutePaths: vi.fn().mockResolvedValue([]),
    findUnitFiles: vi.fn().mockResolvedValue([]),
    deleteById: vi.fn(),
    deleteByIds: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    findLibraryNames: vi.fn((ids: number[]) => Promise.resolve(new Map(ids.map((id) => [id, `Library ${id}`])))),
  };
  const libraryService = {
    verifyAccess: vi.fn().mockResolvedValue(undefined),
  };
  const appSettings = {
    getAutoFinalizeSettings: vi.fn(),
    getUploadPattern: vi.fn().mockResolvedValue(null),
    getUploadPatternBookPerFolder: vi.fn().mockResolvedValue(null),
    isCrossPlatformPathSanitizationEnabled: vi.fn().mockResolvedValue(false),
    getBookRequestImportFormats: vi.fn().mockResolvedValue('all'),
    getBookDockSettings: vi.fn(),
  };
  // Older tests state the global auto-file settings in the shape the service used to read.
  appSettings.getBookDockSettings.mockImplementation(async () => {
    const legacy = ((await appSettings.getAutoFinalizeSettings()) as LegacyAutoFinalizeSettings | undefined) ?? DISABLED_AUTO_FILE;
    return {
      bookDockPath: '/dock',
      autoFetchMetadata: true,
      autoFinalizeEnabled: legacy.enabled,
      autoFinalizeThreshold: legacy.threshold,
      autoFinalizeLibraryId: legacy.libraryId,
      autoFinalizeFolderId: legacy.folderId,
      autoFinalizeMetadataMode: legacy.metadataMode,
      unsortedAutoJoin: false,
      unsortedKeepOriginal: false,
    };
  });
  const metadataService = {
    downloadAndSaveCover: vi.fn().mockResolvedValue(false),
    saveExtractedCoverBytes: vi.fn().mockResolvedValue(undefined),
    coverSlotIsEmpty: vi.fn().mockResolvedValue(true),
    replaceAuthors: vi.fn().mockResolvedValue(undefined),
    replaceGenres: vi.fn().mockResolvedValue(undefined),
    replaceNarrators: vi.fn().mockResolvedValue(undefined),
    upsertComicMetadata: vi.fn().mockResolvedValue(undefined),
    measureMissingAudioDurations: vi.fn().mockResolvedValue({ measured: 0, failed: 0 }),
  };
  const metadataScoreService = {
    calculateAndSave: vi.fn().mockResolvedValue(undefined),
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
    linkToPath: vi.fn().mockResolvedValue('linked'),
  };
  const processor = {
    withFolderBookLock: vi.fn((_libraryId: number, _folderPath: string, work: () => Promise<unknown>) => work()),
    createUnitBookRecords: vi.fn().mockResolvedValue({ bookIds: [101], createdBookIds: [101], attachedFileIds: [] }),
    deleteUnitBookRecords: vi.fn().mockResolvedValue(undefined),
    reconcileCoversAsync: vi.fn(),
  };
  const events = {
    on: vi.fn(),
  };
  const gateway = {
    emitChanged: vi.fn(),
  };
  const processingState = {
    isPaused: vi.fn().mockResolvedValue(false),
    getCachedPaused: vi.fn().mockReturnValue(false),
  };
  const seriesMemberships = {
    replaceForBook: vi.fn().mockResolvedValue(undefined),
    syncPrimaryFromMetadata: vi.fn().mockResolvedValue(undefined),
  };
  const notificationService = {
    notify: vi.fn().mockResolvedValue(undefined),
  };
  const fileWriteService = {
    scheduleWrite: vi.fn(),
  };
  const joinService = {
    resolveRequested: vi.fn(),
    canJoinIn: vi.fn().mockResolvedValue(true),
    suggest: vi.fn().mockResolvedValue(new Map()),
  };
  const dockRegistry = {
    findById: vi.fn().mockResolvedValue(undefined),
    all: vi.fn().mockResolvedValue([]),
  };
  const duplicates = {
    findMatches: vi.fn().mockResolvedValue(new Map()),
  };
  const users = {
    findByIdWithPermissions: vi.fn().mockResolvedValue(makeUploader()),
  };
  const keptFiles = {
    keepsOriginals: vi.fn().mockResolvedValue(false),
    keepOriginalCheck: vi.fn().mockResolvedValue(() => Promise.resolve(false)),
    remember: vi.fn().mockResolvedValue(undefined),
  };
  const digest = { recordFiled: vi.fn(), recordHeld: vi.fn() };

  const service = new BookDockFinalizeService(
    db as never,
    repo as never,
    libraryService as never,
    appSettings as never,
    metadataService as never,
    metadataScoreService as never,
    bookReadService as never,
    validator as never,
    storage as never,
    processor as never,
    events as never,
    gateway as never,
    notificationService as never,
    processingState as never,
    fileWriteService as never,
    dockRegistry as never,
    duplicates as never,
    users as never,
    keptFiles as never,
    digest as never,
    undefined as never,
    seriesMemberships as never,
    undefined as never,
    joinService as never,
  );

  return {
    service,
    db,
    repo,
    libraryService,
    appSettings,
    metadataService,
    metadataScoreService,
    bookReadService,
    validator,
    storage,
    processor,
    events,
    gateway,
    processingState,
    seriesMemberships,
    notificationService,
    fileWriteService,
    joinService,
    dockRegistry,
    duplicates,
    users,
    keptFiles,
    digest,
  };
}

type LegacyAutoFinalizeSettings = {
  enabled: boolean;
  threshold: number;
  libraryId: number | null;
  folderId: number | null;
  metadataMode: 'safe_merge' | 'fetched_only' | 'embedded_only';
};

const DISABLED_AUTO_FILE: LegacyAutoFinalizeSettings = { enabled: false, threshold: 85, libraryId: null, folderId: null, metadataMode: 'safe_merge' };

function makeUploader(overrides: Record<string, unknown> = {}) {
  return { id: 7, active: true, isSuperuser: false, permissions: [Permission.LibraryUpload], contentFilters: {}, ...overrides };
}

type StubLibrary = { id: number; name: string; organizationMode: string };

/**
 * Auto-file runs the real decision but a stubbed preparation and filing: preparation is covered by
 * the `finalizeFile` tests, and these are about what the decision does with its answer.
 */
function stubAutoFile(
  service: BookDockFinalizeService,
  options: { library?: StubLibrary; status?: string; message?: string; existing?: Map<string, number> } = {},
) {
  const library = options.library ?? { id: 5, name: 'Fiction', organizationMode: 'book_per_folder' };
  vi.spyOn(service as never, 'emitChange').mockReturnValue(undefined as never);
  const prepare = vi.spyOn(service as any, 'prepareFinalizeBatch').mockImplementation(((
    rows: Array<{ id: number; fileName: string; absolutePath: string }>,
    _libraryId: number | undefined,
    folderId: number | undefined,
    overrides: Map<number, { joinBook?: { bookId: number; folderPath: string }; folderId?: number }>,
  ) =>
    Promise.resolve({
      analyses: rows.map((row) => {
        const joinBook = overrides.get(row.id)?.joinBook;
        const destPath = joinBook ? `${joinBook.folderPath}/book.epub` : '/library/Author/Title/book.epub';
        if (options.status && options.status !== 'ready') {
          return { fileId: row.id, fileName: row.fileName, row, status: options.status, message: options.message };
        }
        return {
          fileId: row.id,
          fileName: row.fileName,
          row,
          status: 'ready',
          library,
          folder: { id: overrides.get(row.id)?.folderId ?? folderId ?? 9, path: '/library' },
          format: 'epub',
          destPath,
          placement: [{ sourcePath: row.absolutePath, destPath, format: 'epub', role: 'content', sortOrder: 0 }],
          bookFolderPath: '/library/Author/Title',
          ...(joinBook ? { joinBook } : {}),
        };
      }),
      existingDestinations: options.existing ?? new Map<string, number>(),
    })) as never);
  const file = vi
    .spyOn(service as any, 'finalizePreparedCandidate')
    .mockResolvedValue({ fileId: 1, fileName: 'book.epub', success: true, bookId: 42 } as never);
  return { prepare, file };
}

function preparedRow(prepare: ReturnType<typeof stubAutoFile>['prepare'], call = 0) {
  return (prepare.mock.calls[call]?.[0] as Array<{ selectedMetadata: BookDockMetadata | null }> | undefined)?.[0];
}

function makeDock(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    libraryId: 5,
    libraryName: 'Fiction',
    folderName: 'Fiction',
    enabled: true,
    targetFolderId: 9,
    autoFetchMetadata: null,
    autoFinalizeEnabled: null,
    autoFinalizeThreshold: null,
    autoFinalizeMetadataMode: null,
    autoJoin: false,
    keepOriginal: false,
    ...overrides,
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
    uploadedBy: 7,
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
    autoFinalizeSuppressed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A book the shipped default patterns can fill every optional segment of. */
function defaultPatternMetadata(): BookDockMetadata {
  return { title: 'Dune', authors: ['Frank Herbert'], seriesName: 'Dune', seriesIndex: '1', publishedYear: 1965 } as BookDockMetadata;
}

describe('BookDockFinalizeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccess.mockReset();
    mockReadFile.mockReset();
    mockStat.mockReset();
    mockUnlink.mockReset();
    mockLstat.mockReset();
    mockReaddir.mockReset();
    mockAccess.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockLstat.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
    mockReaddir.mockResolvedValue([]);
    mockReadFile.mockResolvedValue(Buffer.from('cover-bytes'));
    mockStat.mockResolvedValue({ size: 100 } as never);
    mockUnlink.mockResolvedValue(undefined);
  });

  describe('triggerAutoFinalize', () => {
    describe('the dock digest (D32)', () => {
      const autoFileOn = { enabled: true, threshold: 85, libraryId: 5, folderId: 9, metadataMode: 'safe_merge' };

      it('adds a book auto-file filed to the digest instead of notifying at once', async () => {
        const { service, repo, appSettings, digest, notificationService } = makeService();
        const row = makeRow();
        appSettings.getAutoFinalizeSettings.mockResolvedValue(autoFileOn);
        repo.findById.mockResolvedValue(row);
        stubAutoFile(service);

        await service.triggerAutoFinalize(row.id);

        expect(digest.recordFiled).toHaveBeenCalledExactlyOnceWith(row, 42);
        expect(digest.recordHeld).not.toHaveBeenCalled();
        expect(notificationService.notify).not.toHaveBeenCalled();
      });

      it('counts a file auto-file leaves waiting once, not each time it looks again', async () => {
        const { service, repo, appSettings, digest } = makeService();
        const row = makeRow({ confidence: 40 });
        appSettings.getAutoFinalizeSettings.mockResolvedValue(autoFileOn);
        repo.findById.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, holdReason: 'low_confidence', holdDetail: { threshold: 85 } });
        stubAutoFile(service);

        await service.triggerAutoFinalize(row.id);
        await service.triggerAutoFinalize(row.id);

        expect(digest.recordHeld).toHaveBeenCalledExactlyOnceWith(row);
      });

      it('counts a file auto-file tried and failed to file', async () => {
        const { service, repo, appSettings, digest } = makeService();
        const row = makeRow();
        appSettings.getAutoFinalizeSettings.mockResolvedValue(autoFileOn);
        repo.findById.mockResolvedValue(row);
        stubAutoFile(service).file.mockResolvedValue({ fileId: 1, fileName: 'book.epub', success: false, message: 'disk full' } as never);

        await service.triggerAutoFinalize(row.id);

        expect(digest.recordHeld).toHaveBeenCalledExactlyOnceWith(row);
        expect(digest.recordFiled).not.toHaveBeenCalled();
      });

      it('counts nothing where auto-file is off, or when an edit is reviewed', async () => {
        const { service, repo, appSettings, digest } = makeService();
        appSettings.getAutoFinalizeSettings.mockResolvedValue({ ...autoFileOn, enabled: false });
        repo.findById.mockResolvedValue(makeRow({ targetLibraryId: 5, targetFolderId: null }));
        stubAutoFile(service);
        await service.triggerAutoFinalize(1);

        appSettings.getAutoFinalizeSettings.mockResolvedValue(autoFileOn);
        repo.findById.mockResolvedValue(makeRow({ confidence: 40 }));
        await (service as any).reviewHold(1);

        expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ holdReason: 'no_folder' }));
        expect(repo.update).toHaveBeenCalledWith(1, expect.objectContaining({ holdReason: 'low_confidence' }));
        expect(digest.recordHeld).not.toHaveBeenCalled();
      });
    });

    it('does not load settings or rows while Book Dock processing is paused', async () => {
      const { service, repo, appSettings, processingState } = makeService();
      processingState.isPaused.mockResolvedValue(true);
      const pauseSpy = vi.spyOn((service as any).autoFinalizeQueue, 'pause');

      await service.triggerAutoFinalize(1);

      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(appSettings.getAutoFinalizeSettings).not.toHaveBeenCalled();
      expect(repo.findById).not.toHaveBeenCalled();
    });

    /**
     * A row another module owns. Racing it would either file the wrong book into the right
     * library or file it before that module's own verification ran, and both fail silently.
     */
    it('skips a row whose finalization another module owns', async () => {
      const { service, repo, appSettings } = makeService();
      const row = makeRow({ autoFinalizeSuppressed: true });

      appSettings.getAutoFinalizeSettings.mockResolvedValue({
        enabled: true,
        threshold: 85,
        libraryId: 5,
        folderId: 9,
        metadataMode: 'safe_merge',
      });
      repo.findById.mockResolvedValue(row);
      const { prepare, file } = stubAutoFile(service);

      await service.triggerAutoFinalize(row.id);

      expect(prepare).not.toHaveBeenCalled();
      expect(file).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
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

      const { prepare, file: finalizeSpy } = stubAutoFile(service);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = preparedRow(prepare);
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

      const { prepare, file: finalizeSpy } = stubAutoFile(service);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      const passedRow = preparedRow(prepare);
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

      const { prepare } = stubAutoFile(service);

      await service.triggerAutoFinalize(row.id);

      const passedRow = preparedRow(prepare);
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

      const { prepare } = stubAutoFile(service);

      await service.triggerAutoFinalize(row.id);

      const passedRow = preparedRow(prepare);
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

      const { file: finalizeSpy } = stubAutoFile(service);

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

      const { file: finalizeSpy } = stubAutoFile(service);

      await service.triggerAutoFinalize(row.id);

      expect(finalizeSpy).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(row.id, { holdReason: 'low_confidence', holdDetail: { threshold: 85 } });
    });

    it('requeueAutoFinalizeCandidates queues every ready row for the auto-file check to decide', async () => {
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

      await expect(service.requeueAutoFinalizeCandidates()).resolves.toBe(2);

      expect(repo.findSelectionBatch).toHaveBeenCalledWith({
        limit: 100,
        afterId: undefined,
        status: 'ready',
        userId: 0,
        canManageAll: true,
      });
      // The row below the threshold is checked too, so it says why it waits.
      expect(enqueueSpy).toHaveBeenCalledWith(1);
      expect(enqueueSpy).toHaveBeenCalledWith(2);
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

  describe('auto-file per dock, holds, duplicates and auto-join', () => {
    const globalOn: LegacyAutoFinalizeSettings = { enabled: true, threshold: 85, libraryId: null, folderId: null, metadataMode: 'safe_merge' };
    const fiction = { libraryId: 5, libraryName: 'Fiction' };

    function setup(
      options: {
        dock?: Record<string, unknown>;
        row?: Record<string, unknown>;
        global?: Partial<LegacyAutoFinalizeSettings>;
        library?: StubLibrary;
        status?: string;
        existing?: Map<string, number>;
      } = {},
    ) {
      const harness = makeService();
      harness.appSettings.getAutoFinalizeSettings.mockResolvedValue({ ...globalOn, ...options.global });
      const dock = makeDock(options.dock);
      harness.dockRegistry.findById.mockImplementation((id: number) => Promise.resolve(id === dock.id ? dock : undefined));
      const row = makeRow({ dockId: 11, targetLibraryId: 5, targetFolderId: 9, holdReason: null, holdDetail: null, ...options.row });
      harness.repo.findById.mockResolvedValue(row);
      return { ...harness, row, dock, ...stubAutoFile(harness.service, options) };
    }

    function match(overrides: Record<string, unknown> = {}) {
      return {
        bookId: 300,
        libraryId: 5,
        libraryFolderId: 4,
        folderPath: '/library/Herbert/Dune',
        storedAsFile: false,
        title: 'Dune',
        reason: 'isbn',
        canTakeFormat: true,
        ...overrides,
      };
    }

    describe('dock settings', () => {
      it("holds a file below its dock's own threshold and says by how much", async () => {
        const { service, repo, file } = setup({ dock: { autoFinalizeThreshold: 95 }, row: { confidence: 90 } });

        await service.triggerAutoFinalize(1);

        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'low_confidence', holdDetail: { confidence: 90, threshold: 95 } });
      });

      it('inherits the global threshold when the dock has none of its own', async () => {
        const { service, file } = setup({ dock: { autoFinalizeThreshold: null }, row: { confidence: 90 } });

        await service.triggerAutoFinalize(1);

        expect(file).toHaveBeenCalledTimes(1);
      });

      it("files with the dock's own metadata mode", async () => {
        const { service, file, prepare } = setup({
          dock: { autoFinalizeMetadataMode: 'embedded_only' },
          row: { confidence: null, fetchedMetadata: { title: 'Fetched Title' } as BookDockMetadata },
        });

        await service.triggerAutoFinalize(1);

        expect(file).toHaveBeenCalledTimes(1);
        expect(preparedRow(prepare)?.selectedMetadata).toEqual({ title: 'Embedded Title', genres: ['Embedded Genre'] });
      });

      it('leaves a dock with auto-file off to a person, with no reason only auto-file would give', async () => {
        const { service, repo, users, file } = setup({ dock: { autoFinalizeEnabled: false }, row: { confidence: 10 } });
        users.findByIdWithPermissions.mockResolvedValue(makeUploader({ permissions: [] }));

        await service.triggerAutoFinalize(1);

        expect(file).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
        expect(users.findByIdWithPermissions).not.toHaveBeenCalled();
      });

      it('files from a dock that turns auto-file on while the global setting is off', async () => {
        const { service, file } = setup({ global: { enabled: false }, dock: { autoFinalizeEnabled: true } });

        await service.triggerAutoFinalize(1);

        expect(file).toHaveBeenCalledTimes(1);
      });

      it('never gives a dock file the global default destination', async () => {
        const { service, repo, prepare } = setup({ global: { libraryId: 5, folderId: 9 }, row: { targetFolderId: null } });

        await service.triggerAutoFinalize(1);

        expect(prepare).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'no_folder', holdDetail: { libraryId: 5, libraryName: 'Library 5' } });
      });

      it('gives an Unsorted file the global default destination only while auto-file is on', async () => {
        const { service, repo, prepare } = setup({
          global: { enabled: false, libraryId: 5, folderId: 9 },
          row: { dockId: null, targetLibraryId: null, targetFolderId: null },
        });

        await service.triggerAutoFinalize(1);

        expect(prepare).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
      });
    });

    describe('the uploader (D24)', () => {
      it('waits for a manager when the uploader may not upload books', async () => {
        const { service, repo, users, file } = setup();
        users.findByIdWithPermissions.mockResolvedValue(makeUploader({ permissions: [] }));

        await service.triggerAutoFinalize(1);

        expect(users.findByIdWithPermissions).toHaveBeenCalledWith(7);
        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'waiting_for_manager', holdDetail: fiction });
      });

      it('waits for a manager when the uploader cannot see the library', async () => {
        const { service, repo, libraryService, file } = setup();
        libraryService.verifyAccess.mockRejectedValue(new ForbiddenException());

        await service.triggerAutoFinalize(1);

        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'waiting_for_manager', holdDetail: fiction });
      });

      it('waits for a manager when the uploader was deactivated or removed', async () => {
        for (const uploader of [makeUploader({ active: false }), null]) {
          const { service, repo, users, file } = setup();
          users.findByIdWithPermissions.mockResolvedValue(uploader);

          await service.triggerAutoFinalize(1);

          expect(file).not.toHaveBeenCalled();
          expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'waiting_for_manager', holdDetail: fiction });
        }
      });

      it('files a superuser upload without the explicit permission', async () => {
        const { service, users, file } = setup();
        users.findByIdWithPermissions.mockResolvedValue(makeUploader({ isSuperuser: true, permissions: [] }));

        await service.triggerAutoFinalize(1);

        expect(file).toHaveBeenCalledTimes(1);
      });

      it('files a file dropped on disk as the system, asking about nobody', async () => {
        const { service, users, libraryService, file } = setup({ row: { uploadedBy: null } });

        await service.triggerAutoFinalize(1);

        expect(users.findByIdWithPermissions).not.toHaveBeenCalled();
        expect(libraryService.verifyAccess).not.toHaveBeenCalled();
        expect(file).toHaveBeenCalledTimes(1);
      });
    });

    describe('hold reasons (D31)', () => {
      it.each([
        ['invalid_format', 'not_allowed_in_library'],
        ['unsupported_layout', 'unsupported_layout'],
        ['invalid_target', 'no_folder'],
      ])('records %s from preparation as %s', async (status, reason) => {
        const { service, repo, file } = setup({ status });

        await service.triggerAutoFinalize(1);

        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: reason, holdDetail: { libraryId: 5, libraryName: 'Library 5' } });
      });

      it('records no reason for a preparation error, which is logged where it happens', async () => {
        const { service, repo, file } = setup({ status: 'error' });

        await service.triggerAutoFinalize(1);

        expect(file).not.toHaveBeenCalled();
        expect(repo.update).not.toHaveBeenCalled();
      });

      it('holds a file whose path already belongs to a book in the library as a duplicate of it', async () => {
        mockAccess.mockResolvedValue(undefined);
        const { service, repo, file } = setup({ existing: new Map([['5\u0000/library/Author/Title/book.epub', 77]]) });

        await service.triggerAutoFinalize(1);

        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'duplicate', holdDetail: { ...fiction, bookId: 77 } });
      });

      it('holds a file whose path is taken by something that is not a book', async () => {
        mockAccess.mockResolvedValue(undefined);
        const { service, repo, file } = setup();

        await service.triggerAutoFinalize(1);

        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'destination_conflict', holdDetail: fiction });
      });

      it('clears a reason that no longer applies, then files', async () => {
        const { service, repo, file } = setup({
          row: { holdReason: 'low_confidence', holdDetail: { confidence: 70, threshold: 85 }, confidence: 90 },
        });

        await service.triggerAutoFinalize(1);

        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: null, holdDetail: null });
        expect(file).toHaveBeenCalledTimes(1);
      });

      it('writes nothing when the reason is unchanged', async () => {
        const { service, repo, gateway } = setup({
          row: { holdReason: 'low_confidence', holdDetail: { confidence: 70, threshold: 85 }, confidence: 70 },
        });

        await service.triggerAutoFinalize(1);

        expect(repo.update).not.toHaveBeenCalled();
        expect(gateway.emitChanged).not.toHaveBeenCalled();
      });

      it('only works out the reason when reviewing, and never files', async () => {
        const { service, repo, file } = setup({
          row: { holdReason: 'low_confidence', holdDetail: { confidence: 70, threshold: 85 }, confidence: 90 },
        });

        service.reviewHolds([1]);
        await (service as any).holdReviewQueue.waitForIdle();

        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: null, holdDetail: null });
        expect(file).not.toHaveBeenCalled();
      });

      it('leaves rows that are not ready, or that another module owns, alone', async () => {
        for (const row of [{ status: 'fetching' }, { autoFinalizeSuppressed: true }]) {
          const { service, repo, prepare } = setup({ row });

          await service.triggerAutoFinalize(1);

          expect(prepare).not.toHaveBeenCalled();
          expect(repo.update).not.toHaveBeenCalled();
        }
      });
    });

    describe('duplicates (D29)', () => {
      it('holds a file the target library already holds, naming the book, and looks only in that library', async () => {
        const { service, repo, duplicates, file } = setup();
        duplicates.findMatches.mockResolvedValue(new Map([[1, [match({ reason: 'title_author' })]]]));

        await service.triggerAutoFinalize(1);

        expect(duplicates.findMatches).toHaveBeenCalledWith([{ fileId: 1, metadata: expect.any(Object), formats: ['epub'] }], [5]);
        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'duplicate', holdDetail: { ...fiction, bookId: 300 } });
      });

      it('files a duplicate a person chose to keep both of', async () => {
        const { service, repo, duplicates, file } = setup({ row: { holdDetail: { keepBoth: true } } });

        await service.triggerAutoFinalize(1);

        expect(duplicates.findMatches).not.toHaveBeenCalled();
        expect(file).toHaveBeenCalledTimes(1);
        expect(repo.update).not.toHaveBeenCalled();
      });

      it('keeps "Keep both" while the file waits for another reason', async () => {
        const { service, repo } = setup({ row: { holdDetail: { keepBoth: true }, confidence: 10 } });

        await service.triggerAutoFinalize(1);

        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'low_confidence', holdDetail: { confidence: 10, threshold: 85, keepBoth: true } });
      });

      it('cannot put a kept duplicate where a book already is, and says so as a path conflict', async () => {
        mockAccess.mockResolvedValue(undefined);
        const { service, repo } = setup({
          row: { holdDetail: { keepBoth: true } },
          existing: new Map([['5\u0000/library/Author/Title/book.epub', 77]]),
        });

        await service.triggerAutoFinalize(1);

        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'destination_conflict', holdDetail: { ...fiction, keepBoth: true } });
      });
    });

    describe('auto-join (D30)', () => {
      it.each(['isbn', 'edition_id', 'work_id'])('adds the file to the book it shares an identifier with (%s)', async (reason) => {
        const { service, duplicates, prepare, file } = setup({ dock: { autoJoin: true } });
        duplicates.findMatches.mockResolvedValue(new Map([[1, [match({ reason })]]]));

        await service.triggerAutoFinalize(1);

        expect(prepare).toHaveBeenCalledTimes(2);
        const override = (prepare.mock.calls[1]?.[3] as Map<number, Record<string, unknown>>).get(1);
        expect(override).toMatchObject({ folderId: 4, joinBook: { bookId: 300, folderPath: '/library/Herbert/Dune', storedAsFile: false } });
        expect(file).toHaveBeenCalledTimes(1);
        expect((file.mock.calls[0]?.[0] as { joinBook?: { bookId: number } }).joinBook?.bookId).toBe(300);
      });

      it.each([
        ['on a title and author alone', { match: { reason: 'title_author' } }],
        ['into a book that already has the format', { match: { canTakeFormat: false } }],
        ['in a library that keeps one book per file', { library: { id: 5, name: 'Fiction', organizationMode: 'book_per_file' } }],
        ['while the dock has auto-join off', { dock: { autoJoin: false } }],
        ['while the dock has auto-file off', { dock: { autoJoin: true, autoFinalizeEnabled: false } }],
      ])('never joins %s, and holds the duplicate instead', async (_label, variant: Record<string, any>) => {
        const { service, repo, duplicates, prepare, file } = setup({ dock: { autoJoin: true, ...variant.dock }, library: variant.library });
        duplicates.findMatches.mockResolvedValue(new Map([[1, [match(variant.match)]]]));

        await service.triggerAutoFinalize(1);

        expect(prepare).toHaveBeenCalledTimes(1);
        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'duplicate', holdDetail: { ...fiction, bookId: 300 } });
      });

      it('does not join for an uploader who may not edit the library', async () => {
        const { service, repo, duplicates, joinService, file } = setup({ dock: { autoJoin: true } });
        duplicates.findMatches.mockResolvedValue(new Map([[1, [match()]]]));
        joinService.canJoinIn.mockResolvedValue(false);

        await service.triggerAutoFinalize(1);

        expect(joinService.canJoinIn).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), expect.objectContaining({ id: 7 }), expect.any(Map));
        expect(file).not.toHaveBeenCalled();
        expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'duplicate', holdDetail: { ...fiction, bookId: 300 } });
      });

      it('holds the duplicate when the join fails as it files', async () => {
        const { service, repo, duplicates, file } = setup({ dock: { autoJoin: true } });
        duplicates.findMatches.mockResolvedValue(new Map([[1, [match()]]]));
        file.mockResolvedValue({ fileId: 1, fileName: 'book.epub', success: false, message: 'no' } as never);

        await service.triggerAutoFinalize(1);

        expect(repo.update).toHaveBeenLastCalledWith(1, { holdReason: 'duplicate', holdDetail: { ...fiction, bookId: 300 } });
      });
    });
  });

  describe('finalize', () => {
    it('returns missing-row failures for explicit ids not found in repository', async () => {
      const { service, repo, notificationService } = makeService();
      const rowOne = makeRow({ id: 1 });
      repo.findByIds.mockResolvedValue([rowOne]);
      vi.spyOn(service as never, 'prepareFinalizeBatch').mockResolvedValue({
        analyses: [{ fileId: 1, fileName: 'book.epub', row: rowOne, status: 'ready' }],
        existingDestinations: new Map(),
      } as never);
      vi.spyOn(service as never, 'finalizePreparedCandidate').mockResolvedValueOnce({
        fileId: 1,
        fileName: 'book.epub',
        success: true,
        bookId: 101,
      } as never);
      vi.spyOn(service as never, 'emitChange').mockReturnValue(undefined as never);

      const result = await service.finalize(7, true, true, [1, 2], false, [], 5, 9);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.results[1]).toEqual(
        expect.objectContaining({
          fileId: 2,
          success: false,
          message: 'Library Dock file not found',
        }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.BookDockFinalizedWithErrors,
          title: 'Library Dock finalization completed with errors',
        }),
      );
    });

    it('iterates selectAll batches until no rows remain', async () => {
      const { service, repo } = makeService();
      repo.findSelectionBatch.mockResolvedValueOnce([makeRow({ id: 1 }), makeRow({ id: 2 })]).mockResolvedValueOnce([]);
      vi.spyOn(service as never, 'prepareFinalizeBatch').mockImplementation(
        (rows: unknown[]) =>
          Promise.resolve({
            analyses: rows.map((row: any) => ({ fileId: row.id, fileName: row.fileName, row, status: 'ready' })),
            existingDestinations: new Map(),
          }) as never,
      );
      vi.spyOn(service as never, 'finalizePreparedCandidate').mockImplementation(
        (analysis: any) =>
          Promise.resolve({
            fileId: analysis.fileId,
            fileName: analysis.fileName,
            success: true,
            bookId: analysis.fileId + 9,
          }) as never,
      );
      vi.spyOn(service as never, 'emitChange').mockReturnValue(undefined as never);

      const result = await service.finalize(7, true, true, [], true, [], 5, 9, [], undefined, 'foo', undefined, true, undefined, { dock: 4 });

      expect(repo.findSelectionBatch).toHaveBeenCalledTimes(2);
      expect(repo.findSelectionBatch).toHaveBeenCalledWith(expect.objectContaining({ readyToFile: true, filter: { dock: 4 } }));
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

    it('marks an occupied indexed destination as a duplicate', async () => {
      const { service, repo } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new.epub' as never);
      repo.findExistingBooksByAbsolutePaths.mockResolvedValue([{ absolutePath: '/library/new.epub', bookId: 77, libraryId: 5 }]);
      mockAccess.mockResolvedValueOnce(undefined as never);

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

    it('allows a stale indexed destination when the physical file is missing', async () => {
      const { service, repo, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_file',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/stale.epub' as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      repo.findExistingBooksByAbsolutePaths.mockResolvedValue([{ absolutePath: '/library/stale.epub', bookId: 77, libraryId: 5 }]);
      mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValueOnce({ size: 100 } as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [77], createdBookIds: [77], attachedFileIds: [] });

      const result = await (service as any).finalizeFile(
        makeRow({ targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        new Map(),
        1,
        true,
      );

      expect(result).toMatchObject({ success: true, bookId: 77 });
      expect(result).not.toHaveProperty('isDuplicate');
    });

    it('rolls back moved files and reports failure when book record creation fails', async () => {
      const { service, storage, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/new/book.epub' as never);
      mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValueOnce({ size: 321 } as never);
      processor.createUnitBookRecords.mockRejectedValueOnce(new Error('create failed'));

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
      mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValueOnce({ size: 321 } as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [808], createdBookIds: [808], attachedFileIds: [] });
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
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValueOnce({ size: 100 } as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [555], createdBookIds: [555], attachedFileIds: [] });

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toEqual({
        fileId: 1,
        fileName: 'book.epub',
        newName: 'new/book.epub',
        success: true,
        bookId: 555,
      });
      expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
        {
          folderPath: '/library/new',
          absolutePath: '/library/new/book.epub',
          relPath: 'new/book.epub',
          format: 'epub',
          sizeBytes: 100,
          role: 'content',
          sortOrder: 0,
        },
      ]);
    });

    describe('as another format of an existing book', () => {
      const joinBook = { bookId: 42, folderPath: '/library/Frank Herbert/Dune' };

      function stubFolderLibrary(service: BookDockFinalizeService, organizationMode = 'book_per_folder') {
        vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
          id: 5,
          allowedFormats: [],
          fileNamingPattern: null,
          organizationMode,
        } as never);
        vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
        vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Frank Herbert/Dune (Unabridged)/Dune (Unabridged).m4b' as never);
        vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      }

      const audioRow = () => makeRow({ fileName: 'dune.m4b', absolutePath: '/tmp/dune.m4b', format: 'm4b', targetLibraryId: 5, targetFolderId: 9 });

      it("lands in the book's own folder under the pattern's file name, so the two formats are one book", async () => {
        const { service, processor, storage } = makeService();
        stubFolderLibrary(service);
        const applyMetadata = vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
        const applyJoined = vi.spyOn(service as never, 'applyJoinedMetadata').mockResolvedValue(undefined as never);
        mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        mockStat.mockResolvedValueOnce({ size: 100 } as never);
        processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [42], createdBookIds: [], attachedFileIds: [900] });

        await expect((service as any).finalizeFile(audioRow(), undefined, undefined, new Map([[1, { joinBook }]]), 1, true)).resolves.toMatchObject({
          success: true,
          bookId: 42,
        });

        expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/dune.m4b', '/library/Frank Herbert/Dune/Dune (Unabridged).m4b');
        expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
          expect.objectContaining({ folderPath: '/library/Frank Herbert/Dune', absolutePath: '/library/Frank Herbert/Dune/Dune (Unabridged).m4b' }),
        ]);
        // The book keeps the title and authors it already had.
        expect(applyJoined).toHaveBeenCalledWith(42, expect.objectContaining({ id: 1 }), null, null);
        expect(applyMetadata).not.toHaveBeenCalled();
      });

      /** Issue 1757: an audiobook joining an ebook was filed with no duration, so listening stayed at 0%. */
      it('measures the audio durations of the book it joined', async () => {
        const { service, processor, metadataService } = makeService();
        stubFolderLibrary(service);
        vi.spyOn(service as never, 'applyJoinedMetadata').mockResolvedValue(undefined as never);
        mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        mockStat.mockResolvedValueOnce({ size: 100 } as never);
        processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [42], createdBookIds: [], attachedFileIds: [900] });

        await (service as any).finalizeFile(audioRow(), undefined, undefined, new Map([[1, { joinBook }]]), 1, true);

        expect(metadataService.measureMissingAudioDurations.mock.calls).toEqual([[42]]);
      });

      it('files the ordinary way in a library where a book is a single file', async () => {
        const { service, storage } = makeService();
        stubFolderLibrary(service, 'book_per_file');
        vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
        mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        mockStat.mockResolvedValueOnce({ size: 100 } as never);

        await (service as any).finalizeFile(audioRow(), undefined, undefined, new Map([[1, { joinBook }]]), 1, true);

        expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/dune.m4b', '/library/Frank Herbert/Dune (Unabridged)/Dune (Unabridged).m4b');
      });

      it('refuses to place anything outside the folder being filed into', async () => {
        const { service, storage } = makeService();
        stubFolderLibrary(service);
        vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
        mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        mockStat.mockResolvedValueOnce({ size: 100 } as never);

        await (service as any).finalizeFile(
          audioRow(),
          undefined,
          undefined,
          new Map([[1, { joinBook: { bookId: 42, folderPath: '/elsewhere/Dune' } }]]),
          1,
          true,
        );

        expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/dune.m4b', '/library/Frank Herbert/Dune (Unabridged)/Dune (Unabridged).m4b');
      });

      /** The book a format joins, as `applyJoinedMetadata` reads it: its audio facts and locks, then whether it has narrators. */
      function mockJoinedBook(
        db: ReturnType<typeof makeService>['db'],
        current: { lockedFields?: string[]; durationSeconds?: number | null; abridged?: boolean | null; chapters?: unknown } = {},
        hasNarrators = false,
      ) {
        const chain = (rows: unknown[]) => {
          const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue(rows) };
          query.from.mockReturnValue(query);
          query.where.mockReturnValue(query);
          return query;
        };
        db.select
          .mockReturnValueOnce(chain([{ lockedFields: [], durationSeconds: null, abridged: null, chapters: null, ...current }]))
          .mockReturnValueOnce(chain(hasNarrators ? [{ bookId: 42 }] : []));
        const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
        db.update.mockReturnValue({ set });
        return set;
      }

      it('adds identifiers and audio facts the book lacks without overwriting what it already says', async () => {
        const { service, db, metadataService } = makeService();
        const set = mockJoinedBook(db, { durationSeconds: 3600, lockedFields: ['goodreadsId'] });
        const row = makeRow({
          format: 'm4b',
          embeddedMetadata: { durationSeconds: 9999, abridged: true, narrators: ['Simon Vance'] } as unknown as BookDockMetadata,
          selectedMetadata: {
            title: 'Dune (Unabridged)',
            authors: ['Simon Vance'],
            audibleId: 'B002V1OF70',
            goodreadsId: 'gr-1',
          } as BookDockMetadata,
        });

        await (service as any).applyJoinedMetadata(42, row, null, null);

        const patch = set.mock.calls[0]![0] as Record<string, unknown>;
        expect(patch).toHaveProperty('audibleId');
        expect(patch).toHaveProperty('abridged', true);
        expect(patch).not.toHaveProperty('goodreadsId');
        expect(patch).not.toHaveProperty('durationSeconds');
        expect(patch).not.toHaveProperty('title');
        expect(metadataService.replaceAuthors).not.toHaveBeenCalled();
        expect(metadataService.replaceNarrators).toHaveBeenCalledWith(42, [{ name: 'Simon Vance', sortName: null }]);
      });

      it('keeps the narrators a book already has, and any it has locked', async () => {
        const row = makeRow({ format: 'm4b', embeddedMetadata: { narrators: ['Simon Vance'] } as unknown as BookDockMetadata });

        const existing = makeService();
        mockJoinedBook(existing.db, {}, true);
        await (existing.service as any).applyJoinedMetadata(42, row, null, null);
        expect(existing.metadataService.replaceNarrators).not.toHaveBeenCalled();

        const locked = makeService();
        mockJoinedBook(locked.db, { lockedFields: ['narrators'] });
        await (locked.service as any).applyJoinedMetadata(42, row, null, null);
        expect(locked.metadataService.replaceNarrators).not.toHaveBeenCalled();
      });

      it('uses a cover picked in the Book Dock for this file as it is', async () => {
        const { service, db, metadataService } = makeService();
        mockJoinedBook(db);
        metadataService.downloadAndSaveCover.mockResolvedValueOnce(true);
        const row = makeRow({
          format: 'm4b',
          coverPath: '/dock/covers/1.jpg',
          selectedMetadata: { title: 'Dune', coverUrl: 'https://covers.example/picked.jpg' } as BookDockMetadata,
        });

        await (service as any).applyJoinedMetadata(42, row, 'https://covers.example/requested.jpg', null);

        expect(metadataService.downloadAndSaveCover).toHaveBeenCalledTimes(1);
        expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith([{ url: 'https://covers.example/picked.jpg' }], 42, 'audio', {
          userChosen: true,
        });
        expect(metadataService.saveExtractedCoverBytes).not.toHaveBeenCalled();
      });

      /**
       * The dock's lookup does not know the file is the other format of a book it already has, so for
       * an audiobook it can answer with the ebook's portrait jacket. The file's own art goes in first,
       * and the looked-up cover replaces it only if it fits the slot, which the download checks.
       */
      it("fills the new format's slot from the file's own art first, and offers the looked-up cover only to replace it if it fits", async () => {
        const { service, db, metadataService } = makeService();
        mockJoinedBook(db);
        mockReadFile.mockResolvedValueOnce(Buffer.from('square-art') as never);
        const row = makeRow({ format: 'm4b', coverPath: '/dock/covers/1.jpg', selectedMetadata: { title: 'Dune' } as BookDockMetadata });

        await (service as any).applyJoinedMetadata(42, row, 'https://covers.example/requested-square.jpg', 'https://covers.example/looked-up.jpg');

        expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledWith(42, Buffer.from('square-art'), 'audio');
        expect(metadataService.downloadAndSaveCover).toHaveBeenCalledTimes(1);
        expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith([{ url: 'https://covers.example/looked-up.jpg' }], 42, 'audio');
      });

      it("falls back to the cover chosen when the format was requested, held to the slot's shape", async () => {
        const { service, db, metadataService } = makeService();
        mockJoinedBook(db);
        const row = makeRow({ format: 'm4b', coverPath: null, selectedMetadata: { title: 'Dune' } as BookDockMetadata });

        await (service as any).applyJoinedMetadata(42, row, 'https://covers.example/requested-square.jpg', null);

        expect(metadataService.downloadAndSaveCover).toHaveBeenCalledTimes(1);
        expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith([{ url: 'https://covers.example/requested-square.jpg' }], 42, 'audio');
      });

      it('leaves a cover the book already holds for this medium, a dormant custom one included', async () => {
        const { service, db, metadataService } = makeService();
        mockJoinedBook(db);
        metadataService.coverSlotIsEmpty.mockResolvedValueOnce(false);
        mockReadFile.mockResolvedValueOnce(Buffer.from('square-art') as never);
        const row = makeRow({ format: 'm4b', coverPath: '/dock/covers/1.jpg', selectedMetadata: { title: 'Dune' } as BookDockMetadata });

        await (service as any).applyJoinedMetadata(42, row, 'https://covers.example/requested.jpg', 'https://covers.example/looked-up.jpg');

        expect(metadataService.coverSlotIsEmpty).toHaveBeenCalledWith(42, 'audio');
        expect(metadataService.saveExtractedCoverBytes).not.toHaveBeenCalled();
        expect(metadataService.downloadAndSaveCover).not.toHaveBeenCalled();
      });
    });

    it('files a book_per_file book under the pattern folders instead of the library root', async () => {
      const { service, appSettings, processor, storage } = makeService();
      appSettings.getUploadPattern.mockResolvedValue(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE);
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_file',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockStat.mockResolvedValueOnce({ size: 100 } as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [557], createdBookIds: [557], attachedFileIds: [] });
      const row = makeRow({ targetLibraryId: 5, targetFolderId: 9, selectedMetadata: defaultPatternMetadata() });
      const destPath = '/library/Frank Herbert/Dune/01. Dune (1965).epub';

      await expect((service as any).finalizeFile(row, undefined, undefined, new Map(), 1, true)).resolves.toEqual({
        fileId: 1,
        fileName: 'book.epub',
        newName: 'Frank Herbert/Dune/01. Dune (1965).epub',
        success: true,
        bookId: 557,
      });
      expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/book.epub', destPath);
      expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
        {
          folderPath: destPath,
          absolutePath: destPath,
          relPath: 'Frank Herbert/Dune/01. Dune (1965).epub',
          format: 'epub',
          sizeBytes: 100,
          role: 'content',
          sortOrder: 0,
        },
      ]);
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
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValueOnce({ size: 100 } as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [556], createdBookIds: [556], attachedFileIds: [] });

      await expect(
        (service as any).finalizeFile(makeRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 1, true),
      ).resolves.toMatchObject({ success: true, bookId: 556 });
      expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
        {
          folderPath: '/library/new/book.epub',
          absolutePath: '/library/new/book.epub',
          relPath: 'new/book.epub',
          format: 'epub',
          sizeBytes: 100,
          role: 'content',
          sortOrder: 0,
        },
      ]);
      // Each file is its own book here, so there is no shared folder whose book needs locking.
      expect(processor.withFolderBookLock).not.toHaveBeenCalled();
    });

    it.each(['book_per_folder', 'book_per_file'])('keeps unrelated root imports separate in %s mode', async (organizationMode) => {
      const { service, processor, storage } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: '<{title}|{originalFilename}> - <{authors:first}> - <{year}>',
        organizationMode,
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      const applyMetadata = vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValue({ size: 100 } as never);

      for (const [index, title] of ['First Book', 'Second Book'].entries()) {
        processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [101 + index], createdBookIds: [101 + index], attachedFileIds: [] });
        const row = makeRow({
          id: index + 1,
          targetLibraryId: 5,
          targetFolderId: 9,
          selectedMetadata: { title, authors: ['Test Author'], publishedYear: 2024 },
        });
        const result = await (service as any).finalizeFile(row, undefined, undefined, new Map(), 1, true);

        expect(result).toMatchObject({ success: true, bookId: 101 + index, newName: `${title} - Test Author - 2024.epub` });
        const destPath = `/library/${title} - Test Author - 2024.epub`;
        expect(storage.moveToPath).toHaveBeenNthCalledWith(index + 1, row.absolutePath, destPath);
        expect(processor.createUnitBookRecords).toHaveBeenNthCalledWith(index + 1, 5, 9, [
          expect.objectContaining({ folderPath: destPath, absolutePath: destPath }),
        ]);
        expect(applyMetadata).toHaveBeenNthCalledWith(index + 1, 101 + index, row, true, null);
      }
    });

    it('uses the persisted filename spelling for a root book identity', async () => {
      const { service, processor } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_folder',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValue({ size: 100 } as never);
      mockLstat.mockResolvedValue({} as never);
      mockReaddir.mockResolvedValue(['dune.epub'] as never);

      const result = await (service as any).finalizeFile(
        makeRow({ targetLibraryId: 5, targetFolderId: 9, selectedMetadata: { title: 'Dune' } }),
        undefined,
        undefined,
        new Map(),
        1,
        true,
      );

      expect(result).toMatchObject({ success: true, newName: 'dune.epub' });
      expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
        expect.objectContaining({ folderPath: '/library/dune.epub', absolutePath: '/library/dune.epub' }),
      ]);
    });

    describe('organization modes', () => {
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
        mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        mockStat.mockResolvedValueOnce({ size: 1024 } as never);
        processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [42], createdBookIds: [42], attachedFileIds: [] });

        const overrideMap = new Map([[7, { libraryId: 5, folderId: 9 }]]);
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
        expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
          {
            folderPath: '/library/Author/Dune',
            absolutePath: '/library/Author/Dune/Dune.pdf',
            relPath: 'Author/Dune/Dune.pdf',
            format: 'pdf',
            sizeBytes: 1024,
            role: 'content',
            sortOrder: 0,
          },
        ]);
      });

      it('creates a separate book record in book_per_file mode', async () => {
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
        mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        mockStat.mockResolvedValueOnce({ size: 2048 } as never);
        processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [300], createdBookIds: [300], attachedFileIds: [] });

        const overrideMap = new Map([[8, { libraryId: 6, folderId: 10 }]]);
        const result = await (service as any).finalizeFile(
          makeRow({ id: 8, fileName: 'Dune.pdf', format: 'pdf', absolutePath: '/tmp/Dune.pdf', targetLibraryId: 6, targetFolderId: 10 }),
          undefined,
          undefined,
          overrideMap,
          1,
          true,
          { role: 'content', sortOrder: 0 },
        );

        expect(result).toMatchObject({ success: true, bookId: 300 });
        // book_per_file: folderPath = destPath itself (each file is its own book)
        expect(processor.createUnitBookRecords).toHaveBeenCalledWith(6, 10, [
          {
            folderPath: '/library2/Dune.pdf',
            absolutePath: '/library2/Dune.pdf',
            relPath: 'Dune.pdf',
            format: 'pdf',
            sizeBytes: 2048,
            role: 'content',
            sortOrder: 0,
          },
        ]);
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
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValueOnce({ size: 993 } as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [500], createdBookIds: [500], attachedFileIds: [] });

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
      expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
        {
          folderPath: '/library/Unknown Author/1',
          absolutePath: '/library/Unknown Author/1/1_alt.epub',
          relPath: 'Unknown Author/1/1_alt.epub',
          format: 'epub',
          sizeBytes: 993,
          role: 'content',
          sortOrder: 0,
        },
      ]);
    });

    it('classifies an occupied indexed renamed destination as a duplicate', async () => {
      const { service, repo } = makeService();
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        allowedFormats: ['epub'],
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Unknown Author/1/1.epub' as never);
      repo.findExistingBooksByAbsolutePaths.mockResolvedValue([{ absolutePath: '/library/Unknown Author/1/1_alt.epub', bookId: 77, libraryId: 5 }]);
      mockAccess.mockResolvedValueOnce(undefined as never);

      const overrideMap = new Map([[1, { libraryId: 5, folderId: 9, targetFileName: '1_alt' }]]);
      const result = await (service as any).finalizeFile(
        makeRow({ id: 1, fileName: '1.epub', format: 'epub', targetLibraryId: 5, targetFolderId: 9 }),
        undefined,
        undefined,
        overrideMap,
        1,
        true,
        { role: 'content', sortOrder: 0 },
      );

      expect(result).toMatchObject({
        success: false,
        isDuplicate: true,
        existingBookId: 77,
      });
      expect(repo.findExistingBooksByAbsolutePaths).toHaveBeenCalledWith(['/library/Unknown Author/1/1_alt.epub']);
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
      const row = makeRow({ id: 4, targetLibraryId: 5, targetFolderId: 9 });
      const prepareSpy = vi.spyOn(service as never, 'prepareFinalizeBatch').mockResolvedValue({
        analyses: [{ fileId: 4, fileName: '1.epub', row, status: 'ready' }],
        existingDestinations: new Map(),
      } as never);
      vi.spyOn(service as never, 'finalizePreparedCandidate').mockResolvedValue({
        fileId: 4,
        fileName: '1.epub',
        success: true,
        bookId: 99,
      } as never);
      vi.spyOn(service as never, 'emitChange').mockReturnValue(undefined as never);

      await service.finalize(1, true, true, [4], false, [], 5, 9, [{ fileId: 4, targetFileName: '1_alt' }]);

      const overrideMapPassed = prepareSpy.mock.calls[0]?.[3] as Map<number, unknown>;
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
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValueOnce({ size: 200 } as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [600], createdBookIds: [600], attachedFileIds: [] });

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
      expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [
        {
          folderPath: '/library/Author/Title',
          absolutePath: '/library/Author/Title/Title (alt).epub',
          relPath: 'Author/Title/Title (alt).epub',
          format: 'epub',
          sizeBytes: 200,
          role: 'content',
          sortOrder: 0,
        },
      ]);
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
        { role: 'content', sortOrder: 0 },
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
      repo.findExistingBooksByAbsolutePaths.mockResolvedValue([{ absolutePath: '/library/duplicate.epub', bookId: 77, libraryId: 5 }]);
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockImplementation((_, __, row: { fileName: string }) =>
        Promise.resolve(`/library/${row.fileName}`),
      );
      mockAccess.mockImplementation((path) => {
        if (String(path).includes('ready.epub')) {
          return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' })) as never;
        }
        return Promise.resolve(undefined) as never;
      });

      const preview = await service.previewFinalize(1, true, true, [1, 2, 3], false, [], undefined, undefined);

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
      expect(repo.findExistingBooksByAbsolutePaths).toHaveBeenCalledTimes(1);
      expect(repo.findExistingBooksByAbsolutePaths).toHaveBeenCalledWith([
        '/library/duplicate.epub',
        '/library/conflict.epub',
        '/library/ready.epub',
      ]);
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
      repo.findExistingBooksByAbsolutePaths.mockResolvedValue([{ absolutePath: '/library/duplicate.epub', bookId: 77, libraryId: 5 }]);
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({ id: 5, allowedFormats: ['epub'], fileNamingPattern: null } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockImplementation((_, __, row: { fileName: string }) =>
        Promise.resolve(`/library/${row.fileName}`),
      );
      mockAccess.mockImplementation((path) => {
        if (String(path).includes('ready.epub')) {
          return Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' })) as never;
        }
        return Promise.resolve(undefined) as never;
      });

      const result = await service.discardDuplicateCandidates(1, true, true, [1, 2, 3], false, [], undefined, undefined);

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

  it('previewNames marks a read-aloud EPUB and uses the same destination for finalization', async () => {
    const { service, repo, db } = makeService();
    const row = makeRow({ id: 1, targetLibraryId: 10, selectedMetadata: { title: 'Dune' } as BookDockMetadata });
    const library = { id: 10, name: 'Books', fileNamingPattern: '{title}< ({readaloud})>', organizationMode: 'book_per_file' };
    repo.findByIds.mockResolvedValue([row]);
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([library]),
      }),
    });
    const inspect = vi.spyOn(service as any, 'inspectMediaOverlayAvailable').mockResolvedValue(true);

    const [preview] = await service.previewNames([1], false, [], undefined, 1, true);
    const destination = await (service as any).resolveDestination(library, '/library', row, 'epub');

    expect(preview.newName).toBe('Dune (readaloud).epub');
    expect(destination).toBe('/library/Dune (readaloud).epub');
    expect(inspect).toHaveBeenCalledTimes(2);
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

  it.each([
    ['book_per_file', DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE, 'Frank Herbert/Dune/01. Dune (1965).epub'],
    ['book_per_folder', DEFAULT_UPLOAD_PATTERN_BOOK_PER_FOLDER, 'Frank Herbert/Dune/01. Dune (1965)/01. Dune (1965).epub'],
  ])('previewNames promises the destination finalize actually uses for a %s library', async (organizationMode, pattern, expected) => {
    const { service, repo, appSettings, db } = makeService();
    const library = { id: 10, name: 'Books', fileNamingPattern: null, organizationMode };
    const row = makeRow({ id: 1, targetLibraryId: 10, selectedMetadata: defaultPatternMetadata() });
    repo.findByIds.mockResolvedValue([row]);
    appSettings.getUploadPattern.mockResolvedValue(organizationMode === 'book_per_file' ? pattern : null);
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue(organizationMode === 'book_per_folder' ? pattern : null);
    db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([library]),
      }),
    });

    const [preview] = await service.previewNames([1], false, [], undefined, 1, true);
    const destPath = await (service as any).resolveDestination(library, '/library', row, 'epub');

    expect(preview.newName).toBe(expected);
    expect(destPath).toBe(`/library/${preview.newName}`);
  });

  it('applyMetadata updates scalar metadata fields and related author/genre rows', async () => {
    const { service, db, metadataService, metadataScoreService } = makeService();
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
        seriesIndex: '2.5',
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
        seriesIndex: '2.5',
      }),
    );
    expect(metadataService.replaceAuthors).toHaveBeenCalledWith(15, [{ name: 'Author A', sortName: null }]);
    expect(metadataService.replaceGenres).toHaveBeenCalledWith(15, ['Fantasy']);
    expect(metadataScoreService.calculateAndSave).toHaveBeenCalledWith(15);
  });

  it('applyMetadata propagates score persistence failures', async () => {
    const { service, db, metadataScoreService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    metadataScoreService.calculateAndSave.mockRejectedValue(new Error('score failed'));

    await expect((service as any).applyMetadata(15, makeRow())).rejects.toThrow('score failed');
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

  it('applyMetadata preserves legacy fetched duration and strips rating timestamps during finalization', async () => {
    const { service, db, bookReadService } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      18,
      makeRow({
        coverPath: null,
        selectedMetadata: {
          title: "Harry Potter and the Sorcerer's Stone",
          duration: 31260,
          communityRatings: [
            {
              provider: 'audible',
              rating: 4.78,
              ratingCount: 16077,
              updatedAt: '2026-07-22T05:10:27.373Z',
            },
          ],
        } as unknown as BookDockMetadata,
      }),
    );

    expect(updateChain.set).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 31260 }));
    expect(bookReadService.replaceCommunityRatings).toHaveBeenCalledWith(18, [{ provider: 'audible', rating: 4.78, ratingCount: 16077 }]);
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
            { seriesName: 'Dune', seriesIndex: '1' },
            { seriesName: 'Dune Chronicles', seriesIndex: '1' },
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
      { seriesName: 'Dune', seriesIndex: '1' },
      { seriesName: 'Dune Chronicles', seriesIndex: '1' },
    ]);
    expect(bookReadService.replaceCommunityRatings).toHaveBeenCalledWith(19, [{ provider: 'hardcover', rating: 4.5, ratingCount: 1000 }]);
    expect(metadataService.upsertComicMetadata).toHaveBeenCalledWith(19, { issueNumber: '1', pencillers: ['Artist'] });
    expect(metadataService.replaceNarrators).toHaveBeenCalledWith(19, [{ name: 'Simon Vance', sortName: null }]);
  });

  it.each([
    {
      case: 'a corrected series name',
      seriesName: 'The Expanse',
      seriesIndex: '3',
      stored: [
        { seriesName: 'Expanse', seriesIndex: '3' },
        { seriesName: 'Expanse Universe', seriesIndex: '5' },
      ],
      expected: [
        { seriesName: 'The Expanse', seriesIndex: '3' },
        { seriesName: 'Expanse Universe', seriesIndex: '5' },
      ],
    },
    {
      case: 'a secondary series chosen as the series',
      seriesName: 'Dune Chronicles',
      seriesIndex: '2',
      stored: [
        { seriesName: 'Dune', seriesIndex: '1' },
        { seriesName: 'dune chronicles', seriesIndex: '1' },
        { seriesName: 'Dune Universe', seriesIndex: '7' },
      ],
      expected: [
        { seriesName: 'Dune Chronicles', seriesIndex: '2' },
        { seriesName: 'Dune Universe', seriesIndex: '7' },
      ],
    },
    {
      case: 'the series name when the provider list was cleared',
      seriesName: 'Dune',
      seriesIndex: '1',
      stored: null,
      expected: [{ seriesName: 'Dune', seriesIndex: '1' }],
    },
  ])('applyMetadata files $case in place of the provider primary series', async ({ seriesName, seriesIndex, stored, expected }) => {
    const { service, db, seriesMemberships } = makeService();
    const updateChain = {
      set: vi.fn(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);

    await (service as any).applyMetadata(
      20,
      makeRow({
        coverPath: null,
        selectedMetadata: { title: 'Leviathan Wakes', seriesName, seriesIndex, seriesMemberships: stored } as BookDockMetadata,
      }),
    );

    expect(seriesMemberships.replaceForBook).toHaveBeenCalledWith(20, expected);
    expect(seriesMemberships.syncPrimaryFromMetadata).not.toHaveBeenCalled();
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

    expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith([{ url: 'https://covers.example/1.jpg' }], 20, 'ebook', { userChosen: true });
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
      { title: 'Chapter 2', startMs: 2000 },
      { title: 'Stringy', startMs: 3001 },
    ]);
    expect(patch).toMatchObject({ chaptersSource: 'embedded', chaptersUpdatedAt: expect.any(Date), chaptersUpdatedBy: null });
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

  it('applyMetadata writes the staged cover of an audiobook into the audio slot, and never into a sibling book', async () => {
    const { service, db, metadataService } = makeService();
    const updateChain = { set: vi.fn(), where: vi.fn().mockResolvedValue(undefined) };
    updateChain.set.mockReturnValue(updateChain);
    db.update.mockReturnValue(updateChain);
    mockReadFile.mockResolvedValue(Buffer.from('square-art'));

    await (service as any).applyMetadata(
      31,
      makeRow({ coverPath: '/tmp/cover.jpg', format: 'm4b', selectedMetadata: { title: 'T' } as BookDockMetadata }),
    );
    await (service as any).applyMetadata(
      32,
      makeRow({ coverPath: '/tmp/cover.jpg', format: 'm4b', selectedMetadata: { title: 'T' } as BookDockMetadata }),
      false,
    );

    expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledOnce();
    expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledWith(31, Buffer.from('square-art'), 'audio');
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

    expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledWith(21, Buffer.from('cover-bytes'), 'ebook');
  });

  describe('a cover the metadata lookup found by itself', () => {
    function stubMetadataWrites(db: ReturnType<typeof makeService>['db']) {
      const updateChain = { set: vi.fn(), where: vi.fn().mockResolvedValue(undefined) };
      updateChain.set.mockReturnValue(updateChain);
      db.update.mockReturnValue(updateChain);
    }

    it("puts an audiobook's own art in first, and lets the field rules' cover replace it only if it fits", async () => {
      const { service, db, metadataService } = makeService();
      stubMetadataWrites(db);
      mockReadFile.mockResolvedValue(Buffer.from('square-art'));

      await (service as any).applyMetadata(
        40,
        makeRow({ coverPath: '/tmp/cover.jpg', format: 'm4b', selectedMetadata: { title: 'Dear Debbie' } as BookDockMetadata }),
        true,
        'https://covers.example/print-jacket.jpg',
      );

      expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledWith(40, Buffer.from('square-art'), 'audio');
      // Not `userChosen`: the shape check is what keeps a portrait jacket out of a filled square slot.
      expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith([{ url: 'https://covers.example/print-jacket.jpg' }], 40, 'audio');
      expect(metadataService.saveExtractedCoverBytes.mock.invocationCallOrder[0]).toBeLessThan(
        metadataService.downloadAndSaveCover.mock.invocationCallOrder[0]!,
      );
    });

    it('checks the shape of a looked-up cover an audiobook falls back to, since nobody chose it', async () => {
      const { service, db, metadataService } = makeService();
      stubMetadataWrites(db);

      await (service as any).applyMetadata(
        41,
        makeRow({ coverPath: null, format: 'm4b', selectedMetadata: { title: 'Dear Debbie' } as BookDockMetadata }),
        true,
        'https://covers.example/print-jacket.jpg',
      );

      expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith([{ url: 'https://covers.example/print-jacket.jpg' }], 41, 'audio');
    });

    it("files an e-book by the same rule: its own art, then the field rules' cover if it fits", async () => {
      const { service, db, metadataService } = makeService();
      stubMetadataWrites(db);
      mockReadFile.mockResolvedValue(Buffer.from('epub-art'));

      await (service as any).applyMetadata(
        42,
        makeRow({ coverPath: '/tmp/cover.jpg', selectedMetadata: { title: 'Dear Debbie' } as BookDockMetadata }),
        true,
        'https://covers.example/jacket.jpg',
      );

      expect(metadataService.downloadAndSaveCover).toHaveBeenCalledWith([{ url: 'https://covers.example/jacket.jpg' }], 42, 'ebook');
      expect(metadataService.saveExtractedCoverBytes).toHaveBeenCalledWith(42, Buffer.from('epub-art'), 'ebook');
    });

    it('files a managed row with the looked-up cover kept apart from what it was told to file with', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(
        makeRow({
          id: 9,
          format: 'm4b',
          embeddedMetadata: { title: 'Dear Debbie' } as BookDockMetadata,
          fetchedMetadata: { title: 'Dear Debbie', coverUrl: 'https://covers.example/print-jacket.jpg' } as BookDockMetadata,
          selectedMetadata: null,
        }),
      );
      const finalizeFile = vi.spyOn(service as any, 'finalizeFile').mockResolvedValue({ fileId: 9, fileName: 'f', success: false, message: 'x' });

      await service.finalizeManagedFile(9, { libraryId: 3, folderId: 4 });

      const [row, , , overrides] = finalizeFile.mock.calls[0] as [
        BookDockFileRow,
        unknown,
        unknown,
        Map<number, { lookedUpCoverUrl?: string | null }>,
      ];
      expect(row.selectedMetadata?.coverUrl).toBeUndefined();
      expect(row.selectedMetadata?.title).toBe('Dear Debbie');
      expect(overrides.get(9)?.lookedUpCoverUrl).toBe('https://covers.example/print-jacket.jpg');
    });

    it('tries the requested art for a joined format only while its slot would otherwise stay empty', async () => {
      const { service, db, metadataService } = makeService();
      stubMetadataWrites(db);
      const chain = () => {
        const query = {
          from: vi.fn(),
          where: vi.fn(),
          limit: vi.fn().mockResolvedValue([{ lockedFields: [], durationSeconds: null, abridged: null, chapters: null }]),
        };
        query.from.mockReturnValue(query);
        query.where.mockReturnValue(query);
        return query;
      };
      db.select.mockImplementation(chain);
      mockReadFile.mockResolvedValue(Buffer.from('square-art'));
      const row = makeRow({ coverPath: '/tmp/cover.jpg', format: 'm4b', selectedMetadata: { title: 'Dune' } as BookDockMetadata });

      await (service as any).applyJoinedMetadata(43, row, 'https://covers.example/requested.jpg', 'https://covers.example/looked-up.jpg');
      expect(metadataService.downloadAndSaveCover).toHaveBeenLastCalledWith([{ url: 'https://covers.example/looked-up.jpg' }], 43, 'audio');

      await (service as any).applyJoinedMetadata(
        44,
        { ...row, coverPath: null },
        'https://covers.example/requested.jpg',
        'https://covers.example/looked-up.jpg',
      );
      expect(metadataService.downloadAndSaveCover).toHaveBeenLastCalledWith(
        [{ url: 'https://covers.example/looked-up.jpg' }, { url: 'https://covers.example/requested.jpg' }],
        44,
        'audio',
      );
    });

    it('treats a cover picked in the Book Dock as chosen, whatever the lookup found', async () => {
      const { service, repo } = makeService();
      repo.findById.mockResolvedValue(
        makeRow({
          id: 9,
          fetchedMetadata: { title: 'Dune', coverUrl: 'https://covers.example/looked-up.jpg' } as BookDockMetadata,
          selectedMetadata: { title: 'Dune', coverUrl: 'https://covers.example/picked.jpg' } as BookDockMetadata,
        }),
      );
      const finalizeFile = vi.spyOn(service as any, 'finalizeFile').mockResolvedValue({ fileId: 9, fileName: 'f', success: false, message: 'x' });

      await service.finalizeManagedFile(9, {});

      const [row, , , overrides] = finalizeFile.mock.calls[0] as [
        BookDockFileRow,
        unknown,
        unknown,
        Map<number, { lookedUpCoverUrl?: string | null }>,
      ];
      expect(row.selectedMetadata?.coverUrl).toBe('https://covers.example/picked.jpg');
      expect(overrides.get(9)?.lookedUpCoverUrl).toBeNull();
    });
  });

  describe('a book a person picked to add the file to', () => {
    const REQUESTER = {
      id: 7,
      isSuperuser: false,
      permissions: [],
      contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
    } as never;
    const summary = { bookId: 42, title: 'Dune', authors: ['Frank Herbert'] };
    const target = (overrides: Record<string, unknown> = {}) => ({
      bookId: 42,
      libraryId: 5,
      libraryFolderId: 9,
      folderPath: '/library/Frank Herbert/Dune',
      storedAsFile: false,
      summary,
      ...overrides,
    });
    const pdfRow = (overrides: Record<string, unknown> = {}) =>
      makeRow({ fileName: 'dune.pdf', absolutePath: '/tmp/dune.pdf', format: 'pdf', ...overrides }) as unknown as BookDockFileRow;

    function stubLibrary(service: BookDockFinalizeService, library: Record<string, unknown> = {}) {
      const findLibrary = vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        name: 'Main',
        allowedFormats: [],
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
        ...library,
      } as never);
      const findFolder = vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue('/library/Frank Herbert/Dune Deluxe/Dune Deluxe.pdf' as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      return { findLibrary, findFolder };
    }

    const joinOverride = [{ fileId: 1, joinBook: { bookId: 42 } }];

    it("files into the book's own folder, taking the library and folder from the book", async () => {
      const { service, repo, joinService, processor, storage } = makeService();
      const { findLibrary, findFolder } = stubLibrary(service);
      const applyMetadata = vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      const applyJoined = vi.spyOn(service as never, 'applyJoinedMetadata').mockResolvedValue(undefined as never);
      repo.findByIds.mockResolvedValue([pdfRow()]);
      joinService.resolveRequested.mockResolvedValue(target());
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [42], createdBookIds: [], attachedFileIds: [900] });

      const result = await service.finalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(result.results[0]).toMatchObject({ fileId: 1, success: true, bookId: 42 });
      expect(joinService.resolveRequested).toHaveBeenCalledWith(42, REQUESTER, ['pdf']);
      expect(findLibrary).toHaveBeenCalledWith(5);
      expect(findFolder).toHaveBeenCalledWith(9, 5);
      expect(storage.moveToPath).toHaveBeenCalledWith('/tmp/dune.pdf', '/library/Frank Herbert/Dune/Dune Deluxe.pdf');
      expect(processor.createUnitBookRecords).toHaveBeenCalledWith(5, 9, [expect.objectContaining({ folderPath: '/library/Frank Herbert/Dune' })]);
      expect(applyJoined).toHaveBeenCalledWith(42, expect.objectContaining({ id: 1 }), null, null);
      expect(applyMetadata).not.toHaveBeenCalled();
      // The file lands and is recorded under the joined book's lock, and only while it is still that book's folder.
      expect(processor.withFolderBookLock).toHaveBeenCalledExactlyOnceWith(5, '/library/Frank Herbert/Dune', expect.any(Function), 42);
      expect(processor.withFolderBookLock.mock.invocationCallOrder[0]).toBeLessThan(storage.moveToPath.mock.invocationCallOrder[0]!);
    });

    it('moves nothing when the book to join no longer owns its folder', async () => {
      const { service, repo, joinService, processor, storage } = makeService();
      stubLibrary(service);
      repo.findByIds.mockResolvedValue([pdfRow()]);
      joinService.resolveRequested.mockResolvedValue(target());
      processor.withFolderBookLock.mockRejectedValueOnce(
        new ConflictException('The book this file belongs with moved while the file was being added. Try again.'),
      );

      const result = await service.finalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(result.results[0]).toMatchObject({ fileId: 1, success: false, message: expect.stringContaining('moved') });
      expect(storage.moveToPath).not.toHaveBeenCalled();
      expect(processor.createUnitBookRecords).not.toHaveBeenCalled();
      expect(repo.deleteById).not.toHaveBeenCalled();
    });

    it("prefers the book's folder over the folder the file was headed for", async () => {
      const { service, repo, joinService } = makeService();
      const { findFolder } = stubLibrary(service);
      repo.findByIds.mockResolvedValue([pdfRow({ targetLibraryId: 5, targetFolderId: 3 })]);
      joinService.resolveRequested.mockResolvedValue(target());

      await service.previewFinalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(findFolder).toHaveBeenCalledWith(9, 5);
    });

    it('previews the join with the book it joins and counts it', async () => {
      const { service, repo, joinService } = makeService();
      stubLibrary(service);
      repo.findByIds.mockResolvedValue([pdfRow()]);
      joinService.resolveRequested.mockResolvedValue(target());

      const preview = await service.previewFinalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(preview).toMatchObject({ total: 1, ready: 1, joining: 1, blocked: 0 });
      expect(preview.items[0]).toEqual(
        expect.objectContaining({
          fileId: 1,
          status: 'ready',
          newName: 'Frank Herbert/Dune/Dune Deluxe.pdf',
          libraryId: 5,
          canJoinBook: true,
          joinsBook: summary,
        }),
      );
      expect(preview.items[0]).not.toHaveProperty('suggestedJoinBook');
      expect(joinService.suggest).toHaveBeenCalledWith([], REQUESTER);
    });

    it.each([
      ['a book in another library', { targetLibraryId: 6, targetFolderId: 10 }, {}, target(), 'BOOK_DOCK_JOIN_OTHER_LIBRARY'],
      ['a library that keeps one book per file', {}, { organizationMode: 'book_per_file' }, target(), 'BOOK_DOCK_JOIN_FILE_PER_BOOK'],
      ['a book with no folder of its own', {}, {}, target({ folderPath: '/library' }), 'BOOK_DOCK_JOIN_ROOT_LEVEL'],
      [
        'a book sitting loose at the library root as its own file',
        {},
        {},
        target({ folderPath: '/library/Dune.epub', storedAsFile: true }),
        'BOOK_DOCK_JOIN_ROOT_LEVEL',
      ],
    ])('holds the file rather than filing it elsewhere for %s', async (_label, rowOverrides, library, joinTarget, errorCode) => {
      const { service, repo, joinService, storage, processor } = makeService();
      stubLibrary(service, rowOverrides.targetLibraryId ? { id: 6, ...library } : library);
      repo.findByIds.mockResolvedValue([pdfRow(rowOverrides)]);
      joinService.resolveRequested.mockResolvedValue(joinTarget);

      const preview = await service.previewFinalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );
      const result = await service.finalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(preview).toMatchObject({ ready: 0, blocked: 1 });
      expect(preview.items[0]).toMatchObject({ fileId: 1, status: 'invalid_target', errorCode });
      expect(result.results[0]).toMatchObject({ fileId: 1, success: false, errorCode });
      expect(storage.moveToPath).not.toHaveBeenCalled();
      expect(processor.createUnitBookRecords).not.toHaveBeenCalled();
    });

    it('reports a refused access check as access denied with its code', async () => {
      const { service, repo, joinService, storage } = makeService();
      stubLibrary(service);
      repo.findByIds.mockResolvedValue([pdfRow()]);
      joinService.resolveRequested.mockRejectedValue(joinError('BOOK_DOCK_JOIN_FORBIDDEN', 'You cannot edit the book this file was meant to join'));

      const preview = await service.previewFinalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(preview.items[0]).toMatchObject({ status: 'access_denied', errorCode: 'BOOK_DOCK_JOIN_FORBIDDEN' });
      expect(storage.moveToPath).not.toHaveBeenCalled();
    });

    it('checks every content format of a unit for a second audio set', async () => {
      const { service, repo, joinService } = makeService();
      stubLibrary(service);
      repo.findByIds.mockResolvedValue([pdfRow({ fileName: 'dune.epub', format: 'epub' })]);
      repo.findUnitFiles.mockResolvedValue([
        { absolutePath: '/tmp/dune/dune.epub', fileName: 'dune.epub', format: 'epub', role: 'content', sortOrder: 0 },
        { absolutePath: '/tmp/dune/dune.m4b', fileName: 'dune.m4b', format: 'M4B', role: 'content', sortOrder: 1 },
        { absolutePath: '/tmp/dune/cover.jpg', fileName: 'cover.jpg', format: null, role: 'cover', sortOrder: null },
      ]);
      joinService.resolveRequested.mockResolvedValue(target());

      await service.previewFinalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        joinOverride,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(joinService.resolveRequested).toHaveBeenCalledWith(42, REQUESTER, ['epub', 'm4b']);
    });

    it('suggests a matching book for a file headed for a library that can take it', async () => {
      const { service, repo, joinService } = makeService();
      stubLibrary(service);
      const row = pdfRow({ targetLibraryId: 5, targetFolderId: 9, embeddedMetadata: { title: 'Dune', authors: ['Frank Herbert'] } });
      repo.findByIds.mockResolvedValue([row]);
      const suggestion = { ...summary, reason: 'title_author' };
      joinService.suggest.mockResolvedValue(new Map([[1, suggestion]]));

      const preview = await service.previewFinalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );

      expect(preview.items[0]).toEqual(expect.objectContaining({ status: 'ready', canJoinBook: true, suggestedJoinBook: suggestion }));
      expect(preview.joining).toBe(0);
      expect(joinService.suggest).toHaveBeenCalledWith(
        [{ fileId: 1, libraryId: 5, metadata: { title: 'Dune', authors: ['Frank Herbert'] }, formats: ['pdf'] }],
        REQUESTER,
      );
      expect(joinService.resolveRequested).not.toHaveBeenCalled();
    });

    it('offers no join where the requester cannot edit and asks nothing without a requester', async () => {
      const { service, repo, joinService } = makeService();
      stubLibrary(service);
      repo.findByIds.mockResolvedValue([pdfRow({ targetLibraryId: 5, targetFolderId: 9 })]);
      joinService.canJoinIn.mockResolvedValue(false);

      const preview = await service.previewFinalize(
        7,
        false,
        false,
        [1],
        false,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        REQUESTER,
      );
      expect(preview.items[0]).toEqual(expect.objectContaining({ canJoinBook: false }));
      expect(joinService.suggest).toHaveBeenCalledWith([], REQUESTER);

      joinService.canJoinIn.mockClear();
      const unattended = await service.previewFinalize(7, true, true, [1], false, [], undefined, undefined);
      expect(unattended.items[0]).not.toHaveProperty('canJoinBook');
      expect(joinService.canJoinIn).not.toHaveBeenCalled();
    });

    /** Issue 1568: a file whose pattern led to an existing book's folder overwrote that book's metadata. */
    it('gives a book the import did not create only what the new format adds', async () => {
      const { service, processor } = makeService();
      stubLibrary(service);
      const applyMetadata = vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      const applyJoined = vi.spyOn(service as never, 'applyJoinedMetadata').mockResolvedValue(undefined as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [42], createdBookIds: [], attachedFileIds: [900] });

      const result = await (service as any).finalizeFile(pdfRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 0, true);

      expect(result).toMatchObject({ success: true, bookId: 42 });
      expect(applyJoined).toHaveBeenCalledWith(42, expect.objectContaining({ id: 1 }), null, null);
      expect(applyMetadata).not.toHaveBeenCalled();
    });

    it('still gives a book the import created the full metadata', async () => {
      const { service, processor } = makeService();
      stubLibrary(service);
      const applyMetadata = vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      const applyJoined = vi.spyOn(service as never, 'applyJoinedMetadata').mockResolvedValue(undefined as never);
      processor.createUnitBookRecords.mockResolvedValueOnce({ bookIds: [101], createdBookIds: [101], attachedFileIds: [] });

      await (service as any).finalizeFile(pdfRow({ targetLibraryId: 5, targetFolderId: 9 }), undefined, undefined, new Map(), 0, true);

      expect(applyMetadata).toHaveBeenCalledWith(101, expect.objectContaining({ id: 1 }), true, null);
      expect(applyJoined).not.toHaveBeenCalled();
    });
  });

  describe('multi-file units', () => {
    const UNIT_DIR = '/dock/request-7-Neuromancer';

    function unitRow(overrides: Record<string, unknown> = {}) {
      return makeRow({
        id: 42,
        fileName: 'track-01.mp3',
        absolutePath: `${UNIT_DIR}/track-01.mp3`,
        unitDirectory: UNIT_DIR,
        format: 'mp3',
        targetLibraryId: 5,
        targetFolderId: 9,
        embeddedMetadata: null,
        ...overrides,
      });
    }

    const AUDIO_UNIT_FILES = [
      {
        id: 1,
        dockFileId: 42,
        absolutePath: `${UNIT_DIR}/track-01.mp3`,
        fileName: 'track-01.mp3',
        fileSize: 10,
        format: 'mp3',
        role: 'content',
        sortOrder: 0,
      },
      {
        id: 2,
        dockFileId: 42,
        absolutePath: `${UNIT_DIR}/track-02.mp3`,
        fileName: 'track-02.mp3',
        fileSize: 10,
        format: 'mp3',
        role: 'content',
        sortOrder: 1,
      },
      {
        id: 3,
        dockFileId: 42,
        absolutePath: `${UNIT_DIR}/cover.jpg`,
        fileName: 'cover.jpg',
        fileSize: 5,
        format: 'jpg',
        role: 'cover',
        sortOrder: null,
      },
    ];

    function arrange(
      harness: ReturnType<typeof makeService>,
      options: {
        organizationMode?: string;
        formatPriority?: string[];
        destPath?: string;
        importFormats?: string;
        fileWriteEnabled?: boolean;
      } = {},
    ) {
      const { service } = harness;
      harness.appSettings.getBookRequestImportFormats.mockResolvedValue(options.importFormats ?? 'all');
      vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
        id: 5,
        name: 'Loose',
        allowedFormats: [],
        fileNamingPattern: null,
        formatPriority: options.formatPriority ?? [],
        organizationMode: options.organizationMode ?? 'book_per_folder',
        fileWriteEnabled: options.fileWriteEnabled ?? false,
      } as never);
      vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
      vi.spyOn(service as never, 'resolveDestination').mockResolvedValue((options.destPath ?? '/library/Neuromancer/track-01.mp3') as never);
      vi.spyOn(service as never, 'applyMetadata').mockResolvedValue(undefined as never);
      vi.spyOn(service as never, 'cleanupBookDockRecord').mockResolvedValue(undefined as never);
      mockAccess.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }));
      mockStat.mockResolvedValue({ size: 10 } as never);
    }

    function finalize(harness: ReturnType<typeof makeService>, row: ReturnType<typeof unitRow>) {
      return (harness.service as any).finalizeFile(row, undefined, undefined, new Map(), 1, true);
    }

    /**
     * Every file into one folder, and one book out of it, in a single write: the primary goes first
     * because the book row that carries `primaryFileId` is the one created for it.
     */
    it.each([UNIT_DIR, null])('places every file into one book with directory ownership %s', async (unitDirectory) => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
      arrange(harness);
      harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [77], createdBookIds: [77], attachedFileIds: [] });

      const result = await finalize(harness, unitRow({ unitDirectory }));

      expect(result).toMatchObject({ success: true, bookId: 77 });
      expect(harness.storage.moveToPath).toHaveBeenCalledTimes(3);
      expect(harness.processor.createUnitBookRecords).toHaveBeenCalledTimes(1);

      const [, , files] = harness.processor.createUnitBookRecords.mock.calls[0];
      expect(new Set(files.map((file: { folderPath: string }) => file.folderPath)).size).toBe(1);
      expect(files[0].absolutePath).toContain('track-01.mp3');
      expect(files.map((file: { role: string; sortOrder: number | null }) => ({ role: file.role, sortOrder: file.sortOrder }))).toEqual([
        { role: 'content', sortOrder: 0 },
        { role: 'content', sortOrder: 1 },
        { role: 'cover', sortOrder: null },
      ]);
    });

    /**
     * The books commit before `applyMetadata` runs, and that runs against services which cannot
     * join the transaction. A ghost book plus a `book_files` row pointing at a path that has just
     * been moved back to the dock is the worst outcome this feature can produce.
     */
    it('takes back the book rows it created when the metadata pass fails', async () => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
      arrange(harness);
      const written = { bookIds: [77], createdBookIds: [77], attachedFileIds: [9] };
      harness.processor.createUnitBookRecords.mockResolvedValue(written);
      vi.spyOn(harness.service as never, 'applyMetadata').mockRejectedValue(new Error('metadata exploded') as never);

      const result = await finalize(harness, unitRow());

      expect(result.success).toBe(false);
      expect(harness.processor.deleteUnitBookRecords).toHaveBeenCalledWith(written);
      // And the files go back to the dock, so nothing is left half-filed on either side.
      expect(harness.storage.moveToPath.mock.calls.slice(3)).toHaveLength(3);
    });

    describe('from a keep-original dock (D34)', () => {
      const destinations = ['/library/Neuromancer/track-01.mp3', '/library/Neuromancer/track-02.mp3', '/library/Neuromancer/cover.jpg'];

      function keepOriginal() {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
        harness.keptFiles.keepsOriginals.mockResolvedValue(true);
        arrange(harness);
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [77], createdBookIds: [77], attachedFileIds: [] });
        return harness;
      }

      it('links every file into the library, moves nothing, and remembers the originals before the row goes', async () => {
        const harness = keepOriginal();
        const row = unitRow({ dockId: 11 });

        const result = await finalize(harness, row);

        expect(result).toMatchObject({ success: true, bookId: 77 });
        expect(harness.keptFiles.keepsOriginals).toHaveBeenCalledWith(row);
        expect(harness.storage.moveToPath).not.toHaveBeenCalled();
        expect(harness.storage.linkToPath.mock.calls).toEqual(AUDIO_UNIT_FILES.map((file, index) => [file.absolutePath, destinations[index]]));
        expect(harness.keptFiles.remember).toHaveBeenCalledWith(row, { bookId: 77 });
        const cleanup = vi.mocked((harness.service as any).cleanupBookDockRecord as () => void);
        expect(harness.keptFiles.remember.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(cleanup).mock.invocationCallOrder[0]!);
      });

      it('files the same way when it had to copy', async () => {
        const harness = keepOriginal();
        harness.storage.linkToPath.mockResolvedValue('copied');

        await expect(finalize(harness, unitRow())).resolves.toMatchObject({ success: true, bookId: 77 });

        expect(harness.keptFiles.remember).toHaveBeenCalledTimes(1);
      });

      it('rolls back by removing only the copies it placed, never an original', async () => {
        const harness = keepOriginal();
        vi.spyOn(harness.service as never, 'applyMetadata').mockRejectedValue(new Error('metadata exploded') as never);

        const result = await finalize(harness, unitRow());

        expect(result.success).toBe(false);
        expect(mockUnlink.mock.calls.map(([path]) => path)).toEqual(destinations);
        expect(harness.storage.moveToPath).not.toHaveBeenCalled();
        expect(harness.keptFiles.remember).not.toHaveBeenCalled();
      });

      it('takes back what it linked when a later file cannot be placed', async () => {
        const harness = keepOriginal();
        harness.storage.linkToPath.mockResolvedValueOnce('linked').mockRejectedValueOnce(new Error('disk on fire'));

        const result = await finalize(harness, unitRow());

        expect(result).toMatchObject({ success: false });
        expect(mockUnlink.mock.calls.map(([path]) => path)).toEqual([destinations[0]]);
        expect(harness.processor.createUnitBookRecords).not.toHaveBeenCalled();
      });

      it('remembers a discarded duplicate instead of deleting it, and drops only the dock cover', async () => {
        const harness = makeService();
        const row = unitRow({ coverPath: '/covers/42.jpg' });

        await (harness.service as any).cleanupDiscardedBookDockFile(row, true);

        expect(harness.keptFiles.remember).toHaveBeenCalledWith(row, { discarded: true });
        expect(mockUnlink.mock.calls.map(([path]) => path)).toEqual(['/covers/42.jpg', '/covers/42_thumb.jpg']);
      });
    });

    /** A rollback that throws must not replace the error that caused it. */
    it('reports the original failure even when the rollback itself fails', async () => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
      arrange(harness);
      harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [77], createdBookIds: [77], attachedFileIds: [] });
      harness.processor.deleteUnitBookRecords.mockRejectedValue(new Error('rollback exploded'));
      vi.spyOn(harness.service as never, 'applyMetadata').mockRejectedValue(new Error('metadata exploded') as never);

      const result = await finalize(harness, unitRow());

      expect(result).toMatchObject({ success: false, message: 'metadata exploded' });
    });

    /**
     * A disc-foldered unit holds two files called `track01.mp3`. Filing them both by basename put
     * the second on top of the first, and filed the book under `CD 1` rather than under the book.
     */
    it.each([UNIT_DIR, null])('preserves distinct disc paths with directory ownership %s', async (unitDirectory) => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue([
        {
          id: 1,
          dockFileId: 42,
          absolutePath: `${UNIT_DIR}/CD 1/track01.mp3`,
          fileName: 'track01.mp3',
          fileSize: 10,
          format: 'mp3',
          role: 'content',
          sortOrder: 0,
        },
        {
          id: 2,
          dockFileId: 42,
          absolutePath: `${UNIT_DIR}/CD 2/track01.mp3`,
          fileName: 'track01.mp3',
          fileSize: 10,
          format: 'mp3',
          role: 'content',
          sortOrder: 1,
        },
      ]);
      arrange(harness);
      harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [80], createdBookIds: [80], attachedFileIds: [] });

      const result = await finalize(harness, unitRow({ absolutePath: `${UNIT_DIR}/CD 1/track01.mp3`, unitDirectory }));

      expect(result.success).toBe(true);
      expect(harness.storage.moveToPath.mock.calls.map((call: string[]) => call[1])).toEqual([
        '/library/Neuromancer/CD 1/track01.mp3',
        '/library/Neuromancer/CD 2/track01.mp3',
      ]);
      // And the book is the unit's own folder, not the disc the primary happened to sit in.
      const [, , files] = harness.processor.createUnitBookRecords.mock.calls[0];
      expect(new Set(files.map((file: { folderPath: string }) => file.folderPath))).toEqual(new Set(['/library/Neuromancer']));
    });

    /** Twenty of thirty-one files moved and then EXDEV must not leave a half-placed folder. */
    it('puts back every file it moved when one of them fails', async () => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
      arrange(harness);
      harness.storage.moveToPath.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('EXDEV'));

      const result = await finalize(harness, unitRow());

      expect(result.success).toBe(false);
      expect(harness.storage.moveToPath.mock.calls.slice(3)).toEqual([
        [expect.stringContaining('track-01.mp3'), `${UNIT_DIR}/track-01.mp3`],
        [expect.stringContaining('track-02.mp3'), `${UNIT_DIR}/track-02.mp3`],
      ]);
    });

    /** A folder in a book_per_file library is split apart by the next scan: data loss, not taste. */
    it.each([UNIT_DIR, null])('holds multipart audio for a book_per_file library with directory ownership %s', async (unitDirectory) => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
      arrange(harness, { organizationMode: 'book_per_file' });

      const result = await finalize(harness, unitRow({ unitDirectory }));

      expect(result.success).toBe(false);
      expect(result.message).toContain('one book per file');
      expect(harness.storage.moveToPath).not.toHaveBeenCalled();
    });

    it('discards every recorded file of a shared-folder unit without removing its directory', async () => {
      const { service, repo } = makeService();
      repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
      await (service as any).cleanupDiscardedBookDockFile(unitRow({ unitDirectory: null }));
      expect(new Set(mockUnlink.mock.calls.map(([path]) => path))).toEqual(new Set(AUDIO_UNIT_FILES.map((file) => file.absolutePath)));
    });

    const MULTI_FORMAT_FILES = [
      {
        id: 1,
        dockFileId: 42,
        absolutePath: '/dock/request-7-Dune/Dune.epub',
        fileName: 'Dune.epub',
        fileSize: 10,
        format: 'epub',
        role: 'content',
        sortOrder: 0,
      },
      {
        id: 2,
        dockFileId: 42,
        absolutePath: '/dock/request-7-Dune/Dune.pdf',
        fileName: 'Dune.pdf',
        fileSize: 10,
        format: 'pdf',
        role: 'content',
        sortOrder: 1,
      },
      {
        id: 3,
        dockFileId: 42,
        absolutePath: '/dock/request-7-Dune/cover.jpg',
        fileName: 'cover.jpg',
        fileSize: 5,
        format: 'jpg',
        role: 'cover',
        sortOrder: null,
      },
    ];

    function multiFormatRow() {
      return unitRow({ fileName: 'Dune.epub', absolutePath: '/dock/request-7-Dune/Dune.epub', format: 'epub' });
    }

    it('keeps every format of one book when the setting says all available', async () => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(MULTI_FORMAT_FILES);
      arrange(harness, { destPath: '/library/Dune/Dune.epub', importFormats: 'all' });
      harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [78], createdBookIds: [78], attachedFileIds: [] });

      const result = await finalize(harness, multiFormatRow());

      expect(result.success).toBe(true);
      expect(harness.storage.moveToPath).toHaveBeenCalledTimes(3);
    });

    it('keeps only the library preferred format when the setting says preferred only', async () => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(MULTI_FORMAT_FILES);
      arrange(harness, { formatPriority: ['pdf', 'epub'], destPath: '/library/Dune/Dune.epub', importFormats: 'preferred' });
      harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [78], createdBookIds: [78], attachedFileIds: [] });

      const result = await finalize(harness, multiFormatRow());

      expect(result.success).toBe(true);
      // The chosen format and the artwork that came with it; the format that lost is dropped.
      expect(harness.storage.moveToPath.mock.calls.map((call: string[]) => call[0])).toEqual([
        '/dock/request-7-Dune/Dune.pdf',
        '/dock/request-7-Dune/cover.jpg',
      ]);
    });

    /**
     * One book per file is exactly what that mode means, and what its own next scan would produce.
     * Both books get the metadata: a second book with the same title and none of it is worse than
     * not importing it.
     */
    it('makes one book per format in a book_per_file library when keeping all formats', async () => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(MULTI_FORMAT_FILES);
      arrange(harness, { organizationMode: 'book_per_file', destPath: '/library/Dune.epub', importFormats: 'all' });
      harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [81, 82], createdBookIds: [81, 82], attachedFileIds: [] });
      const applyMetadata = vi.spyOn(harness.service as never, 'applyMetadata').mockResolvedValue(undefined as never);

      const result = await finalize(harness, multiFormatRow());

      expect(result).toMatchObject({ success: true, bookId: 81 });
      // The cover has nowhere to live in a loose-file library, exactly as the scanner treats it.
      expect(harness.storage.moveToPath).toHaveBeenCalledTimes(2);
      const [, , looseFiles] = harness.processor.createUnitBookRecords.mock.calls[0];
      expect(looseFiles.map((file: { folderPath: string }) => file.folderPath)).toEqual(['/library/Dune.epub', '/library/Dune.pdf']);
      expect(applyMetadata.mock.calls.map((call: unknown[]) => call[0])).toEqual([81, 82]);
      // The staged cover came from the primary file, so only its book gets it; reconcile fills the rest.
      expect(applyMetadata.mock.calls.map((call: unknown[]) => call[2])).toEqual([true, false]);
      expect(harness.processor.reconcileCoversAsync).toHaveBeenCalledWith([81, 82]);
    });

    /**
     * Issue 1757: the player derives progress only from per-file durations, and finalize used to
     * leave them empty until the next scan, so a filed audiobook stayed at 0% and never reached
     * Continue Listening.
     */
    describe('audio durations', () => {
      it('measures every book the unit produced, after its metadata and before any write-back', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(MULTI_FORMAT_FILES);
        arrange(harness, { organizationMode: 'book_per_file', destPath: '/library/Dune.epub', fileWriteEnabled: true });
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [101, 102], createdBookIds: [101, 102], attachedFileIds: [] });
        const order: string[] = [];
        vi.spyOn(harness.service as never, 'applyMetadata').mockImplementation(((bookId: number) => {
          order.push(`metadata:${bookId}`);
          return Promise.resolve();
        }) as never);
        harness.metadataService.measureMissingAudioDurations.mockImplementation((bookId: number) => {
          order.push(`measure:${bookId}`);
          return Promise.resolve({ measured: 1, failed: 0 });
        });
        harness.fileWriteService.scheduleWrite.mockImplementation((bookId: number) => {
          order.push(`write:${bookId}`);
        });

        const result = await finalize(harness, multiFormatRow());

        expect(result.success).toBe(true);
        expect(order).toEqual(['metadata:101', 'metadata:102', 'measure:101', 'measure:102', 'write:101', 'write:102']);
      });

      it('measures the one book of a multi-track audiobook', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
        arrange(harness);
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [77], createdBookIds: [77], attachedFileIds: [] });

        const result = await finalize(harness, unitRow());

        expect(result).toMatchObject({ success: true, bookId: 77 });
        expect(harness.metadataService.measureMissingAudioDurations.mock.calls).toEqual([[77]]);
      });

      it('keeps the book filed when measuring fails, and still measures the next book', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(MULTI_FORMAT_FILES);
        arrange(harness, { organizationMode: 'book_per_file', destPath: '/library/Dune.epub', fileWriteEnabled: true });
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [101, 102], createdBookIds: [101, 102], attachedFileIds: [] });
        harness.metadataService.measureMissingAudioDurations
          .mockRejectedValueOnce(new Error('connection reset'))
          .mockResolvedValueOnce({ measured: 1, failed: 0 });
        const warn = vi.spyOn((harness.service as any).logger, 'warn').mockImplementation(() => undefined);

        const result = await finalize(harness, multiFormatRow());

        expect(result).toMatchObject({ success: true, bookId: 101 });
        expect(harness.metadataService.measureMissingAudioDurations.mock.calls).toEqual([[101], [102]]);
        expect(harness.processor.deleteUnitBookRecords).not.toHaveBeenCalled();
        // Only the forward moves: nothing went back to the dock.
        expect(harness.storage.moveToPath).toHaveBeenCalledTimes(2);
        expect(harness.fileWriteService.scheduleWrite).toHaveBeenCalledTimes(2);
        expect(warn).toHaveBeenCalledWith(
          expect.stringMatching(/^\[book_dock\.measure_audio_durations\] \[fail\] fileId=42 bookId=101 .*errorClass=Error error="connection reset"/),
        );
      });

      it('logs files it could not measure without failing the import', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
        arrange(harness);
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [77], createdBookIds: [77], attachedFileIds: [] });
        harness.metadataService.measureMissingAudioDurations.mockResolvedValueOnce({ measured: 1, failed: 1 });
        const warn = vi.spyOn((harness.service as any).logger, 'warn').mockImplementation(() => undefined);

        const result = await finalize(harness, unitRow());

        expect(result).toMatchObject({ success: true, bookId: 77 });
        expect(warn).toHaveBeenCalledWith(
          expect.stringMatching(/^\[book_dock\.measure_audio_durations\] \[end\] fileId=42 bookId=77 .*measured=1 failed=1/),
        );
      });

      it('measures nothing when the metadata pass fails and the unit is taken back', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
        arrange(harness);
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [77], createdBookIds: [77], attachedFileIds: [] });
        vi.spyOn(harness.service as never, 'applyMetadata').mockRejectedValue(new Error('metadata exploded') as never);

        const result = await finalize(harness, unitRow());

        expect(result.success).toBe(false);
        expect(harness.metadataService.measureMissingAudioDurations).not.toHaveBeenCalled();
      });

      it('measures nothing when the book rows cannot be written', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
        arrange(harness);
        harness.processor.createUnitBookRecords.mockRejectedValue(new Error('create failed'));

        const result = await finalize(harness, unitRow());

        expect(result.success).toBe(false);
        expect(harness.metadataService.measureMissingAudioDurations).not.toHaveBeenCalled();
      });
    });

    describe('metadata write-back', () => {
      it('schedules a write for every book the unit produced, attributed to the uploader', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(MULTI_FORMAT_FILES);
        arrange(harness, { organizationMode: 'book_per_file', destPath: '/library/Dune.epub', fileWriteEnabled: true });
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [101, 102], createdBookIds: [101, 102], attachedFileIds: [] });

        const result = await finalize(harness, multiFormatRow());

        expect(result.success).toBe(true);
        expect(harness.fileWriteService.scheduleWrite.mock.calls).toEqual([
          [101, 'auto', 7],
          [102, 'auto', 7],
        ]);
      });

      it('does not schedule a write when the library does not write metadata to files', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
        arrange(harness, { fileWriteEnabled: false });
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [101], createdBookIds: [101], attachedFileIds: [] });

        const result = await finalize(harness, unitRow());

        expect(result.success).toBe(true);
        expect(harness.fileWriteService.scheduleWrite).not.toHaveBeenCalled();
      });

      it('does not schedule a write for any book when a later book of the unit fails', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(MULTI_FORMAT_FILES);
        arrange(harness, { organizationMode: 'book_per_file', destPath: '/library/Dune.epub', fileWriteEnabled: true });
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [101, 102], createdBookIds: [102], attachedFileIds: [9] });
        vi.spyOn(harness.service as never, 'applyMetadata')
          .mockResolvedValueOnce(undefined as never)
          .mockRejectedValueOnce(new Error('metadata exploded') as never);

        const result = await finalize(harness, multiFormatRow());

        expect(result.success).toBe(false);
        expect(harness.processor.deleteUnitBookRecords).toHaveBeenCalled();
        expect(harness.fileWriteService.scheduleWrite).not.toHaveBeenCalled();
      });

      it('does not schedule a write when dock record cleanup fails', async () => {
        const harness = makeService();
        harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
        arrange(harness, { fileWriteEnabled: true });
        harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [101], createdBookIds: [101], attachedFileIds: [] });
        vi.spyOn(harness.service as never, 'cleanupBookDockRecord').mockRejectedValue(new Error('cleanup failed') as never);

        const result = await finalize(harness, unitRow());

        expect(result.success).toBe(false);
        expect(harness.fileWriteService.scheduleWrite).not.toHaveBeenCalled();
      });
    });

    /**
     * A pattern with no path separator resolves to a bare filename, and `dirname()` of that is the
     * library folder root. Without a floor every unit would land there and merge into one book.
     */
    it('never places a unit directly in the library folder root', async () => {
      const harness = makeService();
      harness.repo.findUnitFiles.mockResolvedValue(AUDIO_UNIT_FILES);
      arrange(harness, { destPath: '/library/track-01.mp3' });
      harness.processor.createUnitBookRecords.mockResolvedValue({ bookIds: [79], createdBookIds: [79], attachedFileIds: [] });

      const result = await finalize(harness, unitRow());

      expect(result.success).toBe(true);
      for (const call of harness.storage.moveToPath.mock.calls) {
        expect(call[1]).toContain('/library/track-01/');
      }
    });
  });

  /**
   * A whole failed SELECT, table and column names included, once reached the request drawer of the
   * person who asked for the book. The cause belongs in the log, not in their status line.
   */
  it('does not put a database error into the message a requester reads', async () => {
    const harness = makeService();
    const row = makeRow({ targetLibraryId: 5, targetFolderId: 9, unitDirectory: '/dock/request-7-Dune' });
    const databaseError = Object.assign(new DatabaseError('syntax error at or near "asc"', 0, 'error'), { code: '42601' });
    const failure = Object.assign(new Error('Failed query: select "id" from "book_dock_unit_files" where ...'), {
      cause: databaseError,
    });
    harness.repo.findUnitFiles.mockRejectedValue(failure);
    const warn = vi.spyOn((harness.service as any).logger, 'warn').mockImplementation(() => {});
    vi.spyOn(harness.service as never, 'findLibraryOrFail').mockResolvedValue({
      id: 5,
      name: 'Books',
      allowedFormats: [],
      fileNamingPattern: null,
      formatPriority: [],
      organizationMode: 'book_per_folder',
    } as never);
    vi.spyOn(harness.service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);

    const result = await (harness.service as any).finalizeFile(row, undefined, undefined, new Map(), 1, true);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Filing this book failed inside BookOrbit. Check the server log for the cause.');
    expect(result.message).not.toContain('select');
    expect(result.message).not.toContain('book_dock_unit_files');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('errorClass=DatabaseError errorCode=42601'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('error="syntax error at or near \\"asc\\""'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('book_dock_unit_files'));
  });

  it.each(['EXDEV', 'EPERM', 'EACCES', 'ENOENT'])('logs %s from a failed file move without exposing paths to the requester', async (code) => {
    const harness = makeService();
    const row = makeRow({ absolutePath: '/dock/book.epub' });
    const prepared = {
      fileId: row.id,
      fileName: row.fileName,
      row,
      status: 'ready',
      destPath: '/library/book.epub',
      library: { id: 5 },
      folder: { id: 9, path: '/library' },
      format: 'epub',
      placement: [
        {
          sourcePath: '/dock/book.epub',
          destPath: '/library/book.epub',
          format: 'epub',
          role: 'content',
          sortOrder: 0,
        },
      ],
    };
    const failure = Object.assign(new Error(`${code}: move '/dock/book.epub' -> '/library/book.epub'`), { code });
    harness.storage.moveToPath.mockRejectedValueOnce(failure);
    vi.spyOn(harness.service as never, 'classifyDestination').mockResolvedValue(prepared as never);
    const warn = vi.spyOn((harness.service as any).logger, 'warn').mockImplementation(() => {});

    const result = await (harness.service as any).finalizePreparedCandidate(prepared, new Map());

    expect(result).toEqual({
      fileId: 1,
      fileName: 'book.epub',
      success: false,
      message: 'Filing this book failed inside BookOrbit. Check the server log for the cause.',
    });
    expect(result.message).not.toContain('/dock');
    expect(result.message).not.toContain('/library');
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      `[book_dock.finalize] [fail] fileId=1 stage=filing errorClass=Error errorCode=${code} error="${code}" - Book Dock file finalization failed`,
    );
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

  it('prepares one batched destination lookup and ignores matching metadata', async () => {
    const { service, repo } = makeService();
    const rows = [
      makeRow({ id: 1, fileName: 'one.epub', selectedMetadata: { title: 'Same', isbn13: '9780306406157' } }),
      makeRow({ id: 2, fileName: 'two.epub', selectedMetadata: { title: 'Same', isbn13: '9780306406157' } }),
    ];
    vi.spyOn(service as never, 'findLibraryOrFail').mockResolvedValue({
      id: 5,
      allowedFormats: ['epub'],
      organizationMode: 'book_per_file',
    } as never);
    vi.spyOn(service as never, 'findFolderOrFail').mockResolvedValue({ id: 9, libraryId: 5, path: '/library' } as never);
    vi.spyOn(service as never, 'resolveDestination').mockImplementation((_, __, row: { fileName: string }) =>
      Promise.resolve(`/library/${row.fileName}`),
    );

    const prepared = await (service as any).prepareFinalizeBatch(rows, 5, 9, new Map(), 1, true);

    expect(prepared.analyses.map((analysis: { status: string }) => analysis.status)).toEqual(['ready', 'ready']);
    expect(repo.findExistingBooksByAbsolutePaths).toHaveBeenCalledOnce();
    expect(repo.findExistingBooksByAbsolutePaths).toHaveBeenCalledWith(['/library/one.epub', '/library/two.epub']);
  });

  it('scopes indexed destination matches to the target library', async () => {
    const { service } = makeService();
    const analysis = {
      fileId: 1,
      fileName: 'book.epub',
      row: makeRow(),
      status: 'ready',
      destPath: '/shared/book.epub',
      library: { id: 5 },
      folder: { id: 9, path: '/shared' },
      format: 'epub',
    };
    mockAccess.mockResolvedValueOnce(undefined as never);

    const classified = await (service as any).classifyDestination(analysis, new Map([['6\u0000/shared/book.epub', 77]]));

    expect(classified).toMatchObject({ status: 'destination_conflict' });
    expect(classified).not.toHaveProperty('existingBookId');
  });

  it('reports non-ENOENT destination access failures without moving the file', async () => {
    const { service, storage } = makeService();
    const warn = vi.spyOn((service as any).logger, 'warn').mockImplementation(() => {});
    const analysis = {
      fileId: 1,
      fileName: 'book.epub',
      row: makeRow(),
      status: 'ready',
      destPath: '/library/book.epub',
      library: { id: 5 },
      folder: { id: 9, path: '/library' },
      format: 'epub',
    };
    mockAccess.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    const classified = await (service as any).classifyDestination(analysis, new Map());

    expect(classified).toMatchObject({
      status: 'error',
      message: 'Filing this book failed inside BookOrbit. Check the server log for the cause.',
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      '[book_dock.finalize] [fail] fileId=1 stage=destination_check errorClass=Error errorCode=EACCES error="EACCES" - Book Dock file finalization failed',
    );
    expect(storage.moveToPath).not.toHaveBeenCalled();
  });

  it('resolveDestination builds names from patterns and falls back per organization mode', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPattern.mockResolvedValue(null);
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue(null);
    const rowWithMeta = makeRow({
      fileName: 'original.epub',
      selectedMetadata: { title: 'Dune', seriesIndex: '2.5' } as BookDockMetadata,
    });

    await expect((service as any).resolveDestination({ fileNamingPattern: '{title}-{seriesIndex}' }, '/library', rowWithMeta, 'epub')).resolves.toBe(
      '/library/Dune-02.5.epub',
    );
    await expect(
      (service as any).resolveDestination({ fileNamingPattern: null, organizationMode: 'book_per_folder' }, '/library', rowWithMeta, 'epub'),
    ).resolves.toBe('/library/original/original.epub');
    await expect(
      (service as any).resolveDestination({ fileNamingPattern: null, organizationMode: 'book_per_file' }, '/library', rowWithMeta, 'epub'),
    ).resolves.toBe('/library/original.epub');
  });

  it('resolveDestination files legacy BookDock metadata with a numeric series index', async () => {
    const { service } = makeService();
    const row = makeRow({
      fileName: 'Day, Sylvia - Crossfire 03 - Entwined With You - Day, Sylvia.epub',
      selectedMetadata: {
        title: 'Entwined With You',
        authors: ['Sylvia Day'],
        seriesName: 'Crossfire',
        seriesIndex: 3,
      } as unknown as BookDockMetadata,
    });

    await expect(
      (service as any).resolveDestination(
        { fileNamingPattern: '<{authors:first}|Unknown Author>/<{series}/><{seriesIndex}. >{title}' },
        '/library',
        row,
        'epub',
      ),
    ).resolves.toBe('/library/Sylvia Day/Crossfire/03. Entwined With You.epub');
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

  it('resolveDestination keeps the folder segments a book_per_file pattern defines', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPattern.mockResolvedValue('{authors:first}/{series}/{title}');
    const row = makeRow({
      fileName: 'book.epub',
      selectedMetadata: { title: 'Foundation', authors: ['Isaac Asimov'], seriesName: 'Foundation' } as BookDockMetadata,
    });

    await expect(
      (service as any).resolveDestination({ fileNamingPattern: null, organizationMode: 'book_per_file' }, '/library', row, 'epub'),
    ).resolves.toBe('/library/Isaac Asimov/Foundation/Foundation.epub');
  });

  it('resolveDestination files a book_per_file library under the shipped default pattern', async () => {
    const { service, appSettings } = makeService();
    appSettings.getUploadPattern.mockResolvedValue(DEFAULT_UPLOAD_PATTERN_BOOK_PER_FILE);
    const row = makeRow({ fileName: 'book.epub', selectedMetadata: defaultPatternMetadata() });

    await expect(
      (service as any).resolveDestination({ fileNamingPattern: null, organizationMode: 'book_per_file' }, '/library', row, 'epub'),
    ).resolves.toBe('/library/Frank Herbert/Dune/01. Dune (1965).epub');
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

  it('triggerAutoFinalize files nothing when auto-finalize is disabled, and holds nothing a person could file', async () => {
    const { service, appSettings, repo } = makeService();
    appSettings.getAutoFinalizeSettings.mockResolvedValue({
      enabled: false,
      threshold: 80,
      libraryId: 1,
      folderId: 2,
      metadataMode: 'safe_merge',
    });
    repo.findById.mockResolvedValue(makeRow({ targetLibraryId: 5, targetFolderId: 9, confidence: 10 }));
    const { file } = stubAutoFile(service);

    await service.triggerAutoFinalize(1);

    expect(file).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  describe('auto-finalize destination', () => {
    const noDefault = { enabled: true, threshold: 80, libraryId: null, folderId: null, metadataMode: 'safe_merge' as const };
    const withDefault = { enabled: true, threshold: 80, libraryId: 5, folderId: 9, metadataMode: 'safe_merge' as const };

    function spyOnFinalize(service: BookDockFinalizeService) {
      return stubAutoFile(service).prepare;
    }

    it('files a row into its own destination when no default library is configured', async () => {
      const { service, appSettings, repo } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue(noDefault);
      repo.findById.mockResolvedValue(makeRow({ targetLibraryId: 3, targetFolderId: 7 }));
      const finalizeSpy = spyOnFinalize(service);

      await service.triggerAutoFinalize(1);

      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      expect(finalizeSpy.mock.calls[0]?.slice(1, 3)).toEqual([3, 7]);
    });

    it('leaves a row without a destination for review when no default library is configured', async () => {
      const { service, appSettings, repo } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue(noDefault);
      repo.findById.mockResolvedValue(makeRow());
      const finalizeSpy = spyOnFinalize(service);

      await service.triggerAutoFinalize(1);

      expect(finalizeSpy).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith(1, { holdReason: 'no_destination', holdDetail: null });
    });

    it('prefers the row destination over the default library', async () => {
      const { service, appSettings, repo } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue(withDefault);
      repo.findById.mockResolvedValue(makeRow({ targetLibraryId: 3, targetFolderId: 7 }));
      const finalizeSpy = spyOnFinalize(service);

      await service.triggerAutoFinalize(1);

      expect(finalizeSpy.mock.calls[0]?.slice(1, 3)).toEqual([3, 7]);
    });

    it('files a row without a destination into the default library and folder', async () => {
      const { service, appSettings, repo } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue(withDefault);
      repo.findById.mockResolvedValue(makeRow());
      const finalizeSpy = spyOnFinalize(service);

      await service.triggerAutoFinalize(1);

      expect(finalizeSpy.mock.calls[0]?.slice(1, 3)).toEqual([5, 9]);
    });

    it('fills a missing folder from the default only when the default library is the row library', async () => {
      const { service, appSettings, repo } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue(withDefault);
      const finalizeSpy = spyOnFinalize(service);

      repo.findById.mockResolvedValueOnce(makeRow({ targetLibraryId: 5, targetFolderId: null }));
      await service.triggerAutoFinalize(1);
      expect(finalizeSpy.mock.calls[0]?.slice(1, 3)).toEqual([5, 9]);

      repo.findById.mockResolvedValueOnce(makeRow({ targetLibraryId: 3, targetFolderId: null }));
      await service.triggerAutoFinalize(1);
      expect(finalizeSpy).toHaveBeenCalledTimes(1);
      expect(repo.update).toHaveBeenLastCalledWith(1, { holdReason: 'no_folder', holdDetail: { libraryId: 3, libraryName: 'Library 3' } });
    });

    it('requeues every ready row except those another module owns', async () => {
      const { service, repo, appSettings } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue(noDefault);
      repo.findSelectionBatch
        .mockResolvedValueOnce([
          makeRow({ id: 1, targetLibraryId: 3, targetFolderId: 7 }),
          makeRow({ id: 2 }),
          makeRow({ id: 3, autoFinalizeSuppressed: true }),
        ])
        .mockResolvedValueOnce([]);
      const enqueueSpy = vi.spyOn((service as any).autoFinalizeQueue, 'enqueue').mockReturnValue(true);

      await expect(service.requeueAutoFinalizeCandidates()).resolves.toBe(2);

      expect(enqueueSpy).toHaveBeenCalledWith(1);
      expect(enqueueSpy).toHaveBeenCalledWith(2);
      expect(enqueueSpy).not.toHaveBeenCalledWith(3);
    });

    it('requeues nothing on resume when neither the global settings nor any dock files by itself', async () => {
      const { service, repo, appSettings, dockRegistry } = makeService();
      appSettings.getAutoFinalizeSettings.mockResolvedValue({ ...noDefault, enabled: false });
      dockRegistry.all.mockResolvedValue([makeDock({ autoFinalizeEnabled: false }), makeDock({ id: 12, autoFinalizeEnabled: null })]);

      await expect(service.requeueAutoFinalizeCandidates()).resolves.toBe(0);
      expect(repo.findSelectionBatch).not.toHaveBeenCalled();

      dockRegistry.all.mockResolvedValue([makeDock({ autoFinalizeEnabled: true })]);
      repo.findSelectionBatch.mockResolvedValueOnce([makeRow({ id: 1, dockId: 11 })]).mockResolvedValueOnce([]);
      vi.spyOn((service as any).autoFinalizeQueue, 'enqueue').mockReturnValue(true);
      await expect(service.requeueAutoFinalizeCandidates()).resolves.toBe(1);
    });
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
