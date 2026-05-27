import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bcryptHashMock, bcryptCompareMock, createHashMock } = vi.hoisted(() => ({
  bcryptHashMock: vi.fn(),
  bcryptCompareMock: vi.fn(),
  createHashMock: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  hash: bcryptHashMock,
  compare: bcryptCompareMock,
}));

vi.mock('crypto', () => ({
  createHash: createHashMock,
}));

import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderService } from './koreader.service';

function md5Hex(value: string): string {
  return `md5:${value}:hex:0123456789abcdef0123456789abcdef`;
}

function defaultDeviceId(device: string, userId: number): string {
  return md5Hex(`${device}:${userId}`).slice(0, 16);
}

function makeKoreaderUserRow(overrides?: Record<string, unknown>) {
  return {
    userId: 7,
    username: 'reader',
    passwordHash: 'stored-bcrypt-hash',
    passwordMd5: md5Hex('secret'),
    syncEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('KoreaderService', () => {
  let service: KoreaderService;
  let mockRepo: {
    findKoreaderUser: ReturnType<typeof vi.fn>;
    findKoreaderUserByUsername: ReturnType<typeof vi.fn>;
    createKoreaderUser: ReturnType<typeof vi.fn>;
    updateKoreaderUser: ReturnType<typeof vi.fn>;
    deleteKoreaderUser: ReturnType<typeof vi.fn>;
    getAccessibleLibraryIds: ReturnType<typeof vi.fn>;
    resolveBookFileByHash: ReturnType<typeof vi.fn>;
    upsertDeviceProgress: ReturnType<typeof vi.fn>;
    upsertReadingProgress: ReturnType<typeof vi.fn>;
    getLatestDeviceProgress: ReturnType<typeof vi.fn>;
    getReadingProgress: ReturnType<typeof vi.fn>;
    getTotalSyncedBooks: ReturnType<typeof vi.fn>;
    getDevicesList: ReturnType<typeof vi.fn>;
    findBookFileIdByBookId: ReturnType<typeof vi.fn>;
    getBookProgressForDashboard: ReturnType<typeof vi.fn>;
    getChapters: ReturnType<typeof vi.fn>;
    getLastFileWriteTime: ReturnType<typeof vi.fn>;
    upsertKoreaderBookStats: ReturnType<typeof vi.fn>;
    bulkInsertKoreaderReadingSessions: ReturnType<typeof vi.fn>;
    getKoreaderBookStats: ReturnType<typeof vi.fn>;
    getKoreaderReadingSessions: ReturnType<typeof vi.fn>;
    getKoreaderAggregateStats: ReturnType<typeof vi.fn>;
    hasKoreaderBookStats: ReturnType<typeof vi.fn>;
    getKoreaderSessionsDailySummary: ReturnType<typeof vi.fn>;
    getKoreaderStatsActiveDates: ReturnType<typeof vi.fn>;
    getKoreaderStatsTotals: ReturnType<typeof vi.fn>;
    getKoreaderActivityHeatmap: ReturnType<typeof vi.fn>;
    getKoreaderMonthlyReading: ReturnType<typeof vi.fn>;
    getKoreaderTimeOfDay: ReturnType<typeof vi.fn>;
    getKoreaderSessionLengths: ReturnType<typeof vi.fn>;
    getKoreaderTopBooks: ReturnType<typeof vi.fn>;
    getKoreaderTopAnnotated: ReturnType<typeof vi.fn>;
    getKoreaderWeeklyRhythm: ReturnType<typeof vi.fn>;
    getKoreaderDevices: ReturnType<typeof vi.fn>;
  };
  let mockChapterService: {
    parseChapterIndexFromProgress: ReturnType<typeof vi.fn>;
    parseChapterIndexFromCfi: ReturnType<typeof vi.fn>;
  };
  let mockChapterExtractor: {
    extractAndStoreChapters: ReturnType<typeof vi.fn>;
  };
  let mockUserBookStatusService: {
    autoUpdate: ReturnType<typeof vi.fn>;
    setStartedAtIfNull: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    bcryptHashMock.mockResolvedValue('fresh-bcrypt-hash');
    bcryptCompareMock.mockResolvedValue(false);
    createHashMock.mockImplementation((algorithm: string) => {
      let value = '';
      const hash = {
        update: vi.fn((input: string) => {
          value += input;
          return hash;
        }),
        digest: vi.fn((encoding: string) => `${algorithm}:${value}:${encoding}:0123456789abcdef0123456789abcdef`),
      };
      return hash;
    });

    mockRepo = {
      findKoreaderUser: vi.fn(),
      findKoreaderUserByUsername: vi.fn(),
      createKoreaderUser: vi.fn(),
      updateKoreaderUser: vi.fn(),
      deleteKoreaderUser: vi.fn(),
      getAccessibleLibraryIds: vi.fn(),
      resolveBookFileByHash: vi.fn(),
      upsertDeviceProgress: vi.fn(),
      upsertReadingProgress: vi.fn(),
      getLatestDeviceProgress: vi.fn(),
      getReadingProgress: vi.fn(),
      getTotalSyncedBooks: vi.fn(),
      getDevicesList: vi.fn(),
      findBookFileIdByBookId: vi.fn(),
      getBookProgressForDashboard: vi.fn(),
      getChapters: vi.fn(),
      getLastFileWriteTime: vi.fn(),
      upsertKoreaderBookStats: vi.fn(),
      bulkInsertKoreaderReadingSessions: vi.fn(),
      getKoreaderBookStats: vi.fn(),
      getKoreaderReadingSessions: vi.fn(),
      getKoreaderAggregateStats: vi.fn(),
      hasKoreaderBookStats: vi.fn(),
      getKoreaderSessionsDailySummary: vi.fn(),
      getKoreaderStatsActiveDates: vi.fn(),
      getKoreaderStatsTotals: vi.fn(),
      getKoreaderActivityHeatmap: vi.fn(),
      getKoreaderMonthlyReading: vi.fn(),
      getKoreaderTimeOfDay: vi.fn(),
      getKoreaderSessionLengths: vi.fn(),
      getKoreaderTopBooks: vi.fn(),
      getKoreaderTopAnnotated: vi.fn(),
      getKoreaderWeeklyRhythm: vi.fn(),
      getKoreaderDevices: vi.fn(),
    };

    mockChapterService = {
      parseChapterIndexFromProgress: vi.fn(),
      parseChapterIndexFromCfi: vi.fn().mockReturnValue(null),
    };

    mockChapterExtractor = {
      extractAndStoreChapters: vi.fn(),
    };

    mockUserBookStatusService = {
      autoUpdate: vi.fn(),
      setStartedAtIfNull: vi.fn(),
    };

    mockRepo.deleteKoreaderUser.mockResolvedValue(undefined);
    mockRepo.updateKoreaderUser.mockResolvedValue(undefined);
    mockRepo.upsertDeviceProgress.mockResolvedValue(undefined);
    mockRepo.upsertReadingProgress.mockResolvedValue(undefined);
    mockRepo.upsertKoreaderBookStats.mockResolvedValue(undefined);
    mockRepo.bulkInsertKoreaderReadingSessions.mockResolvedValue(undefined);
    mockRepo.getAccessibleLibraryIds.mockResolvedValue([1, 2]);
    mockRepo.getKoreaderAggregateStats.mockResolvedValue({ booksWithStats: 0, totalReadingSeconds: 0 });
    mockRepo.getKoreaderSessionsDailySummary.mockResolvedValue([]);
    mockRepo.getKoreaderStatsActiveDates.mockResolvedValue([]);
    mockRepo.getKoreaderStatsTotals.mockResolvedValue({
      totalSessions: 0,
      totalDurationSecs: 0,
      totalHighlights: 0,
      totalNotes: 0,
      booksWithStats: 0,
    });
    mockRepo.getKoreaderActivityHeatmap.mockResolvedValue([]);
    mockRepo.getKoreaderMonthlyReading.mockResolvedValue([]);
    mockRepo.getKoreaderTimeOfDay.mockResolvedValue([]);
    mockRepo.getKoreaderSessionLengths.mockResolvedValue([]);
    mockRepo.getKoreaderTopBooks.mockResolvedValue([]);
    mockRepo.getKoreaderTopAnnotated.mockResolvedValue([]);
    mockRepo.getKoreaderWeeklyRhythm.mockResolvedValue([]);
    mockRepo.getKoreaderDevices.mockResolvedValue([]);
    mockChapterService.parseChapterIndexFromProgress.mockReturnValue(null);
    mockChapterExtractor.extractAndStoreChapters.mockResolvedValue([]);
    mockUserBookStatusService.autoUpdate.mockResolvedValue(undefined);
    mockUserBookStatusService.setStartedAtIfNull.mockResolvedValue(undefined);

    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new KoreaderService(
      mockRepo as unknown as KoreaderRepository,
      mockChapterService as unknown as KoreaderChapterService,
      mockChapterExtractor as unknown as KoreaderChapterExtractorService,
      mockUserBookStatusService as unknown as UserBookStatusService,
    );
  });

  describe('createCredentials', () => {
    it('creates credentials when user and username are available', async () => {
      const created = makeKoreaderUserRow();
      mockRepo.findKoreaderUser.mockResolvedValue(null);
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(null);
      mockRepo.createKoreaderUser.mockResolvedValue(created);

      const result = await service.createCredentials(7, 'reader', 'secret');

      expect(bcryptHashMock).toHaveBeenCalledWith('secret', 12);
      expect(mockRepo.createKoreaderUser).toHaveBeenCalledWith({
        userId: 7,
        username: 'reader',
        passwordHash: 'fresh-bcrypt-hash',
        passwordMd5: md5Hex('secret'),
      });
      expect(result).toBe(created);
    });

    it('throws when credentials already exist for the user', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(makeKoreaderUserRow());

      await expect(service.createCredentials(7, 'reader', 'secret')).rejects.toThrow(ConflictException);

      expect(mockRepo.findKoreaderUserByUsername).not.toHaveBeenCalled();
      expect(mockRepo.createKoreaderUser).not.toHaveBeenCalled();
    });

    it('throws when the requested username is already taken', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(null);
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(makeKoreaderUserRow({ userId: 99 }));

      await expect(service.createCredentials(7, 'reader', 'secret')).rejects.toThrow(ConflictException);

      expect(mockRepo.createKoreaderUser).not.toHaveBeenCalled();
    });
  });

  describe('updateCredentials', () => {
    it('updates username, password, and syncEnabled together', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(makeKoreaderUserRow({ username: 'old-name' }));
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(null);

      await service.updateCredentials(7, {
        username: 'new-name',
        password: 'new-secret',
        syncEnabled: false,
      });

      expect(mockRepo.updateKoreaderUser).toHaveBeenCalledWith(7, {
        username: 'new-name',
        passwordHash: 'fresh-bcrypt-hash',
        passwordMd5: md5Hex('new-secret'),
        syncEnabled: false,
      });
    });

    it('throws when credentials do not exist', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(null);

      await expect(service.updateCredentials(7, { username: 'new-name' })).rejects.toThrow(NotFoundException);

      expect(mockRepo.updateKoreaderUser).not.toHaveBeenCalled();
    });

    it('throws when updating to a username that is already taken', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(makeKoreaderUserRow({ username: 'old-name' }));
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(makeKoreaderUserRow({ userId: 99, username: 'taken-name' }));

      await expect(service.updateCredentials(7, { username: 'taken-name' })).rejects.toThrow(ConflictException);

      expect(mockRepo.updateKoreaderUser).not.toHaveBeenCalled();
    });

    it('does nothing for an empty update payload', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(makeKoreaderUserRow());

      await service.updateCredentials(7, {});

      expect(mockRepo.findKoreaderUserByUsername).not.toHaveBeenCalled();
      expect(bcryptHashMock).not.toHaveBeenCalled();
      expect(mockRepo.updateKoreaderUser).not.toHaveBeenCalled();
    });
  });

  describe('deleteCredentials', () => {
    it('delegates deletion to the repository', async () => {
      await service.deleteCredentials(15);

      expect(mockRepo.deleteKoreaderUser).toHaveBeenCalledWith(15);
    });
  });

  describe('getCredentials', () => {
    it('returns formatted credentials when they exist', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(makeKoreaderUserRow());

      await expect(service.getCredentials(7)).resolves.toEqual({
        username: 'reader',
        syncEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('returns null when credentials do not exist', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(null);

      await expect(service.getCredentials(7)).resolves.toBeNull();
    });
  });

  describe('testConnection', () => {
    it('returns true when bcrypt validation succeeds', async () => {
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(makeKoreaderUserRow({ userId: 7 }));
      bcryptCompareMock.mockResolvedValue(true);

      await expect(service.testConnection(7, 'reader', 'secret')).resolves.toBe(true);

      expect(bcryptCompareMock).toHaveBeenCalledWith('secret', 'stored-bcrypt-hash');
    });

    it('returns false when the password is wrong', async () => {
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(makeKoreaderUserRow({ userId: 7, passwordMd5: md5Hex('different') }));
      bcryptCompareMock.mockResolvedValue(false);

      await expect(service.testConnection(7, 'reader', 'wrong-password')).resolves.toBe(false);
    });

    it('returns false when the username belongs to a different user', async () => {
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(makeKoreaderUserRow({ userId: 9 }));

      await expect(service.testConnection(7, 'reader', 'secret')).resolves.toBe(false);

      expect(bcryptCompareMock).not.toHaveBeenCalled();
    });

    it('falls back to md5 for legacy password validation', async () => {
      mockRepo.findKoreaderUserByUsername.mockResolvedValue(makeKoreaderUserRow({ userId: 7, passwordMd5: md5Hex('legacy-secret') }));
      bcryptCompareMock.mockResolvedValue(false);

      await expect(service.testConnection(7, 'reader', 'legacy-secret')).resolves.toBe(true);
    });
  });

  describe('saveStats', () => {
    it('returns processed=0 unmatched=0 for empty book list', async () => {
      const result = await service.saveStats(7, { books: [], device: 'KOReader', device_id: 'abc' });
      expect(result).toEqual({ processed: 0, unmatched: 0 });
      expect(mockRepo.resolveBookFileByHash).not.toHaveBeenCalled();
    });

    it('counts unmatched books that cannot be resolved', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      const result = await service.saveStats(7, {
        books: [{ document: 'unknownhash', page_sessions: [] }],
      });

      expect(result.unmatched).toBe(1);
      expect(result.processed).toBe(0);
    });

    it('processes a matched book and upserts stats and sessions', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });

      const result = await service.saveStats(7, {
        books: [
          {
            document: 'abc123',
            md5: 'abc123',
            total_read_secs: 3600,
            total_read_pages: 100,
            highlights: 3,
            notes: 1,
            last_open: 1700000000,
            page_sessions: [{ page: 5, start_time: 1700000000, duration: 120, total_pages: 300 }],
          },
        ],
      });

      expect(result).toEqual({ processed: 1, unmatched: 0 });
      expect(mockRepo.upsertKoreaderBookStats).toHaveBeenCalledWith(expect.objectContaining({ bookFileId: 10, userId: 7, totalReadSecs: 3600 }));
      expect(mockRepo.bulkInsertKoreaderReadingSessions).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ bookFileId: 10, userId: 7, page: 5, durationSeconds: 120 })]),
      );
      expect(mockUserBookStatusService.setStartedAtIfNull).toHaveBeenCalledWith(7, 20, expect.any(Date));
    });

    it('filters out zero-duration sessions', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });

      await service.saveStats(7, {
        books: [
          {
            document: 'abc',
            page_sessions: [
              { page: 1, start_time: 1700000000, duration: 0, total_pages: 300 },
              { page: 2, start_time: 1700000001, duration: 60, total_pages: 300 },
            ],
          },
        ],
      });

      const sessions = mockRepo.bulkInsertKoreaderReadingSessions.mock.calls[0][0];
      expect(sessions).toHaveLength(1);
      expect(sessions[0].page).toBe(2);
    });

    it('does not call setStartedAtIfNull when last_open is 0', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });

      await service.saveStats(7, {
        books: [{ document: 'abc', last_open: 0, page_sessions: [] }],
      });

      expect(mockUserBookStatusService.setStartedAtIfNull).not.toHaveBeenCalled();
    });

    it('uses md5 field over document for hash lookup when md5 is non-empty', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });

      await service.saveStats(7, {
        books: [{ document: '/path/to/book.epub', md5: 'actualmd5', page_sessions: [] }],
      });

      expect(mockRepo.resolveBookFileByHash).toHaveBeenCalledWith('actualmd5', expect.anything());
    });

    it('processes multiple books independently', async () => {
      mockRepo.resolveBookFileByHash
        .mockResolvedValueOnce({ id: 10, bookId: 20 })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 11, bookId: 21 });

      const result = await service.saveStats(7, {
        books: [
          { document: 'hash1', page_sessions: [] },
          { document: 'hash2', page_sessions: [] },
          { document: 'hash3', page_sessions: [] },
        ],
      });

      expect(result).toEqual({ processed: 2, unmatched: 1 });
    });
  });

  describe('saveProgress', () => {
    it('resolves the book file, parses progress, extracts chapters, and updates synced progress', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 44, bookId: 55 });
      mockChapterService.parseChapterIndexFromProgress.mockReturnValue(6);
      mockChapterExtractor.extractAndStoreChapters.mockRejectedValueOnce(new Error('extract failed'));

      const result = await service.saveProgress(12, {
        document: 'abcdef1234567890fedcba',
        percentage: 0.5,
        progress: '/body/DocFragment[7]',
        device: 'Kobo Sage',
        device_id: 'device-12',
        timestamp: 1700000000,
      });

      expect(mockRepo.resolveBookFileByHash).toHaveBeenCalledWith('abcdef1234567890fedcba', [1, 2]);
      expect(mockChapterService.parseChapterIndexFromProgress).toHaveBeenCalledWith('/body/DocFragment[7]');
      expect(mockChapterExtractor.extractAndStoreChapters).toHaveBeenCalledWith(44);
      expect(mockRepo.upsertDeviceProgress).toHaveBeenCalledWith({
        bookFileId: 44,
        userId: 12,
        device: 'Kobo Sage',
        deviceId: 'device-12',
        percentage: 0.5,
        progress: '/body/DocFragment[7]',
        chapterIndex: 6,
        syncTimestamp: 1700000000,
      });
      expect(mockRepo.upsertReadingProgress).toHaveBeenCalledWith(44, 12, 50);
      expect(mockUserBookStatusService.autoUpdate).toHaveBeenCalledWith(12, 55, 50);
      expect(result).toEqual({
        document: 'abcdef1234567890fedcba',
        timestamp: 1700000000,
      });
    });

    it('throws when the book file cannot be resolved', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(
        service.saveProgress(12, {
          document: 'missing-document',
          percentage: 0.2,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockRepo.upsertDeviceProgress).not.toHaveBeenCalled();
      expect(mockRepo.upsertReadingProgress).not.toHaveBeenCalled();
      expect(mockUserBookStatusService.autoUpdate).not.toHaveBeenCalled();
    });

    it('passes empty accessible library lists to hash resolution', async () => {
      mockRepo.getAccessibleLibraryIds.mockResolvedValue([]);
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(
        service.saveProgress(12, {
          document: 'no-access-document',
          percentage: 0.2,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockRepo.resolveBookFileByHash).toHaveBeenCalledWith('no-access-document', []);
    });

    it('uses the default device and generated device id when the payload leaves them empty', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 88, bookId: 99 });

      await service.saveProgress(12, {
        document: 'default-device-document',
        percentage: 0.25,
        device: '',
        device_id: '',
      });

      expect(mockRepo.upsertDeviceProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          device: 'KOReader',
          deviceId: defaultDeviceId('KOReader', 12),
          progress: null,
          syncTimestamp: null,
        }),
      );
    });
  });

  describe('getProgress', () => {
    it('returns device progress when the device sync is latest', async () => {
      const latestDeviceTime = new Date('2026-02-01T10:00:00.000Z');
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });
      mockRepo.getLatestDeviceProgress.mockResolvedValue({
        percentage: 0.66,
        progress: '/body/DocFragment[8]/body',
        device: 'Kobo Libra',
        deviceId: 'device-1',
        syncTimestamp: null,
        updatedAt: latestDeviceTime,
      });
      mockRepo.getReadingProgress.mockResolvedValue({
        percentage: 80,
        updatedAt: new Date('2026-02-01T09:00:00.000Z'),
      });

      await expect(service.getProgress(7, 'doc-hash')).resolves.toEqual({
        document: 'doc-hash',
        percentage: 0.66,
        progress: '/body/DocFragment[8]/body',
        device: 'Kobo Libra',
        device_id: 'device-1',
        timestamp: Math.floor(latestDeviceTime.getTime() / 1000),
      });
    });

    it('returns web reader progress with null XPointer when no CFI is stored', async () => {
      const readerTime = new Date('2026-02-01T11:00:00.000Z');
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });
      mockRepo.getLatestDeviceProgress.mockResolvedValue({
        percentage: 0.2,
        progress: '/body/DocFragment[5]/body',
        device: 'Kobo Libra',
        deviceId: 'device-1',
        syncTimestamp: 100,
        updatedAt: new Date('2026-02-01T09:00:00.000Z'),
      });
      mockRepo.getReadingProgress.mockResolvedValue({
        percentage: 73.21,
        cfi: null,
        updatedAt: readerTime,
      });

      await expect(service.getProgress(7, 'doc-hash')).resolves.toEqual({
        document: 'doc-hash',
        percentage: 0.7321,
        progress: null,
        device: 'web',
        device_id: 'bookorbit-web',
        timestamp: Math.floor(readerTime.getTime() / 1000),
      });
    });

    it('converts CFI to DocFragment XPointer using chapter service (no file I/O)', async () => {
      const readerTime = new Date('2026-02-01T11:00:00.000Z');
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });
      mockRepo.getLatestDeviceProgress.mockResolvedValue(null);
      mockRepo.getReadingProgress.mockResolvedValue({
        percentage: 50,
        // /6/4 -> spinePos=4 -> floor(4/2)-1 = 1 -> chapterIndex=1 -> DocFragment[2]
        cfi: 'epubcfi(/6/4!/4/2/2:10)',
        updatedAt: readerTime,
      });
      mockChapterService.parseChapterIndexFromCfi.mockReturnValue(1);

      await expect(service.getProgress(7, 'doc-hash')).resolves.toEqual({
        document: 'doc-hash',
        percentage: 0.5,
        progress: '/body/DocFragment[2]/body',
        device: 'web',
        device_id: 'bookorbit-web',
        timestamp: Math.floor(readerTime.getTime() / 1000),
      });
      expect(mockChapterService.parseChapterIndexFromCfi).toHaveBeenCalledWith('epubcfi(/6/4!/4/2/2:10)');
    });

    it('returns null XPointer when chapter service cannot parse CFI spine index', async () => {
      const readerTime = new Date('2026-02-01T11:00:00.000Z');
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });
      mockRepo.getLatestDeviceProgress.mockResolvedValue(null);
      mockRepo.getReadingProgress.mockResolvedValue({
        percentage: 30,
        cfi: 'some-unparseable-format',
        updatedAt: readerTime,
      });
      mockChapterService.parseChapterIndexFromCfi.mockReturnValue(null);

      const result = await service.getProgress(7, 'doc-hash');
      expect(result?.progress).toBeNull();
    });

    it('returns null when neither device nor web reader progress exists', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });
      mockRepo.getLatestDeviceProgress.mockResolvedValue(null);
      mockRepo.getReadingProgress.mockResolvedValue(null);

      await expect(service.getProgress(7, 'doc-hash')).resolves.toBeNull();
    });

    it('returns null when the document hash does not resolve to a book file', async () => {
      mockRepo.resolveBookFileByHash.mockResolvedValue(null);

      await expect(service.getProgress(7, 'doc-hash')).resolves.toBeNull();
    });
  });

  describe('getKoreaderTabData', () => {
    it('returns null when no book file found', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(null);

      const result = await service.getKoreaderTabData(7, 99, 1, 20);

      expect(result).toBeNull();
    });

    it('returns null when no stats exist for the book', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(10);
      mockRepo.getKoreaderBookStats.mockResolvedValue(null);

      const result = await service.getKoreaderTabData(7, 99, 1, 20);

      expect(result).toBeNull();
    });

    it('returns tab data when stats exist', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(10);
      mockRepo.getKoreaderBookStats.mockResolvedValue({
        id: 1,
        bookFileId: 10,
        userId: 7,
        totalReadSecs: 3600,
        totalReadPages: 100,
        highlightsCount: 3,
        notesCount: 1,
        lastOpenAt: new Date('2024-01-15T10:00:00Z'),
        updatedAt: new Date('2024-01-15T10:00:00Z'),
      });
      mockRepo.getKoreaderReadingSessions.mockResolvedValue({
        rows: [
          {
            id: 1,
            bookFileId: 10,
            userId: 7,
            sessionHash: 'abc',
            page: 5,
            startedAt: new Date('2024-01-15T09:00:00Z'),
            durationSeconds: 120,
            totalPages: 300,
            createdAt: new Date('2024-01-15T10:00:00Z'),
          },
        ],
        total: 1,
      });
      mockRepo.getKoreaderSessionsDailySummary.mockResolvedValue([{ day: '2024-01-15', durationSeconds: 120 }]);

      const result = await service.getKoreaderTabData(7, 99, 1, 20);

      expect(result).not.toBeNull();
      expect(result!.stats.totalReadSecs).toBe(3600);
      expect(result!.sessions).toHaveLength(1);
      expect(result!.total).toBe(1);
      expect(result!.dailySummary).toEqual([{ day: '2024-01-15', durationSeconds: 120 }]);
    });
  });

  describe('getSyncStatus', () => {
    it('aggregates credentials, devices, totals, and last sync time', async () => {
      const credentials = {
        username: 'reader',
        syncEnabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const devices = [
        {
          device: 'Kobo Libra',
          deviceId: 'device-1',
          lastSyncAt: '2026-02-01T10:00:00.000Z',
          lastBookTitle: null,
        },
      ];
      const getCredentialsSpy = vi.spyOn(service, 'getCredentials').mockResolvedValue(credentials);
      const getDevicesSpy = vi.spyOn(service, 'getDevices').mockResolvedValue(devices);
      mockRepo.getTotalSyncedBooks.mockResolvedValue(14);

      await expect(service.getSyncStatus(7)).resolves.toEqual({
        credentials,
        devices,
        totalSyncedBooks: 14,
        lastSyncAt: '2026-02-01T10:00:00.000Z',
        booksWithStats: 0,
        totalReadingSeconds: 0,
      });

      expect(getCredentialsSpy).toHaveBeenCalledWith(7);
      expect(getDevicesSpy).toHaveBeenCalledWith(7);
      expect(mockRepo.getTotalSyncedBooks).toHaveBeenCalledWith(7);
    });

    it('includes booksWithStats and totalReadingSeconds from aggregate stats', async () => {
      mockRepo.findKoreaderUser.mockResolvedValue(makeKoreaderUserRow());
      mockRepo.getDevicesList.mockResolvedValue([]);
      mockRepo.getTotalSyncedBooks.mockResolvedValue(5);
      mockRepo.getKoreaderAggregateStats.mockResolvedValue({ booksWithStats: 3, totalReadingSeconds: 7200 });

      const result = await service.getSyncStatus(7);

      expect(result.booksWithStats).toBe(3);
      expect(result.totalReadingSeconds).toBe(7200);
    });
  });

  describe('getDevices', () => {
    it('maps repository rows to device DTOs', async () => {
      mockRepo.getDevicesList.mockResolvedValue([
        {
          device: 'Kobo Libra',
          deviceId: 'device-1',
          lastSyncAt: new Date('2026-02-01T10:00:00.000Z'),
          lastBookTitle: 'Project Hail Mary',
        },
        {
          device: 'KOReader',
          deviceId: 'device-2',
          lastSyncAt: new Date('2026-02-01T11:00:00.000Z'),
          lastBookTitle: null,
        },
      ]);

      await expect(service.getDevices(7)).resolves.toEqual([
        {
          device: 'Kobo Libra',
          deviceId: 'device-1',
          lastSyncAt: '2026-02-01T10:00:00.000Z',
          lastBookTitle: 'Project Hail Mary',
        },
        {
          device: 'KOReader',
          deviceId: 'device-2',
          lastSyncAt: '2026-02-01T11:00:00.000Z',
          lastBookTitle: null,
        },
      ]);
    });
  });

  describe('getBookProgress', () => {
    it('returns full sync info with chapters when KOReader is the canonical source', async () => {
      const latestDeviceTime = new Date('2026-03-01T10:00:00.000Z');
      mockRepo.findBookFileIdByBookId.mockResolvedValue(31);
      mockRepo.getBookProgressForDashboard.mockResolvedValue({
        deviceProgress: [
          {
            device: 'Kobo Libra',
            deviceId: 'device-1',
            percentage: 0.75,
            chapterIndex: 2,
            updatedAt: latestDeviceTime,
          },
          {
            device: 'Kobo Sage',
            deviceId: 'device-2',
            percentage: 0.25,
            chapterIndex: 1,
            updatedAt: new Date('2026-03-01T08:00:00.000Z'),
          },
        ],
        readingProgress: {
          percentage: 49,
          updatedAt: new Date('2026-03-01T09:00:00.000Z'),
        },
      });
      mockRepo.getChapters.mockResolvedValue([
        { chapterIndex: 1, title: 'Chapter 2' },
        { chapterIndex: 2, title: 'Chapter 3' },
      ]);
      mockRepo.getLastFileWriteTime.mockResolvedValue(new Date('2026-03-01T12:00:00.000Z'));

      await expect(service.getBookProgress(7, 99)).resolves.toEqual({
        bookId: 99,
        bookFileId: 31,
        canonicalPercentage: 75,
        canonicalChapterIndex: 2,
        canonicalChapterTitle: 'Chapter 3',
        canonicalSource: 'koreader',
        canonicalUpdatedAt: '2026-03-01T10:00:00.000Z',
        devices: [
          {
            device: 'Kobo Libra',
            deviceId: 'device-1',
            percentage: 75,
            chapterIndex: 2,
            chapterTitle: 'Chapter 3',
            updatedAt: '2026-03-01T10:00:00.000Z',
          },
          {
            device: 'Kobo Sage',
            deviceId: 'device-2',
            percentage: 25,
            chapterIndex: 1,
            chapterTitle: 'Chapter 2',
            updatedAt: '2026-03-01T08:00:00.000Z',
          },
        ],
        fileModifiedSinceLastSync: true,
      });
    });

    it('returns null when there is no primary book file', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(null);

      await expect(service.getBookProgress(7, 99)).resolves.toBeNull();
    });

    it('returns null when no progress data exists for the book', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(31);
      mockRepo.getBookProgressForDashboard.mockResolvedValue({
        deviceProgress: [],
        readingProgress: null,
      });

      await expect(service.getBookProgress(7, 99)).resolves.toBeNull();
    });

    it('uses web reader as the canonical source when its progress is newer', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(31);
      mockRepo.getBookProgressForDashboard.mockResolvedValue({
        deviceProgress: [
          {
            device: 'Kobo Libra',
            deviceId: 'device-1',
            percentage: 0.2,
            chapterIndex: 1,
            updatedAt: new Date('2026-03-01T08:00:00.000Z'),
          },
        ],
        readingProgress: {
          percentage: 64.3,
          updatedAt: new Date('2026-03-01T11:00:00.000Z'),
        },
      });
      mockRepo.getChapters.mockResolvedValue([{ chapterIndex: 1, title: 'Chapter 2' }]);
      mockRepo.getLastFileWriteTime.mockResolvedValue(new Date('2026-03-01T07:00:00.000Z'));

      await expect(service.getBookProgress(7, 99)).resolves.toEqual({
        bookId: 99,
        bookFileId: 31,
        canonicalPercentage: 64.3,
        canonicalChapterIndex: null,
        canonicalChapterTitle: null,
        canonicalSource: 'web_reader',
        canonicalUpdatedAt: '2026-03-01T11:00:00.000Z',
        devices: [
          {
            device: 'Kobo Libra',
            deviceId: 'device-1',
            percentage: 20,
            chapterIndex: 1,
            chapterTitle: 'Chapter 2',
            updatedAt: '2026-03-01T08:00:00.000Z',
          },
        ],
        fileModifiedSinceLastSync: false,
      });
    });

    it('marks the file stale when any device synced before the last file write', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(31);
      mockRepo.getBookProgressForDashboard.mockResolvedValue({
        deviceProgress: [
          {
            device: 'Kobo Libra',
            deviceId: 'device-1',
            percentage: 0.8,
            chapterIndex: 2,
            updatedAt: new Date('2026-03-01T13:00:00.000Z'),
          },
          {
            device: 'Kobo Sage',
            deviceId: 'device-2',
            percentage: 0.45,
            chapterIndex: 1,
            updatedAt: new Date('2026-03-01T10:00:00.000Z'),
          },
        ],
        readingProgress: {
          percentage: 60,
          updatedAt: new Date('2026-03-01T09:00:00.000Z'),
        },
      });
      mockRepo.getChapters.mockResolvedValue([
        { chapterIndex: 1, title: 'Chapter 2' },
        { chapterIndex: 2, title: 'Chapter 3' },
      ]);
      mockRepo.getLastFileWriteTime.mockResolvedValue(new Date('2026-03-01T12:00:00.000Z'));

      const result = await service.getBookProgress(7, 99);

      expect(result?.canonicalSource).toBe('koreader');
      expect(result?.fileModifiedSinceLastSync).toBe(true);
    });

    it('keeps the file fresh when every device synced after the last file write', async () => {
      mockRepo.findBookFileIdByBookId.mockResolvedValue(31);
      mockRepo.getBookProgressForDashboard.mockResolvedValue({
        deviceProgress: [
          {
            device: 'Kobo Libra',
            deviceId: 'device-1',
            percentage: 0.8,
            chapterIndex: 2,
            updatedAt: new Date('2026-03-01T13:00:00.000Z'),
          },
          {
            device: 'Kobo Sage',
            deviceId: 'device-2',
            percentage: 0.45,
            chapterIndex: 1,
            updatedAt: new Date('2026-03-01T12:30:00.000Z'),
          },
        ],
        readingProgress: {
          percentage: 60,
          updatedAt: new Date('2026-03-01T09:00:00.000Z'),
        },
      });
      mockRepo.getChapters.mockResolvedValue([
        { chapterIndex: 1, title: 'Chapter 2' },
        { chapterIndex: 2, title: 'Chapter 3' },
      ]);
      mockRepo.getLastFileWriteTime.mockResolvedValue(new Date('2026-03-01T12:00:00.000Z'));

      const result = await service.getBookProgress(7, 99);

      expect(result?.canonicalSource).toBe('koreader');
      expect(result?.fileModifiedSinceLastSync).toBe(false);
    });
  });

  describe('getKoreaderStatsSummary', () => {
    it('returns zeros and 0 streaks when no data', async () => {
      mockRepo.getKoreaderStatsActiveDates.mockResolvedValue([]);
      mockRepo.getKoreaderStatsTotals.mockResolvedValue({
        totalSessions: 0,
        totalDurationSecs: 0,
        totalHighlights: 0,
        totalNotes: 0,
        booksWithStats: 0,
      });

      const result = await service.getKoreaderStatsSummary(7);

      expect(result.totalReadSecs).toBe(0);
      expect(result.totalSessions).toBe(0);
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
    });

    it('computes correct streak for consecutive days ending today', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
      mockRepo.getKoreaderStatsActiveDates.mockResolvedValue([twoDaysAgo, yesterday, today]);
      mockRepo.getKoreaderStatsTotals.mockResolvedValue({
        totalSessions: 5,
        totalDurationSecs: 3600,
        totalHighlights: 2,
        totalNotes: 1,
        booksWithStats: 1,
      });

      const result = await service.getKoreaderStatsSummary(7);

      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
      expect(result.totalReadSecs).toBe(3600);
      expect(result.totalSessions).toBe(5);
    });

    it('normalizes unsorted and duplicate streak dates before computing streaks', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
      const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
      mockRepo.getKoreaderStatsActiveDates.mockResolvedValue([today, yesterday, today, twoDaysAgo]);
      mockRepo.getKoreaderStatsTotals.mockResolvedValue({
        totalSessions: 3,
        totalDurationSecs: 1800,
        totalHighlights: 0,
        totalNotes: 0,
        booksWithStats: 1,
      });

      const result = await service.getKoreaderStatsSummary(7);

      expect(result.currentStreak).toBe(3);
      expect(result.longestStreak).toBe(3);
    });

    it('returns 0 current streak when last session was 2+ days ago', async () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
      mockRepo.getKoreaderStatsActiveDates.mockResolvedValue([fourDaysAgo, threeDaysAgo]);
      mockRepo.getKoreaderStatsTotals.mockResolvedValue({
        totalSessions: 2,
        totalDurationSecs: 7200,
        totalHighlights: 0,
        totalNotes: 0,
        booksWithStats: 1,
      });

      const result = await service.getKoreaderStatsSummary(7);

      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(2);
    });

    it('counts longest streak correctly across a gap', async () => {
      mockRepo.getKoreaderStatsActiveDates.mockResolvedValue(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-10', '2026-01-11']);
      mockRepo.getKoreaderStatsTotals.mockResolvedValue({
        totalSessions: 5,
        totalDurationSecs: 0,
        totalHighlights: 0,
        totalNotes: 0,
        booksWithStats: 0,
      });

      const result = await service.getKoreaderStatsSummary(7);

      expect(result.longestStreak).toBe(3);
    });

    it('returns highlights and notes from totals', async () => {
      mockRepo.getKoreaderStatsActiveDates.mockResolvedValue([]);
      mockRepo.getKoreaderStatsTotals.mockResolvedValue({
        totalSessions: 0,
        totalDurationSecs: 0,
        totalHighlights: 42,
        totalNotes: 7,
        booksWithStats: 3,
      });

      const result = await service.getKoreaderStatsSummary(7);

      expect(result.totalHighlights).toBe(42);
      expect(result.totalNotes).toBe(7);
      expect(result.booksWithStats).toBe(3);
    });
  });

  describe('getKoreaderWeeklyRhythm', () => {
    it('maps DOW to labels and fills missing weekdays', async () => {
      mockRepo.getKoreaderWeeklyRhythm.mockResolvedValue([
        { dow: 1, durationSeconds: 600 },
        { dow: 7, durationSeconds: 1200 },
      ]);

      const result = await service.getKoreaderWeeklyRhythm(7);

      expect(result[0]).toEqual({ dow: 1, label: 'Mon', durationSeconds: 600 });
      expect(result[1]).toEqual({ dow: 2, label: 'Tue', durationSeconds: 0 });
      expect(result[6]).toEqual({ dow: 7, label: 'Sun', durationSeconds: 1200 });
      expect(result).toHaveLength(7);
    });

    it('returns seven zero-filled weekday entries when no data', async () => {
      mockRepo.getKoreaderWeeklyRhythm.mockResolvedValue([]);
      const result = await service.getKoreaderWeeklyRhythm(7);
      expect(result).toHaveLength(7);
      expect(result.every((item) => item.durationSeconds === 0)).toBe(true);
      expect(result[0]?.label).toBe('Mon');
      expect(result[6]?.label).toBe('Sun');
    });
  });

  describe('getKoreaderActivityHeatmap', () => {
    it('delegates to repository', async () => {
      const heatmap = [{ date: '2026-01-01', durationSeconds: 3600 }];
      mockRepo.getKoreaderActivityHeatmap.mockResolvedValue(heatmap);

      const result = await service.getKoreaderActivityHeatmap(7);

      expect(result).toEqual(heatmap);
      expect(mockRepo.getKoreaderActivityHeatmap).toHaveBeenCalledWith(7);
    });
  });

  describe('getKoreaderMonthlyReading', () => {
    it('delegates to repository', async () => {
      const monthly = [{ year: 2026, month: 1, durationSeconds: 7200 }];
      mockRepo.getKoreaderMonthlyReading.mockResolvedValue(monthly);

      const result = await service.getKoreaderMonthlyReading(7);

      expect(result).toEqual(monthly);
    });
  });

  describe('getKoreaderSessionLengths', () => {
    it('delegates to repository', async () => {
      const bins = [{ label: '0-5m', minSecs: 0, maxSecs: 300, count: 5 }];
      mockRepo.getKoreaderSessionLengths.mockResolvedValue(bins);

      const result = await service.getKoreaderSessionLengths(7);

      expect(result).toEqual(bins);
    });
  });

  describe('getKoreaderTopBooks', () => {
    it('delegates to repository', async () => {
      const books = [{ bookId: 1, title: 'Test Book', totalReadSecs: 3600 }];
      mockRepo.getKoreaderTopBooks.mockResolvedValue(books);

      const result = await service.getKoreaderTopBooks(7);

      expect(result).toEqual(books);
      expect(mockRepo.getKoreaderTopBooks).toHaveBeenCalledWith(7);
    });
  });

  describe('getKoreaderTopAnnotated', () => {
    it('delegates to repository', async () => {
      const annotated = [{ bookId: 1, title: 'Annotated Book', highlightsCount: 10, notesCount: 2 }];
      mockRepo.getKoreaderTopAnnotated.mockResolvedValue(annotated);

      const result = await service.getKoreaderTopAnnotated(7);

      expect(result).toEqual(annotated);
    });
  });

  describe('getKoreaderDevices', () => {
    it('delegates to repository', async () => {
      const devices = [{ device: 'Kobo Libra', booksTracked: 5 }];
      mockRepo.getKoreaderDevices.mockResolvedValue(devices);

      const result = await service.getKoreaderDevices(7);

      expect(result).toEqual(devices);
      expect(mockRepo.getKoreaderDevices).toHaveBeenCalledWith(7);
    });
  });

  describe('getKoreaderTimeOfDay', () => {
    it('fills all 24 hours when repository returns partial data', async () => {
      const hours = [{ hour: 9, durationSeconds: 1800 }];
      mockRepo.getKoreaderTimeOfDay.mockResolvedValue(hours);

      const result = await service.getKoreaderTimeOfDay(7);

      expect(result).toHaveLength(24);
      expect(result[9]).toEqual({ hour: 9, durationSeconds: 1800 });
      expect(result[8]).toEqual({ hour: 8, durationSeconds: 0 });
      expect(result[23]).toEqual({ hour: 23, durationSeconds: 0 });
    });
  });
});
