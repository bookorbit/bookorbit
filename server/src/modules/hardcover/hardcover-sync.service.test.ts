import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HardcoverSyncService } from './hardcover-sync.service';

const mockRepo = {
  findBookState: vi.fn(),
  findBookStatesByBookIds: vi.fn(),
  upsertBookState: vi.fn(),
  updateLastSyncedAt: vi.fn(),
  findSyncableBooks: vi.fn(),
  findSyncableBook: vi.fn(),
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
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.updateLastSyncedAt.mockResolvedValue(undefined);
    mockSettingsService.getSettings.mockResolvedValue(defaultSettings);
  });

  describe('syncBook', () => {
    it('does nothing when no token', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockRepo.findSyncableBook).not.toHaveBeenCalled();
    });

    it('does nothing when book not found', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('does nothing for unread status', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'unread' });
      await makeService().syncBook(1, 1);
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('stores no_match error when match fails', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue(null);
      mockRepo.findBookState.mockResolvedValue(null);
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          syncError: 'no_match',
          lastSyncedAt: expect.any(Date),
          lastSyncedStatus: 'reading',
          lastSyncedProgress: 42,
          lastSyncedStartedAt: '2024-01-01',
        }),
      );
    });

    it('syncs book successfully', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, matchMethod: 'isbn' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });
      await makeService().syncBook(1, 1);
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
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
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
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
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
    });

    it('keeps progress pending when edition pages are unavailable', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(null);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: null, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      await makeService().syncBook(1, 1);

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedProgress: null }));
    });

    it('stores error on API failure without throwing', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue(readingBook);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: null, matchMethod: 'isbn' });
      mockClient.query.mockRejectedValue(new Error('timeout'));
      await makeService().syncBook(1, 1);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'timeout' }));
    });

    it('skips books with no status mapping', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findSyncableBook.mockResolvedValue({ ...readingBook, status: 'invalid_status' });
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
