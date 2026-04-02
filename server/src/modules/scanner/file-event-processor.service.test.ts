import { FileEventProcessorService } from './file-event-processor.service';
import type { Mocked, MockedFunction } from 'vitest';
import { ScannerRepository } from './scanner.repository';
import { Logger } from '@nestjs/common';

vi.mock('fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn(),
}));

import { stat, readdir } from 'fs/promises';

const mockStat = stat as MockedFunction<typeof stat>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;

const mockRepo: Mocked<
  Pick<
    ScannerRepository,
    | 'findBookFileByAbsolutePath'
    | 'findBookFilesByBookId'
    | 'deleteBookFile'
    | 'markBooksAsMissing'
    | 'findBooksByFolderPath'
    | 'findMissingBookByFolderPath'
    | 'findMissingBooksByFolderPath'
    | 'findMissingBooksForLibraries'
    | 'findPrimaryBookFilesByBookId'
    | 'createBookFile'
    | 'updateBookFile'
    | 'markBooksAsPresent'
    | 'findBookFileWithContextByIno'
    | 'updateBookFolderPath'
    | 'findLibraryFolderPath'
    | 'findLibrarySettings'
    | 'updateBookPrimaryFile'
  >
> = {
  findBookFileByAbsolutePath: vi.fn(),
  findBookFilesByBookId: vi.fn(),
  deleteBookFile: vi.fn(),
  markBooksAsMissing: vi.fn(),
  findBooksByFolderPath: vi.fn(),
  findMissingBookByFolderPath: vi.fn(),
  findMissingBooksByFolderPath: vi.fn(),
  findMissingBooksForLibraries: vi.fn(),
  findPrimaryBookFilesByBookId: vi.fn(),
  createBookFile: vi.fn(),
  updateBookFile: vi.fn(),
  markBooksAsPresent: vi.fn(),
  findBookFileWithContextByIno: vi.fn(),
  updateBookFolderPath: vi.fn(),
  findLibraryFolderPath: vi.fn(),
  findLibrarySettings: vi.fn(),
  updateBookPrimaryFile: vi.fn(),
};

function makeService() {
  return new FileEventProcessorService(mockRepo as unknown as ScannerRepository);
}

function makeFileStat(overrides: Partial<{ ino: number; size: number; mtime: Date; isDirectory: boolean; isFile: boolean }> = {}) {
  return {
    ino: overrides.ino ?? 1001,
    size: overrides.size ?? 12345,
    mtime: overrides.mtime ?? new Date('2024-01-01'),
    isDirectory: () => overrides.isDirectory ?? false,
    isFile: () => overrides.isFile ?? true,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  mockRepo.markBooksAsMissing.mockResolvedValue(undefined);
  mockRepo.markBooksAsPresent.mockResolvedValue(undefined);
  mockRepo.createBookFile.mockResolvedValue({} as any);
  mockRepo.updateBookFile.mockResolvedValue({} as any);
  mockRepo.deleteBookFile.mockResolvedValue(undefined);
  mockRepo.findBookFilesByBookId.mockResolvedValue([]);
  mockRepo.findLibrarySettings.mockResolvedValue(null);
  mockRepo.findBookFileWithContextByIno.mockResolvedValue(null);
  mockRepo.updateBookFolderPath.mockResolvedValue(undefined);
  mockRepo.findLibraryFolderPath.mockResolvedValue('/books');
  mockReaddir.mockResolvedValue([]);
  mockRepo.updateBookPrimaryFile.mockResolvedValue(undefined);
});

// ── handleUnlink ──────────────────────────────────────────────────────────────

