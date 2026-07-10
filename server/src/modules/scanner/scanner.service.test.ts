vi.mock('./lib/walk');
vi.mock('./lib/hash');
vi.mock('./lib/stability', () => ({ waitForStability: vi.fn().mockResolvedValue(undefined) }));
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn().mockResolvedValue({ isFile: () => true, ino: 2001n, size: 1024, mtime: new Date('2024-01-01') }),
  };
});

import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@bookorbit/types';
import type { MockedFunction } from 'vitest';
import type { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';

import { ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED } from '../achievement/achievement-events.service';
import { ScannerService } from './scanner.service';
import { ScanJobStore } from './scan-job-store.service';
import { DEFAULT_FORMAT_PRIORITY } from './lib/classify';
import type { BookCandidate, FileStat } from './lib/walk';
import { findBookCandidates, findLooseFileCandidates, buildSingleBookCandidate, clampIno } from './lib/walk';
import { computeFileHash } from './lib/hash';
import * as assembleBookCardsModule from '../book/utils/assemble-book-cards';

const mockFindCandidates = findBookCandidates as MockedFunction<typeof findBookCandidates>;
const mockFindLooseCandidates = findLooseFileCandidates as MockedFunction<typeof findLooseFileCandidates>;
const mockBuildSingleCandidate = buildSingleBookCandidate as MockedFunction<typeof buildSingleBookCandidate>;
const mockClampIno = clampIno as MockedFunction<typeof clampIno>;
const mockFingerprint = computeFileHash as MockedFunction<typeof computeFileHash>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockStat = stat as MockedFunction<typeof stat>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFileStat(overrides: Partial<FileStat> = {}): FileStat {
  return {
    absolutePath: '/library/Author/Book/book.epub',
    relPath: 'Author/Book/book.epub',
    ino: 1001,
    sizeBytes: 1024,
    mtime: new Date('2024-01-01'),
    ...overrides,
  };
}

function makeCandidate(folderPath: string, files: FileStat[]): BookCandidate {
  return { folderPath, files };
}

function makeBookFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    bookId: 1,
    libraryFolderId: 1,
    absolutePath: '/library/Author/Book/book.epub',
    relPath: 'Author/Book/book.epub',
    ino: 1001,
    sizeBytes: 1024,
    mtime: new Date('2024-01-01'),
    fileHash: 'abc123',
    format: 'epub',
    role: 'content',
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    failAllRunningJobs: vi.fn().mockResolvedValue(undefined),
    findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    findLibrarySettings: vi.fn().mockResolvedValue({
      allowedFormats: [],
      formatPriority: DEFAULT_FORMAT_PRIORITY,
      metadataPrecedence: ['embedded', 'opfFile'],
      excludePatterns: [],
      organizationMode: 'book_per_folder',
    }),
    findLibraryAccessibleUserIds: vi.fn().mockResolvedValue([]),
    createScanJob: vi.fn().mockResolvedValue({ id: 100 }),
    completeScanJob: vi.fn().mockResolvedValue(undefined),
    failScanJob: vi.fn().mockResolvedValue(undefined),
    findBooksByLibraryFolder: vi.fn().mockResolvedValue([]),
    findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
    createBook: vi.fn().mockResolvedValue({ id: 1, status: 'present', libraryFolderId: 1, folderPath: '/library/Author/Book', libraryId: 1 }),
    promoteProcessingBookToPresent: vi.fn().mockResolvedValue(true),
    updateBookStatus: vi.fn().mockResolvedValue(undefined),
    updateBookPrimaryFile: vi.fn().mockResolvedValue(undefined),
    markBooksAsMissing: vi.fn().mockResolvedValue(undefined),
    createBookFile: vi.fn().mockResolvedValue(makeBookFile()),
    updateBookFile: vi.fn().mockResolvedValue(makeBookFile()),
    findBookFileByAbsolutePath: vi.fn().mockResolvedValue(null),
    findBookFileByHash: vi.fn().mockResolvedValue(null),
    findBookFileWithContextByIno: vi.fn().mockResolvedValue(null),
    findMissingBookFileWithContextByIno: vi.fn().mockResolvedValue(null),
    findBookFileWithContextByHash: vi.fn().mockResolvedValue(null),
    findMissingBookFileWithContextByHash: vi.fn().mockResolvedValue(null),
    moveBookToLibrary: vi.fn().mockImplementation((bookId: number, libraryId: number, libraryFolderId: number, folderPath: string) =>
      Promise.resolve({
        id: bookId,
        libraryId,
        libraryFolderId,
        folderPath,
        status: 'present',
      }),
    ),
    findPrimaryBookFilesByLibrary: vi.fn().mockResolvedValue([]),
    findBooksByFolderPath: vi.fn().mockResolvedValue([]),
    findBookFilesByBookId: vi.fn().mockResolvedValue([]),
    findBookFilesByBookIds: vi.fn().mockResolvedValue([]),
    findBookById: vi.fn().mockResolvedValue(null),
    findBooksByIds: vi.fn().mockResolvedValue([]),
    findBookCardData: vi.fn().mockResolvedValue({ rows: [], authorRows: [], fileRows: [], genreRows: [] }),
    deleteBookFile: vi.fn().mockResolvedValue(undefined),
    updateBookFolderPath: vi.fn().mockResolvedValue(undefined),
    findDirScanState: vi.fn().mockResolvedValue(new Map()),
    upsertDirScanState: vi.fn().mockResolvedValue(undefined),
    deleteStaleDirScanState: vi.fn().mockResolvedValue(undefined),
    clearDirScanState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const mockGateway = {
  emitProgress: vi.fn(),
  emitBookMissing: vi.fn(),
  emitBookRestored: vi.fn(),
  emitBookMoved: vi.fn(),
  emitBookTransferred: vi.fn(),
  emitBooksAdded: vi.fn(),
  emitCoverRefreshed: vi.fn(),
  emitCoverRefreshProgress: vi.fn(),
};

const mockMetadata = {
  extractAndSave: vi.fn().mockResolvedValue(undefined),
  refreshCoverForBook: vi.fn().mockResolvedValue(false),
  extractAudioFileDuration: vi.fn().mockResolvedValue(undefined),
  aggregateAudioDuration: vi.fn().mockResolvedValue(undefined),
  extractAudioChaptersAndNarrators: vi.fn().mockResolvedValue(undefined),
};

function makeService(
  repo: ReturnType<typeof makeRepo>,
  autoFetchOrchestrator?: { scheduleImportedBooksIfEligible: (...args: unknown[]) => Promise<number> },
) {
  const jobStore = new ScanJobStore();
  const notificationService = { notify: vi.fn().mockResolvedValue(undefined) };
  const achievementEvents = { emit: vi.fn() };
  const service = new ScannerService(
    repo as any,
    mockMetadata as any,
    jobStore,
    mockGateway as any,
    notificationService as any,
    autoFetchOrchestrator as any,
    achievementEvents as any,
  );
  return { service, jobStore, notificationService, achievementEvents };
}

/**
 * Await the async scan by hooking into completeScanJob/failScanJob.
 * Must be called before startScan so the mock is set up in time.
 */
function awaitScan(repo: ReturnType<typeof makeRepo>): Promise<void> {
  return new Promise<void>((resolve) => {
    repo.completeScanJob.mockImplementationOnce(() => {
      resolve();
      return Promise.resolve(undefined);
    });
    repo.failScanJob.mockImplementationOnce(() => {
      resolve();
      return Promise.resolve(undefined);
    });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  mockFindCandidates.mockResolvedValue({ candidates: [], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });
  mockFindLooseCandidates.mockResolvedValue({ candidates: [], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });
  mockBuildSingleCandidate.mockResolvedValue(null);
  mockClampIno.mockImplementation((ino: bigint) => {
    return ino > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(ino);
  });
  mockFingerprint.mockResolvedValue('hash-abc');
  mockReaddir.mockResolvedValue([]);
  mockStat.mockResolvedValue({ isFile: () => true, ino: 2001n, size: 1024, mtime: new Date('2024-01-01') } as any);
  delete (mockMetadata as Record<string, unknown>).extractAndSaveIfAvailable;
});

// ── startScan — precondition checks ──────────────────────────────────────────

describe('startScan — preconditions', () => {
  it('throws ConflictException when a scan is already running for the library', async () => {
    const repo = makeRepo();
    const { service, jobStore } = makeService(repo);
    jobStore.create(99, 1, 0); // simulate running scan for library 1

    await expect(service.startScan(1, 'manual')).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when library has no configured folders', async () => {
    const repo = makeRepo({ findLibraryFolders: vi.fn().mockResolvedValue([]) });
    const { service } = makeService(repo);

    await expect(service.startScan(1, 'manual')).rejects.toThrow(NotFoundException);
  });

  it('returns a jobId immediately without waiting for scan to finish', async () => {
    const repo = makeRepo();
    void awaitScan(repo); // set up so it doesn't hang
    const { service } = makeService(repo);

    const result = await service.startScan(1, 'manual');
    expect(result).toHaveProperty('jobId', 100);
  });
});

// ── Missing book detection ────────────────────────────────────────────────────

describe('missing book detection', () => {
  it('marks books as missing when they are in the DB but not found in candidates', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 5, libraryId: 1, libraryFolderId: 1, folderPath: '/library/old/book', status: 'present' },
        { id: 6, libraryId: 1, libraryFolderId: 1, folderPath: '/library/old/other', status: 'present' },
      ]),
    });
    mockFindCandidates.mockResolvedValue({ candidates: [], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() }); // nothing found on disk

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).toHaveBeenCalledWith([5, 6]);
  });

  it('does not mark books as missing when they appear in candidates', async () => {
    const folderPath = '/library/Author/Book';
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([{ id: 5, libraryId: 1, libraryFolderId: 1, folderPath, status: 'present' }]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate(folderPath, [makeFileStat()])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    repo.createBook.mockResolvedValue({ id: 5, status: 'present', libraryFolderId: 1, folderPath, libraryId: 1 });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
  });

  it('does not mark books as missing when their tracked content files still exist on disk', async () => {
    const folderPath = '/library/Author/Book';
    const file = makeBookFile({ id: 10, bookId: 5, absolutePath: `${folderPath}/book.epub`, relPath: 'Author/Book/book.epub' });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([{ id: 5, libraryId: 1, libraryFolderId: 1, folderPath, status: 'present' }]),
      findBookFilesByBookIds: vi.fn().mockResolvedValue([file]),
    });
    mockFindCandidates.mockResolvedValue({ candidates: [], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.findBookFilesByBookIds).toHaveBeenCalledWith([5]);
    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
  });

  it('marks books as missing when their tracked content files no longer exist on disk', async () => {
    const folderPath = '/library/Author/Book';
    const file = makeBookFile({ id: 10, bookId: 5, absolutePath: `${folderPath}/book.epub`, relPath: 'Author/Book/book.epub' });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([{ id: 5, libraryId: 1, libraryFolderId: 1, folderPath, status: 'present' }]),
      findBookFilesByBookIds: vi.fn().mockResolvedValue([file]),
    });
    mockFindCandidates.mockResolvedValue({ candidates: [], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });
    mockStat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).toHaveBeenCalledWith([5]);
  });

  it('does not let existing non-content files keep a book present when content is gone', async () => {
    const folderPath = '/library/Author/Book';
    const cover = makeBookFile({
      id: 10,
      bookId: 5,
      absolutePath: `${folderPath}/cover.jpg`,
      relPath: 'Author/Book/cover.jpg',
      format: 'jpg',
      role: 'cover',
    });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([{ id: 5, libraryId: 1, libraryFolderId: 1, folderPath, status: 'present' }]),
      findBookFilesByBookIds: vi.fn().mockResolvedValue([cover]),
    });
    mockFindCandidates.mockResolvedValue({ candidates: [], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).toHaveBeenCalledWith([5]);
  });
});

