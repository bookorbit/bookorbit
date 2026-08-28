import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BulkRenameService } from './bulk-rename.service';
import type { BulkRenameBookData } from '../file-write/bulk-rename.repository';
import type { FileRenameResult } from '@bookorbit/types';

function makeBookData(overrides: Partial<BulkRenameBookData> & { bookId?: number } = {}): BulkRenameBookData {
  const bookId = overrides.bookId ?? 1;
  const absolutePath = overrides.absolutePath ?? `/library/folder/book-${bookId}.epub`;
  const format = overrides.format ?? 'epub';
  const primaryFileId = overrides.primaryFileId ?? bookId * 100;

  return {
    bookId,
    title: 'Test Book',
    primaryFileId,
    absolutePath,
    relPath: `folder/book-${bookId}.epub`,
    format,
    libraryFolderPath: '/library',
    libraryName: 'Test Library',
    organizationMode: 'book_per_file',
    fileNamingPattern: '{authors}/{title}',
    bookFolderPath: absolutePath,
    metadata: {
      title: overrides.title ?? 'Test Book',
      subtitle: null,
      publisher: null,
      language: null,
      isbn13: null,
      publishedYear: null,
      seriesName: null,
      seriesIndex: null,
    },
    authors: ['Author A'],
    narrators: [],
    // A single-file book unless a test says otherwise.
    files: [{ id: primaryFileId, absolutePath, format, role: 'content', sortOrder: null }],
    ...overrides,
  };
}

/**
 * A multi-track audiobook: several content files that all resolve to one filename under the
 * pattern, which is what forces the `-PartNN` suffixes back on.
 */
function makeMultiTrackAudiobook(bookId: number, title: string, partCount: number, folder = `/library/${title}`): BulkRenameBookData {
  const files = Array.from({ length: partCount }, (_, index) => ({
    id: bookId * 100 + index,
    absolutePath: `${folder}/${title}-Part${String(index + 1).padStart(2, '0')}.mp3`,
    format: 'mp3',
    role: 'content',
    sortOrder: index,
  }));

  return makeBookData({
    bookId,
    title,
    primaryFileId: files[0]!.id,
    absolutePath: files[0]!.absolutePath,
    format: 'mp3',
    bookFolderPath: folder,
    organizationMode: 'book_per_folder',
    fileNamingPattern: '{title}/{title}',
    files,
  });
}

// Under the default '{title}' pattern, a book whose file sits in /library/folder/* resolves to
// /library/<title>.* and therefore always lands in the will_rename bucket. Distinct titles keep
// each new path unique so they are never reclassified as collisions.
function willRenameBook(id: number): BulkRenameBookData {
  return makeBookData({ bookId: id, title: `Book ${id}`, absolutePath: `/library/folder/book-${id}.epub` });
}

// The stream opens with a lifecycle event so the response headers flush before the slow work.
// Assertions about renames care only about the per-book events that follow it.
function renameEvents(events: any[]): any[] {
  return events.filter((event) => !('started' in event) && !('done' in event));
}

