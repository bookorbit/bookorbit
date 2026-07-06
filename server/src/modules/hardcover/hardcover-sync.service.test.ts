import { Logger } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HardcoverSyncService } from './hardcover-sync.service';

const mockRepo = {
  findBookState: vi.fn(),
  findBookStatesByBookIds: vi.fn(),
  upsertBookState: vi.fn(),
  setBookSyncOverride: vi.fn(),
  updateLastSyncedAt: vi.fn(),
  findSyncableBooks: vi.fn(),
  findSyncableBook: vi.fn(),
  findBookSyncData: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

const mockMatchService = {
  matchBook: vi.fn(),
};

const mockSettingsService = {
  getTokenForUser: vi.fn(),
  getSettings: vi.fn(),
};

function makeService() {
  return new HardcoverSyncService(mockRepo as any, mockClient as any, mockMatchService as any, mockSettingsService as any);
}

const defaultSettings = {
  tokenConfigured: true,
  enabled: true,
  effectiveEnabled: true,
  disabledReason: null,
  bookSyncMode: 'all_eligible',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  privacySettingId: 3,
};

const readingBook = {
  bookId: 1,
  isbn13: '9781234567890',
  isbn10: null,
  title: 'Book One',
  authorName: 'Author One',
  hardcoverMetadataId: null,
  status: 'reading',
  startedAt: new Date('2024-01-01'),
  finishedAt: null,
  rating: null,
  progress: 42,
};

describe('HardcoverSyncService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.findBookState.mockResolvedValue(undefined);
    mockRepo.findBookStatesByBookIds.mockResolvedValue([]);
    mockRepo.findSyncableBooks.mockResolvedValue([]);
    mockRepo.findSyncableBook.mockResolvedValue(null);
    mockRepo.findBookSyncData.mockResolvedValue(null);
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.setBookSyncOverride.mockResolvedValue({});
    mockRepo.updateLastSyncedAt.mockResolvedValue(undefined);
    mockSettingsService.getSettings.mockResolvedValue(defaultSettings);
  });

  describe('syncBook', () => {
    it('does nothing when no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockRepo.findBookSyncData).not.toHaveBeenCalled();
    });

    it('does nothing when book not found', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('does nothing for unread status', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, status: 'unread' });
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('skips when the book is explicitly excluded', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ syncOverride: 'excluded', syncExcluded: true });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('skips when selected-only mode has not included the book', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockSettingsService.getSettings.mockResolvedValue({ ...defaultSettings, bookSyncMode: 'selected_only' });
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('syncs when selected-only mode explicitly includes the book', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockSettingsService.getSettings.mockResolvedValue({ ...defaultSettings, bookSyncMode: 'selected_only' });
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ syncOverride: 'included', syncExcluded: false });
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'isbn' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockMatchService.matchBook).toHaveBeenCalledWith(1, 'tok', readingBook);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverUserBookId: 55, hardcoverReadId: 77 }));
    });

    it('fails when progress is present but the matched edition has no page count', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: null, matchMethod: 'isbn' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          bookId: 1,
          hardcoverBookId: 10,
          matchMethod: 'isbn',
          syncError: 'missing_edition_pages',
        }),
      );

      errorSpy.mockRestore();
    });

    it('skips when the local sync snapshot has no changes', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
        lastSyncedRating: null,
        lastSyncedStartedAt: '2024-01-01',
        lastSyncedFinishedAt: null,
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('re-checks the latest override before mutating Hardcover', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockSettingsService.getSettings.mockResolvedValue({ ...defaultSettings, bookSyncMode: 'selected_only' });
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValueOnce({ syncOverride: 'included', syncExcluded: false }).mockResolvedValueOnce({
        syncOverride: 'excluded',
        syncExcluded: true,
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('retries an unchanged snapshot when a Hardcover metadata id was added after a failed match', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const bookWithMetadataId = { ...readingBook, hardcoverMetadataId: 'fyrebirds' };
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(bookWithMetadataId);
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: null,
        syncError: 'no_match',
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
        lastSyncedRating: null,
        lastSyncedStartedAt: '2024-01-01',
        lastSyncedFinishedAt: null,
      });
      mockMatchService.matchBook.mockResolvedValue(null);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).toHaveBeenCalledWith(1, 'tok', bookWithMetadataId);
      warnSpy.mockRestore();
    });

    it('skips when an invalid Hardcover metadata id does not change the snapshot', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, hardcoverMetadataId: 'not-a-number' });
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: 10,
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
        lastSyncedRating: null,
        lastSyncedStartedAt: '2024-01-01',
        lastSyncedFinishedAt: null,
      });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
    });

    it('stores no_match error when match fails', async () => {
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue(null);
      mockRepo.findBookState.mockResolvedValue(null);
      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncError: 'no_match',
          lastSyncedAt: expect.any(Date),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 42,
          lastSyncedStartedAt: '2024-01-01',
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[hardcover.sync_book] [fail] userId=1 bookId=1'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('errorClass=MatchError error="no_match"'));
      warnSpy.mockRestore();
    });

    it('syncs book successfully', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'isbn' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });
      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          hardcoverUserBookId: 55,
          hardcoverReadId: 77,
          lastSyncedStatus: 'reading',
        }),
      );
    });

    it('updates the active unfinished read when cached read id is stale', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 501 });
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({
          user_book_reads: [
            { id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null },
            { id: 501, started_at: '2024-01-01', finished_at: '2024-01-02', progress_pages: 12 },
          ],
        })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 777 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockClient.query).toHaveBeenNthCalledWith(
        4,
        1,
        'tok',
        expect.stringContaining('mutation UpdateUserBookRead'),
        expect.objectContaining({ id: 777 }),
      );
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverReadId: 777 }));
    });

    it('syncs progress to sibling unfinished reads to avoid page 0 in Hardcover UI', async () => {
      const logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 900 });
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({
          user_book_reads: [
            { id: 900, started_at: '2024-01-01', finished_at: null, progress_pages: null },
            { id: 899, started_at: '2024-01-01', finished_at: null, progress_pages: null },
          ],
        })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 900 }, error: null } })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 899 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockClient.query).toHaveBeenNthCalledWith(
        5,
        1,
        'tok',
        expect.stringContaining('mutation UpdateUserBookRead'),
        expect.objectContaining({ id: 899, object: expect.objectContaining({ progress_pages: 126 }) }),
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[hardcover.sync_progress] [end] userId=1 bookId=1'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('progress=42 progressPages=126 - progress sent to Hardcover'));
      logSpy.mockRestore();
    });

    it('stores error when edition pages are unavailable', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: null, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'missing_edition_pages' }));
    });

    it('stores error on API failure without throwing', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: null, editionPages: 300, matchMethod: 'isbn' });
      mockClient.query.mockRejectedValue(new Error('timeout'));
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'timeout' }));
    });

    it('skips books with no status mapping', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, status: 'invalid_status' });
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncError: expect.stringContaining('no_status_mapping'),
          lastSyncedAt: expect.any(Date),
          lastSyncedStatus: 'invalid_status',
        }),
      );
    });
  });

  describe('syncAll', () => {
    it('returns existing run id if already running', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockReturnValue(new Promise(() => {})); // blocks runSyncAll
      const svc = makeService();
      const id1 = await svc.syncAll(1);
      const id2 = await svc.syncAll(1);
      expect(id1).toBe(id2);
      expect(mockRepo.findSyncableBooks).toHaveBeenCalledTimes(1);
    });

    it('creates in-memory run and returns run id', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const id = await makeService().syncAll(1);
      expect(id).toBeGreaterThan(0);
    });

    it('returns 0 when no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      const id = await makeService().syncAll(1);
      expect(id).toBe(0);
    });

    it('calls updateLastSyncedAt on successful completion', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      await Promise.resolve(); // flush runSyncAll microtasks
      await Promise.resolve();
      expect(mockRepo.updateLastSyncedAt).toHaveBeenCalledWith(1, expect.any(Date));
    });

    it('skips excluded books during a running sync all', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockResolvedValue({ syncExcluded: true });

      const svc = makeService();
      await svc.syncAll(1);
      await Promise.resolve();
      await Promise.resolve();

      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
      expect(mockClient.query).not.toHaveBeenCalled();
      expect(mockRepo.updateLastSyncedAt).toHaveBeenCalledWith(1, expect.any(Date));
    });

    it('clears active sync and does not call updateLastSyncedAt when runSyncAll crashes', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockRejectedValue(new Error('DB crash'));
      const svc = makeService();
      await svc.syncAll(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(svc.getSyncStatus(1)).toBeNull();
      expect(mockRepo.updateLastSyncedAt).not.toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('returns null when no active run', () => {
      expect(makeService().getSyncStatus(1)).toBeNull();
    });

    it('returns status after syncAll is called', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookState.mockReturnValue(new Promise(() => {})); // blocks runSyncAll
      const svc = makeService();
      await svc.syncAll(1);
      const result = svc.getSyncStatus(1);
      expect(result).not.toBeNull();
      expect(result?.status).toBe('running');
    });

    it('deduplicates identical active sync status emissions', () => {
      const svc = makeService();
      const seen: Array<{ runId: number; syncedBooks: number; totalBooks: number; status: 'running' }> = [];
      const sub = svc.streamSyncStatus(1).subscribe((status) => {
        if (status) seen.push(status as { runId: number; syncedBooks: number; totalBooks: number; status: 'running' });
      });

      const status = { runId: 7, syncedBooks: 1, totalBooks: 4, status: 'running' as const };
      (svc as any).emitSyncStatus(1, status);
      (svc as any).emitSyncStatus(1, status);
      (svc as any).emitSyncStatus(1, { ...status });
      (svc as any).emitSyncStatus(1, { ...status, syncedBooks: 2 });

      expect(seen).toEqual([
        { runId: 7, syncedBooks: 1, totalBooks: 4, status: 'running' },
        { runId: 7, syncedBooks: 2, totalBooks: 4, status: 'running' },
      ]);
      sub.unsubscribe();
    });
  });

  describe('getSyncPendingSummary', () => {
    it('returns zero when user has no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 0, pendingBooks: 0 });
      expect(mockRepo.findSyncableBooks).not.toHaveBeenCalled();
    });

    it('counts only books with unsynced changes', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([
        { ...readingBook, bookId: 10, progress: 42 },
        { ...readingBook, bookId: 11, progress: 88 },
      ]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([
        {
          bookId: 10,
          lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 42,
          lastSyncedRating: null,
          lastSyncedStartedAt: '2024-01-01',
          lastSyncedFinishedAt: null,
        },
        {
          bookId: 11,
          lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 10,
          lastSyncedRating: null,
          lastSyncedStartedAt: '2024-01-01',
          lastSyncedFinishedAt: null,
        },
      ]);

      const result = await makeService().getSyncPendingSummary(1);
      expect(result).toEqual({ totalBooks: 2, pendingBooks: 1 });
      expect(mockRepo.findBookStatesByBookIds).toHaveBeenCalledWith(1, [10, 11]);
    });

    it('does not count excluded books as pending', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([
        { ...readingBook, bookId: 10, progress: 42 },
        { ...readingBook, bookId: 11, progress: 88 },
      ]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([
        { bookId: 10, syncExcluded: true },
        {
          bookId: 11,
          lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 10,
          lastSyncedRating: null,
          lastSyncedStartedAt: '2024-01-01',
          lastSyncedFinishedAt: null,
        },
      ]);

      const result = await makeService().getSyncPendingSummary(1);

      expect(result).toEqual({ totalBooks: 1, pendingBooks: 1 });
    });
  });

  describe('book sync state', () => {
    it('returns a default state when no Hardcover state row exists', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);

      await expect(makeService().getBookSyncState(1, 42)).resolves.toEqual({
        bookId: 42,
        syncOverride: null,
        syncEnabled: true,
        canSyncNow: true,
        effectiveReason: null,
        lastSyncedAt: null,
        syncError: null,
      });
    });

    it('returns existing per-book sync state', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({
        syncOverride: 'excluded',
        syncExcluded: true,
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        syncError: 'timeout',
      });

      await expect(makeService().getBookSyncState(1, 42)).resolves.toEqual({
        bookId: 42,
        syncOverride: 'excluded',
        syncEnabled: false,
        canSyncNow: false,
        effectiveReason: 'excluded',
        lastSyncedAt: '2024-02-01T00:00:00.000Z',
        syncError: 'timeout',
      });
    });

    it('updates the per-book override from the current sync mode', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.setBookSyncOverride.mockResolvedValue({
        syncOverride: 'excluded',
        syncExcluded: true,
        lastSyncedAt: null,
        syncError: null,
      });

      await expect(makeService().updateBookSyncState(1, 42, { syncEnabled: false })).resolves.toEqual({
        bookId: 42,
        syncOverride: 'excluded',
        syncEnabled: false,
        canSyncNow: false,
        effectiveReason: 'excluded',
        lastSyncedAt: null,
        syncError: null,
      });
      expect(mockRepo.setBookSyncOverride).toHaveBeenCalledWith(1, 42, 'excluded');
    });

    it('triggers sync when per-book sync is enabled', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.setBookSyncOverride.mockResolvedValue({
        syncOverride: 'included',
        syncExcluded: false,
        lastSyncedAt: null,
        syncError: null,
      });

      const svc = makeService();
      const syncBookSpy = vi.spyOn(svc, 'syncBook').mockResolvedValue('synced');

      await expect(svc.updateBookSyncState(1, 42, { syncEnabled: true })).resolves.toEqual({
        bookId: 42,
        syncOverride: 'included',
        syncEnabled: true,
        canSyncNow: true,
        effectiveReason: null,
        lastSyncedAt: null,
        syncError: null,
      });

      expect(mockRepo.setBookSyncOverride).toHaveBeenCalledWith(1, 42, null);
      expect(syncBookSpy).toHaveBeenCalledWith(1, 42);
    });
  });

  describe('cancelSync', () => {
    it('does nothing if no active run', () => {
      makeService().cancelSync(1);
      expect(mockRepo.updateLastSyncedAt).not.toHaveBeenCalled();
    });

    it('clears active run when cancelled', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBooks.mockResolvedValue([]);
      const svc = makeService();
      await svc.syncAll(1);
      svc.cancelSync(1);
      expect(svc.getSyncStatus(1)).toBeNull();
    });
  });
});