describe('books unavailable notifications', () => {
  it('buffers and deduplicates missing book notifications', () => {
    const repo = makeRepo();
    const { service, notificationService } = makeService(repo);

    service.bufferBooksUnavailableNotification(9, [1, 2, 2]);
    service.bufferBooksUnavailableNotification(9, [3]);
    (service as any).flushBooksUnavailableNotification(9);

    expect(notificationService.notify).toHaveBeenCalledWith({
      type: NotificationType.BooksUnavailable,
      title: 'Books unavailable',
      message: '3 books are no longer available on disk.',
      actionUrl: '/library/9',
      scope: { kind: 'library', libraryId: 9 },
      meta: { libraryId: 9, count: 3 },
    });
  });

  it('uses singular copy for one unavailable book', () => {
    const repo = makeRepo();
    const { service, notificationService } = makeService(repo);

    service.bufferBooksUnavailableNotification(4, [12]);
    (service as any).flushBooksUnavailableNotification(4);

    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Book unavailable',
        message: '1 book is no longer available on disk.',
        meta: { libraryId: 4, count: 1 },
      }),
    );
  });

  it('buffers and deduplicates restored book notifications', () => {
    const repo = makeRepo();
    const { service, notificationService } = makeService(repo);

    service.bufferBooksRestoredNotification(9, [1, 2, 2]);
    service.bufferBooksRestoredNotification(9, [3]);
    (service as any).flushBooksRestoredNotification(9);

    expect(notificationService.notify).toHaveBeenCalledWith({
      type: NotificationType.BooksRestored,
      title: 'Books restored',
      message: '3 books were restored on disk.',
      actionUrl: '/library/9',
      scope: { kind: 'library', libraryId: 9 },
      meta: { libraryId: 9, count: 3 },
    });
  });

  it('cancels pending unavailable notifications when the same books are restored', () => {
    const repo = makeRepo();
    const { service, notificationService } = makeService(repo);

    service.bufferBooksUnavailableNotification(9, [2]);
    service.bufferBooksRestoredNotification(9, [2]);
    (service as any).flushBooksUnavailableNotification(9);

    expect(notificationService.notify).toHaveBeenCalledTimes(0);

    (service as any).flushBooksRestoredNotification(9);
    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BooksRestored,
        meta: { libraryId: 9, count: 1 },
      }),
    );
  });

  it('buffers missing websocket events and emits only books still missing in that library', async () => {
    const repo = makeRepo({
      findBooksByIds: vi.fn().mockResolvedValue([
        { id: 1, libraryId: 9, status: 'missing' },
        { id: 2, libraryId: 9, status: 'present' },
        { id: 3, libraryId: 8, status: 'missing' },
      ]),
    });
    const { service } = makeService(repo);

    service.bufferBookMissingEvent(9, [1, 2, 3]);
    await (service as any).flushBookMissingEvent(9);

    expect(repo.findBooksByIds).toHaveBeenCalledWith([1, 2, 3]);
    expect(mockGateway.emitBookMissing).toHaveBeenCalledWith({ libraryId: 9, bookIds: [1] });
  });

  it('cancels pending missing websocket events when unavailable notifications are canceled', async () => {
    const repo = makeRepo({
      findBooksByIds: vi.fn().mockResolvedValue([{ id: 2, libraryId: 9, status: 'missing' }]),
    });
    const { service } = makeService(repo);

    service.bufferBookMissingEvent(9, [2]);
    service.cancelBooksUnavailableNotification(9, [2]);
    await (service as any).flushBookMissingEvent(9);

    expect(mockGateway.emitBookMissing).not.toHaveBeenCalled();
    expect(repo.findBooksByIds).not.toHaveBeenCalled();
  });

  it('uses singular copy for one restored book', () => {
    const repo = makeRepo();
    const { service, notificationService } = makeService(repo);

    service.bufferBooksRestoredNotification(4, [12]);
    (service as any).flushBooksRestoredNotification(4);

    expect(notificationService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.BooksRestored,
        title: 'Book restored',
        message: '1 book was restored on disk.',
        meta: { libraryId: 4, count: 1 },
      }),
    );
  });
});

describe('achievement event emission', () => {
  it('emits library catalog changed for accessible users when unavailable notification flushes', async () => {
    const repo = makeRepo({
      findLibraryAccessibleUserIds: vi.fn().mockResolvedValue([7, 11]),
    });
    const { service, achievementEvents } = makeService(repo);

    service.bufferBooksUnavailableNotification(9, [1, 2]);
    (service as any).flushBooksUnavailableNotification(9);

    await vi.waitFor(() => {
      expect(achievementEvents.emit).toHaveBeenCalledTimes(2);
    });
    expect(repo.findLibraryAccessibleUserIds).toHaveBeenCalledWith(9);
    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: 7, libraryId: 9 });
    expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: 11, libraryId: 9 });
  });

  it('emits library catalog changed when a scan changes library contents', async () => {
    const repo = makeRepo({
      findLibraryAccessibleUserIds: vi.fn().mockResolvedValue([3]),
      findBookCardData: vi.fn().mockResolvedValue({ rows: [], authorRows: [], fileRows: [], genreRows: [] }),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/New Book', [makeFileStat({ absolutePath: '/library/Author/New Book/book.epub' })])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service, achievementEvents } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    await vi.waitFor(() => {
      expect(achievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, { userId: 3, libraryId: 1 });
    });
  });
});

// ── excludePatterns wiring ────────────────────────────────────────────────────

describe('excludePatterns', () => {
  it('passes excludePatterns from library settings to findBookCandidates', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: ['#recycle', '*.bak'],
        organizationMode: 'book_per_folder',
      }),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockFindCandidates).toHaveBeenCalledWith('/library', ['#recycle', '*.bak'], expect.any(Function), undefined);
  });
});

// ── New file — happy path ─────────────────────────────────────────────────────

