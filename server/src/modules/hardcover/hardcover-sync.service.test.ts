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
  findCurrentReadingBooks: vi.fn(),
  findReadingAttempts: vi.fn(),
  findClaimedHardcoverReadIds: vi.fn(),
  linkReadingAttempt: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

const mockMatchService = {
  matchBook: vi.fn(),
  listEditions: vi.fn(),
  findEditionForBook: vi.fn(),
};

const mockSettingsService = {
  getTokenForUser: vi.fn(),
  getSettings: vi.fn(),
};

const mockBookService = {
  setHardcoverEditionIdIfEmpty: vi.fn(),
};

function makeService() {
  return new HardcoverSyncService(mockRepo as any, mockClient as any, mockMatchService as any, mockSettingsService as any, mockBookService as any);
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
    mockRepo.findCurrentReadingBooks.mockResolvedValue([]);
    mockRepo.findReadingAttempts.mockResolvedValue([]);
    mockRepo.findClaimedHardcoverReadIds.mockResolvedValue([]);
    mockRepo.linkReadingAttempt.mockResolvedValue('linked');
    mockRepo.upsertBookState.mockResolvedValue({});
    mockRepo.setBookSyncOverride.mockResolvedValue({});
    mockRepo.updateLastSyncedAt.mockResolvedValue(undefined);
    mockSettingsService.getSettings.mockResolvedValue(defaultSettings);
    mockBookService.setHardcoverEditionIdIfEmpty.mockResolvedValue(false);
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

    it('syncs audiobook progress in seconds using the matched edition duration', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, format: 'm4b' });
      mockMatchService.matchBook.mockResolvedValue({
        hardcoverBookId: 10,
        hardcoverEditionId: 20,
        editionPages: null,
        editionAudioSeconds: 3600,
        matchMethod: 'cached',
      });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [] })
        .mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id: 77 }, error: null } });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockClient.query).toHaveBeenNthCalledWith(
        4,
        1,
        'tok',
        expect.stringContaining('mutation InsertUserBookRead'),
        expect.objectContaining({
          object: expect.objectContaining({
            progress_seconds: 1512,
            edition_id: 20,
          }),
        }),
      );
      expect(mockClient.query.mock.calls[3]?.[3]?.object).not.toHaveProperty('progress_pages');
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ lastSyncedProgress: 42, syncError: null }));
    });

    it('fails audiobook progress sync when the matched edition has no duration', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, format: 'm4b' });
      mockMatchService.matchBook.mockResolvedValue({
        hardcoverBookId: 10,
        hardcoverEditionId: 20,
        editionPages: null,
        editionAudioSeconds: null,
        matchMethod: 'cached',
      });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'missing_edition_audio_seconds' }));
      expect(mockClient.query).not.toHaveBeenCalledWith(1, 'tok', expect.stringContaining('UserBookRead'), expect.anything());
      errorSpy.mockRestore();
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

    it('does not treat a digit-prefixed Hardcover slug as a changed numeric book id', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, hardcoverMetadataId: '84-charing-cross-road' });
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: 277100,
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

    it('re-syncs when a complete numeric Hardcover metadata id changes', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      const changedBook = { ...readingBook, hardcoverMetadataId: '84' };
      mockRepo.findBookSyncData.mockResolvedValue(changedBook);
      mockRepo.findBookState.mockResolvedValue({
        hardcoverBookId: 277100,
        lastSyncedAt: new Date('2024-02-01T00:00:00Z'),
        lastSyncedStatus: 'reading',
        lastSyncedProgress: 42,
        lastSyncedRating: null,
        lastSyncedStartedAt: '2024-01-01',
        lastSyncedFinishedAt: null,
      });
      mockMatchService.matchBook.mockResolvedValue(null);
      const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');

      expect(mockMatchService.matchBook).toHaveBeenCalledWith(1, 'tok', changedBook);
      warnSpy.mockRestore();
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
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('progress=42 progressPages=126 progressSeconds=null - progress sent to Hardcover'));
      logSpy.mockRestore();
    });

    it('does not fan primary progress out to an open read reserved by another attempt', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 900 });
      mockRepo.findReadingAttempts.mockResolvedValue([
        {
          id: 2,
          startedOn: '2024-01-01',
          endedOn: null,
          outcome: null,
          externalProvider: 'hardcover',
          externalId: '900',
        },
      ]);
      mockRepo.findClaimedHardcoverReadIds.mockResolvedValue([899, 900]);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({
          user_book_reads: [
            { id: 900, started_at: '2024-01-01', finished_at: null, progress_pages: null },
            { id: 899, started_at: '2023-01-01', finished_at: null, progress_pages: null },
          ],
        })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 900 }, error: null } });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(
        mockClient.query.mock.calls.some(
          ([, , query, variables]) =>
            typeof query === 'string' && query.includes('mutation UpdateUserBookRead') && (variables as { id?: number } | undefined)?.id === 899,
        ),
      ).toBe(false);
    });

    it('fails without inserting a read when Hardcover read discovery fails', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockRejectedValueOnce(new Error('read discovery failed'));

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockClient.query.mock.calls.some(([, , query]) => typeof query === 'string' && query.includes('mutation InsertUserBookRead'))).toBe(
        false,
      );
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'read discovery failed' }));
      errorSpy.mockRestore();
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

  describe('listLinkedBooks', () => {
    it('maps currently-reading books with their link state', async () => {
      mockRepo.findCurrentReadingBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([
        { bookId: 1, hardcoverBookId: 100, hardcoverEditionId: 200, matchMethod: 'isbn', matchError: null },
      ]);

      const result = await makeService().listLinkedBooks(1);

      expect(result).toEqual({
        truncated: false,
        books: [
          {
            bookId: 1,
            title: 'Book One',
            authorName: 'Author One',
            hardcoverBookId: 100,
            hardcoverEditionId: 200,
            matchMethod: 'isbn',
            matchError: null,
          },
        ],
      });
    });

    it('reports unlinked books without a matching state row', async () => {
      mockRepo.findCurrentReadingBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      const result = await makeService().listLinkedBooks(1);

      expect(result.books).toEqual([
        {
          bookId: 1,
          title: 'Book One',
          authorName: 'Author One',
          hardcoverBookId: null,
          hardcoverEditionId: null,
          matchMethod: null,
          matchError: null,
        },
      ]);
    });

    it('asks for one row past the cap so truncation can be detected', async () => {
      mockRepo.findCurrentReadingBooks.mockResolvedValue([readingBook]);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      await makeService().listLinkedBooks(1);

      expect(mockRepo.findCurrentReadingBooks).toHaveBeenCalledWith(1, 201);
    });

    it('caps the list and reports truncation instead of dropping books silently', async () => {
      const rows = Array.from({ length: 201 }, (_, index) => ({ ...readingBook, bookId: index + 1 }));
      mockRepo.findCurrentReadingBooks.mockResolvedValue(rows);
      mockRepo.findBookStatesByBookIds.mockResolvedValue([]);

      const result = await makeService().listLinkedBooks(1);

      expect(result.books).toHaveLength(200);
      expect(result.truncated).toBe(true);
    });
  });

  describe('getEditions', () => {
    it('throws instead of reporting a disconnected account as an empty catalog', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);
      await expect(makeService().getEditions(1, 1)).rejects.toThrow('Hardcover is not connected for this user');
      expect(mockMatchService.listEditions).not.toHaveBeenCalled();
    });

    it('throws instead of reporting an unmatched book as an empty catalog', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: null });
      await expect(makeService().getEditions(1, 1)).rejects.toThrow('Book 1 is not matched to a Hardcover book yet');
      expect(mockMatchService.listEditions).not.toHaveBeenCalled();
    });

    it('lists editions for the matched hardcover book', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 100 });
      mockMatchService.listEditions.mockResolvedValue({ editions: [{ id: 200, format: 'Physical Book' }], truncated: false });

      const result = await makeService().getEditions(1, 1);

      expect(mockMatchService.listEditions).toHaveBeenCalledWith(1, 'tok', 100);
      expect(result).toEqual({ editions: [{ id: 200, format: 'Physical Book' }], truncated: false });
    });
  });

  describe('setEdition', () => {
    it('throws when the book has no matched hardcoverBookId', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookState.mockResolvedValue(null);

      await expect(makeService().setEdition(1, 1, 200)).rejects.toThrow('Book 1 is not matched to a Hardcover book yet');
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });

    it('throws when there is no token to validate the edition against', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue(null);

      await expect(makeService().setEdition(1, 1, 200)).rejects.toThrow('Hardcover is not connected for this user');
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });

    it('rejects an edition id that does not belong to the matched hardcover book', async () => {
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 100 });
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockMatchService.findEditionForBook.mockResolvedValue(null);

      await expect(makeService().setEdition(1, 1, 200)).rejects.toThrow('Edition 200 does not belong to the matched Hardcover book');
      expect(mockRepo.upsertBookState).not.toHaveBeenCalled();
    });

    it('validates against the book rather than the capped display window', async () => {
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 100 });
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockMatchService.findEditionForBook.mockResolvedValue({ id: 9999, format: 'Physical Book' });

      await expect(makeService().setEdition(1, 1, 9999)).resolves.toEqual({ success: true });
      expect(mockMatchService.findEditionForBook).toHaveBeenCalledWith(1, 'tok', 100, 9999);
      expect(mockMatchService.listEditions).not.toHaveBeenCalled();
    });

    it('sets the edition, forces a resync, and back-fills the shared metadata field', async () => {
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 100 });
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockMatchService.findEditionForBook.mockResolvedValue({ id: 200, format: 'Physical Book' });

      const result = await makeService().setEdition(1, 1, 200);

      expect(result).toEqual({ success: true });
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          bookId: 1,
          hardcoverBookId: 100,
          hardcoverEditionId: 200,
          matchMethod: 'manual',
          matchError: null,
          lastSyncedAt: null,
        }),
      );
      expect(mockBookService.setHardcoverEditionIdIfEmpty).toHaveBeenCalledWith(1, '200');
    });

    it('does not let a back-fill failure fail the edition pick', async () => {
      mockRepo.findBookState.mockResolvedValue({ hardcoverBookId: 100 });
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockMatchService.findEditionForBook.mockResolvedValue({ id: 200, format: 'Physical Book' });
      mockBookService.setHardcoverEditionIdIfEmpty.mockRejectedValue(new Error('boom'));

      await expect(makeService().setEdition(1, 1, 200)).resolves.toEqual({ success: true });
    });
  });
  describe('reading attempt to Hardcover read mapping', () => {
    type AttemptRow = {
      id: number;
      startedOn: string | null;
      endedOn: string | null;
      outcome: 'completed' | 'skimmed' | 'abandoned' | null;
      externalProvider: string | null;
      externalId: string | null;
    };

    function attempt(id: number, overrides: Partial<AttemptRow> = {}): AttemptRow {
      return { id, startedOn: null, endedOn: null, outcome: null, externalProvider: null, externalId: null, ...overrides };
    }

    function linked(id: number, readId: number, overrides: Partial<AttemptRow> = {}): AttemptRow {
      return attempt(id, { externalProvider: 'hardcover', externalId: String(readId), ...overrides });
    }

    const rereadingBook = { ...readingBook, status: 'rereading', startedAt: new Date('2024-02-01'), finishedAt: null };
    const match = { hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' };

    function arrange(reads: Array<{ id: number; started_at: string | null; finished_at: string | null; progress_pages: number | null }>) {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockMatchService.matchBook.mockResolvedValue(match);
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: reads });
    }

    function insertRead(id: number) {
      mockClient.query.mockResolvedValueOnce({ insert_user_book_read: { user_book_read: { id }, error: null } });
    }

    function updateRead(id: number) {
      mockClient.query.mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id }, error: null } });
    }

    function linkCalls() {
      return mockRepo.linkReadingAttempt.mock.calls as Array<[number, number, number]>;
    }

    it("gives a reread its own read instead of stamping the finished attempt's id onto it", async () => {
      mockRepo.findBookSyncData.mockResolvedValue(rereadingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 555 });
      mockRepo.findReadingAttempts.mockResolvedValue([
        linked(1, 555, { startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'completed' }),
        attempt(2, { startedOn: '2024-02-01' }),
      ]);
      mockRepo.findClaimedHardcoverReadIds.mockResolvedValue([555]);
      arrange([{ id: 555, started_at: '2024-01-01', finished_at: '2024-01-05', progress_pages: 300 }]);
      insertRead(556);
      updateRead(555);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(linkCalls()).toEqual([[1, 2, 556]]);
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverReadId: 556, syncError: null }));
    });

    it('keeps the finished attempt on its original read rather than merging the two', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(rereadingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 555 });
      mockRepo.findReadingAttempts.mockResolvedValue([
        linked(1, 555, { startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'completed' }),
        attempt(2, { startedOn: '2024-02-01' }),
      ]);
      mockRepo.findClaimedHardcoverReadIds.mockResolvedValue([555]);
      arrange([{ id: 555, started_at: '2024-01-01', finished_at: '2024-01-05', progress_pages: 300 }]);
      insertRead(556);
      updateRead(555);

      await makeService().syncBook(1, 1);

      expect(mockClient.query).toHaveBeenNthCalledWith(
        5,
        1,
        'tok',
        expect.stringContaining('mutation UpdateUserBookRead'),
        expect.objectContaining({ id: 555 }),
      );
      expect(linkCalls().some(([, attemptId]) => attemptId === 1)).toBe(false);
    });

    it("does not let a stale cached read id override an attempt's own mapping", async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 900 });
      mockRepo.findReadingAttempts.mockResolvedValue([linked(1, 777, { startedOn: '2024-01-01' })]);
      mockRepo.findClaimedHardcoverReadIds.mockResolvedValue([777]);
      arrange([
        { id: 900, started_at: '2024-01-01', finished_at: null, progress_pages: null },
        { id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null },
      ]);
      updateRead(777);
      updateRead(900);

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

    it('leaves a read reserved by a soft-deleted attempt alone', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([attempt(2, { startedOn: '2024-01-01' })]);
      mockRepo.findClaimedHardcoverReadIds.mockResolvedValue([555]);
      arrange([{ id: 555, started_at: '2024-01-01', finished_at: null, progress_pages: null }]);
      insertRead(601);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(linkCalls()).toEqual([[1, 2, 601]]);
    });

    it('adopts an unclaimed matching read instead of creating a duplicate', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([attempt(2, { startedOn: '2024-01-01' })]);
      arrange([{ id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null }]);
      updateRead(777);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(linkCalls()).toEqual([[1, 2, 777]]);
      expect(mockClient.query).not.toHaveBeenCalledWith(1, 'tok', expect.stringContaining('mutation InsertUserBookRead'), expect.anything());
    });

    it('claims a candidate locally before editing it on Hardcover', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([attempt(2, { startedOn: '2024-01-01' })]);
      arrange([{ id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null }]);
      const order: string[] = [];
      mockRepo.linkReadingAttempt.mockImplementation(() => {
        order.push('link');
        return Promise.resolve('linked');
      });
      mockClient.query.mockImplementationOnce(() => {
        order.push('remote-write');
        return Promise.resolve({ update_user_book_read: { user_book_read: { id: 777 }, error: null } });
      });

      await makeService().syncBook(1, 1);

      expect(order).toEqual(['link', 'remote-write']);
    });

    it('gives competing unlinked attempts distinct reads', async () => {
      mockRepo.findBookSyncData.mockResolvedValue({ ...rereadingBook, startedAt: new Date('2024-03-01') });
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([
        attempt(1, { startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'completed' }),
        attempt(2, { startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'completed' }),
        attempt(3, { startedOn: '2024-03-01' }),
      ]);
      arrange([{ id: 700, started_at: '2024-01-01', finished_at: '2024-01-05', progress_pages: 300 }]);
      insertRead(800);
      updateRead(700);
      insertRead(801);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      const readIds = linkCalls().map(([, , readId]) => readId);
      expect(readIds).toEqual([800, 700, 801]);
      expect(new Set(readIds).size).toBe(readIds.length);
    });

    it('writes no link when every attempt already owns its read, so repeat syncs do not churn', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue({ hardcoverReadId: 777 });
      mockRepo.findReadingAttempts.mockResolvedValue([
        linked(1, 700, { startedOn: '2023-05-01', endedOn: '2023-05-09', outcome: 'completed' }),
        linked(2, 777, { startedOn: '2024-01-01' }),
      ]);
      mockRepo.findClaimedHardcoverReadIds.mockResolvedValue([700, 777]);
      arrange([
        { id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null },
        { id: 700, started_at: '2023-05-01', finished_at: '2023-05-09', progress_pages: 300 },
      ]);
      updateRead(777);
      updateRead(700);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockRepo.linkReadingAttempt).not.toHaveBeenCalled();
    });

    it('reselects another read when a claim loses the race', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([attempt(2, { startedOn: '2024-01-01' })]);
      mockRepo.linkReadingAttempt.mockResolvedValueOnce('conflict').mockResolvedValueOnce('linked');
      arrange([
        { id: 778, started_at: '2024-01-01', finished_at: null, progress_pages: null },
        { id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null },
      ]);
      updateRead(777);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(linkCalls()).toEqual([
        [1, 2, 778],
        [1, 2, 777],
      ]);
      expect(mockClient.query).toHaveBeenNthCalledWith(
        4,
        1,
        'tok',
        expect.stringContaining('mutation UpdateUserBookRead'),
        expect.objectContaining({ id: 777 }),
      );
    });

    it('creates a fresh read once reselection is exhausted rather than sharing one', async () => {
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([attempt(2, { startedOn: '2024-01-01' })]);
      mockRepo.linkReadingAttempt.mockResolvedValueOnce('conflict').mockResolvedValueOnce('conflict').mockResolvedValueOnce('conflict');
      arrange([
        { id: 778, started_at: '2024-01-01', finished_at: null, progress_pages: null },
        { id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null },
        { id: 776, started_at: '2024-01-01', finished_at: null, progress_pages: null },
      ]);
      insertRead(900);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');

      expect(mockClient.query).toHaveBeenNthCalledWith(4, 1, 'tok', expect.stringContaining('mutation InsertUserBookRead'), expect.anything());
      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ hardcoverReadId: 900 }));
    });

    it('fails the sync instead of recording success when a brand new read cannot be claimed', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([attempt(2, { startedOn: '2024-01-01' })]);
      mockRepo.linkReadingAttempt.mockResolvedValue('conflict');
      arrange([]);
      insertRead(900);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(mockRepo.upsertBookState).toHaveBeenCalledWith(expect.objectContaining({ syncError: 'read_link_conflict' }));
      expect(mockRepo.upsertBookState).not.toHaveBeenCalledWith(expect.objectContaining({ syncError: null }));
      errorSpy.mockRestore();
    });

    it('logs the driver cause so a constraint failure names its constraint', async () => {
      const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mockRepo.findBookSyncData.mockResolvedValue(readingBook);
      mockRepo.findBookState.mockResolvedValue(undefined);
      mockRepo.findReadingAttempts.mockResolvedValue([attempt(2, { startedOn: '2024-01-01' })]);
      mockRepo.linkReadingAttempt.mockRejectedValue(
        Object.assign(new Error('Failed query: update "reading_attempts"'), {
          cause: { code: '23505', constraint: 'reading_attempts_external_uidx', message: 'duplicate key value' },
        }),
      );
      arrange([{ id: 777, started_at: '2024-01-01', finished_at: null, progress_pages: null }]);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('failed');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('cause="23505 reading_attempts_external_uidx duplicate key value"'));
      errorSpy.mockRestore();
    });
  });
  describe('change detection', () => {
    const syncedState = {
      hardcoverBookId: 10,
      hardcoverReadId: 700,
      lastSyncedAt: new Date('2026-08-21T10:00:00Z'),
      lastSyncedStatus: 'reading',
      lastSyncedProgress: 42,
      lastSyncedRating: null,
      lastSyncedStartedAt: '2024-01-01',
      lastSyncedFinishedAt: null,
    };

    it('skips a book whose watched fields all match the last sync', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, attemptsUpdatedAt: new Date('2026-08-21T09:00:00Z') });
      mockRepo.findBookState.mockResolvedValue(syncedState);

      await expect(makeService().syncBook(1, 1)).resolves.toBe('skipped');
      expect(mockMatchService.matchBook).not.toHaveBeenCalled();
    });

    it('re-syncs when only the attempt history changed', async () => {
      mockSettingsService.getTokenForUser.mockResolvedValue('tok');
      mockRepo.findBookSyncData.mockResolvedValue({ ...readingBook, attemptsUpdatedAt: new Date('2026-08-21T11:00:00Z') });
      mockRepo.findBookState.mockResolvedValue(syncedState);
      mockMatchService.matchBook.mockResolvedValue({ hardcoverBookId: 10, hardcoverEditionId: 20, editionPages: 300, matchMethod: 'cached' });
      mockClient.query
        .mockResolvedValueOnce({ insert_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ update_user_book: { user_book: { id: 55 }, error: null } })
        .mockResolvedValueOnce({ user_book_reads: [{ id: 700, started_at: '2024-01-01', finished_at: null, progress_pages: 120 }] })
        .mockResolvedValueOnce({ update_user_book_read: { user_book_read: { id: 700 }, error: null } });

      await expect(makeService().syncBook(1, 1)).resolves.toBe('synced');
    });
  });
});