describe('handleUnlink', () => {
  it('returns noop when path is not tracked in DB', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);

    const result = await makeService().handleUnlink('/untracked/file.epub');

    expect(result).toEqual({ type: 'noop' });
    expect(mockRepo.markBooksAsMissing).not.toHaveBeenCalled();
    expect(mockRepo.deleteBookFile).not.toHaveBeenCalled();
  });

  it('deletes non-selected file record and returns noop without marking book missing', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 55, bookId: 12, role: 'supplementary' },
      libraryId: 5,
      primaryFileId: 99,
    } as any);

    const result = await makeService().handleUnlink('/books/Solo/solo.pdf');

    expect(mockRepo.deleteBookFile).toHaveBeenCalledWith(55);
    expect(mockRepo.markBooksAsMissing).not.toHaveBeenCalled();
    expect(mockRepo.findBookFilesByBookId).not.toHaveBeenCalled();
    expect(result).toEqual({ type: 'noop' });
  });

  it('marks book missing when primary file is deleted and no other files remain', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12, role: 'content' },
      libraryId: 5,
      primaryFileId: 99,
    } as any);
    mockRepo.findBookFilesByBookId.mockResolvedValue([{ id: 99, bookId: 12, role: 'content', format: 'epub', sizeBytes: 1000 }] as any);

    const result = await makeService().handleUnlink('/books/Solo/solo.epub');

    // File record is intentionally kept so inode-based rename detection still works.
    expect(mockRepo.deleteBookFile).not.toHaveBeenCalled();
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(12, null);
    expect(mockRepo.markBooksAsMissing).toHaveBeenCalledWith([12]);
    expect(result).toEqual({ type: 'book-missing', libraryId: 5, bookIds: [12] });
  });

  it('promotes highest-priority remaining file when primary is deleted', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12, role: 'content' },
      libraryId: 5,
      primaryFileId: 99,
    } as any);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 99, bookId: 12, role: 'content', format: 'epub', sizeBytes: 1000 },
      { id: 100, bookId: 12, role: 'content', format: 'pdf', sizeBytes: 2000 },
      { id: 101, bookId: 12, role: 'content', format: 'mobi', sizeBytes: 1500 },
    ] as any);
    mockRepo.findLibrarySettings.mockResolvedValue({ formatPriority: ['epub', 'pdf', 'mobi'] } as any);

    const result = await makeService().handleUnlink('/books/Solo/solo.epub');

    expect(mockRepo.deleteBookFile).toHaveBeenCalledWith(99);
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(12, 100);
    expect(mockRepo.markBooksAsMissing).not.toHaveBeenCalled();
    expect(result).toEqual({ type: 'book-restored', libraryId: 5, bookIds: [12] });
  });

  it('falls back to DEFAULT_FORMAT_PRIORITY when library settings are null', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12, role: 'content' },
      libraryId: 5,
      primaryFileId: 99,
    } as any);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 99, bookId: 12, role: 'content', format: 'epub', sizeBytes: 1000 },
      { id: 100, bookId: 12, role: 'content', format: 'pdf', sizeBytes: 2000 },
    ] as any);
    mockRepo.findLibrarySettings.mockResolvedValue(null);

    await makeService().handleUnlink('/books/Solo/solo.epub');

    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(12, 100);
  });

  it('skips zero-byte files in format election, falls back to them only if all remaining are zero-byte', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12, role: 'content' },
      libraryId: 5,
      primaryFileId: 99,
    } as any);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 99, bookId: 12, role: 'content', format: 'epub', sizeBytes: 1000 },
      { id: 100, bookId: 12, role: 'content', format: 'pdf', sizeBytes: 0 },
      { id: 101, bookId: 12, role: 'content', format: 'mobi', sizeBytes: 1500 },
    ] as any);
    mockRepo.findLibrarySettings.mockResolvedValue({ formatPriority: ['epub', 'pdf', 'mobi'] } as any);

    await makeService().handleUnlink('/books/Solo/solo.epub');

    // pdf is zero-byte so mobi wins despite pdf being higher in priority
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(12, 101);
  });

  it('falls back to first remaining file when no format matches priority list', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12, role: 'content' },
      libraryId: 5,
      primaryFileId: 99,
    } as any);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 99, bookId: 12, role: 'content', format: 'epub', sizeBytes: 1000 },
      { id: 100, bookId: 12, role: 'content', format: 'unknown', sizeBytes: 500 },
    ] as any);
    mockRepo.findLibrarySettings.mockResolvedValue({ formatPriority: ['epub', 'pdf'] } as any);

    await makeService().handleUnlink('/books/Solo/solo.epub');

    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(12, 100);
  });

  it('falls back to zero-byte files when all remaining are zero-byte', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12, role: 'content' },
      libraryId: 5,
      primaryFileId: 99,
    } as any);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 99, bookId: 12, role: 'content', format: 'epub', sizeBytes: 1000 },
      { id: 100, bookId: 12, role: 'content', format: 'pdf', sizeBytes: 0 },
    ] as any);
    mockRepo.findLibrarySettings.mockResolvedValue({ formatPriority: ['epub', 'pdf'] } as any);

    const result = await makeService().handleUnlink('/books/Solo/solo.epub');

    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(12, 100);
    expect(result).toEqual({ type: 'book-restored', libraryId: 5, bookIds: [12] });
  });

  it('re-elects and marks missing when primary_file_id is null and last content file is deleted', async () => {
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 99, bookId: 12, role: 'content' },
      libraryId: 5,
      primaryFileId: null,
    } as any);
    mockRepo.findBookFilesByBookId.mockResolvedValue([{ id: 99, bookId: 12, role: 'content', format: 'epub', sizeBytes: 1000 }] as any);

    const result = await makeService().handleUnlink('/books/Solo/solo.epub');

    // File record is intentionally kept so inode-based rename detection still works.
    expect(mockRepo.deleteBookFile).not.toHaveBeenCalled();
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(12, null);
    expect(mockRepo.markBooksAsMissing).toHaveBeenCalledWith([12]);
    expect(result).toEqual({ type: 'book-missing', libraryId: 5, bookIds: [12] });
  });
});