describe('genuinely new primary file', () => {
  it('creates a book record and a book file record', async () => {
    const candidate = makeCandidate('/library/Author/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.createBook).toHaveBeenCalled();
    expect(repo.createBookFile).toHaveBeenCalledWith(
      expect.objectContaining({ absolutePath: '/library/Author/Book/book.epub', format: 'epub', role: 'content' }),
    );
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });

  it('keeps the primary file when a concurrent scan already inserted the file row', async () => {
    const candidate = makeCandidate('/library/Author/Book', [makeFileStat()]);
    const existingFile = makeBookFile({ id: 42, bookId: 1 });
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo({
      createBookFile: vi.fn().mockRejectedValue(new Error('duplicate absolute path')),
      findBookFileByAbsolutePath: vi.fn().mockResolvedValue({
        file: existingFile,
        libraryId: 1,
        primaryFileId: 42,
      }),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.findBookFileByAbsolutePath).toHaveBeenCalledWith('/library/Author/Book/book.epub');
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(1, 42);
    expect(repo.updateBookPrimaryFile).not.toHaveBeenCalledWith(1, null);
  });

  it('extracts metadata when an existing book had no primary file selected', async () => {
    const file = makeFileStat();
    const candidate = makeCandidate('/library/Author/Book', [file]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        {
          id: 1,
          status: 'present',
          folderPath: '/library/Author/Book',
          primaryFileId: null,
        },
      ]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([makeBookFile({ id: 42, bookId: 1 })]),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.createBookFile).not.toHaveBeenCalled();
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(1, 42);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(1, '/library/Author/Book/book.epub', 'epub');
  });

  it('extracts metadata for new primary files in supported formats', async () => {
    const candidate = makeCandidate('/library/Author/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Author/Book/book.epub', 'epub');
  });

  it('queues import metadata fetch only after local metadata extraction and book promotion', async () => {
    const candidate = makeCandidate('/library/Author/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const order: string[] = [];
    mockMetadata.extractAndSave.mockImplementation(() => {
      order.push('extract');
      return Promise.resolve();
    });
    const repo = makeRepo({
      promoteProcessingBookToPresent: vi.fn().mockImplementation(() => {
        order.push('promote');
        return Promise.resolve(true);
      }),
    });
    const autoFetchOrchestrator = {
      scheduleImportedBooksIfEligible: vi.fn().mockImplementation(() => {
        order.push('schedule');
        return Promise.resolve(1);
      }),
    };
    const done = awaitScan(repo);
    const { service } = makeService(repo, autoFetchOrchestrator);

    await service.startScan(1, 'manual');
    await done;

    expect(order).toEqual(['extract', 'promote', 'schedule']);
    expect(autoFetchOrchestrator.scheduleImportedBooksIfEligible).toHaveBeenCalledWith(1, [1]);
  });

  it('does not extract metadata for non-primary files', async () => {
    const primary = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub' });
    const cover = makeFileStat({ absolutePath: '/library/Book/cover.jpg', relPath: 'Book/cover.jpg', sizeBytes: 512 });
    const candidate = makeCandidate('/library/Book', [primary, cover]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // extractAndSave called once for epub, not for cover.jpg
    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Book/book.epub', 'epub');
  });

  it('extracts sidecar OPF metadata when opfFile precedes embedded metadata', async () => {
    const primary = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', format: 'epub', role: 'content' });
    const opf = makeFileStat({
      absolutePath: '/library/Book/metadata.opf',
      relPath: 'Book/metadata.opf',
      ino: 1002,
      format: 'opf',
      role: 'metadata',
    });
    const candidate = makeCandidate('/library/Book', [primary, opf]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        metadataPrecedence: ['opfFile', 'embedded'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Book/metadata.opf', 'opf');
  });

  it('keeps embedded metadata ahead of sidecar OPF when embedded precedes opfFile', async () => {
    const primary = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', format: 'epub', role: 'content' });
    const opf = makeFileStat({
      absolutePath: '/library/Book/metadata.opf',
      relPath: 'Book/metadata.opf',
      ino: 1002,
      format: 'opf',
      role: 'metadata',
    });
    const candidate = makeCandidate('/library/Book', [primary, opf]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Book/book.epub', 'epub');
  });

  it('falls back to embedded metadata when preferred OPF has no usable metadata', async () => {
    const extractAndSaveIfAvailable = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    (mockMetadata as Record<string, unknown>).extractAndSaveIfAvailable = extractAndSaveIfAvailable;
    const primary = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', format: 'epub', role: 'content' });
    const opf = makeFileStat({
      absolutePath: '/library/Book/metadata.opf',
      relPath: 'Book/metadata.opf',
      ino: 1002,
      format: 'opf',
      role: 'metadata',
    });
    const candidate = makeCandidate('/library/Book', [primary, opf]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        metadataPrecedence: ['opfFile', 'embedded'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(extractAndSaveIfAvailable).toHaveBeenNthCalledWith(1, expect.any(Number), '/library/Book/metadata.opf', 'opf');
    expect(extractAndSaveIfAvailable).toHaveBeenNthCalledWith(2, expect.any(Number), '/library/Book/book.epub', 'epub');
    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
  });

  it('does not fall back to embedded metadata when preferred OPF extraction throws', async () => {
    const extractAndSaveIfAvailable = vi.fn().mockRejectedValueOnce(new Error('persist failed'));
    (mockMetadata as Record<string, unknown>).extractAndSaveIfAvailable = extractAndSaveIfAvailable;
    const primary = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', format: 'epub', role: 'content' });
    const opf = makeFileStat({
      absolutePath: '/library/Book/metadata.opf',
      relPath: 'Book/metadata.opf',
      ino: 1002,
      format: 'opf',
      role: 'metadata',
    });
    const candidate = makeCandidate('/library/Book', [primary, opf]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        metadataPrecedence: ['opfFile', 'embedded'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(extractAndSaveIfAvailable).toHaveBeenCalledTimes(1);
    expect(extractAndSaveIfAvailable).toHaveBeenCalledWith(expect.any(Number), '/library/Book/metadata.opf', 'opf');
    expect(repo.completeScanJob).toHaveBeenCalled();
    expect(repo.failScanJob).not.toHaveBeenCalled();
  });

  it('extracts sidecar OPF metadata when the OPF file changes and content is unchanged', async () => {
    const primary = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', format: 'epub', role: 'content' });
    const opf = makeFileStat({
      absolutePath: '/library/Book/metadata.opf',
      relPath: 'Book/metadata.opf',
      ino: 1002,
      sizeBytes: 128,
      mtime: new Date('2024-01-02'),
      format: 'opf',
      role: 'metadata',
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [primary, opf])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        metadataPrecedence: ['opfFile', 'embedded'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Book', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([
        makeBookFile({ id: 10, bookId: 1, absolutePath: primary.absolutePath, relPath: primary.relPath, ino: primary.ino }),
        makeBookFile({
          id: 11,
          bookId: 1,
          absolutePath: opf.absolutePath,
          relPath: opf.relPath,
          ino: opf.ino,
          sizeBytes: 128,
          mtime: new Date('2024-01-01'),
          format: 'opf',
          role: 'metadata',
          sortOrder: 1,
        }),
      ]),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Book/metadata.opf', 'opf');
  });

  it('continues scanning when metadata extraction fails', async () => {
    mockMetadata.extractAndSave.mockRejectedValueOnce(new Error('parse error'));
    const candidate = makeCandidate('/library/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.completeScanJob).toHaveBeenCalled();
    expect(repo.failScanJob).not.toHaveBeenCalled();
  });
});

// ── Zero-byte file handling ───────────────────────────────────────────────────

describe('zero-byte primary files', () => {
  it('skips zero-byte primary files — no book file created, no metadata extracted', async () => {
    const zeroByte = makeFileStat({ sizeBytes: 0 });
    const candidate = makeCandidate('/library/Book', [zeroByte]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.createBookFile).not.toHaveBeenCalled();
    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
  });

  it('zero-byte primary does not win format election — valid sibling format gets primary role', async () => {
    // epub is first in formatPriority but is zero-byte → should NOT win
    // pdf is second and valid → should get primary role
    const zeroByte = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', sizeBytes: 0 });
    const valid = makeFileStat({ absolutePath: '/library/Book/book.pdf', relPath: 'Book/book.pdf', format: 'pdf' } as any);
    const candidate = makeCandidate('/library/Book', [zeroByte, valid]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.createBookFile).toHaveBeenCalledWith(expect.objectContaining({ absolutePath: '/library/Book/book.pdf', role: 'content' }));
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  });
});

// ── File identity resolution ──────────────────────────────────────────────────

describe('file identity resolution', () => {
  it('updates the book file record when path matches but mtime changed', async () => {
    const oldMtime = new Date('2023-01-01');
    const newMtime = new Date('2024-06-01');
    const fileStat = makeFileStat({ mtime: newMtime });

    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([makeBookFile({ absolutePath: fileStat.absolutePath, mtime: oldMtime })]),
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFile).toHaveBeenCalledWith(1, expect.objectContaining({ mtime: newMtime }));
    expect(repo.createBookFile).not.toHaveBeenCalled();
  });

  it('does not update when path matches and file is unchanged', async () => {
    const mtime = new Date('2024-01-01');
    const fileStat = makeFileStat({ mtime });

    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([makeBookFile({ mtime, sizeBytes: fileStat.sizeBytes })]),
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFile).not.toHaveBeenCalled();
    expect(repo.createBookFile).not.toHaveBeenCalled();
  });

  it('updates path when inode matches a known file at a different path (renamed file)', async () => {
    const fileStat = makeFileStat({ absolutePath: '/library/Author/Book/renamed.epub', relPath: 'Author/Book/renamed.epub', ino: 9999 });

    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([makeBookFile({ absolutePath: '/library/Author/Book/old-name.epub', ino: 9999 })]),
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFile).toHaveBeenCalledWith(1, expect.objectContaining({ absolutePath: '/library/Author/Book/renamed.epub' }));
    expect(repo.createBookFile).not.toHaveBeenCalled();
  });

  it('reuses existing book id when an entire book folder is renamed via inode match', async () => {
    const renamedFile = makeFileStat({
      absolutePath: '/library/Author/NewName/book.epub',
      relPath: 'Author/NewName/book.epub',
      ino: 9090,
    });
    const existingFile = makeBookFile({
      id: 21,
      bookId: 10,
      absolutePath: '/library/Author/OldName/book.epub',
      relPath: 'Author/OldName/book.epub',
      ino: 9090,
      fileHash: 'rename-hash',
    });

    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 10, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/OldName', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([existingFile]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/NewName', [renamedFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).toHaveBeenCalledWith(10, '/library/Author/NewName');
    expect(repo.updateBookFile).toHaveBeenCalledWith(
      21,
      expect.objectContaining({
        bookId: 10,
        absolutePath: '/library/Author/NewName/book.epub',
        relPath: 'Author/NewName/book.epub',
      }),
    );
    expect(repo.createBook).not.toHaveBeenCalled();
    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
  });

  it('reuses existing book id for renamed folders when inode is 0 using hash fallback', async () => {
    const renamedFile = makeFileStat({
      absolutePath: '/library/Author/NewName/book.epub',
      relPath: 'Author/NewName/book.epub',
      ino: 0,
    });
    const existingFile = makeBookFile({
      id: 31,
      bookId: 11,
      absolutePath: '/library/Author/OldName/book.epub',
      relPath: 'Author/OldName/book.epub',
      ino: 0,
      fileHash: 'rename-hash',
    });

    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 11, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/OldName', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([existingFile]),
      findBookFileByHash: vi.fn().mockResolvedValue(existingFile),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/NewName', [renamedFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    mockFingerprint.mockResolvedValue('rename-hash');

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).toHaveBeenCalledWith(11, '/library/Author/NewName');
    expect(repo.updateBookFile).toHaveBeenCalledWith(
      31,
      expect.objectContaining({
        bookId: 11,
        absolutePath: '/library/Author/NewName/book.epub',
        relPath: 'Author/NewName/book.epub',
      }),
    );
    expect(repo.createBook).not.toHaveBeenCalled();
    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
  });

  it('gracefully skips a file that disappears during fingerprinting (ENOENT) — scan still completes', async () => {
    const fileStat = makeFileStat({ ino: 7777 }); // different ino so inode match fails
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    mockFingerprint.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.createBookFile).not.toHaveBeenCalled();
    expect(repo.completeScanJob).toHaveBeenCalled();
    expect(repo.failScanJob).not.toHaveBeenCalled();
  });

  it('updates path when hash matches a known file from a different filesystem (cross-fs move)', async () => {
    const fileStat = makeFileStat({ absolutePath: '/library/moved.epub', relPath: 'moved.epub', ino: 8888 });
    const existingFile = makeBookFile({ absolutePath: '/old-library/book.epub', ino: 1111, fileHash: 'fixed-hash' });

    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([existingFile]),
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
      findBookFileByHash: vi.fn().mockResolvedValue(existingFile),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    mockFingerprint.mockResolvedValue('fixed-hash');

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFile).toHaveBeenCalledWith(existingFile.id, expect.objectContaining({ absolutePath: '/library/moved.epub' }));
    expect(repo.createBookFile).not.toHaveBeenCalled();
  });
});

// ── Format priority ───────────────────────────────────────────────────────────

describe('format priority', () => {
  it('assigns primary file id to the highest-priority format when multiple content files exist', async () => {
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub' });
    const mobi = makeFileStat({ absolutePath: '/library/Book/book.mobi', relPath: 'Book/book.mobi' });
    const candidate = makeCandidate('/library/Book', [epub, mobi]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    repo.createBookFile
      .mockResolvedValueOnce(makeBookFile({ id: 11, absolutePath: epub.absolutePath, format: 'epub', role: 'content' }))
      .mockResolvedValueOnce(makeBookFile({ id: 12, absolutePath: mobi.absolutePath, format: 'mobi', role: 'content' }));
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // epub comes before mobi in DEFAULT_FORMAT_PRIORITY
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(expect.any(Number), 11);
  });
});

// ── allowedFormats filtering ──────────────────────────────────────────────────

describe('allowedFormats filtering', () => {
  it('excludes primary files whose format is not in allowedFormats', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: ['epub'],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
    });

    // findBookCandidates returns both, but the service filters before processing
    mockFindCandidates.mockResolvedValue({
      candidates: [
        makeCandidate('/library/Book', [
          makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub' }),
          makeFileStat({ absolutePath: '/library/Book/book.cbz', relPath: 'Book/book.cbz' }),
        ]),
      ],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    const createdPaths = repo.createBookFile.mock.calls.map((c: any) => c[0].absolutePath);
    expect(createdPaths.some((p: string) => p.endsWith('.cbz'))).toBe(false);
  });
});

// ── Audio multi-file handling ─────────────────────────────────────────────────

describe('audio multi-file audiobook', () => {
  it('calls extractAndSave on the winner (first natural-sorted) audio file only', async () => {
    const file1 = makeFileStat({ absolutePath: '/library/Book/chapter-01.mp3', relPath: 'Book/chapter-01.mp3' });
    const file2 = makeFileStat({ absolutePath: '/library/Book/chapter-02.mp3', relPath: 'Book/chapter-02.mp3', ino: 1002 });
    const candidate = makeCandidate('/library/Book', [file1, file2]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Book/chapter-01.mp3', 'mp3');
  });

  it('calls extractAudioFileDuration for ALL new audio files including the winner', async () => {
    const file1 = makeFileStat({ absolutePath: '/library/Book/chapter-01.mp3', relPath: 'Book/chapter-01.mp3' });
    const file2 = makeFileStat({ absolutePath: '/library/Book/chapter-02.mp3', relPath: 'Book/chapter-02.mp3', ino: 1002 });
    const file3 = makeFileStat({ absolutePath: '/library/Book/chapter-03.mp3', relPath: 'Book/chapter-03.mp3', ino: 1003 });
    const candidate = makeCandidate('/library/Book', [file1, file2, file3]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // All 3 files including the first (winner) must get per-file duration so
    // aggregateAudioDuration can sum them all correctly.
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledTimes(3);
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), '/library/Book/chapter-01.mp3');
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), '/library/Book/chapter-02.mp3');
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), '/library/Book/chapter-03.mp3');
  });

  it('calls aggregateAudioDuration after processing audio files', async () => {
    const file1 = makeFileStat({ absolutePath: '/library/Book/chapter-01.mp3', relPath: 'Book/chapter-01.mp3' });
    const file2 = makeFileStat({ absolutePath: '/library/Book/chapter-02.mp3', relPath: 'Book/chapter-02.mp3', ino: 1002 });
    const candidate = makeCandidate('/library/Book', [file1, file2]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.aggregateAudioDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('calls extractAudioFileDuration once and aggregates for a single-file m4b', async () => {
    const file1 = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b' });
    const candidate = makeCandidate('/library/Book', [file1]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Book/book.m4b', 'm4b');
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), '/library/Book/book.m4b');
    expect(mockMetadata.aggregateAudioDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('does not call aggregateAudioDuration for epub books', async () => {
    const candidate = makeCandidate('/library/Author/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.aggregateAudioDuration).not.toHaveBeenCalled();
  });

  it('uses epub metadata (not audio) when a book has both epub and mp3 files', async () => {
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 2001 });
    const mp3a = makeFileStat({ absolutePath: '/library/Book/book/01.mp3', relPath: 'Book/book/01.mp3', ino: 2002 });
    const mp3b = makeFileStat({ absolutePath: '/library/Book/book/02.mp3', relPath: 'Book/book/02.mp3', ino: 2003 });
    const candidate = makeCandidate('/library/Book', [epub, mp3a, mp3b]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // epub extractAndSave called once, audio extractAndSave NOT called
    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), epub.absolutePath, 'epub');
  });

  it('extracts duration from ALL new audio files when ebook is the winner', async () => {
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 2001 });
    const mp3a = makeFileStat({ absolutePath: '/library/Book/book/01.mp3', relPath: 'Book/book/01.mp3', ino: 2002 });
    const mp3b = makeFileStat({ absolutePath: '/library/Book/book/02.mp3', relPath: 'Book/book/02.mp3', ino: 2003 });
    const candidate = makeCandidate('/library/Book', [epub, mp3a, mp3b]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledTimes(2);
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), mp3a.absolutePath);
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), mp3b.absolutePath);
    expect(mockMetadata.aggregateAudioDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('falls back to audio metadata when no non-audio metadata format is in the candidate', async () => {
    const mp3a = makeFileStat({ absolutePath: '/library/Book/01.mp3', relPath: 'Book/01.mp3' });
    const mp3b = makeFileStat({ absolutePath: '/library/Book/02.mp3', relPath: 'Book/02.mp3', ino: 1002 });
    const candidate = makeCandidate('/library/Book', [mp3a, mp3b]);
    mockFindCandidates.mockResolvedValue({ candidates: [candidate], skippedDirs: new Set(), unchangedDirs: new Set(), dirMtimes: new Map() });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), mp3a.absolutePath, 'mp3');
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), mp3a.absolutePath);
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), mp3b.absolutePath);
  });
});