describe('BulkRenameService', () => {
  let service: BulkRenameService;

  const bulkRenameRepo = {
    findAllBooksForLibrary: vi.fn(),
    findLibrarySettings: vi.fn(),
  };

  const fileRenameRepo = {
    findExistingPaths: vi.fn(),
  };

  const fileRenameService = {
    performRename: vi.fn(),
  };

  const appSettings = {
    getUploadPattern: vi.fn(),
    getUploadPatternBookPerFolder: vi.fn(),
    isCrossPlatformPathSanitizationEnabled: vi.fn(),
  };

  const notificationService = {
    notify: vi.fn(),
  };

  const fileWatcherService = {
    stopWatcher: vi.fn(),
    startWatcher: vi.fn(),
    pauseWatcher: vi.fn(),
    resumeWatcher: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();

    appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(false);
    appSettings.getUploadPattern.mockResolvedValue('{authors}/{title}');
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{authors}/{title}/');
    notificationService.notify.mockResolvedValue(undefined);
    fileRenameRepo.findExistingPaths.mockResolvedValue(new Map());
    fileWatcherService.pauseWatcher.mockReturnValue(true);

    service = new BulkRenameService(
      bulkRenameRepo as any,
      fileRenameRepo as any,
      fileRenameService as any,
      appSettings as any,
      notificationService as any,
      fileWatcherService as any,
    );
  });

  describe('getPreview', () => {
    it('returns the pattern the preview was resolved against', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{authors}/{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([makeBookData()]);

      const page = await service.getPreview(1, 1, 50);

      expect(page.pattern).toBe('{authors}/{title}');
    });

    it('reports an empty pattern when the library has none', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: null,
        organizationMode: 'book_per_file',
        watch: false,
      });
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([makeBookData()]);
      appSettings.getUploadPattern.mockResolvedValue(null);

      const page = await service.getPreview(1, 1, 50);

      expect(page.pattern).toBe('');
      expect(page.items[0].status).toBe('no_pattern');
    });

    it('computes preview items for a library', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{authors}/{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book = makeBookData({ bookId: 1, title: 'Dune' });
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].bookId).toBe(1);
      expect(result.items[0].status).toBe('will_rename');
      expect(result.items[0].newPath).toContain('Author A');
      expect(result.items[0].newPath).toContain('Dune');
      expect(result.total).toBe(1);
      expect(result.totalByStatus.will_rename).toBe(1);
    });

    it('marks books as unchanged when path already matches', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book = makeBookData({
        bookId: 1,
        title: 'MyBook',
        absolutePath: '/library/MyBook.epub',
      });
      book.metadata.title = 'MyBook';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].status).toBe('unchanged');
    });

    it('detects cross-book collisions', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book1 = makeBookData({ bookId: 1, title: 'Dune' });
      book1.metadata.title = 'Dune';
      const book2 = makeBookData({ bookId: 2, title: 'Dune' });
      book2.metadata.title = 'Dune';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book1, book2]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].status).toBe('collision');
      expect(result.items[1].status).toBe('collision');
      expect(result.totalByStatus.collision).toBe(2);
    });

    it('detects collision with existing paths in the database', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book = makeBookData({ bookId: 1, title: 'Taken' });
      book.metadata.title = 'Taken';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      fileRenameRepo.findExistingPaths.mockResolvedValue(new Map([['/library/Taken.epub', 99]]));

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].status).toBe('collision');
      expect(result.items[0].reason).toContain('already taken');
    });

    it('does not flag collision when the same book owns the existing path', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book = makeBookData({ bookId: 1, title: 'SameBook' });
      book.metadata.title = 'SameBook';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      fileRenameRepo.findExistingPaths.mockResolvedValue(new Map([['/library/SameBook.epub', 1]]));

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].status).not.toBe('collision');
    });

    it('marks no_pattern when no pattern is configured', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: null,
        organizationMode: 'book_per_file',
        watch: false,
      });

      appSettings.getUploadPattern.mockResolvedValue(null);

      const book = makeBookData({ bookId: 1 });
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].status).toBe('no_pattern');
    });

    it('paginates correctly', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const books = Array.from({ length: 5 }, (_, i) => {
        const b = makeBookData({ bookId: i + 1, title: `Book${i + 1}` });
        b.metadata.title = `Book${i + 1}`;
        return b;
      });
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue(books);

      const page1 = await service.getPreview(1, 1, 2);
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.items[0].bookId).toBe(1);
      expect(page1.items[1].bookId).toBe(2);

      const page2 = await service.getPreview(1, 2, 2);
      expect(page2.items).toHaveLength(2);
      expect(page2.items[0].bookId).toBe(3);
    });

    it('filters by status', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book1 = makeBookData({ bookId: 1, title: 'WillChange' });
      book1.metadata.title = 'WillChange';
      const book2 = makeBookData({ bookId: 2, title: 'AlreadyRight' });
      book2.metadata.title = 'AlreadyRight';
      book2.absolutePath = '/library/AlreadyRight.epub';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book1, book2]);

      const willRename = await service.getPreview(1, 1, 50, 'will_rename');
      expect(willRename.items).toHaveLength(1);
      expect(willRename.items[0].bookId).toBe(1);
      expect(willRename.total).toBe(1);

      const unchanged = await service.getPreview(1, 1, 50, 'unchanged');
      expect(unchanged.items).toHaveLength(1);
      expect(unchanged.items[0].bookId).toBe(2);
    });

    it('throws NotFoundException when library does not exist', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(null);

      await expect(service.getPreview(999, 1, 50)).rejects.toThrow(NotFoundException);
    });

    it('uses cache for repeated calls', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book = makeBookData({ bookId: 1, title: 'Cached' });
      book.metadata.title = 'Cached';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      await service.getPreview(1, 1, 50);
      await service.getPreview(1, 1, 50);

      expect(bulkRenameRepo.findAllBooksForLibrary).toHaveBeenCalledTimes(1);
    });

    it('falls back to global pattern when library has no pattern', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: null,
        organizationMode: 'book_per_file',
        watch: false,
      });

      appSettings.getUploadPattern.mockResolvedValue('{title}');

      const book = makeBookData({ bookId: 1, title: 'FallbackTest' });
      book.metadata.title = 'FallbackTest';
      book.fileNamingPattern = null;
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].newPath).toContain('FallbackTest');
      expect(appSettings.getUploadPattern).toHaveBeenCalled();
    });

    it('uses book_per_folder pattern for book_per_folder organization mode', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: null,
        organizationMode: 'book_per_folder',
        watch: false,
      });

      appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{title}/');

      const book = makeBookData({ bookId: 1, title: 'FolderBook' });
      book.metadata.title = 'FolderBook';
      book.fileNamingPattern = null;
      book.organizationMode = 'book_per_folder';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(appSettings.getUploadPatternBookPerFolder).toHaveBeenCalled();
      expect(result.items[0].newPath).toContain('FolderBook');
    });

    it('returns empty items for library with no books', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.totalByStatus.will_rename).toBe(0);
    });

    it('sanitizes colon in title when cross-platform sanitization is enabled', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{authors}/{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });
      appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(true);

      const book = makeBookData({ bookId: 1 });
      book.metadata.title = 'Bad Love: A Novel';
      book.authors = ['Jonathan Kellerman'];
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].newPath).not.toContain(':');
      expect(result.items[0].newPath).toContain('Bad Love_ A Novel');
    });

    it('preserves colon in title when cross-platform sanitization is disabled', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{authors}/{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });
      appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(false);

      const book = makeBookData({ bookId: 1 });
      book.metadata.title = 'Bad Love: A Novel';
      book.authors = ['Jonathan Kellerman'];
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].newPath).toContain('Bad Love: A Novel');
    });

    it('sanitizes double-quote in author name when cross-platform sanitization is enabled', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{authors}/{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });
      appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(true);

      const book = makeBookData({ bookId: 1 });
      book.metadata.title = 'A Book';
      book.authors = ['John "The Author" Smith'];
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      const result = await service.getPreview(1, 1, 50);

      expect(result.items[0].newPath).not.toContain('"');
    });
  });

  describe('execute', () => {
    const defaultSettings = {
      fileRenameEnabled: true,
      fileNamingPattern: '{title}',
      organizationMode: 'book_per_file',
      watch: false,
    };

    it('skips the excluded books and renames the rest', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2), willRenameBook(3)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const summary = await service.execute(1, 42, {
        excludeBookIds: [2],
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(summary.processed).toBe(2);
      expect(summary.succeeded).toBe(2);
      const renamed = fileRenameService.performRename.mock.calls.map((call) => call[0]);
      expect(renamed).toEqual([1, 3]);
    });

    it('ignores excluded ids that were never candidates', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const summary = await service.execute(1, 42, {
        excludeBookIds: [999],
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(summary.processed).toBe(1);
      expect(fileRenameService.performRename.mock.calls[0][0]).toBe(1);
    });

    it('renames nothing when every candidate is excluded', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2)]);

      const summary = await service.execute(1, 42, {
        excludeBookIds: [1, 2],
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(summary.processed).toBe(0);
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
    });

    it('renames only the included books', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2), willRenameBook(3)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const summary = await service.execute(1, 42, {
        includeBookIds: [1, 3],
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(summary.processed).toBe(2);
      expect(fileRenameService.performRename.mock.calls.map((call) => call[0])).toEqual([1, 3]);
    });

    it('renames nothing when the included list is empty', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2)]);

      const summary = await service.execute(1, 42, {
        includeBookIds: [],
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(summary.processed).toBe(0);
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
    });

    it('ignores included ids that the preview held back', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      const settled = makeBookData({ bookId: 2, title: 'Settled', absolutePath: '/library/Settled.epub' });
      settled.metadata.title = 'Settled';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), settled]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const summary = await service.execute(1, 42, {
        includeBookIds: [1, 2],
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(summary.processed).toBe(1);
      expect(fileRenameService.performRename.mock.calls.map((call) => call[0])).toEqual([1]);
    });

    it('renames only the will_rename candidates and reports summary', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2), willRenameBook(3)]);

      const results: FileRenameResult[] = [
        { status: 'success', durationMs: 10 },
        { status: 'skipped', reason: 'path unchanged', durationMs: 5 },
        { status: 'success', durationMs: 10 },
      ];
      fileRenameService.performRename.mockImplementation(() => {
        return Promise.resolve(results.shift()!);
      });

      const events: any[] = [];
      const summary = await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
      });

      expect(summary.processed).toBe(3);
      expect(summary.succeeded).toBe(2);
      expect(summary.failed).toBe(0);
      expect(summary.skipped).toBe(1);
      expect(summary.cancelled).toBe(false);
      expect(renameEvents(events)).toHaveLength(3);
      expect(fileRenameService.performRename).toHaveBeenCalledTimes(3);
    });

    it('only renames will_rename books, never the unchanged or collision ones', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);

      const willRename = willRenameBook(1);
      // Already at its target path under the '{title}' pattern -> unchanged.
      const unchanged = makeBookData({ bookId: 2, title: 'Settled', absolutePath: '/library/Settled.epub' });
      // Two books resolving to /library/Same.epub -> both collision.
      const collideA = makeBookData({ bookId: 3, title: 'Same', absolutePath: '/library/folder/a.epub' });
      const collideB = makeBookData({ bookId: 4, title: 'Same', absolutePath: '/library/folder/b.epub' });
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRename, unchanged, collideA, collideB]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const events: any[] = [];
      const summary = await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
      });

      expect(fileRenameService.performRename).toHaveBeenCalledTimes(1);
      expect(fileRenameService.performRename).toHaveBeenCalledWith(1, 42, false, true);
      expect(renameEvents(events)).toEqual([{ bookId: 1, status: 'success', reason: undefined }]);
      expect(summary.processed).toBe(1);
      expect(summary.succeeded).toBe(1);
    });

    it('suppresses per-book notifications during bulk rename', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      // performRename(bookId, userId, force=false, suppressNotification=true)
      expect(fileRenameService.performRename).toHaveBeenCalledWith(1, 42, false, true);
    });

    it('does nothing per-book when there are no will_rename candidates but still notifies completion', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      const unchanged = makeBookData({ bookId: 1, title: 'Settled', absolutePath: '/library/Settled.epub' });
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([unchanged]);

      const summary = await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(fileRenameService.performRename).not.toHaveBeenCalled();
      expect(summary).toMatchObject({ processed: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: false });
      expect(notificationService.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'bulk_rename_completed' }));
    });

    it('stops when cancelled and reports partial progress', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2), willRenameBook(3)]);

      let callCount = 0;
      fileRenameService.performRename.mockImplementation(() => {
        callCount++;
        return Promise.resolve({ status: 'success', durationMs: 10 });
      });

      const summary = await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => callCount >= 1,
      });

      expect(summary.succeeded).toBe(1);
      expect(summary.cancelled).toBe(true);
      expect(fileRenameService.performRename).toHaveBeenCalledTimes(1);
    });

    it('throws when library not found', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(null);

      await expect(
        service.execute(999, 42, {
          onProgress: () => {},
          isCancelled: () => false,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when file rename is not enabled', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        ...defaultSettings,
        fileRenameEnabled: false,
      });

      await expect(
        service.execute(1, 42, {
          onProgress: () => {},
          isCancelled: () => false,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prevents concurrent execution on same library', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);

      let resolveRename: ((value: FileRenameResult) => void) | undefined;
      fileRenameService.performRename.mockImplementation(
        () =>
          new Promise<FileRenameResult>((resolve) => {
            resolveRename = resolve;
          }),
      );

      const first = service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      await vi.waitFor(() => expect(resolveRename).toBeDefined());

      await expect(
        service.execute(1, 42, {
          onProgress: () => {},
          isCancelled: () => false,
        }),
      ).rejects.toThrow(BadRequestException);

      resolveRename!({ status: 'success', durationMs: 10 });
      await first;
    });

    it('pauses and resumes the file watcher when library has watch enabled', async () => {
      const watchSettings = { ...defaultSettings, watch: true };
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(fileWatcherService.pauseWatcher).toHaveBeenCalledWith(1);
      expect(fileWatcherService.resumeWatcher).toHaveBeenCalledWith(1);
      // Tearing the watcher down would block for seconds; pausing must not do it.
      expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
      expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    });

    it('does not touch file watcher when library has watch disabled', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(fileWatcherService.pauseWatcher).not.toHaveBeenCalled();
      expect(fileWatcherService.resumeWatcher).not.toHaveBeenCalled();
    });

    it('resumes file watcher even after failure', async () => {
      const watchSettings = { ...defaultSettings, watch: true };
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockRejectedValue(new Error('disk error'));

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(fileWatcherService.pauseWatcher).toHaveBeenCalledWith(1);
      expect(fileWatcherService.resumeWatcher).toHaveBeenCalledWith(1);
    });

    it('counts failed renames from performRename', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2)]);

      fileRenameService.performRename.mockResolvedValueOnce({ status: 'failed', reason: 'collision', durationMs: 5 });
      fileRenameService.performRename.mockResolvedValueOnce({ status: 'success', durationMs: 10 });

      const events: any[] = [];
      const summary = await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
      });

      expect(summary.failed).toBe(1);
      expect(summary.succeeded).toBe(1);
      expect(renameEvents(events)[0].status).toBe('failed');
      expect(renameEvents(events)[1].status).toBe('success');
    });

    it('handles thrown errors from performRename gracefully', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockRejectedValue(new Error('disk error'));

      const events: any[] = [];
      const summary = await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
      });

      expect(summary.failed).toBe(1);
      expect(renameEvents(events)[0].status).toBe('failed');
      expect(renameEvents(events)[0].reason).toBe('disk error');
    });

    it('notifies failure and rethrows when the run errors unexpectedly', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await expect(
        service.execute(1, 42, {
          onProgress: () => {},
          isCancelled: () => {
            throw new Error('stream broke');
          },
        }),
      ).rejects.toThrow('stream broke');

      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bulk_rename_failed',
          title: 'Bulk rename failed',
        }),
      );
      // The running lock must be released even on an unexpected failure.
      expect(service.isRunning(1)).toBe(false);
    });

    it('sends success notification when all renames succeed', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bulk_rename_completed',
          title: 'Bulk rename completed',
        }),
      );
    });

    it('sends failure notification when some renames fail', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'failed', reason: 'collision', durationMs: 5 });

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'bulk_rename_failed',
          title: 'Bulk rename completed with errors',
        }),
      );
    });

    it('clears running lock after execution completes', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      expect(service.isRunning(1)).toBe(false);

      const promise = service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      await promise;
      expect(service.isRunning(1)).toBe(false);
    });

    it('invalidates preview cache on execute', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.getPreview(1, 1, 50);
      expect(bulkRenameRepo.findAllBooksForLibrary).toHaveBeenCalledTimes(1);

      // execute() recomputes the preview internally to derive the will_rename set (call #2),
      // and clears the cache so the following getPreview recomputes again (call #3).
      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });
      expect(bulkRenameRepo.findAllBooksForLibrary).toHaveBeenCalledTimes(2);

      await service.getPreview(1, 1, 50);
      expect(bulkRenameRepo.findAllBooksForLibrary).toHaveBeenCalledTimes(3);
    });
  });

  describe('isRunning', () => {
    it('returns false when no execution is in progress', () => {
      expect(service.isRunning(1)).toBe(false);
    });
  });

  // A bulk rename used to tear the library watcher down and rebuild it. chokidar's close()
  // releases one handle per watched directory and blocks the event loop while it does: measured
  // at 9.5s across 944 directories on a real library, before a single file had moved. Every event
  // is gated on library membership in the watcher's `subscriptions` map, so pausing achieves the
  // same isolation for free. These tests pin that, plus the stream and lock behaviour around it.
  describe('execute stream latency and watcher handling', () => {
    const watchSettings = {
      fileRenameEnabled: true,
      fileNamingPattern: '{title}',
      organizationMode: 'book_per_file' as const,
      watch: true,
    };

    const noWatchSettings = { ...watchSettings, watch: false };

    it('emits a started event carrying the narrowed total before any rename', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(noWatchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2), willRenameBook(3)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const events: any[] = [];
      await service.execute(1, 42, { onProgress: (e) => events.push(e), isCancelled: () => false });

      expect(events[0]).toEqual({ started: true, total: 3 });
      expect(fileRenameService.performRename).toHaveBeenCalledTimes(3);
    });

    it('reports the excluded total in the started event, not the candidate total', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(noWatchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2), willRenameBook(3)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const events: any[] = [];
      await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
        excludeBookIds: [2],
      });

      expect(events[0]).toEqual({ started: true, total: 2 });
    });

    it('reports zero in the started event when the selection renames nothing', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(noWatchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2)]);

      const events: any[] = [];
      await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
        includeBookIds: [],
      });

      expect(events[0]).toEqual({ started: true, total: 0 });
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
    });

    it('emits started before the watcher is paused so headers flush first', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      const order: string[] = [];
      fileWatcherService.pauseWatcher.mockImplementation(() => {
        order.push('pauseWatcher');
        return true;
      });

      await service.execute(1, 42, {
        onProgress: (e) => order.push('started' in e ? 'started' : 'progress'),
        isCancelled: () => false,
      });

      expect(order).toEqual(['started', 'pauseWatcher', 'progress']);
    });

    it('never closes or rebuilds the watcher, which is the blocking work', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false });

      expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
      expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    });

    it('pauses once before the first rename and resumes once after the last', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1), willRenameBook(2), willRenameBook(3)]);

      const order: string[] = [];
      fileWatcherService.pauseWatcher.mockImplementation(() => {
        order.push('pause');
        return true;
      });
      fileWatcherService.resumeWatcher.mockImplementation(() => {
        order.push('resume');
        return true;
      });
      fileRenameService.performRename.mockImplementation(() => {
        order.push('rename');
        return Promise.resolve({ status: 'success', durationMs: 10 });
      });

      await service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false });

      expect(order).toEqual(['pause', 'rename', 'rename', 'rename', 'resume']);
    });

    it('does not resume a watcher it never paused', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });
      // No live watcher to pause, so there is nothing to put back.
      fileWatcherService.pauseWatcher.mockReturnValue(false);

      await service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false });

      expect(fileWatcherService.resumeWatcher).not.toHaveBeenCalled();
    });

    it('releases the lock as soon as the run finishes', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false });

      expect(service.isRunning(1)).toBe(false);
      await expect(service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false })).resolves.toBeDefined();
    });

    it('resumes the watcher and releases the lock when the run throws', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);

      await expect(
        service.execute(1, 42, {
          onProgress: () => {},
          isCancelled: () => {
            throw new Error('stream broke');
          },
        }),
      ).rejects.toThrow('stream broke');

      expect(fileWatcherService.resumeWatcher).toHaveBeenCalledWith(1);
      expect(service.isRunning(1)).toBe(false);
    });

    it('releases the lock when preparation fails before anything moves', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(noWatchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockRejectedValue(new Error('database down'));

      await expect(service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false })).rejects.toThrow('database down');

      // A preparation failure used to strand the lock, wedging the library as "already running".
      expect(service.isRunning(1)).toBe(false);
      expect(fileWatcherService.pauseWatcher).not.toHaveBeenCalled();
    });

    it('releases the lock when pausing the watcher fails', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);
      fileWatcherService.pauseWatcher.mockImplementation(() => {
        throw new Error('cannot pause watcher');
      });

      await expect(service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false })).rejects.toThrow('cannot pause watcher');

      expect(service.isRunning(1)).toBe(false);
      // The watcher was never paused, so it must not be resumed, and nothing may have moved.
      expect(fileWatcherService.resumeWatcher).not.toHaveBeenCalled();
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
    });
  });

  // Search runs over the whole candidate set rather than the requested page. The client only ever
  // holds the pages it has scrolled to, so filtering there made a match on a later page
  // unreachable without loading every page before it.
  /**
   * The preview and the rename must answer "where does this book go" the same way. They used to
   * answer separately: the preview looked only at the primary file, so a multi-track audiobook
   * whose parts all resolve to one filename was offered as a rename, and the rename then skipped
   * it as "path unchanged" once the -PartNN suffixes were restored. Eleven books in a row could
   * report "renamed 0 of 11".
   */
  describe('getPreview agreement with the rename executor', () => {
    const audiobookSettings = {
      fileRenameEnabled: true,
      fileNamingPattern: '{title}/{title}',
      organizationMode: 'book_per_folder' as const,
      watch: false,
    };

    const singleFileSettings = {
      fileRenameEnabled: true,
      fileNamingPattern: '{title}',
      organizationMode: 'book_per_file' as const,
      watch: false,
    };

    it('reports a correctly named multi-track audiobook as unchanged, not as a rename', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(audiobookSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([makeMultiTrackAudiobook(1, 'Book', 17)]);

      const page = await service.getPreview(1, 1, 50);

      expect(page.items[0]?.status).toBe('unchanged');
      expect(page.totalByStatus.will_rename).toBe(0);
    });

    it('keeps the track suffix in the proposed path when the book does need moving', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(audiobookSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([makeMultiTrackAudiobook(1, 'Book', 3, '/library/Wrong Folder')]);

      const page = await service.getPreview(1, 1, 50);

      expect(page.items[0]?.status).toBe('will_rename');
      expect(page.items[0]?.newPath).toBe('/library/Book/Book-Part01.mp3');
    });

    it('does not offer renames that the executor would skip as unchanged', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(audiobookSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([
        makeMultiTrackAudiobook(1, 'Alpha', 5),
        makeMultiTrackAudiobook(2, 'Beta', 12),
        makeMultiTrackAudiobook(3, 'Gamma', 2),
      ]);

      const page = await service.getPreview(1, 1, 50, 'will_rename');

      // Every one of these is already where the pattern wants it once the parts are accounted for.
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('a run over those books renames nothing because none of them are candidates', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(audiobookSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([makeMultiTrackAudiobook(1, 'Alpha', 5), makeMultiTrackAudiobook(2, 'Beta', 12)]);

      const events: any[] = [];
      const summary = await service.execute(1, 42, { onProgress: (e) => events.push(e), isCancelled: () => false });

      // The old behaviour queued both and reported "renamed 0 of 2, 2 skipped".
      expect(events[0]).toEqual({ started: true, total: 0 });
      expect(summary).toEqual({ processed: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: false });
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
    });

    it('holds back a book whose renumbering would overwrite its own files', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(audiobookSettings);
      // Parts start at 02 on disk, so renumbering wants each file's neighbour's slot.
      const files = [2, 3, 4, 5].map((part, index) => ({
        id: 100 + index,
        absolutePath: `/library/Book/Book-Part${String(part).padStart(2, '0')}.mp3`,
        format: 'mp3',
        role: 'content',
        sortOrder: index,
      }));
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([
        makeBookData({
          bookId: 1,
          title: 'Book',
          primaryFileId: files[0]!.id,
          absolutePath: files[0]!.absolutePath,
          format: 'mp3',
          bookFolderPath: '/library/Book',
          organizationMode: 'book_per_folder',
          fileNamingPattern: '{title}/{title}',
          files,
        }),
      ]);

      const page = await service.getPreview(1, 1, 50);

      expect(page.items[0]?.status).toBe('collision');
      expect(page.items[0]?.reason).toBe('Renaming would overwrite another file in this book');
      expect(page.totalByStatus.will_rename).toBe(0);
    });

    it('does not run a book that was held back for overwriting its own files', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(audiobookSettings);
      const files = [2, 3, 4].map((part, index) => ({
        id: 100 + index,
        absolutePath: `/library/Book/Book-Part${String(part).padStart(2, '0')}.mp3`,
        format: 'mp3',
        role: 'content',
        sortOrder: index,
      }));
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([
        makeBookData({
          bookId: 1,
          title: 'Book',
          primaryFileId: files[0]!.id,
          absolutePath: files[0]!.absolutePath,
          format: 'mp3',
          bookFolderPath: '/library/Book',
          organizationMode: 'book_per_folder',
          fileNamingPattern: '{title}/{title}',
          files,
        }),
      ]);

      const summary = await service.execute(1, 42, { onProgress: () => {}, isCancelled: () => false });

      expect(summary.processed).toBe(0);
      expect(fileRenameService.performRename).not.toHaveBeenCalled();
    });

    it('still reports a single file book normally', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(singleFileSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([willRenameBook(1)]);

      const page = await service.getPreview(1, 1, 50);

      expect(page.items[0]?.status).toBe('will_rename');
    });

    it('treats a book with no file rows as a single file book rather than losing it', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(singleFileSettings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([makeBookData({ bookId: 1, title: 'Orphan', files: [] })]);

      const page = await service.getPreview(1, 1, 50);

      expect(page.items[0]?.status).toBe('will_rename');
      expect(page.items[0]?.newPath).toBe('/library/Orphan.epub');
    });
  });

  describe('getPreview search', () => {
    const settings = {
      fileRenameEnabled: true,
      fileNamingPattern: '{title}',
      organizationMode: 'book_per_file' as const,
      watch: false,
    };

    function library(count: number) {
      return Array.from({ length: count }, (_, i) =>
        makeBookData({ bookId: i + 1, title: `Book ${i + 1}`, absolutePath: `/library/folder/book-${i + 1}.epub` }),
      );
    }

    it('matches a book that sits well past the first page', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue(library(300));

      const page = await service.getPreview(1, 1, 50, undefined, 'Book 288');

      expect(page.total).toBe(1);
      expect(page.items[0]?.title).toBe('Book 288');
    });

    it('is case insensitive and ignores surrounding whitespace', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue(library(5));

      const page = await service.getPreview(1, 1, 50, undefined, '  bOoK 3  ');

      expect(page.items.map((item) => item.title)).toEqual(['Book 3']);
    });

    it('matches on the current path as well as the title', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([
        makeBookData({ bookId: 1, title: 'Alpha', absolutePath: '/library/Tolkien/alpha.epub' }),
        makeBookData({ bookId: 2, title: 'Beta', absolutePath: '/library/Herbert/beta.epub' }),
      ]);

      const page = await service.getPreview(1, 1, 50, undefined, 'tolkien');

      expect(page.items.map((item) => item.title)).toEqual(['Alpha']);
    });

    it('combines with the status filter rather than replacing it', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([
        makeBookData({ bookId: 1, title: 'Match', absolutePath: '/library/folder/match.epub' }),
        // Already at its target path under '{title}', so it lands in the unchanged bucket.
        makeBookData({ bookId: 2, title: 'Match Two', absolutePath: '/library/Match Two.epub' }),
      ]);

      const willRename = await service.getPreview(1, 1, 50, 'will_rename', 'match');
      const unchanged = await service.getPreview(1, 1, 50, 'unchanged', 'match');

      expect(willRename.items.map((item) => item.title)).toEqual(['Match']);
      expect(unchanged.items.map((item) => item.title)).toEqual(['Match Two']);
    });

    it('keeps status totals library-wide so the chips do not follow the search', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue(library(10));

      const page = await service.getPreview(1, 1, 50, undefined, 'Book 4');

      expect(page.total).toBe(1);
      expect(page.totalByStatus.will_rename).toBe(10);
    });

    it('paginates the matches rather than the whole library', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue(library(120));

      // "Book 1" also matches 1, 10-19, 100-119.
      const first = await service.getPreview(1, 1, 10, undefined, 'Book 1');
      const second = await service.getPreview(1, 2, 10, undefined, 'Book 1');

      expect(first.items).toHaveLength(10);
      expect(first.total).toBe(second.total);
      expect(second.items[0]?.bookId).not.toBe(first.items[0]?.bookId);
    });

    it('returns everything when the search is blank', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue(library(7));

      expect((await service.getPreview(1, 1, 50, undefined, '   ')).total).toBe(7);
      expect((await service.getPreview(1, 1, 50)).total).toBe(7);
    });

    it('returns no matches without failing', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(settings);
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue(library(5));

      const page = await service.getPreview(1, 1, 50, undefined, 'nothing here');

      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });
  });

  describe('invalidateCache', () => {
    it('causes next getPreview call to recompute', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue({
        fileRenameEnabled: true,
        fileNamingPattern: '{title}',
        organizationMode: 'book_per_file',
        watch: false,
      });

      const book = makeBookData({ bookId: 1, title: 'Invalidation' });
      book.metadata.title = 'Invalidation';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      await service.getPreview(1, 1, 50);
      service.invalidateCache(1);
      await service.getPreview(1, 1, 50);

      expect(bulkRenameRepo.findAllBooksForLibrary).toHaveBeenCalledTimes(2);
    });
  });
});