// ── handleUnlinkDir ───────────────────────────────────────────────────────────

describe('handleUnlinkDir', () => {
  it('returns noop when no books are under the deleted folder', async () => {
    mockRepo.findBooksByFolderPath.mockResolvedValue([]);

    const result = await makeService().handleUnlinkDir('/empty/folder');

    expect(result).toEqual({ type: 'noop' });
    expect(mockRepo.markBooksAsMissing).not.toHaveBeenCalled();
  });

  it('marks books missing without deleting file rows', async () => {
    mockRepo.findBooksByFolderPath.mockResolvedValue([
      { id: 20, libraryId: 1 },
      { id: 21, libraryId: 1 },
    ] as any);

    const result = await makeService().handleUnlinkDir('/books/Author');

    expect(mockRepo.markBooksAsMissing).toHaveBeenCalledWith([20, 21]);
    expect(result).toEqual({ type: 'book-missing', libraryId: 1, bookIds: [20, 21] });
  });
});

// ── handleCreate (file) ───────────────────────────────────────────────────────

describe('handleCreate — file', () => {
  it('returns noop when stat fails (path no longer exists)', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const result = await makeService().handleCreate('/books/Author/ghost.epub');

    expect(result).toEqual({ type: 'noop' });
  });

  it('returns noop for non-content file formats', async () => {
    mockStat.mockResolvedValue(makeFileStat());
    const result = await makeService().handleCreate('/books/Author/cover.jpg');
    expect(result).toEqual({ type: 'noop' });
  });

  it('returns noop when file row exists but book is not missing', async () => {
    mockStat.mockResolvedValue(makeFileStat());
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({ file: { id: 1 }, libraryId: 1 } as any);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue(null);

    const result = await makeService().handleCreate('/books/Author/book.epub');

    expect(result).toEqual({ type: 'noop' });
  });

  it('restores book by updating existing file row when book is missing', async () => {
    const fileStat = makeFileStat({ ino: 2000, size: 50000 });
    mockStat.mockResolvedValue(fileStat);
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue({
      file: { id: 42, bookId: 10 },
      libraryId: 3,
    } as any);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue({
      id: 10,
      libraryId: 3,
      libraryFolderId: 5,
    } as any);

    const result = await makeService().handleCreate('/books/Author/book.epub');

    expect(mockRepo.updateBookFile).toHaveBeenCalledWith(42, expect.objectContaining({ ino: 2000, sizeBytes: 50000 }));
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalled();
    expect(mockRepo.markBooksAsPresent).toHaveBeenCalledWith([10]);
    expect(mockRepo.createBookFile).not.toHaveBeenCalled();
    expect(result).toEqual({ type: 'book-restored', libraryId: 3, bookIds: [10] });
  });

  it('returns noop when no file row and no missing book', async () => {
    mockStat.mockResolvedValue(makeFileStat());
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue(null);

    const result = await makeService().handleCreate('/books/Author/book.epub');

    expect(result).toEqual({ type: 'noop' });
    expect(mockRepo.createBookFile).not.toHaveBeenCalled();
  });

  it('creates new file row when no existing row but missing book found via dirname', async () => {
    const fileStat = makeFileStat({ ino: 2000, size: 50000 });
    mockStat.mockResolvedValue(fileStat);
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue({
      id: 55,
      libraryId: 4,
      libraryFolderId: 10,
    } as any);

    const result = await makeService().handleCreate('/books/Author/book.epub');

    expect(mockRepo.createBookFile).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 55, absolutePath: '/books/Author/book.epub', format: 'epub', role: 'content' }),
    );
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalled();
    expect(mockRepo.markBooksAsPresent).toHaveBeenCalledWith([55]);
    expect(result).toEqual({ type: 'book-restored', libraryId: 4, bookIds: [55] });
  });

  it('creates new file row for root-level book where folderPath equals file path', async () => {
    const fileStat = makeFileStat({ ino: 3000, size: 60000 });
    mockStat.mockResolvedValue(fileStat);
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);
    mockRepo.findMissingBookByFolderPath.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 60, libraryId: 5, libraryFolderId: 15 } as any);

    const result = await makeService().handleCreate('/books/Audiobooks/book.pdf');

    expect(mockRepo.findMissingBookByFolderPath).toHaveBeenCalledWith('/books/Audiobooks');
    expect(mockRepo.findMissingBookByFolderPath).toHaveBeenCalledWith('/books/Audiobooks/book.pdf');
    expect(mockRepo.createBookFile).toHaveBeenCalledWith(
      expect.objectContaining({ bookId: 60, absolutePath: '/books/Audiobooks/book.pdf', format: 'pdf', role: 'content' }),
    );
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalled();
    expect(mockRepo.markBooksAsPresent).toHaveBeenCalledWith([60]);
    expect(result).toEqual({ type: 'book-restored', libraryId: 5, bookIds: [60] });
  });
});

