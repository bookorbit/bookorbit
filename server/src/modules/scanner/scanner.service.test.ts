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
import type { MockedFunction } from 'vitest';
import type { Dirent } from 'fs';
import { readdir, stat } from 'fs/promises';

import { ScannerService } from './scanner.service';
import { ScanJobStore } from './scan-job-store.service';
import { DEFAULT_FORMAT_PRIORITY } from './lib/classify';
import type { BookCandidate, FileStat } from './lib/walk';
import { findBookCandidates, findLooseFileCandidates, buildSingleBookCandidate } from './lib/walk';
import { fingerprintFile } from './lib/hash';

const mockFindCandidates = findBookCandidates as MockedFunction<typeof findBookCandidates>;
const mockFindLooseCandidates = findLooseFileCandidates as MockedFunction<typeof findLooseFileCandidates>;
const mockBuildSingleCandidate = buildSingleBookCandidate as MockedFunction<typeof buildSingleBookCandidate>;
const mockFingerprint = fingerprintFile as MockedFunction<typeof fingerprintFile>;
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
    hash: 'abc123',
    format: 'epub',
    role: 'content',
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
      excludePatterns: [],
      organizationMode: 'book_per_folder',
    }),
    createScanJob: vi.fn().mockResolvedValue({ id: 100 }),
    completeScanJob: vi.fn().mockResolvedValue(undefined),
    failScanJob: vi.fn().mockResolvedValue(undefined),
    findBooksByLibraryFolder: vi.fn().mockResolvedValue([]),
    findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
    createBook: vi.fn().mockResolvedValue({ id: 1, status: 'present', libraryFolderId: 1, folderPath: '/library/Author/Book', libraryId: 1 }),
    updateBookStatus: vi.fn().mockResolvedValue(undefined),
    updateBookPrimaryFile: vi.fn().mockResolvedValue(undefined),
    markBooksAsMissing: vi.fn().mockResolvedValue(undefined),
    createBookFile: vi.fn().mockResolvedValue(makeBookFile()),
    updateBookFile: vi.fn().mockResolvedValue(makeBookFile()),
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
    deleteBookFile: vi.fn().mockResolvedValue(undefined),
    updateBookFolderPath: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const mockGateway = {
  emitProgress: vi.fn(),
  emitBookMissing: vi.fn(),
  emitBookRestored: vi.fn(),
  emitBookMoved: vi.fn(),
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

function makeService(repo: ReturnType<typeof makeRepo>) {
  const jobStore = new ScanJobStore();
  const service = new ScannerService(repo as any, mockMetadata as any, jobStore, mockGateway as any);
  return { service, jobStore };
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
  mockFindCandidates.mockResolvedValue([]);
  mockFindLooseCandidates.mockResolvedValue([]);
  mockBuildSingleCandidate.mockResolvedValue(null);
  mockFingerprint.mockResolvedValue('hash-abc');
  mockReaddir.mockResolvedValue([]);
  mockStat.mockResolvedValue({ isFile: () => true, ino: 2001n, size: 1024, mtime: new Date('2024-01-01') } as any);
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
    mockFindCandidates.mockResolvedValue([]); // nothing found on disk

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
    mockFindCandidates.mockResolvedValue([makeCandidate(folderPath, [makeFileStat()])]);
    repo.createBook.mockResolvedValue({ id: 5, status: 'present', libraryFolderId: 1, folderPath, libraryId: 1 });

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).not.toHaveBeenCalled();
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

    expect(mockFindCandidates).toHaveBeenCalledWith('/library', ['#recycle', '*.bak'], expect.any(Function));
  });
});

// ── New file — happy path ─────────────────────────────────────────────────────