// -- Multi-format metadata source routing --------------------------------------
//
// These tests verify metadata source routing:
//   - Embedded text metadata comes from the winner content format when embedded is
//     the active source.
//   - Audio-specific fields (chapters, narrators, duration) always come from audio
//     via extractAudioChaptersAndNarrators when audio is present and not the winner.
//   - Non-winning content formats do not contribute embedded metadata.

describe('multi-format metadata source routing', () => {
  it('m4b primary + epub secondary: extracts metadata from m4b only, not epub', async () => {
    // formatPriority has m4b before epub — m4b wins.
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: ['m4b', 'epub', 'pdf'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
    });
    const m4b = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b', ino: 3001 });
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 3002 });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [m4b, epub])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), m4b.absolutePath, 'm4b');
    // epub must not contribute metadata since audio owns everything
    expect(mockMetadata.extractAudioChaptersAndNarrators).not.toHaveBeenCalled();
  });

  it('m4b primary + epub secondary: per-file duration and aggregate run for m4b', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: ['m4b', 'epub', 'pdf'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
    });
    const m4b = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b', ino: 3001 });
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 3002 });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [m4b, epub])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), m4b.absolutePath);
    expect(mockMetadata.aggregateAudioDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('epub primary + m4b secondary: epub owns text/cover, m4b provides chapters/narrators', async () => {
    // Default formatPriority has epub before m4b — epub wins.
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 4001 });
    const m4b = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b', ino: 4002 });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [epub, m4b])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // epub wins — full metadata from epub
    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), epub.absolutePath, 'epub');
    // audio-specific fields from m4b
    expect(mockMetadata.extractAudioChaptersAndNarrators).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAudioChaptersAndNarrators).toHaveBeenCalledWith(expect.any(Number), m4b.absolutePath, 'm4b');
    // per-file duration + aggregate
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), m4b.absolutePath);
    expect(mockMetadata.aggregateAudioDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('epub primary + multi-track m4b: chapters/narrators from first m4b, duration from all m4b files', async () => {
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 5001 });
    const m4b1 = makeFileStat({ absolutePath: '/library/Book/disc-1.m4b', relPath: 'Book/disc-1.m4b', ino: 5002 });
    const m4b2 = makeFileStat({ absolutePath: '/library/Book/disc-2.m4b', relPath: 'Book/disc-2.m4b', ino: 5003 });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [epub, m4b1, m4b2])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // epub wins — full metadata from epub only
    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), epub.absolutePath, 'epub');
    // chapters/narrators from the first m4b (natural sort: disc-1 before disc-2)
    expect(mockMetadata.extractAudioChaptersAndNarrators).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAudioChaptersAndNarrators).toHaveBeenCalledWith(expect.any(Number), m4b1.absolutePath, 'm4b');
    // per-file duration for both m4b files
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledTimes(2);
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), m4b1.absolutePath);
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), m4b2.absolutePath);
    expect(mockMetadata.aggregateAudioDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('epub + pdf + mobi all new: only epub metadata extracted, pdf and mobi are ignored', async () => {
    // epub comes first in DEFAULT_FORMAT_PRIORITY
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 6001 });
    const pdf = makeFileStat({ absolutePath: '/library/Book/book.pdf', relPath: 'Book/book.pdf', ino: 6002 });
    const mobi = makeFileStat({ absolutePath: '/library/Book/book.mobi', relPath: 'Book/book.mobi', ino: 6003 });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [epub, pdf, mobi])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), epub.absolutePath, 'epub');
  });

  it('m4b wins + epub also present: epub never triggers extractAndSave', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: ['m4b', 'epub', 'pdf'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
    });
    const m4b = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b', ino: 7001 });
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 7002 });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [m4b, epub])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    const epubCall = mockMetadata.extractAndSave.mock.calls.find(([, path]) => path === epub.absolutePath);
    expect(epubCall).toBeUndefined();
  });
});

// ── Incremental scan — no re-extraction when source file is unchanged ─────────
//
// Metadata extraction should only fire when the relevant source file is new or
// reassigned, not merely because some other file in the same book changed.

describe('incremental scan — no re-extraction on unchanged winner', () => {
  it('does not call extractAndSave when winner m4b was already scanned and a new epub is added', async () => {
    const m4b = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b', ino: 8001 });
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 8002 });

    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: ['m4b', 'epub', 'pdf'],
        excludePatterns: [],
        organizationMode: 'book_per_folder',
      }),
      // m4b already exists in DB — not new; epub is genuinely new
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Book', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([makeBookFile({ id: 10, bookId: 1, absolutePath: m4b.absolutePath, ino: m4b.ino })]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [m4b, epub])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // m4b is winner but not new — no metadata extraction
    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
    // epub is not audio — no audio extraction either
    expect(mockMetadata.extractAudioChaptersAndNarrators).not.toHaveBeenCalled();
    expect(mockMetadata.extractAudioFileDuration).not.toHaveBeenCalled();
    expect(mockMetadata.aggregateAudioDuration).not.toHaveBeenCalled();
  });

  it('extracts chapters/narrators/duration from new m4b even when winner epub was already scanned', async () => {
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub', ino: 9001 });
    const m4b = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b', ino: 9002 });

    const repo = makeRepo({
      // epub already exists in DB — not new; m4b is genuinely new
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Book', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([makeBookFile({ id: 10, bookId: 1, absolutePath: epub.absolutePath, ino: epub.ino })]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [epub, m4b])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // epub is winner but not new — no extractAndSave
    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
    // m4b is new audio and winner is not audio — extract audio-specific fields
    expect(mockMetadata.extractAudioChaptersAndNarrators).toHaveBeenCalledWith(expect.any(Number), m4b.absolutePath, 'm4b');
    expect(mockMetadata.extractAudioFileDuration).toHaveBeenCalledWith(expect.any(Number), m4b.absolutePath);
    expect(mockMetadata.aggregateAudioDuration).toHaveBeenCalledWith(expect.any(Number));
  });

  it('does not call aggregateAudioDuration when existing audio book has no new files', async () => {
    const m4b = makeFileStat({ absolutePath: '/library/Book/book.m4b', relPath: 'Book/book.m4b', ino: 10001 });

    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Book', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([makeBookFile({ id: 10, bookId: 1, absolutePath: m4b.absolutePath, ino: m4b.ino })]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Book', [m4b])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
    expect(mockMetadata.aggregateAudioDuration).not.toHaveBeenCalled();
  });
});