// ── handleCreate (directory / folder restoration) ────────────────────────────

describe('handleCreate — directory (folder restoration)', () => {
  it('returns noop when no missing books match the folder', async () => {
    mockStat.mockResolvedValue(makeFileStat({ isDirectory: true, isFile: false }));
    mockRepo.findMissingBooksByFolderPath.mockResolvedValue([]);

    const result = await makeService().handleCreate('/books/Author');

    expect(result).toEqual({ type: 'noop' });
  });

  it('restores books by updating existing file rows when files exist on disk', async () => {
    mockStat
      .mockResolvedValueOnce(makeFileStat({ isDirectory: true, isFile: false }))
      .mockResolvedValueOnce(makeFileStat({ ino: 3000, size: 80000, isFile: true }));

    mockRepo.findMissingBooksByFolderPath.mockResolvedValue([
      { id: 70, libraryId: 6, libraryFolderId: 20, folderPath: '/books/Author/Title' } as any,
    ]);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 100, absolutePath: '/books/Author/Title/book.epub', bookId: 70, role: 'content', format: 'epub', sizeBytes: 80000 } as any,
    ]);

    const result = await makeService().handleCreate('/books/Author/Title');

    expect(mockRepo.updateBookFile).toHaveBeenCalledWith(100, expect.objectContaining({ ino: 3000 }));
    expect(mockRepo.markBooksAsPresent).toHaveBeenCalledWith([70]);
    expect(result).toEqual({ type: 'book-restored', libraryId: 6, bookIds: [70] });
  });

  it('returns noop when files for missing books no longer exist on disk', async () => {
    mockStat.mockResolvedValueOnce(makeFileStat({ isDirectory: true, isFile: false })).mockRejectedValueOnce(new Error('ENOENT'));

    mockRepo.findMissingBooksByFolderPath.mockResolvedValue([{ id: 80, libraryId: 7, libraryFolderId: 30, folderPath: '/books/gone' } as any]);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 200, absolutePath: '/books/gone/book.epub', bookId: 80, role: 'content', format: 'epub', sizeBytes: 1000 } as any,
    ]);

    const result = await makeService().handleCreate('/books/gone');

    expect(mockRepo.markBooksAsPresent).not.toHaveBeenCalled();
    expect(result).toEqual({ type: 'noop' });
  });
});

