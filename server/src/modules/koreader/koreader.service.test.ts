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

import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../achievement/achievement-events.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderChapterService } from './koreader-chapter.service';
import type { KoreaderPackageService } from './koreader-package.service';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
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
  };
  let mockAchievementEvents: {
    emit: ReturnType<typeof vi.fn>;
  };
  let mockPluginRepo: {
    listSweeps: ReturnType<typeof vi.fn>;
    getPluginTotals: ReturnType<typeof vi.fn>;
  };
  let mockPositionConverter: {
    xpointerPointToCfi: ReturnType<typeof vi.fn>;
  };
  let mockBookService: {
    syncKoboReadingStateForExternalProgress: ReturnType<typeof vi.fn>;
  };
  let mockPackageService: {
    getVersionInfo: ReturnType<typeof vi.fn>;
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
    };

    mockAchievementEvents = {
      emit: vi.fn(),
    };

    mockPositionConverter = {
      xpointerPointToCfi: vi.fn().mockResolvedValue({ status: 'failed', reason: 'chapter_unavailable' }),
    };

    mockBookService = {
      syncKoboReadingStateForExternalProgress: vi.fn().mockResolvedValue(undefined),
    };
    mockPackageService = {
      getVersionInfo: vi.fn().mockResolvedValue({ pluginVersion: 'unknown', serverVersion: '1.0.0' }),
    };

    mockPluginRepo = {
      listSweeps: vi.fn().mockResolvedValue([]),
      getPluginTotals: vi.fn().mockResolvedValue({
        matchedBooks: 0,
        trashedAnnotations: 0,
        pendingDeletes: 0,
        failedPositions: 0,
        pageStatEvents: 0,
        annotations: 0,
      }),
    };

    mockRepo.deleteKoreaderUser.mockResolvedValue(undefined);
    mockRepo.updateKoreaderUser.mockResolvedValue(undefined);
    mockRepo.upsertDeviceProgress.mockResolvedValue(undefined);
    mockRepo.upsertReadingProgress.mockResolvedValue(undefined);
    mockRepo.getAccessibleLibraryIds.mockResolvedValue([1, 2]);
    mockChapterService.parseChapterIndexFromProgress.mockReturnValue(null);
    mockChapterExtractor.extractAndStoreChapters.mockResolvedValue([]);
    mockUserBookStatusService.autoUpdate.mockResolvedValue(undefined);

    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new KoreaderService(
      mockRepo as unknown as KoreaderRepository,
      mockPluginRepo as unknown as KoreaderPluginRepository,
      mockChapterService as unknown as KoreaderChapterService,
      mockChapterExtractor as unknown as KoreaderChapterExtractorService,
      mockUserBookStatusService as unknown as UserBookStatusService,
      mockAchievementEvents as unknown as AchievementEventsService,
      mockPositionConverter as never,
      mockBookService as never,
      mockPackageService as unknown as KoreaderPackageService,
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
      expect(mockRepo.upsertReadingProgress).toHaveBeenCalledWith(44, 12, 50, null, '/body/DocFragment[7]');
      expect(mockBookService.syncKoboReadingStateForExternalProgress).toHaveBeenCalledWith(12, 44, 50);
      expect(mockUserBookStatusService.autoUpdate).toHaveBeenCalledWith(12, 55, 50);
      expect(mockAchievementEvents.emit).toHaveBeenCalledWith(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
        userId: 12,
        bookId: 55,
        bookFileId: 44,
        progress: 50,
        source: 'koreader',
      });
      expect(mockAchievementEvents.emit.mock.invocationCallOrder[0]!).toBeGreaterThan(
        mockUserBookStatusService.autoUpdate.mock.invocationCallOrder[0]!,
      );
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
      expect(mockAchievementEvents.emit).not.toHaveBeenCalled();
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

    it('returns exact web reader KOReader XPointer when it is stored', async () => {
      const readerTime = new Date('2026-02-01T11:00:00.000Z');
      mockRepo.resolveBookFileByHash.mockResolvedValue({ id: 10, bookId: 20 });
      mockRepo.getLatestDeviceProgress.mockResolvedValue(null);
      mockRepo.getReadingProgress.mockResolvedValue({
        percentage: 50,
        cfi: 'epubcfi(/6/4!/4/2/2:10)',
        koreaderProgress: '/body/DocFragment[2]/body/p[137]/text()[1].0',
        updatedAt: readerTime,
      });

      await expect(service.getProgress(7, 'doc-hash')).resolves.toEqual({
        document: 'doc-hash',
        percentage: 0.5,
        progress: '/body/DocFragment[2]/body/p[137]/text()[1].0',
        device: 'web',
        device_id: 'bookorbit-web',
        timestamp: Math.floor(readerTime.getTime() / 1000),
      });
      expect(mockChapterService.parseChapterIndexFromCfi).not.toHaveBeenCalled();
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
        latestPluginVersion: null,
        pluginUpdateAvailable: false,
        sweeps: [],
        pluginTotals: { matchedBooks: 0, trashedAnnotations: 0, pendingDeletes: 0, failedPositions: 0, pageStatEvents: 0, annotations: 0 },
      });

      expect(getCredentialsSpy).toHaveBeenCalledWith(7);
      expect(getDevicesSpy).toHaveBeenCalledWith(7);
      expect(mockRepo.getTotalSyncedBooks).toHaveBeenCalledWith(7);
      expect(mockPluginRepo.listSweeps).toHaveBeenCalledWith(7);
      expect(mockPluginRepo.getPluginTotals).toHaveBeenCalledWith(7);
      expect(mockPackageService.getVersionInfo).toHaveBeenCalledTimes(1);
    });

    it('marks only devices with older comparable plugin versions as updateable', async () => {
      vi.spyOn(service, 'getCredentials').mockResolvedValue(null);
      vi.spyOn(service, 'getDevices').mockResolvedValue([]);
      mockRepo.getTotalSyncedBooks.mockResolvedValue(0);
      mockPackageService.getVersionInfo.mockResolvedValue({ pluginVersion: '0.5.0', serverVersion: '1.0.0' });
      mockPluginRepo.listSweeps.mockResolvedValue([
        {
          deviceId: 'old-device',
          deviceModel: 'Kobo Libra 2',
          pluginVersion: '0.4.0',
          lastSweepAt: new Date('2026-02-01T10:00:00.000Z'),
          lastSweepBooksMatched: 12,
          lastSweepPageStats: 30,
          lastSweepAnnotations: 8,
        },
        {
          deviceId: 'current-device',
          deviceModel: 'Kobo Clara',
          pluginVersion: '0.5.0',
          lastSweepAt: new Date('2026-02-01T11:00:00.000Z'),
          lastSweepBooksMatched: 3,
          lastSweepPageStats: 4,
          lastSweepAnnotations: 5,
        },
        {
          deviceId: 'unknown-device',
          deviceModel: 'Kobo Sage',
          pluginVersion: null,
          lastSweepAt: new Date('2026-02-01T12:00:00.000Z'),
          lastSweepBooksMatched: 0,
          lastSweepPageStats: 0,
          lastSweepAnnotations: 0,
        },
      ]);

      const result = await service.getSyncStatus(7);

      expect(result.latestPluginVersion).toBe('0.5.0');
      expect(result.pluginUpdateAvailable).toBe(true);
      expect(result.sweeps).toEqual([
        expect.objectContaining({
          deviceId: 'old-device',
          latestPluginVersion: '0.5.0',
          updateAvailable: true,
        }),
        expect.objectContaining({
          deviceId: 'current-device',
          latestPluginVersion: '0.5.0',
          updateAvailable: false,
        }),
        expect.objectContaining({
          deviceId: 'unknown-device',
          latestPluginVersion: '0.5.0',
          updateAvailable: null,
        }),
      ]);
    });

    it('keeps plugin update state unknown when the server cannot report a plugin version', async () => {
      vi.spyOn(service, 'getCredentials').mockResolvedValue(null);
      vi.spyOn(service, 'getDevices').mockResolvedValue([]);
      mockRepo.getTotalSyncedBooks.mockResolvedValue(0);
      mockPackageService.getVersionInfo.mockResolvedValue({ pluginVersion: 'unknown', serverVersion: '1.0.0' });
      mockPluginRepo.listSweeps.mockResolvedValue([
        {
          deviceId: 'device-1',
          deviceModel: 'Kobo Libra 2',
          pluginVersion: '0.4.0',
          lastSweepAt: new Date('2026-02-01T10:00:00.000Z'),
          lastSweepBooksMatched: 12,
          lastSweepPageStats: 30,
          lastSweepAnnotations: 8,
        },
      ]);

      const result = await service.getSyncStatus(7);

      expect(result.latestPluginVersion).toBeNull();
      expect(result.pluginUpdateAvailable).toBe(false);
      expect(result.sweeps[0]).toEqual(
        expect.objectContaining({
          latestPluginVersion: null,
          updateAvailable: null,
        }),
      );
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
});
