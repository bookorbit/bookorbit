import { Logger } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StorygraphSyncService } from './storygraph-sync.service';

const mockRepo = {
  findBookState: vi.fn(),
  findBookStatesByBookIds: vi.fn(),
  upsertBookState: vi.fn(),
  resetSyncProgress: vi.fn(),
  updateLastSyncedAt: vi.fn(),
  findSyncableBooks: vi.fn(),
  findCurrentReadingBooks: vi.fn(),
  findSyncableBooksBatch: vi.fn(),
  countSyncableBooks: vi.fn(),
  countPendingSyncableBooks: vi.fn(),
  findSyncableBook: vi.fn(),
  findBookSyncData: vi.fn(),
  clearBookMatch: vi.fn(),
  findBooksWithSyncErrors: vi.fn(),
  findSettings: vi.fn(),
  setBookSyncOverride: vi.fn(),
};

const mockClient = {
  get: vi.fn(),
  post: vi.fn(),
  extractCsrfToken: vi.fn(),
};

const mockMatchService = {
  matchBook: vi.fn(),
  resolveManualInput: vi.fn(),
  getEditions: vi.fn(),
  switchEdition: vi.fn(),
};

const mockSettingsService = {
  getCookiesForUser: vi.fn(),
  getSettings: vi.fn(),
};

const mockLibraryService = {
  findAccessibleLibraryIds: vi.fn(),
};

function makeService() {
  return new StorygraphSyncService(
    mockRepo as any,
    mockClient as any,
    mockMatchService as any,
    mockSettingsService as any,
    mockLibraryService as any,
  );
}

const cookies = { sessionCookie: 'sess', rememberToken: 'remember' };

const readingBook = {
  bookId: 1,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Book One',
  authorName: 'Author One',
  format: 'epub',
  status: 'reading',
  progress: 42,
};