describe('missing book restoration', () => {
  it('restores a missing book to present when its folder is found again', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 10, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'missing' }]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [makeFileStat()])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookStatus).toHaveBeenCalledWith(10, 'present');
    expect(mockGateway.emitBookRestored).toHaveBeenCalledWith({ libraryId: 1, bookIds: [10] });
    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('does not call updateBookStatus when existing book is already present', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 10, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [makeFileStat()])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookStatus).not.toHaveBeenCalled();
    expect(mockGateway.emitBookRestored).not.toHaveBeenCalled();
  });
});

describe('cross-library transfer', () => {
  it('transfers a missing source book into the destination library via inode match', async () => {
    const destinationFile = makeFileStat({
      absolutePath: '/dest/Inbox/book.epub',
      relPath: 'Inbox/book.epub',
      ino: 4242,
    });
    const sourceFile = makeBookFile({
      id: 500,
      bookId: 42,
      libraryFolderId: 10,
      absolutePath: '/source/Book/book.epub',
      relPath: 'Book/book.epub',
      ino: 4242,
      fileHash: 'transfer-hash',
    });

    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 20, path: '/dest', libraryId: 2 }]),
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
      findMissingBookFileWithContextByIno: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 1,
        bookStatus: 'missing',
        folderPath: '/source/Book',
        libraryFolderPath: '/source',
      }),
      findBookFileWithContextByIno: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 2,
        bookStatus: 'present',
        folderPath: '/dest/Inbox',
        libraryFolderPath: '/source',
      }),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/dest/Inbox', [destinationFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service, notificationService } = makeService(repo);
    service.bufferBooksUnavailableNotification(1, [42]);
    await service.startScan(2, 'manual');
    await done;

    expect(repo.moveBookToLibrary).toHaveBeenCalledWith(42, 2, 20, '/dest/Inbox');
    expect(repo.createBook).not.toHaveBeenCalled();
    expect(repo.updateBookFile).toHaveBeenCalledWith(
      500,
      expect.objectContaining({
        bookId: 42,
        libraryFolderId: 20,
        absolutePath: '/dest/Inbox/book.epub',
        relPath: 'Inbox/book.epub',
      }),
    );
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(42, 500);
    expect(mockGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 2, bookIds: [42] });
    (service as any).flushBooksUnavailableNotification(1);
    expect(notificationService.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: NotificationType.BooksUnavailable }));
  });

  it('transfers a source book when inode matches and the previous path no longer exists', async () => {
    const destinationFile = makeFileStat({
      absolutePath: '/dest/Inbox/book.epub',
      relPath: 'Inbox/book.epub',
      ino: 4343,
    });
    const sourceFile = makeBookFile({
      id: 510,
      bookId: 55,
      libraryFolderId: 10,
      absolutePath: '/source/Book/book.epub',
      relPath: 'Book/book.epub',
      ino: 4343,
      fileHash: 'transfer-hash',
    });

    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 22, path: '/dest', libraryId: 2 }]),
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
      findMissingBookFileWithContextByIno: vi.fn().mockResolvedValue(null),
      findBookFileWithContextByIno: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 1,
        bookStatus: 'present',
        folderPath: '/source/Book',
        libraryFolderPath: '/source',
      }),
      findMissingBookFileWithContextByHash: vi.fn().mockResolvedValue(null),
      findBookFileWithContextByHash: vi.fn().mockResolvedValue(null),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/dest/Inbox', [destinationFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    mockStat.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(2, 'manual');
    await done;

    expect(repo.moveBookToLibrary).toHaveBeenCalledWith(55, 2, 22, '/dest/Inbox');
    expect(repo.createBook).not.toHaveBeenCalled();
    expect(repo.updateBookFile).toHaveBeenCalledWith(
      510,
      expect.objectContaining({
        bookId: 55,
        libraryFolderId: 22,
        absolutePath: '/dest/Inbox/book.epub',
        relPath: 'Inbox/book.epub',
      }),
    );
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(55, 510);
    expect(mockGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 2, bookIds: [55] });
  });

  it('transfers a missing source book via hash fallback when inode differs', async () => {
    const destinationFile = makeFileStat({
      absolutePath: '/dest/Inbox/book.epub',
      relPath: 'Inbox/book.epub',
      ino: 9999,
    });
    const sourceFile = makeBookFile({
      id: 600,
      bookId: 77,
      libraryFolderId: 11,
      absolutePath: '/source/Book/book.epub',
      relPath: 'Book/book.epub',
      ino: 2222,
      fileHash: 'transfer-hash',
    });

    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 21, path: '/dest', libraryId: 3 }]),
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
      findMissingBookFileWithContextByIno: vi.fn().mockResolvedValue(null),
      findMissingBookFileWithContextByHash: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 1,
        bookStatus: 'missing',
        folderPath: '/source/Book',
        libraryFolderPath: '/source',
      }),
      findBookFileWithContextByIno: vi.fn().mockResolvedValue(null),
      findBookFileWithContextByHash: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 3,
        bookStatus: 'present',
        folderPath: '/dest/Inbox',
        libraryFolderPath: '/source',
      }),
      findBookFileByHash: vi.fn().mockResolvedValue(null),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/dest/Inbox', [destinationFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    mockFingerprint.mockResolvedValue('transfer-hash');

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(3, 'manual');
    await done;

    expect(repo.moveBookToLibrary).toHaveBeenCalledWith(77, 3, 21, '/dest/Inbox');
    expect(repo.createBook).not.toHaveBeenCalled();
    expect(repo.updateBookFile).toHaveBeenCalledWith(
      600,
      expect.objectContaining({
        bookId: 77,
        libraryFolderId: 21,
        absolutePath: '/dest/Inbox/book.epub',
      }),
    );
    expect(repo.updateBookPrimaryFile).toHaveBeenCalledWith(77, 600);
    expect(mockGateway.emitBookTransferred).toHaveBeenCalledWith({ fromLibraryId: 1, toLibraryId: 3, bookIds: [77] });
  });

  it('does not emit a transfer event when a racing scan reports no library change', async () => {
    const destinationFile = makeFileStat({
      absolutePath: '/dest/Inbox/book.epub',
      relPath: 'Inbox/book.epub',
      ino: 4242,
    });
    const sourceFile = makeBookFile({
      id: 500,
      bookId: 42,
      libraryFolderId: 10,
      absolutePath: '/source/Book/book.epub',
      relPath: 'Book/book.epub',
      ino: 4242,
      fileHash: 'transfer-hash',
    });

    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 20, path: '/dest', libraryId: 2 }]),
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
      findMissingBookFileWithContextByIno: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 1,
        bookStatus: 'missing',
        folderPath: '/source/Book',
        libraryFolderPath: '/source',
      }),
      moveBookToLibrary: vi.fn().mockResolvedValue({
        id: 42,
        libraryId: 2,
        libraryFolderId: 20,
        folderPath: '/dest/Inbox',
        status: 'present',
        previousLibraryId: 2,
        libraryChanged: false,
      }),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/dest/Inbox', [destinationFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(2, 'manual');
    await done;

    expect(repo.moveBookToLibrary).toHaveBeenCalledWith(42, 2, 20, '/dest/Inbox');
    expect(mockGateway.emitBookTransferred).not.toHaveBeenCalled();
  });

  it('does not transfer ownership when destination folder already has a book', async () => {
    const destinationFile = makeFileStat({
      absolutePath: '/dest/Inbox/book.epub',
      relPath: 'Inbox/book.epub',
      ino: 5151,
    });
    const sourceFile = makeBookFile({
      id: 700,
      bookId: 88,
      libraryFolderId: 12,
      absolutePath: '/source/Book/book.epub',
      relPath: 'Book/book.epub',
      ino: 5151,
      fileHash: 'transfer-hash',
    });
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 30, path: '/dest', libraryId: 4 }]),
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 9, libraryId: 4, libraryFolderId: 30, folderPath: '/dest/Inbox', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
      findMissingBookFileWithContextByIno: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 1,
        bookStatus: 'missing',
        folderPath: '/source/Book',
        libraryFolderPath: '/source',
      }),
      findBookFileWithContextByIno: vi.fn().mockResolvedValue({
        file: sourceFile,
        libraryId: 1,
        bookStatus: 'missing',
        folderPath: '/source/Book',
        libraryFolderPath: '/source',
      }),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/dest/Inbox', [destinationFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(4, 'manual');
    await done;

    expect(repo.moveBookToLibrary).not.toHaveBeenCalled();
    expect(repo.createBook).not.toHaveBeenCalled();
  });
});

// ── Virtual sibling drain / merge ────────────────────────────────────────────

