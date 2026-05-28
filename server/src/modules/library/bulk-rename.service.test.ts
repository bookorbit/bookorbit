import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BulkRenameService } from './bulk-rename.service';
import type { BulkRenameBookData } from '../file-write/bulk-rename.repository';
import type { FileRenameResult } from '@bookorbit/types';

function makeBookData(overrides: Partial<BulkRenameBookData> & { bookId?: number } = {}): BulkRenameBookData {
  const bookId = overrides.bookId ?? 1;
  return {
    bookId,
    title: 'Test Book',
    absolutePath: `/library/folder/book-${bookId}.epub`,
    relPath: `folder/book-${bookId}.epub`,
    format: 'epub',
    libraryFolderPath: '/library',
    organizationMode: 'book_per_file',
    fileNamingPattern: '{authors}/{title}',
    bookFolderPath: `/library/folder/book-${bookId}.epub`,
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
    ...overrides,
  };
}

describe('BulkRenameService', () => {
  let service: BulkRenameService;

  const bulkRenameRepo = {
    findAllBooksForLibrary: vi.fn(),
    findLibrarySettings: vi.fn(),
    findLibraryBookIds: vi.fn(),
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
  };

  const libraryRepo = {
    findFoldersByLibrary: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();

    appSettings.isCrossPlatformPathSanitizationEnabled.mockResolvedValue(false);
    appSettings.getUploadPattern.mockResolvedValue('{authors}/{title}');
    appSettings.getUploadPatternBookPerFolder.mockResolvedValue('{authors}/{title}/');
    notificationService.notify.mockResolvedValue(undefined);
    fileRenameRepo.findExistingPaths.mockResolvedValue(new Map());
    libraryRepo.findFoldersByLibrary.mockResolvedValue([{ path: '/library' }]);

    service = new BulkRenameService(
      bulkRenameRepo as any,
      fileRenameRepo as any,
      fileRenameService as any,
      appSettings as any,
      notificationService as any,
      fileWatcherService as any,
      libraryRepo as any,
    );
  });

  describe('getPreview', () => {
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
  });

  describe('execute', () => {
    const defaultSettings = {
      fileRenameEnabled: true,
      fileNamingPattern: '{title}',
      organizationMode: 'book_per_file',
      watch: false,
    };

    it('renames all books sequentially and reports summary', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1, 2, 3]);

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
      expect(events).toHaveLength(3);
      expect(fileRenameService.performRename).toHaveBeenCalledTimes(3);
    });

    it('stops when cancelled and reports partial progress', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1, 2, 3]);

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
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);

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

    it('stops and restarts file watcher when library has watch enabled', async () => {
      const watchSettings = { ...defaultSettings, watch: true };
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(1);
      expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(1, ['/library']);
    });

    it('does not touch file watcher when library has watch disabled', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(fileWatcherService.stopWatcher).not.toHaveBeenCalled();
      expect(fileWatcherService.startWatcher).not.toHaveBeenCalled();
    });

    it('restarts file watcher even after failure', async () => {
      const watchSettings = { ...defaultSettings, watch: true };
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(watchSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
      fileRenameService.performRename.mockRejectedValue(new Error('disk error'));

      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      expect(fileWatcherService.stopWatcher).toHaveBeenCalledWith(1);
      expect(fileWatcherService.startWatcher).toHaveBeenCalledWith(1, ['/library']);
    });

    it('counts failed renames from performRename', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1, 2]);

      fileRenameService.performRename.mockResolvedValueOnce({ status: 'failed', reason: 'collision', durationMs: 5 });
      fileRenameService.performRename.mockResolvedValueOnce({ status: 'success', durationMs: 10 });

      const events: any[] = [];
      const summary = await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
      });

      expect(summary.failed).toBe(1);
      expect(summary.succeeded).toBe(1);
      expect(events[0].status).toBe('failed');
      expect(events[1].status).toBe('success');
    });

    it('handles thrown errors from performRename gracefully', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
      fileRenameService.performRename.mockRejectedValue(new Error('disk error'));

      const events: any[] = [];
      const summary = await service.execute(1, 42, {
        onProgress: (e) => events.push(e),
        isCancelled: () => false,
      });

      expect(summary.failed).toBe(1);
      expect(events[0].status).toBe('failed');
      expect(events[0].reason).toBe('disk error');
    });

    it('sends success notification when all renames succeed', async () => {
      bulkRenameRepo.findLibrarySettings.mockResolvedValue(defaultSettings);
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
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
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
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
      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
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

      const book = makeBookData({ bookId: 1, title: 'CacheTest' });
      book.metadata.title = 'CacheTest';
      bulkRenameRepo.findAllBooksForLibrary.mockResolvedValue([book]);

      await service.getPreview(1, 1, 50);
      expect(bulkRenameRepo.findAllBooksForLibrary).toHaveBeenCalledTimes(1);

      bulkRenameRepo.findLibraryBookIds.mockResolvedValue([1]);
      fileRenameService.performRename.mockResolvedValue({ status: 'success', durationMs: 10 });
      await service.execute(1, 42, {
        onProgress: () => {},
        isCancelled: () => false,
      });

      await service.getPreview(1, 1, 50);
      expect(bulkRenameRepo.findAllBooksForLibrary).toHaveBeenCalledTimes(2);
    });
  });

  describe('isRunning', () => {
    it('returns false when no execution is in progress', () => {
      expect(service.isRunning(1)).toBe(false);
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