describe('StorygraphSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockRepo.findBookStatesByBookIds.mockResolvedValue([]);
    mockRepo.findSyncableBooks.mockResolvedValue([]);
    mockRepo.findCurrentReadingBooks.mockResolvedValue([]);
    mockRepo.findSyncableBooksBatch.mockResolvedValue([]);
    mockRepo.countSyncableBooks.mockResolvedValue(0);
    mockRepo.countPendingSyncableBooks.mockResolvedValue(0);
    mockRepo.findSyncableBook.mockResolvedValue(null);
    mockRepo.findBookSyncData.mockImplementation((userId: number, bookId: number) => mockRepo.findSyncableBook(userId, bookId));
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.resetSyncProgress.mockResolvedValue(undefined);
    mockRepo.updateLastSyncedAt.mockResolvedValue(undefined);
    mockRepo.clearBookMatch.mockResolvedValue(undefined);
    mockRepo.setBookSyncOverride.mockResolvedValue({});
    mockRepo.findSettings.mockResolvedValue({});
    mockSettingsService.getSettings.mockResolvedValue({
      cookiesConfigured: true,
      enabled: true,
      effectiveEnabled: true,
      disabledReason: null,
      bookSyncMode: 'all_eligible',
      autoSyncOnStatusChange: true,
      autoSyncOnProgressUpdate: true,
      lastSyncedAt: null,
    });
    mockLibraryService.findAccessibleLibraryIds.mockResolvedValue([1]);
    mockClient.extractCsrfToken.mockReturnValue('csrf-token');
    mockClient.get.mockResolvedValue({ status: 200, html: '<html></html>', redirectedToSignIn: false });
    mockClient.post.mockResolvedValue({ status: 302, html: '', redirectedToSignIn: false });
  });

  describe('syncBook', () => {
    it('does nothing when no cookies', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockRepo.findSyncableBook).not.toHaveBeenCalled();
    });

    it('does nothing when book not found', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('does nothing for unread status', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'unread' });
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockRepo.resetSyncProgress).not.toHaveBeenCalled();
    });

    it('clears the synced markers when a previously synced book is taken back to unread', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'unread' });
      mockRepo.findBookState.mockResolvedValue({
        storygraphBookId: 'sg-1',
        matchMethod: 'isbn',
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'read',
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      // Re-marking the book later must re-push, so the stale "already synced" markers are dropped.
      expect(mockRepo.resetSyncProgress).toHaveBeenCalledWith(1, 1);
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('does not reset an unread book that was never synced', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'unread' });
      mockRepo.findBookState.mockResolvedValue({ storygraphBookId: 'sg-1', matchMethod: 'isbn', lastSyncedAt: null });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockRepo.resetSyncProgress).not.toHaveBeenCalled();
    });

    it('does not reset a synced book that is merely excluded from sync', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({
        syncOverride: 'excluded',
        storygraphBookId: 'sg-1',
        matchMethod: 'isbn',
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockRepo.resetSyncProgress).not.toHaveBeenCalled();
    });

    it('skips when the local sync snapshot has no changes', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('stores no_match error when match fails', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue(null);
      mockRepo.findBookState.mockResolvedValue(null);
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ syncError: 'no_match', lastSyncedAt: expect.any(Date), lastSyncedStatus: 'reading' }),
      );
      warnSpy.mockRestore();
    });

    it('skips books with no status mapping', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'invalid_status' });
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ syncError: expect.stringContaining('no_status_mapping'), lastSyncedStatus: 'invalid_status' }),
      );
    });

    it('syncs status and progress successfully', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockClient.post).toHaveBeenCalledWith(
        1,
        cookies,
        expect.stringContaining('/update-status.js?book_id=abc-123&status=currently-reading'),
        {},
        'csrf-token',
      );
      expect(mockClient.post).toHaveBeenCalledWith(
        1,
        cookies,
        '/update-progress',
        expect.objectContaining({ 'read_status[progress_number]': '42', 'read_status[progress_type]': 'percentage', book_id: 'abc-123' }),
        'csrf-token',
      );
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ storygraphBookId: 'abc-123', lastSyncedStatus: 'reading', lastSyncedProgress: 42 }),
      );
    });

    it('records a failure when StoryGraph rejects the progress update', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.post
        .mockResolvedValueOnce({ status: 302, html: '', redirectedToSignIn: false })
        .mockResolvedValueOnce({ status: 500, html: '', redirectedToSignIn: false });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ storygraphBookId: 'abc-123', syncError: 'progress_update_failed:500' }),
      );
      expect(mockRepo.upsertBookState).not.toHaveBeenCalledWith(expect.objectContaining({ syncError: null }));
    });

    it('falls back to rereading when currently-reading status update fails', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.post
        .mockResolvedValueOnce({ status: 422, html: '', redirectedToSignIn: false })
        .mockResolvedValueOnce({ status: 200, html: '', redirectedToSignIn: false })
        .mockResolvedValueOnce({ status: 200, html: '', redirectedToSignIn: false });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockClient.post).toHaveBeenNthCalledWith(2, 1, cookies, expect.stringContaining('status=rereading'), {}, 'csrf-token');
    });

    it('reports the retry status when the rereading fallback also fails', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.post
        .mockResolvedValueOnce({ status: 422, html: '', redirectedToSignIn: false })
        .mockResolvedValueOnce({ status: 500, html: '', redirectedToSignIn: false });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ syncError: expect.stringContaining('status_update_failed:500') }),
      );
    });

    it('treats an expired session as a failure', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.get.mockResolvedValue({ status: 200, html: '', redirectedToSignIn: true });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'storygraph_session_expired' }));
    });

    it('stores error on API failure without throwing', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockClient.get.mockRejectedValue(new Error('network timeout'));

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'network timeout' }));
    });

    it('syncs a book finished long before connecting in all-eligible mode', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue({
        ...readingBook,
        status: 'read',
        progress: 100,
      });
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');
      expect(mockMatchService.matchBook).toHaveBeenCalled();
      expect(mockClient.post).toHaveBeenCalledTimes(1);
      expect(mockClient.post).toHaveBeenCalledWith(
        1,
        cookies,
        expect.stringContaining('/update-status.js?book_id=abc-123&status=read'),
        {},
        'csrf-token',
      );
      expect(mockClient.post).not.toHaveBeenCalledWith(1, cookies, '/update-progress', expect.anything(), 'csrf-token');
    });

    it('skips unselected books when sync mode is selected-only', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockSettingsService.getSettings.mockResolvedValue({
        cookiesConfigured: true,
        enabled: true,
        effectiveEnabled: true,
        disabledReason: null,
        bookSyncMode: 'selected_only',
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        lastSyncedAt: null,
      });
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('syncs selected books when sync mode is selected-only', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockSettingsService.getSettings.mockResolvedValue({
        cookiesConfigured: true,
        enabled: true,
        effectiveEnabled: true,
        disabledReason: null,
        bookSyncMode: 'selected_only',
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        lastSyncedAt: null,
      });
      mockRepo.findBookState.mockResolvedValue({ syncOverride: 'included' });
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');
      expect(mockMatchService.matchBook).toHaveBeenCalled();
    });
  });

  describe('syncAll', () => {
    it('returns existing run id if already running', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.countSyncableBooks.mockResolvedValue(1);
      mockRepo.findSyncableBooksBatch.mockResolvedValue([readingBook]);
      mockRepo.findBookStatesByBookIds.mockReturnValue(new Promise(() => {}));
      const svc = makeService();
      const id1 = await svc.syncAll(1);
      const id2 = await svc.syncAll(1);
      expect(id1).toBe(id2);
      expect(mockRepo.countSyncableBooks).toHaveBeenCalledTimes(1);
    });

    it('returns 0 when no cookies', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      const id = await makeService().syncAll(1);
      expect(id).toBe(0);
    });

    it('calls updateLastSyncedAt on successful completion', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.countSyncableBooks.mockResolvedValue(0);
      mockRepo.findSyncableBooksBatch.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(mockRepo.updateLastSyncedAt).toHaveBeenCalledWith(1, expect.any(Date));
    });

    it('streams a distinct progress snapshot for every processed book, including skipped ones', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'abc-123', matchMethod: 'isbn' });
      mockRepo.countSyncableBooks.mockResolvedValue(3);
      mockRepo.findSyncableBooksBatch
        .mockResolvedValueOnce([
          { ...readingBook, bookId: 10 },
          // Already synced: processed as a skip, but must still advance progress.
          { ...readingBook, bookId: 11, progress: 42 },
          { ...readingBook, bookId: 12 },
        ])
        .mockResolvedValueOnce([]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([
        { bookId: 11, lastSyncedAt: new Date('2024-02-01T00:00:00Z'), lastSyncedStatus: 'reading', lastSyncedProgress: 42 },
      ]);

      const svc = makeService();
      const emissions: unknown[] = [];
      const subscription = svc.streamSyncStatus(1).subscribe((status) => emissions.push(status));

      await svc.syncAll(1);
      await vi.waitFor(() => {
        expect(emissions[emissions.length - 1]).toBeNull();
      });
      subscription.unsubscribe();

      const runs = emissions.filter((e): e is { processedBooks: number; status: string } => e !== null && typeof e === 'object');
      const processedSequence = runs.filter((e) => e.status === 'running').map((e) => e.processedBooks);
      // initial 0, then one advance per book - the old in-place mutation collapsed these
      // into a single reference that distinctUntilChanged dropped entirely.
      expect(processedSequence).toEqual([0, 1, 2, 3]);
      const terminal = runs[runs.length - 1]!;
      expect(terminal).toMatchObject({ status: 'completed', processedBooks: 3, syncedBooks: 2, skippedBooks: 1, failedBooks: 0 });
    });

    it('processes match failures without stalling the progress stream', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockMatchService.matchBook.mockResolvedValue(null);
      mockRepo.countSyncableBooks.mockResolvedValue(1);
      mockRepo.findSyncableBooksBatch.mockResolvedValueOnce([{ ...readingBook, bookId: 10 }]).mockResolvedValueOnce([]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      const svc = makeService();
      const emissions: unknown[] = [];
      const subscription = svc.streamSyncStatus(1).subscribe((status) => emissions.push(status));

      await svc.syncAll(1);
      await vi.waitFor(() => {
        expect(emissions[emissions.length - 1]).toBeNull();
      });
      subscription.unsubscribe();

      const terminal = emissions.filter((e) => e !== null).pop();
      expect(terminal).toMatchObject({ status: 'completed', failedBooks: 0, skippedBooks: 1 });
    });

    it('includes previously finished books in the run', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.countSyncableBooks.mockResolvedValue(2);
      mockRepo.findSyncableBooksBatch
        .mockResolvedValueOnce([
          {
            ...readingBook,
            bookId: 10,
            status: 'read',
          },
          { ...readingBook, bookId: 11, status: 'reading' },
        ])
        .mockResolvedValueOnce([]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      const svc = makeService();
      await svc.syncAll(1);
      await vi.waitFor(() => {
        expect(mockRepo.findBookStatesByBookIds).toHaveBeenCalledWith(1, [10, 11]);
      });
    });
  });

  describe('listSyncFailures', () => {
    it('maps repository rows to sync failures', async () => {
      mockRepo.findBooksWithSyncErrors.mockResolvedValue([
        { bookId: 7, title: 'Broken Book', authorName: 'Some Author', syncError: 'no_match', lastAttemptAt: new Date('2026-07-01T00:00:00Z') },
        { bookId: 8, title: null, authorName: null, syncError: 'status_update_failed:500', lastAttemptAt: null },
      ]);

      const failures = await makeService().listSyncFailures(1);

      expect(failures).toEqual([
        { bookId: 7, title: 'Broken Book', authorName: 'Some Author', syncError: 'no_match', lastAttemptAt: '2026-07-01T00:00:00.000Z' },
        { bookId: 8, title: 'Unknown title', authorName: null, syncError: 'status_update_failed:500', lastAttemptAt: null },
      ]);
    });
  });

  describe('getSyncPendingSummary', () => {
    it('returns zero when user has no cookies', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 0, pendingBooks: 0 });
      expect(mockRepo.countSyncableBooks).not.toHaveBeenCalled();
    });

    it('counts only books with unsynced changes', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.countSyncableBooks.mockResolvedValue(2);
      mockRepo.countPendingSyncableBooks.mockResolvedValue(1);

      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 2, pendingBooks: 1 });
    });

    it('includes previously finished books in the totals', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.countSyncableBooks.mockResolvedValue(2);
      mockRepo.countPendingSyncableBooks.mockResolvedValue(2);

      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 2, pendingBooks: 2 });
    });
  });

  describe('cancelSync', () => {
    it('does nothing if no active run', () => {
      makeService().cancelSync(1);
      expect(mockRepo.updateLastSyncedAt).not.toHaveBeenCalled();
    });

    it('clears active run when cancelled', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.countSyncableBooks.mockResolvedValue(0);
      mockRepo.findSyncableBooksBatch.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      svc.cancelSync(1);
      expect(svc.getSyncStatus(1)).toBeNull();
    });
  });

  describe('rematchBook', () => {
    it('clears the cached match before delegating to syncBook', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      // clearBookMatch (tested separately on the repository) resets lastSyncedAt to null in the
      // real DB, which is what makes hasChanges() treat this as a fresh, never-synced book here.
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'correct-id', matchMethod: 'isbn' });

      const result = await makeService().rematchBook(1, 1);

      expect(mockRepo.clearBookMatch).toHaveBeenCalledWith(1, 1);
      expect(result).toBe('synced');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ storygraphBookId: 'correct-id' }));
    });

    it('returns skipped when the user has no cookies configured', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);

      const result = await makeService().rematchBook(1, 1);

      expect(mockRepo.clearBookMatch).toHaveBeenCalledWith(1, 1);
      expect(result).toBe('skipped');
    });
  });

  describe('linkBookManually', () => {
    it('resolves the input, saves the match, and re-syncs', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockMatchService.resolveManualInput.mockResolvedValue({ storygraphBookId: 'canonical-id', title: 'Real Title' });
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'canonical-id', matchMethod: 'isbn' });

      const result = await makeService().linkBookManually(1, 1, 'https://app.thestorygraph.com/books/canonical-id');

      expect(mockMatchService.resolveManualInput).toHaveBeenCalledWith(1, cookies, 'https://app.thestorygraph.com/books/canonical-id');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, bookId: 1, storygraphBookId: 'canonical-id', matchMethod: 'manual', lastSyncedAt: null }),
      );
      expect(result).toEqual({ success: true, storygraphBookId: 'canonical-id', title: 'Real Title' });
    });

    it('returns failure when there are no cookies configured', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      const result = await makeService().linkBookManually(1, 1, 'canonical-id');
      expect(result).toEqual({ success: false });
      expect(mockMatchService.resolveManualInput).not.toHaveBeenCalled();
    });

    it('returns failure when the input cannot be resolved', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockMatchService.resolveManualInput.mockResolvedValue(null);
      const result = await makeService().linkBookManually(1, 1, 'garbage-input');
      expect(result).toEqual({ success: false });
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });
  });

  describe('listEditions', () => {
    it('returns editions for the currently linked StoryGraph book', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findBookState.mockResolvedValue({ storygraphBookId: 'canonical-id' });
      mockMatchService.getEditions.mockResolvedValue([
        { id: 'ed-1', title: 'Hardcover', format: 'Hardcover', pages: 688, isAudio: false, language: 'English' },
      ]);

      const result = await makeService().listEditions(1, 1);

      expect(mockMatchService.getEditions).toHaveBeenCalledWith(1, cookies, 'canonical-id');
      expect(result).toHaveLength(1);
    });

    it('returns an empty list when there are no cookies configured', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      const result = await makeService().listEditions(1, 1);
      expect(result).toEqual([]);
      expect(mockMatchService.getEditions).not.toHaveBeenCalled();
    });

    it('returns an empty list when the book has no linked StoryGraph match yet', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findBookState.mockResolvedValue(null);
      const result = await makeService().listEditions(1, 1);
      expect(result).toEqual([]);
      expect(mockMatchService.getEditions).not.toHaveBeenCalled();
    });
  });

  describe('setEdition', () => {
    it('switches the edition, saves it, and re-syncs', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findBookState.mockResolvedValue({ storygraphBookId: 'canonical-id' });
      mockMatchService.switchEdition.mockResolvedValue(true);
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue({ storygraphBookId: 'ed-2', matchMethod: 'cached' });

      const result = await makeService().setEdition(1, 1, 'ed-2');

      expect(mockMatchService.switchEdition).toHaveBeenCalledWith(1, cookies, 'canonical-id', 'ed-2');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 1, bookId: 1, storygraphBookId: 'ed-2', matchMethod: 'manual', lastSyncedAt: null }),
      );
      expect(result).toEqual({ success: true });
    });

    it('returns failure when there are no cookies configured', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(null);
      const result = await makeService().setEdition(1, 1, 'ed-2');
      expect(result).toEqual({ success: false });
    });

    it('returns failure when the book has no linked StoryGraph match yet', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findBookState.mockResolvedValue(null);
      const result = await makeService().setEdition(1, 1, 'ed-2');
      expect(result).toEqual({ success: false });
      expect(mockMatchService.switchEdition).not.toHaveBeenCalled();
    });

    it('returns failure when the switch itself fails', async () => {
      mockSettingsService.getCookiesForUser.mockResolvedValue(cookies);
      mockRepo.findBookState.mockResolvedValue({ storygraphBookId: 'canonical-id' });
      mockMatchService.switchEdition.mockResolvedValue(false);
      const result = await makeService().setEdition(1, 1, 'ed-2');
      expect(result).toEqual({ success: false });
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });
  });

  describe('listLinkedBooks', () => {
    it('combines syncable books with their current match state', async () => {
      mockRepo.findCurrentReadingBooks.mockResolvedValue([
        { ...readingBook, bookId: 10, title: 'Book Ten' },
        { ...readingBook, bookId: 11, title: 'Book Eleven' },
      ]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([{ bookId: 10, storygraphBookId: 'sg-10', matchMethod: 'isbn', matchError: null }]);

      const result = await makeService().listLinkedBooks(1);

      expect(result).toEqual([
        { bookId: 10, title: 'Book Ten', authorName: 'Author One', storygraphBookId: 'sg-10', matchMethod: 'isbn', matchError: null },
        { bookId: 11, title: 'Book Eleven', authorName: 'Author One', storygraphBookId: null, matchMethod: null, matchError: null },
      ]);
    });

    it('only includes books currently being read, not finished/want-to-read ones', async () => {
      mockRepo.findCurrentReadingBooks.mockResolvedValue([
        { ...readingBook, bookId: 10, title: 'Reading Now', status: 'reading' },
        { ...readingBook, bookId: 11, title: 'Rereading Now', status: 'rereading' },
      ]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      const result = await makeService().listLinkedBooks(1);

      expect(result.map((book) => book.bookId)).toEqual([10, 11]);
    });
  });
});