describe('genuinely new primary file', () => {
  it('creates a book record and a book file record', async () => {
    const candidate = makeCandidate('/library/Author/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue([candidate]);

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

  it('extracts metadata for new primary files in supported formats', async () => {
    const candidate = makeCandidate('/library/Author/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue([candidate]);

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Author/Book/book.epub', 'epub');
  });

  it('does not extract metadata for non-primary files', async () => {
    const primary = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub' });
    const cover = makeFileStat({ absolutePath: '/library/Book/cover.jpg', relPath: 'Book/cover.jpg', sizeBytes: 512 });
    const candidate = makeCandidate('/library/Book', [primary, cover]);
    mockFindCandidates.mockResolvedValue([candidate]);

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // extractAndSave called once for epub, not for cover.jpg
    expect(mockMetadata.extractAndSave).toHaveBeenCalledTimes(1);
    expect(mockMetadata.extractAndSave).toHaveBeenCalledWith(expect.any(Number), '/library/Book/book.epub', 'epub');
  });

  it('continues scanning when metadata extraction fails', async () => {
    mockMetadata.extractAndSave.mockRejectedValueOnce(new Error('parse error'));
    const candidate = makeCandidate('/library/Book', [makeFileStat()]);
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFile).toHaveBeenCalledWith(1, { sortOrder: 0 });
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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFile).toHaveBeenCalledWith(1, expect.objectContaining({ absolutePath: '/library/Author/Book/renamed.epub' }));
    expect(repo.createBookFile).not.toHaveBeenCalled();
  });

  it('gracefully skips a file that disappears during fingerprinting (ENOENT) — scan still completes', async () => {
    const fileStat = makeFileStat({ ino: 7777 }); // different ino so inode match fails
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);
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
    const existingFile = makeBookFile({ absolutePath: '/old-library/book.epub', ino: 1111, hash: 'fixed-hash' });

    const repo = makeRepo({
      findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([existingFile]),
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
      findBookFileByHash: vi.fn().mockResolvedValue(existingFile),
    });
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);
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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([
      makeCandidate('/library/Book', [
        makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub' }),
        makeFileStat({ absolutePath: '/library/Book/book.cbz', relPath: 'Book/book.cbz' }),
      ]),
    ]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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
    mockFindCandidates.mockResolvedValue([candidate]);

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

// ── Multi-format metadata source routing ──────────────────────────────────────
//
// These tests verify the winner-driven metadata extraction rule:
//   - Text metadata (title, authors, cover) comes from the winner format only.
//   - Audio-specific fields (chapters, narrators, duration) always come from audio
//     via extractAudioChaptersAndNarrators when audio is present and not the winner.
//   - Only the winner file triggers extractAndSave — no other format does.

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [m4b, epub])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [m4b, epub])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [epub, m4b])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [epub, m4b1, m4b2])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [epub, pdf, mobi])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [m4b, epub])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [m4b, epub])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [epub, m4b])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Book', [m4b])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [makeFileStat()])]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookStatus).toHaveBeenCalledWith(10, 'present');
    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('does not call updateBookStatus when existing book is already present', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi
        .fn()
        .mockResolvedValue([{ id: 10, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Author/Book', status: 'present' }]),
    });
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [makeFileStat()])]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookStatus).not.toHaveBeenCalled();
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
      hash: 'transfer-hash',
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
    mockFindCandidates.mockResolvedValue([makeCandidate('/dest/Inbox', [destinationFile])]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
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
      hash: 'transfer-hash',
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
    mockFindCandidates.mockResolvedValue([makeCandidate('/dest/Inbox', [destinationFile])]);
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
      hash: 'transfer-hash',
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
    mockFindCandidates.mockResolvedValue([makeCandidate('/dest/Inbox', [destinationFile])]);
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
      hash: 'transfer-hash',
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
    mockFindCandidates.mockResolvedValue([makeCandidate('/dest/Inbox', [destinationFile])]);

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
  it('marks virtual children missing when real folder book exists (drain path)', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series', status: 'present' },
        { id: 2, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleOne', status: 'present' },
        { id: 3, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleTwo', status: 'present' },
      ]),
    });
    mockFindCandidates.mockResolvedValue([
      makeCandidate('/library/Series', [makeFileStat({ absolutePath: '/library/Series/book.epub', relPath: 'Series/book.epub' })]),
    ]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.markBooksAsMissing).toHaveBeenCalledWith(expect.arrayContaining([2, 3]));
    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('picks lowest-id virtual child as survivor and updates its folderPath when no exact match exists (merge path)', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 3, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleOne', status: 'present' },
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleTwo', status: 'present' },
      ]),
    });
    mockFindCandidates.mockResolvedValue([
      makeCandidate('/library/Series', [makeFileStat({ absolutePath: '/library/Series/book.epub', relPath: 'Series/book.epub' })]),
    ]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).toHaveBeenCalledWith(1, '/library/Series');
    expect(repo.createBook).not.toHaveBeenCalled();
  });

  it('restores the survivor to present when it was missing during the merge', async () => {
    const repo = makeRepo({
      findBooksByLibraryFolder: vi.fn().mockResolvedValue([
        { id: 1, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleOne', status: 'missing' },
        { id: 2, libraryId: 1, libraryFolderId: 1, folderPath: '/library/Series/TitleTwo', status: 'present' },
      ]),
    });
    mockFindCandidates.mockResolvedValue([
      makeCandidate('/library/Series', [makeFileStat({ absolutePath: '/library/Series/book.epub', relPath: 'Series/book.epub' })]),
    ]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(repo.updateBookFolderPath).toHaveBeenCalledWith(1, '/library/Series');
    expect(repo.updateBookStatus).toHaveBeenCalledWith(1, 'present');
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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);

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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
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
    mockFindCandidates.mockResolvedValue([makeCandidate('/library/Author/Book', [fileStat])]);

    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    expect(mockMetadata.extractAndSave).not.toHaveBeenCalled();
  });
});

// ── Targeted folder scan (scanBookFolder) ────────────────────────────────────

describe('targeted folder scan', () => {
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

  it('triggers a full scan instead when the file sits directly inside the library root', async () => {
    const repo = makeRepo({
      findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    });
    const { service } = makeService(repo);
    const startScanAsyncSpy = vi.spyOn(service, 'startScanAsync').mockReturnValue(undefined as any);

    await (service as any).scanBookFolder('/library/book.epub', 1);

    expect(startScanAsyncSpy).toHaveBeenCalledWith(1);
    expect(mockBuildSingleCandidate).not.toHaveBeenCalled();
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

    expect(mockFindLooseCandidates).toHaveBeenCalledWith('/library', [], expect.any(Function));
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

    expect(mockFindLooseCandidates).toHaveBeenCalledWith('/library', ['samples', '*.bak'], expect.any(Function));
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
    mockFindLooseCandidates.mockResolvedValue([
      makeCandidate('/library/Author/book1.epub', [file1]),
      makeCandidate('/library/Author/book2.epub', [file2]),
    ]);

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
    mockFindLooseCandidates.mockResolvedValue([makeCandidate('/library/book.epub', [epubFile]), makeCandidate('/library/book.pdf', [pdfFile])]);

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
});