// ── handleCreate — move detection (inode-based) ─────────────────────────────

describe('handleCreate — move detection', () => {
  it('detects a moved file via inode match and updates paths', async () => {
    const fileStat = makeFileStat({ ino: 4000, size: 70000 });
    mockStat.mockResolvedValue(fileStat);
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue(null);
    mockRepo.findBookFileWithContextByIno.mockResolvedValue({
      file: { id: 50, bookId: 30, absolutePath: '/books/OldAuthor/book.epub' },
      libraryId: 2,
      folderPath: '/books/OldAuthor',
      libraryFolderPath: '/books',
      bookStatus: 'missing',
    } as any);

    const result = await makeService().handleCreate('/books/NewAuthor/book.epub');

    expect(mockRepo.updateBookFile).toHaveBeenCalledWith(
      50,
      expect.objectContaining({ absolutePath: '/books/NewAuthor/book.epub', relPath: 'NewAuthor/book.epub' }),
    );
    expect(mockRepo.updateBookFolderPath).toHaveBeenCalledWith(30, '/books/NewAuthor');
    expect(mockRepo.markBooksAsPresent).toHaveBeenCalledWith([30]);
    expect(result).toEqual({ type: 'book-moved', libraryId: 2, bookIds: [30] });
  });

  it('skips move detection when inode matches same path (not a move)', async () => {
    const fileStat = makeFileStat({ ino: 4000 });
    mockStat.mockResolvedValue(fileStat);
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue(null);
    mockRepo.findBookFileWithContextByIno.mockResolvedValue({
      file: { id: 50, bookId: 30, absolutePath: '/books/Author/book.epub' },
      libraryId: 2,
      folderPath: '/books/Author',
      libraryFolderPath: '/books',
      bookStatus: 'present',
    } as any);

    const result = await makeService().handleCreate('/books/Author/book.epub');

    expect(result).toEqual({ type: 'noop' });
    expect(mockRepo.updateBookFile).not.toHaveBeenCalled();
  });

  it('does not update folderPath when folder did not change', async () => {
    const fileStat = makeFileStat({ ino: 4000, size: 70000 });
    mockStat.mockResolvedValue(fileStat);
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue(null);
    mockRepo.findBookFileWithContextByIno.mockResolvedValue({
      file: { id: 50, bookId: 30, absolutePath: '/books/Author/old.epub' },
      libraryId: 2,
      folderPath: '/books/Author',
      libraryFolderPath: '/books',
      bookStatus: 'missing',
    } as any);

    const result = await makeService().handleCreate('/books/Author/renamed.epub');

    expect(mockRepo.updateBookFolderPath).not.toHaveBeenCalled();
    expect(result).toEqual({ type: 'book-moved', libraryId: 2, bookIds: [30] });
  });

  it('handles root-level file rename (folderPath equals old absolutePath)', async () => {
    const fileStat = makeFileStat({ ino: 5000 });
    mockStat.mockResolvedValue(fileStat);
    mockRepo.findBookFileByAbsolutePath.mockResolvedValue(null);
    mockRepo.findMissingBookByFolderPath.mockResolvedValue(null);
    mockRepo.findBookFileWithContextByIno.mockResolvedValue({
      file: { id: 60, bookId: 40, absolutePath: '/books/old.epub' },
      libraryId: 3,
      folderPath: '/books/old.epub',
      libraryFolderPath: '/books',
      bookStatus: 'missing',
    } as any);

    const result = await makeService().handleCreate('/books/renamed.epub');

    expect(mockRepo.updateBookFolderPath).toHaveBeenCalledWith(40, '/books/renamed.epub');
    expect(result).toEqual({ type: 'book-moved', libraryId: 3, bookIds: [40] });
  });
});

