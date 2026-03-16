vi.mock('./lib/walk');
vi.mock('./lib/hash');
vi.mock('./lib/stability', () => ({ waitForStability: vi.fn().mockResolvedValue(undefined) }));

import { ConflictException, NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';

import { ScannerService } from './scanner.service';
import { ScanJobStore } from './scan-job-store.service';
import { DEFAULT_FORMAT_PRIORITY } from './lib/classify';
import type { BookCandidate, FileStat } from './lib/walk';
import { findBookCandidates } from './lib/walk';
import { fingerprintFile } from './lib/hash';

const mockFindCandidates = findBookCandidates as MockedFunction<typeof findBookCandidates>;
const mockFingerprint = fingerprintFile as MockedFunction<typeof fingerprintFile>;

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
    role: 'primary',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    failAllRunningJobs: vi.fn().mockResolvedValue(undefined),
    findLibraryFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/library', libraryId: 1 }]),
    findLibrarySettings: vi.fn().mockResolvedValue({ allowedFormats: [], formatPriority: DEFAULT_FORMAT_PRIORITY, excludePatterns: [] }),
    createScanJob: vi.fn().mockResolvedValue({ id: 100 }),
    completeScanJob: vi.fn().mockResolvedValue(undefined),
    failScanJob: vi.fn().mockResolvedValue(undefined),
    findBooksByLibraryFolder: vi.fn().mockResolvedValue([]),
    findBookFilesByLibraryFolder: vi.fn().mockResolvedValue([]),
    createBook: vi.fn().mockResolvedValue({ id: 1, status: 'present', libraryFolderId: 1, folderPath: '/library/Author/Book', libraryId: 1 }),
    updateBookStatus: vi.fn().mockResolvedValue(undefined),
    markBooksAsMissing: vi.fn().mockResolvedValue(undefined),
    createBookFile: vi.fn().mockResolvedValue(makeBookFile()),
    updateBookFile: vi.fn().mockResolvedValue(makeBookFile()),
    findBookFileByHash: vi.fn().mockResolvedValue(null),
    findPrimaryBookFilesByLibrary: vi.fn().mockResolvedValue([]),
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
  mockFindCandidates.mockResolvedValue([]);
  mockFingerprint.mockResolvedValue('hash-abc');
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
      findLibrarySettings: vi
        .fn()
        .mockResolvedValue({ allowedFormats: [], formatPriority: DEFAULT_FORMAT_PRIORITY, excludePatterns: ['#recycle', '*.bak'] }),
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
      expect.objectContaining({ absolutePath: '/library/Author/Book/book.epub', format: 'epub', role: 'primary' }),
    );
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

    expect(repo.createBookFile).toHaveBeenCalledWith(expect.objectContaining({ absolutePath: '/library/Book/book.pdf', role: 'primary' }));
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
    mockFingerprint.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

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
  it('assigns primary role to the highest-priority format when multiple primaries exist', async () => {
    const epub = makeFileStat({ absolutePath: '/library/Book/book.epub', relPath: 'Book/book.epub' });
    const mobi = makeFileStat({ absolutePath: '/library/Book/book.mobi', relPath: 'Book/book.mobi' });
    const candidate = makeCandidate('/library/Book', [epub, mobi]);
    mockFindCandidates.mockResolvedValue([candidate]);

    const repo = makeRepo();
    const done = awaitScan(repo);
    const { service } = makeService(repo);
    await service.startScan(1, 'manual');
    await done;

    // epub comes before mobi in DEFAULT_FORMAT_PRIORITY
    const calls = repo.createBookFile.mock.calls.map((c: any) => ({ path: c[0].absolutePath, role: c[0].role }));
    const epubCall = calls.find((c: any) => c.path.endsWith('.epub'));
    const mobiCall = calls.find((c: any) => c.path.endsWith('.mobi'));
    expect(epubCall?.role).toBe('primary');
    expect(mobiCall?.role).toBe('supplementary');
  });
});

// ── allowedFormats filtering ──────────────────────────────────────────────────

describe('allowedFormats filtering', () => {
  it('excludes primary files whose format is not in allowedFormats', async () => {
    const repo = makeRepo({
      findLibrarySettings: vi.fn().mockResolvedValue({ allowedFormats: ['epub'], formatPriority: DEFAULT_FORMAT_PRIORITY, excludePatterns: [] }),
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