describe('virtual sibling drain', () => {
  it('does not merge nested child records into a new parent when child candidates are also seen', async () => {
    const parentFolder = '/library/Rising Queen (Court of the Sea Fae Trilogy Book 3) (2020)';
    const childFolder = `${parentFolder}/City of Thorns (2021)`;
    const parentFile = makeFileStat({
      absolutePath: `${parentFolder}/Rising Queen.epub`,
      relPath: 'Rising Queen (Court of the Sea Fae Trilogy Book 3) (2020)/Rising Queen.epub',
      ino: 1001,
    });
    const childFile = makeFileStat({
      absolutePath: `${childFolder}/City of Thorns - C.N. Crawford.epub`,
      relPath: 'Rising Queen (Court of the Sea Fae Trilogy Book 3) (2020)/City of Thorns (2021)/City of Thorns - C.N. Crawford.epub',
      ino: 1002,
    });

    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([{ id: 2, libraryId: 1, libraryFolderId: 1, folderPath: childFolder, status: 'present' }]),
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([
          makeBookFile({ id: 12, bookId: 2, absolutePath: childFile.absolutePath, relPath: childFile.relPath, ino: childFile.ino }),
        ]),
      createBook: vi.fn().mockResolvedValue({ id: 1, status: 'present', libraryFolderId: 1, folderPath: parentFolder, libraryId: 1 }),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate(parentFolder, [parentFile]), makeCandidate(childFolder, [childFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).not.toHaveBeenCalledWith(2, parentFolder);
    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
    expect(repo.completeScanJob).toHaveBeenCalledWith(100, expect.objectContaining({ missingCount: 0 }));
  });

  it('does not mark nested real book folders missing when parent and child candidates are both seen', async () => {
    const parentFolder = '/library/Rising Queen (Court of the Sea Fae Trilogy Book 3) (2020)';
    const childFolder = `${parentFolder}/City of Thorns (2021)`;
    const parentFile = makeFileStat({
      absolutePath: `${parentFolder}/Rising Queen.epub`,
      relPath: 'Rising Queen (Court of the Sea Fae Trilogy Book 3) (2020)/Rising Queen.epub',
      ino: 1001,
    });
    const childFile = makeFileStat({
      absolutePath: `${childFolder}/City of Thorns - C.N. Crawford.epub`,
      relPath: 'Rising Queen (Court of the Sea Fae Trilogy Book 3) (2020)/City of Thorns (2021)/City of Thorns - C.N. Crawford.epub',
      ino: 1002,
    });

    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: parentFolder, status: 'present' },
        { id: 2, libraryId: 1, libraryFolderId: 1, folderPath: childFolder, status: 'present' },
      ]),
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([
          makeBookFile({ id: 11, bookId: 1, absolutePath: parentFile.absolutePath, relPath: parentFile.relPath, ino: parentFile.ino }),
          makeBookFile({ id: 12, bookId: 2, absolutePath: childFile.absolutePath, relPath: childFile.relPath, ino: childFile.ino }),
        ]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate(parentFolder, [parentFile]), makeCandidate(childFolder, [childFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
    expect(mockGateway.emitBookMissing).not.toHaveBeenCalled();
    expect(repo.completeScanJob).toHaveBeenCalledWith(100, expect.objectContaining({ missingCount: 0 }));
  });

  it('marks virtual children missing when real folder book exists (drain path)', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series', status: 'present' },
        { id: 2, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleOne', status: 'present' },
        { id: 3, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleTwo', status: 'present' },
      ]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Series', [makeFileStat({ absolutePath: '/library/Series/book.epub', relPath: 'Series/book.epub' })])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).toHaveBeenCalledWith(expect.arrayContaining([2, 3]));
    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('picks lowest-id virtual child as survivor and updates its folderPath when no exact match exists (merge path)', async () => {
    const mergedFile = makeFileStat({ absolutePath: '/library/Series/book.epub', relPath: 'Series/book.epub' });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 3, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleOne', status: 'present' },
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleTwo', status: 'present' },
      ]),
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([
          makeBookFile({ id: 10, bookId: 1, absolutePath: mergedFile.absolutePath, relPath: mergedFile.relPath, ino: mergedFile.ino }),
        ]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Series', [mergedFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).toHaveBeenCalledWith(1, '/library/Series');
    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('uses inode ownership to merge renamed virtual children into the lowest-id survivor', async () => {
    const currentFirst = makeFileStat({ absolutePath: '/library/Series/renamed-one.epub', relPath: 'Series/renamed-one.epub', ino: 3003 });
    const currentSecond = makeFileStat({ absolutePath: '/library/Series/renamed-two.epub', relPath: 'Series/renamed-two.epub', ino: 1001 });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 3, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleOne', status: 'present' },
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleTwo', status: 'present' },
      ]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([
        makeBookFile({
          id: 30,
          bookId: 3,
          absolutePath: '/library/Series/TitleOne/old-one.epub',
          relPath: 'Series/TitleOne/old-one.epub',
          ino: 3003,
        }),
        makeBookFile({
          id: 10,
          bookId: 1,
          absolutePath: '/library/Series/TitleTwo/old-two.epub',
          relPath: 'Series/TitleTwo/old-two.epub',
          ino: 1001,
        }),
      ]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Series', [currentFirst, currentSecond])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).toHaveBeenCalledWith(1, '/library/Series');
    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('restores the survivor to present when it was missing during the merge', async () => {
    const mergedFile = makeFileStat({ absolutePath: '/library/Series/book.epub', relPath: 'Series/book.epub' });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleOne', status: 'missing' },
        { id: 2, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleTwo', status: 'present' },
      ]),
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([
          makeBookFile({ id: 10, bookId: 1, absolutePath: mergedFile.absolutePath, relPath: mergedFile.relPath, ino: mergedFile.ino }),
        ]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Series', [mergedFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).toHaveBeenCalledWith(1, '/library/Series');
    expect(repo.updateBookStatus).toHaveBeenCalledWith(1, 'present');
    expect(mockGateway.emitBookRestored).toHaveBeenCalledWith({ libraryId: 1, bookIds: [1] });
  });
});

// ── Reassigned file metadata extraction ──────────────────────────────────────

describe('reassigned file metadata extraction', () => {
  it('extracts metadata when a content file moves to a new book (path match, different bookId)', async () => {
    const fileStat = makeFileStat({ absolutePath: '/library/Author/Book/book.epub', relPath: 'Author/Book/book.epub', ino: 1001 });
    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([makeBookFile({ id: 5, bookId: 999, absolutePath: fileStat.absolutePath, ino: fileStat.ino })]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), fileStat.absolutePath, 'epub');
  });

  it('extracts metadata when a content file is reassigned via inode match (different bookId)', async () => {
    const fileStat = makeFileStat({ absolutePath: '/library/Author/Book/book.epub', relPath: 'Author/Book/book.epub', ino: 7777 });
    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([makeBookFile({ id: 5, bookId: 999, absolutePath: '/library/OldBook/book.epub', ino: 7777 })]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), fileStat.absolutePath, 'epub');
  });

  it('does not extract metadata when a sidecar/cover file is reassigned', async () => {
    const fileStat = makeFileStat({ absolutePath: '/library/Author/Book/cover.jpg', relPath: 'Author/Book/cover.jpg', ino: 2002 });
    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([
          makeBookFile({ id: 5, bookId: 999, absolutePath: fileStat.absolutePath, ino: fileStat.ino, format: 'jpg', role: 'cover' }),
        ]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
  });

  it('extracts metadata when a content file is renamed and changed via inode match', async () => {
    const fileStat = makeFileStat({
      absolutePath: '/library/Author/Book/new-title.epub',
      relPath: 'Author/Book/new-title.epub',
      ino: 7778,
      sizeBytes: 2048,
      mtime: new Date('2024-01-02'),
    });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([
        makeBookFile({
          id: 5,
          bookId: 1,
          absolutePath: '/library/Author/Book/old-title.epub',
          relPath: 'Author/Book/old-title.epub',
          ino: 7778,
          sizeBytes: 1024,
          mtime: new Date('2024-01-01'),
        }),
      ]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), fileStat.absolutePath, 'epub');
  });

  it('does not extract metadata when the file stays in the same book (not reassigned)', async () => {
    const fileStat = makeFileStat({ absolutePath: '/library/Author/Book/book.epub', relPath: 'Author/Book/book.epub', ino: 1001 });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
      findBookFilesByLibraryFolder: vi
        .fn()
        .mockResolvedValue([makeBookFile({ id: 5, bookId: 1, absolutePath: fileStat.absolutePath, ino: fileStat.ino })]),
    });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
  });
});

// ── Targeted book scan (scanBookFolder) ──────────────────────────────────────

describe('targeted book scan', () => {
  it('does nothing when buildSingleBookCandidate returns null (empty / no-primary-format folder)', async () => {
    mockBuildSingleCandidate.mockResolvedValue(null);
    const repo = makeRepo();
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/Book/book.epub', 1);

    expect(repo.createBook).not.toHaveBeenCalled();
    expect(repo.createBookFile).not.toHaveBeenCalled();
  });

  it('does nothing when the file path does not belong to any watched library folder', async () => {
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/other-mount/book.epub', 1);

    expect(repo.createBook).not.toHaveBeenCalled();
    expect(mockBuildSingleCandidate).not.toHaveBeenCalled();
  });

  it('performs a shallow scan for a root-level file instead of triggering a full library rescan', async () => {
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    mockStat.mockResolvedValue({ isFile: () => true, ino: 9001n, size: 2048, mtime: new Date('2024-01-01') } as any);
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/book.epub', 1);

    expect(repo.createBook).toHaveBeenCalled();
    expect(mockBuildSingleCandidate).not.toHaveBeenCalled();
  });

  it('clamps precision-unsafe root-level inode values to 0 before creating book files', async () => {
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    mockStat.mockResolvedValue({ isFile: () => true, ino: 651896050678335552n, size: 2048, mtime: new Date('2024-01-01') } as any);
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/book.epub', 1);

    expect(repo.createBookFile).toHaveBeenCalledWith(
      expect.objectContaining({
        absolutePath: '/library/book.epub',
        ino: 0,
      }),
    );
  });

  it('creates a new book and extracts metadata for a genuinely new epub file', async () => {
    const fileStat = makeFileStat({ absolutePath: '/library/Author/Book/book.epub', relPath: 'Author/Book/book.epub' });
    mockBuildSingleCandidate.mockResolvedValue(makeCandidate('/library/Author/Book', [fileStat]));

    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/Book/book.epub', 1);

    expect(repo.createBook).toHaveBeenCalledWith(expect.objectContaining({ folderPath: '/library/Author/Book', libraryId: 1 }));
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), fileStat.absolutePath, 'epub');
  });

  it('uses buildSingleBookCandidate (not findBookCandidates) for targeted scans', async () => {
    mockBuildSingleCandidate.mockResolvedValue(null);
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/Book/book.epub', 1);

    expect(mockBuildSingleCandidate).toHaveBeenCalledWith('/library/Author/Book', '/library', expect.any(Array), expect.any(Function));
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it('walks up to parent folder when the file is inside a stem-named audio subfolder', async () => {
    const parentEpub = { name: 'BookTitle.epub', isFile: () => true, isDirectory: () => false } as unknown as Dirent;
    mockReaddir.mockResolvedValue([parentEpub]);

    const fileStat = makeFileStat({
      absolutePath: '/library/Author/BookTitle/01-chapter.mp3',
      relPath: 'Author/BookTitle/01-chapter.mp3',
    });
    mockBuildSingleCandidate.mockResolvedValue(makeCandidate('/library/Author/Book', [fileStat]));

    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/BookTitle/01-chapter.mp3', 1);

    // Should scan the parent (/library/Author) not the audio subfolder (/library/Author/BookTitle)
    expect(mockBuildSingleCandidate).toHaveBeenCalledWith('/library/Author', '/library', expect.any(Array), expect.any(Function));
  });

  it('does not walk up when no sibling file in the parent matches the folder stem', async () => {
    const unrelatedFile = { name: 'SomethingElse.epub', isFile: () => true, isDirectory: () => false } as unknown as Dirent;
    mockReaddir.mockResolvedValue([unrelatedFile]);

    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/AudioBook/01.mp3', 1);

    // Should stay in the audio subfolder, not walk up
    expect(mockBuildSingleCandidate).toHaveBeenCalledWith('/library/Author/AudioBook', '/library', expect.any(Array), expect.any(Function));
  });

  it('recursively scans a created grouping directory for child book folders', async () => {
    const fileStat = makeFileStat({
      absolutePath: '/library/AJ Carter/Book/book.epub',
      relPath: 'Book/book.epub',
    });
    mockBuildSingleCandidate.mockResolvedValue(null);
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/AJ Carter/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookDirectory('/library/AJ Carter', 1);

    expect(mockBuildSingleCandidate).toHaveBeenCalledWith('/library/AJ Carter', '/library', expect.any(Array), expect.any(Function));
    expect(mockFindCandidates).toHaveBeenCalledWith('/library/AJ Carter', expect.any(Array), expect.any(Function));
    expect(repo.createBook).toHaveBeenCalledWith(expect.objectContaining({ folderPath: '/library/AJ Carter/Book', libraryId: 1 }));
    expect(repo.createBookFile).toHaveBeenCalledWith(expect.objectContaining({ relPath: 'AJ Carter/Book/book.epub' }));
  });
});

// ── book_per_file mode — runScan ──────────────────────────────────────────────

describe('book_per_file mode — runScan', () => {
  it('calls findLooseFileCandidates instead of findBookCandidates when organizationMode is book_per_file', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockFindLooseCandidates).toHaveBeenCalledWith('/library', [], expect.any(Function), undefined);
    expect(mockFindCandidates).not.toHaveBeenCalled();
  });

  it('calls findBookCandidates (not loose) when organizationMode is book_per_folder', async () => {
    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockFindCandidates).toHaveBeenCalled();
    expect(mockFindLooseCandidates).not.toHaveBeenCalled();
  });

  it('passes excludePatterns to findLooseFileCandidates in book_per_file mode', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: ['samples', '*.bak'],
        organizationMode: 'book_per_file',
      }),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockFindLooseCandidates).toHaveBeenCalledWith('/library', ['samples', '*.bak'], expect.any(Function), undefined);
  });

  it('creates one book per loose-file candidate', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
    });

    const file1 = makeFileStat({ absolutePath: '/library/Author/book1.epub', relPath: 'Author/book1.epub', ino: 5001 });
    const file2 = makeFileStat({ absolutePath: '/library/Author/book2.epub', relPath: 'Author/book2.epub', ino: 5002 });
    mockFindLooseCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/book1.epub', [file1]), makeCandidate('/library/Author/book2.epub', [file2])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.createBook).toHaveBeenCalledTimes(2);
    const folderPaths = repo.createBook.mock.calls.map((c: [{ folderPath: string }]) => c[0].folderPath).sort();
    expect(folderPaths).toContain('/library/Author/book1.epub');
    expect(folderPaths).toContain('/library/Author/book2.epub');
  });

  it('allowedFormats filter still applies in book_per_file mode', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: ['epub'],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
    });

    const epubFile = makeFileStat({ absolutePath: '/library/book.epub', relPath: 'book.epub', ino: 6001 });
    const pdfFile = makeFileStat({ absolutePath: '/library/book.pdf', relPath: 'book.pdf', ino: 6002 });
    mockFindLooseCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/book.epub', [epubFile]), makeCandidate('/library/book.pdf', [pdfFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // Only the epub candidate passes the allowedFormats filter
    expect(repo.createBook).toHaveBeenCalledTimes(1);
    expect(repo.createBook.mock.calls[0][0].folderPath).toBe('/library/book.epub');
  });
});