// ── handleCreate — directory move detection ─────────────────────────────────

describe('handleCreate — directory move detection', () => {
  it('detects moved books in a renamed directory via inode matching', async () => {
    mockStat
      .mockResolvedValueOnce(makeFileStat({ isDirectory: true, isFile: false }))
      .mockResolvedValueOnce(makeFileStat({ ino: 6000, size: 90000 }));

    mockRepo.findMissingBooksByFolderPath.mockResolvedValue([]);
    mockReaddir.mockResolvedValue([{ isFile: () => true, name: 'book.epub', parentPath: '/books/NewAuthor' }] as any);
    mockRepo.findBookFileWithContextByIno.mockResolvedValue({
      file: { id: 70, bookId: 50, absolutePath: '/books/OldAuthor/book.epub' },
      libraryId: 4,
      folderPath: '/books/OldAuthor',
      libraryFolderPath: '/books',
      bookStatus: 'missing',
    } as any);

    const result = await makeService().handleCreate('/books/NewAuthor');

    expect(mockRepo.updateBookFile).toHaveBeenCalledWith(70, expect.objectContaining({ absolutePath: '/books/NewAuthor/book.epub' }));
    expect(mockRepo.updateBookFolderPath).toHaveBeenCalledWith(50, '/books/NewAuthor');
    expect(result).toEqual({ type: 'book-moved', libraryId: 4, bookIds: [50] });
  });

  it('returns noop when renamed directory has no matching inodes', async () => {
    mockStat.mockResolvedValueOnce(makeFileStat({ isDirectory: true, isFile: false }));
    mockRepo.findMissingBooksByFolderPath.mockResolvedValue([]);
    mockReaddir.mockResolvedValue([]);

    const result = await makeService().handleCreate('/books/EmptyDir');

    expect(result).toEqual({ type: 'noop' });
  });
});

// ── reconcileMissingBooks ────────────────────────────────────────────────────

describe('reconcileMissingBooks', () => {
  it('returns empty when no missing books', async () => {
    mockRepo.findMissingBooksForLibraries.mockResolvedValue([]);

    const results = await makeService().reconcileMissingBooks([1]);

    expect(results).toEqual([]);
  });

  it('restores books whose files reappear on disk', async () => {
    mockRepo.findMissingBooksForLibraries.mockResolvedValue([{ id: 50, libraryId: 2, libraryFolderId: 10, folderPath: '/books/restored' } as any]);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 300, absolutePath: '/books/restored/book.epub', bookId: 50, role: 'content', format: 'epub', sizeBytes: 99000 } as any,
    ]);
    mockStat.mockResolvedValue(makeFileStat({ ino: 5000, size: 99000 }));

    const results = await makeService().reconcileMissingBooks([2]);

    expect(mockRepo.updateBookFile).toHaveBeenCalledWith(300, expect.objectContaining({ ino: 5000 }));
    expect(mockRepo.updateBookPrimaryFile).toHaveBeenCalledWith(50, 300);
    expect(mockRepo.markBooksAsPresent).toHaveBeenCalledWith([50]);
    expect(results).toEqual([{ type: 'book-restored', libraryId: 2, bookIds: [50] }]);
  });

  it('skips books whose files are still gone', async () => {
    mockRepo.findMissingBooksForLibraries.mockResolvedValue([{ id: 51, libraryId: 2, libraryFolderId: 10, folderPath: '/books/still-gone' } as any]);
    mockRepo.findBookFilesByBookId.mockResolvedValue([
      { id: 301, absolutePath: '/books/still-gone/book.epub', bookId: 51, role: 'content', format: 'epub', sizeBytes: 1000 } as any,
    ]);
    mockStat.mockRejectedValue(new Error('ENOENT'));

    const results = await makeService().reconcileMissingBooks([2]);

    expect(mockRepo.markBooksAsPresent).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });
});