// ── book_per_file mode — scanBookFolder ──────────────────────────────────────

describe('book_per_file mode — scanBookFolder', () => {
  it('builds a single-file candidate from the exact file path (no folder resolution)', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/Book/book.epub', 1);

    // Must NOT call buildSingleBookCandidate or findBookCandidates
    expect(mockBuildSingleCandidate).not.toHaveBeenCalled();
    expect(mockFindCandidates).not.toHaveBeenCalled();
    // Should attempt to create a book with folderPath = file path
    expect(repo.createBook).toHaveBeenCalledWith(expect.objectContaining({ folderPath: '/library/Author/Book/book.epub' }));
  });

  it('skips non-content files in book_per_file mode', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    // cover.jpg is not a primary content format
    await (service as any).scanBookFolder('/library/Author/Book/cover.jpg', 1);

    expect(repo.createBook).not.toHaveBeenCalled();
    expect(mockBuildSingleCandidate).not.toHaveBeenCalled();
  });

  it('skips file not matching allowedFormats in book_per_file mode', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: ['epub'],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/Book/book.pdf', 1);

    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('skips when stat fails (file disappeared) in book_per_file mode', async () => {
    mockStat.mockResolvedValueOnce(null as any);

    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/Book/book.epub', 1);

    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('falls through to normal folder scan when mode is book_per_folder', async () => {
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);

    await (service as any).scanBookFolder('/library/Author/Book/book.epub', 1);

    // Normal path: buildSingleBookCandidate is called for the folder
    expect(mockBuildSingleCandidate).toHaveBeenCalledWith('/library/Author/Book', '/library', expect.any(Array), expect.any(Function));
  });

  it('reuses a same-library moved file when directory scan sees the add before unlink marks missing', async () => {
    const movedFile = makeFileStat({
      absolutePath: '/library/Moved/Alpha.epub',
      relPath: 'Moved/Alpha.epub',
      ino: 3001,
    });
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({
        allowedFormats: [],
        formatPriority: DEFAULT_FORMAT_PRIORITY,
        metadataPrecedence: ['embedded'],
        excludePatterns: [],
        organizationMode: 'book_per_file',
      }),
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
      findBooksByFolderPath: vi.fn().mockResolvedValue([]),
      findBookFilesByBookIds: vi.fn().mockResolvedValue([]),
      findMissingBookFileWithContextByIno: vi.fn().mockResolvedValue(null),
      findBookFileWithContextByIno: vi.fn().mockResolvedValue({
        file: {
          id: 9,
          bookId: 7,
          absolutePath: '/library/Alpha.epub',
          ino: 3001,
          sizeBytes: 1024,
          mtime: new Date('2024-01-01'),
          fileHash: null,
        },
        libraryId: 1,
        bookStatus: 'present',
        folderPath: '/library/Alpha.epub',
        libraryFolderPath: '/library',
      }),
    });
    mockFindLooseCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Moved/Alpha.epub', [movedFile])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });
    mockStat.mockRejectedValue(new Error('ENOENT'));
    const { service } = makeService(repo);

    await (service as any).scanBookDirectory('/library/Moved', 1);

    expect(repo.moveBookToLibrary).toHaveBeenCalledWith(7, 1, 1, '/library/Moved/Alpha.epub');
    expect(repo.createBook).not.toHaveBeenCalled();
    expect(repo.updateBookFile).toHaveBeenCalledWith(
      9,
      expect.objectContaining({
        bookId: 7,
        absolutePath: '/library/Moved/Alpha.epub',
        relPath: 'Moved/Alpha.epub',
      }),
    );
  });
});

describe('bootstrap, wrappers, and cover refresh', () => {
  it('marks running scan jobs as failed on application bootstrap', async () => {
    const repo = makeRepo();
    const { service } = makeService(repo);

    await service.onApplicationBootstrap();

    expect(repo.failAllRunningJobs).toHaveBeenCalledWith('Server restarted during scan');
  });

  it('does not start another async scan when one is already running', () => {
    const repo = makeRepo();
    const { service, jobStore } = makeService(repo);
    const startScanSpy = vi.spyOn(service, 'startScan');
    jobStore.create(500, 1, 0);

    service.startScanAsync(1);

    expect(startScanSpy).not.toHaveBeenCalled();
  });

  it('logs async start failures from startScanAsync', async () => {
    const repo = makeRepo();
    const { service } = makeService(repo);
    vi.spyOn(service, 'startScan').mockRejectedValue(new Error('queue failed'));

    service.startScanAsync(4);
    await Promise.resolve();

    expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('[scanner.start_scan] [fail] libraryId=4'));
  });

  it('reports scan running state from ScanJobStore', () => {
    const repo = makeRepo();
    const { service, jobStore } = makeService(repo);

    expect(service.isScanRunning(8)).toBe(false);
    jobStore.create(900, 8, 0);
    expect(service.isScanRunning(8)).toBe(true);
  });

  it('logs targeted scan failures from scanBookFolderAsync wrapper', async () => {
    const repo = makeRepo();
    const { service } = makeService(repo);
    vi.spyOn(service as any, 'scanBookFolder').mockRejectedValue(new Error('targeted scan failed'));

    service.scanBookFolderAsync('/library/Author/Book/book.epub', 1);
    await vi.waitFor(() => expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('[scanner.targeted_book_scan] [fail]')));
  });

  it('limits concurrent targeted scans from watcher bursts', async () => {
    const repo = makeRepo();
    const { service } = makeService(repo);
    const resolveScan: Array<() => void> = [];
    const scanSpy = vi.spyOn(service as unknown as { scanBookFolder: (p: string, l: number) => Promise<void> }, 'scanBookFolder').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveScan.push(resolve);
        }),
    );

    for (let i = 0; i < 10; i++) {
      service.scanBookFolderAsync(`/library/root-${i}.epub`, 1);
    }

    expect(scanSpy).toHaveBeenCalledTimes(8);

    resolveScan.shift()?.();
    await vi.waitFor(() => expect(scanSpy).toHaveBeenCalledTimes(9));

    for (const resolve of resolveScan.splice(0)) resolve();
    await vi.waitFor(() => expect(scanSpy).toHaveBeenCalledTimes(10));
  });

  it('refreshes covers in the background and emits progress/completion events', async () => {
    const repo = makeRepo({
      findPrimaryBookFilesByLibrary: vi.fn().mockResolvedValue([
        { bookId: 1, absolutePath: '/library/Book/book.epub', format: 'epub' },
        { bookId: 2, absolutePath: '/library/Book/readme.txt', format: 'txt' },
        { bookId: 3, absolutePath: '/library/Book/book.pdf', format: 'pdf' },
      ]),
    });
    mockMetadata.refreshCoverForBook.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { service } = makeService(repo);

    await expect(service.refreshCovers(1)).resolves.toEqual({ queued: 2 });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockMetadata.refreshCoverForBook).toHaveBeenNthCalledWith(1, 1, '/library/Book/book.epub', 'epub');
    expect(mockMetadata.refreshCoverForBook).toHaveBeenNthCalledWith(2, 3, '/library/Book/book.pdf', 'pdf');
    expect(mockGateway.emitCoverRefreshed).toHaveBeenCalledWith({ bookId: 1, libraryId: 1 });
    expect(mockGateway.emitCoverRefreshProgress).toHaveBeenNthCalledWith(1, { libraryId: 1, processed: 0, total: 2, status: 'running' });
    expect(mockGateway.emitCoverRefreshProgress).toHaveBeenNthCalledWith(2, { libraryId: 1, processed: 2, total: 2, status: 'completed' });
  });

  it('rethrows refreshCovers query failures', async () => {
    const repo = makeRepo({
      findPrimaryBookFilesByLibrary: vi.fn().mockRejectedValue(new Error('lookup failed')),
    });
    const { service } = makeService(repo);

    await expect(service.refreshCovers(9)).rejects.toThrow('lookup failed');
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('[scanner.refresh_covers] [fail]'));
  });

  it('continues processing remaining covers when one item fails in a batch', async () => {
    const repo = makeRepo({
      findPrimaryBookFilesByLibrary: vi.fn().mockResolvedValue([
        { bookId: 7, absolutePath: '/library/Book/book.epub', format: 'epub' },
        { bookId: 8, absolutePath: '/library/Book2/book2.epub', format: 'epub' },
      ]),
    });
    mockMetadata.refreshCoverForBook.mockRejectedValueOnce(new Error('provider timeout'));
    mockMetadata.refreshCoverForBook.mockResolvedValueOnce(true);
    const { service } = makeService(repo);

    await expect(service.refreshCovers(5)).resolves.toEqual({ queued: 2 });
    // Let the background IIFE settle
    await new Promise((r) => setTimeout(r, 10));
    await Promise.resolve();

    // Second item should still have been processed despite first one failing
    expect(mockMetadata.refreshCoverForBook).toHaveBeenCalledTimes(2);
  });

  it('flushes buffered added books immediately at threshold and emits built cards', async () => {
    vi.useFakeTimers();
    const repo = makeRepo({
      findBookCardData: vi.fn().mockResolvedValue({ rows: [{ id: 1 }], authorRows: [], fileRows: [], genreRows: [] }),
    });
    const assembleSpy = vi.spyOn(assembleBookCardsModule, 'assembleBookCards').mockReturnValue([{ id: 1 }] as any);
    const { service } = makeService(repo);
    const flushSpy = vi.spyOn(service as any, 'flushBookEmitBuffer');

    for (let i = 0; i < 20; i++) {
      (service as any).bufferBookForEmit(3, i + 1);
    }

    expect(flushSpy).toHaveBeenCalledWith(3);
    await (service as any).buildAndEmitBookCards(3, [1]);
    expect(mockGateway.emitBooksAdded).toHaveBeenCalledWith({ libraryId: 3, books: [{ id: 1 }] });
    expect(assembleSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('schedules a delayed book buffer flush before the threshold is reached', () => {
    vi.useFakeTimers();
    const repo = makeRepo();
    const { service } = makeService(repo);
    const flushSpy = vi.spyOn(service as any, 'flushBookEmitBuffer').mockImplementation(() => undefined);

    (service as any).bufferBookForEmit(6, 42);
    vi.runOnlyPendingTimers();

    expect(flushSpy).toHaveBeenCalledWith(6);
    vi.useRealTimers();
  });
});

// ── TOCTOU start lock ─────────────────────────────────────────────────────────

describe('TOCTOU start lock', () => {
  it('rejects concurrent startScan calls with ConflictException via start lock', async () => {
    const repo = makeRepo();
    const { service, jobStore } = makeService(repo);
    jobStore.acquireStartLock(1);

    await expect(service.startScan(1, 'manual')).rejects.toThrow(ConflictException);
  });

  it('releases the lock after successful scan completion', async () => {
    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service, jobStore } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(jobStore.isStartLocked(1)).toBe(false);
  });

  it('releases the lock even when scan setup throws', async () => {
    const repo = makeRepo({ findLibraryFolders: vi.fn().mockResolvedValue([]) });
    const { service, jobStore } = makeService(repo);

    await expect(service.startScan(1, 'manual')).rejects.toThrow();
    expect(jobStore.isStartLocked(1)).toBe(false);
  });
});

// ── inode zero guard ──────────────────────────────────────────────────────────

describe('inode zero guard', () => {
  it('skips global inode lookup in processFile when file has ino=0', async () => {
    const fileStat = makeFileStat({ ino: 0 });
    mockFindCandidates.mockResolvedValue({
      candidates: [makeCandidate('/library/Author/Book', [fileStat])],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes: new Map(),
    });

    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.findBookFileWithContextByIno).not.toHaveBeenCalled();
    expect(repo.findMissingBookFileWithContextByIno).not.toHaveBeenCalled();
  });
});

// ── pendingRescan chain ───────────────────────────────────────────────────────

describe('pendingRescan chain', () => {
  it('startScanAsync marks pending rescan when scan is already running', () => {
    const repo = makeRepo();
    const { service, jobStore } = makeService(repo);
    jobStore.create(500, 1, 0);
    const startScanSpy = vi.spyOn(service, 'startScan');

    service.startScanAsync(1);

    expect(startScanSpy).not.toHaveBeenCalled();
    // Verify pending was marked by consuming it
    expect(jobStore.consumePendingRescan(1)).toBe(true);
  });

  it('startScanAsync marks pending rescan when start lock is held', () => {
    const repo = makeRepo();
    const { service, jobStore } = makeService(repo);
    jobStore.acquireStartLock(1);
    const startScanSpy = vi.spyOn(service, 'startScan');

    service.startScanAsync(1);

    expect(startScanSpy).not.toHaveBeenCalled();
    expect(jobStore.consumePendingRescan(1)).toBe(true);
  });
});

// ── Incremental scan — dir state and settings invalidation ─────────────────

describe('incremental scan — dir state', () => {
  it('loads dir scan state and passes to walk function', async () => {
    const storedMtimes = new Map([
      ['/library/Author', 1000],
      ['/library/Author/Book', 2000],
    ]);
    const repo = makeRepo({
      findDirScanState: vi.fn().mockResolvedValue(storedMtimes),
    });
    const { service } = makeService(repo);

    // First scan: seeds settings hash (forces full scan, no stored hash)
    let done = awaitScan(repo);
    await service.startScan(1, 'manual');
    await done;
    await new Promise((r) => setTimeout(r, 10));

    // Second scan: settings hash matches, so incremental scan loads dir state
    repo.createScanJob.mockResolvedValue({ id: 101 });
    done = awaitScan(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.findDirScanState).toHaveBeenCalledWith(1);
    expect(mockFindCandidates).toHaveBeenCalledWith('/library', [], expect.any(Function), storedMtimes);
  });

  it('persists dir mtimes after successful scan', async () => {
    const dirMtimes = new Map([
      ['/library/Author', 1000],
      ['/library/Author/Book', 2000],
    ]);
    mockFindCandidates.mockResolvedValue({
      candidates: [],
      skippedDirs: new Set(),
      unchangedDirs: new Set(),
      dirMtimes,
    });
    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.upsertDirScanState).toHaveBeenCalledWith(
      1,
      expect.arrayContaining([
        { dirPath: '/library/Author', mtimeMs: 1000 },
        { dirPath: '/library/Author/Book', mtimeMs: 2000 },
      ]),
    );
    expect(repo.deleteStaleDirScanState).toHaveBeenCalledWith(1, new Set(['/library/Author', '/library/Author/Book']));
  });

  it('clears dir state when forceFullScan is true', async () => {
    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual', true);
    await done;

    expect(repo.clearDirScanState).toHaveBeenCalledWith(1);
    expect(repo.findDirScanState).not.toHaveBeenCalled();
  });

  it('excludes books in unchanged dirs from missing detection', async () => {
    mockFindCandidates.mockResolvedValue({
      candidates: [],
      skippedDirs: new Set(),
      unchangedDirs: new Set(['/library/Author/Book']),
      dirMtimes: new Map(),
    });
    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
    });
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // Book in unchanged dir should NOT be marked missing
    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
  });
});

describe('incremental scan — settings invalidation', () => {
  it('forces full scan on first scan after service start (no stored hash)', async () => {
    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // First scan has no stored hash, so it should force full scan (clear dir state)
    expect(repo.clearDirScanState).toHaveBeenCalledWith(1);
  });

  it('forces full scan when scan-affecting settings change between runs', async () => {
    const repo = makeRepo();

    // First scan
    let done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;
    await new Promise((r) => setTimeout(r, 10));

    // Change settings for next scan
    repo.findLibrarySettings.mockResolvedValue({
      allowedFormats: ['epub'],
      formatPriority: ['epub', 'pdf'],
      excludePatterns: ['*.bak'],
      organizationMode: 'book_per_folder',
    });
    repo.createScanJob.mockResolvedValue({ id: 101 });
    repo.clearDirScanState.mockClear();

    // Second scan with changed settings
    done = awaitScan(repo);
    await service.startScan(1, 'manual');
    await done;

    // Settings changed, so clearDirScanState should have been called
    expect(repo.clearDirScanState).toHaveBeenCalledWith(1);
  });

  it('uses incremental scan when settings are unchanged', async () => {
    const repo = makeRepo();

    // First scan (stores hash, forces full scan)
    let done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;
    await new Promise((r) => setTimeout(r, 10));

    // Second scan with same settings — should NOT clear dir state
    repo.createScanJob.mockResolvedValue({ id: 101 });
    repo.clearDirScanState.mockClear();

    done = awaitScan(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.clearDirScanState).not.toHaveBeenCalled();
  });
});
