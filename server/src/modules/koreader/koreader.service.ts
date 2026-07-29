import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash } from 'crypto';

import { DEFAULT_KOREADER_DEVICE_PATTERN, type KoreaderBookSyncInfo, type KoreaderDeviceInfo, type KoreaderSyncStatus } from '@bookorbit/types';
import { StatsCache } from '../../common/cache/stats-cache';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { isSemverNewer } from '../../common/utils/semver.utils';
import { KoreaderRepository, type DeviceProgressUpsert } from './koreader.repository';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderPackageService } from './koreader-package.service';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { BookService } from '../book/book.service';
import { PositionConverterService } from '../position-converter/position-converter.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../achievement/achievement-events.service';

const BCRYPT_ROUNDS = 12;
const SYNC_EVENT = 'koreader.sync';
const CREDENTIALS_EVENT = 'koreader.credentials';
const DEVICE_REMOVE_EVENT = 'koreader.device_remove';
const FILE_NAMING_EVENT = 'koreader.file_naming';
const DEFAULT_DEVICE = 'KOReader';
const FILE_NAMING_CACHE_TTL_MS = 30_000;
const FILE_NAMING_CACHE_MAX_ENTRIES = 5_000;
const SHARED_PROGRESS_CONCURRENCY = 4;
const CHAPTER_EXTRACTION_CONCURRENCY = 2;

export interface BulkProgressEntry {
  bookFile: { id: number; bookId: number; libraryId: number };
  percentage: number;
  progress?: string;
  timestamp?: number;
}

@Injectable()
export class KoreaderService {
  private readonly logger = new Logger(KoreaderService.name);
  private readonly fileNamingCache = new StatsCache({ ttlMs: FILE_NAMING_CACHE_TTL_MS, maxEntries: FILE_NAMING_CACHE_MAX_ENTRIES });

  constructor(
    private readonly repo: KoreaderRepository,
    private readonly pluginRepo: KoreaderPluginRepository,
    private readonly chapterService: KoreaderChapterService,
    private readonly chapterExtractor: KoreaderChapterExtractorService,
    private readonly achievementEvents: AchievementEventsService,
    private readonly positionConverter: PositionConverterService,
    private readonly bookService: BookService,
    private readonly packageService: KoreaderPackageService,
  ) {}

  async createCredentials(userId: number, username: string, password: string) {
    this.logger.log(`[${CREDENTIALS_EVENT}] [start] userId=${userId} username=${username} - creating credentials`);

    const existing = await this.repo.findKoreaderUser(userId);
    if (existing) throw new ConflictException('KOReader credentials already exist');

    const existingUsername = await this.repo.findKoreaderUserByUsername(username);
    if (existingUsername) throw new ConflictException('Username already taken');

    const passwordHash = await bcryptHash(password, BCRYPT_ROUNDS);
    const passwordMd5 = createHash('md5').update(password).digest('hex');

    const result = await this.repo.createKoreaderUser({ userId, username, passwordHash, passwordMd5 });
    this.logger.log(`[${CREDENTIALS_EVENT}] [end] userId=${userId} username=${username} - credentials created`);
    return result;
  }

  async updateCredentials(userId: number, data: { username?: string; password?: string; syncEnabled?: boolean }) {
    this.logger.log(`[${CREDENTIALS_EVENT}] [start] userId=${userId} - updating credentials`);

    const existing = await this.repo.findKoreaderUser(userId);
    if (!existing) throw new NotFoundException('KOReader credentials not found');

    const updatePayload: Record<string, unknown> = {};

    if (data.username && data.username !== existing.username) {
      const taken = await this.repo.findKoreaderUserByUsername(data.username);
      if (taken) throw new ConflictException('Username already taken');
      updatePayload.username = data.username;
    }

    if (data.password) {
      updatePayload.passwordHash = await bcryptHash(data.password, BCRYPT_ROUNDS);
      updatePayload.passwordMd5 = createHash('md5').update(data.password).digest('hex');
    }

    if (data.syncEnabled !== undefined) {
      updatePayload.syncEnabled = data.syncEnabled;
    }

    if (Object.keys(updatePayload).length > 0) {
      await this.repo.updateKoreaderUser(userId, updatePayload as Parameters<typeof this.repo.updateKoreaderUser>[1]);
    }

    this.logger.log(
      `[${CREDENTIALS_EVENT}] [end] userId=${userId} fieldsUpdated=${Object.keys(updatePayload).join(',') || 'none'} - credentials updated`,
    );
  }

  async deleteCredentials(userId: number) {
    await this.repo.deleteKoreaderUser(userId);
    this.logger.log(`[${CREDENTIALS_EVENT}] [end] userId=${userId} - credentials deleted`);
  }

  async getCredentials(userId: number) {
    const row = await this.repo.findKoreaderUser(userId);
    if (!row) return null;
    return { username: row.username, syncEnabled: row.syncEnabled, createdAt: row.createdAt.toISOString() };
  }

  async testConnection(userId: number, username: string, password: string): Promise<boolean> {
    const row = await this.repo.findKoreaderUserByUsername(username);
    if (!row || row.userId !== userId) return false;

    const { compare } = await import('bcryptjs');
    const bcryptMatch = await compare(password, row.passwordHash);
    if (bcryptMatch) return true;

    const md5 = createHash('md5').update(password).digest('hex');
    return md5 === row.passwordMd5;
  }

  async saveProgress(
    userId: number,
    data: { document: string; percentage: number; progress?: string; device?: string; device_id?: string; timestamp?: number },
  ) {
    const startedAt = Date.now();
    const device = data.device || DEFAULT_DEVICE;
    const deviceId = data.device_id || createHash('md5').update(`${device}:${userId}`).digest('hex').slice(0, 16); // codeql[js/weak-cryptographic-algorithm] - non-security device identifier

    this.logger.debug(`[${SYNC_EVENT}] [start] userId=${userId} document=${data.document.slice(0, 16)} device=${device} - save progress started`);

    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(userId);
    const bookFile = await this.repo.resolveBookFileByHash(data.document, accessibleLibraryIds, userId);

    if (!bookFile) {
      this.logger.debug(
        `[${SYNC_EVENT}] [fail] userId=${userId} document=${data.document.slice(0, 16)} durationMs=${Date.now() - startedAt} error="book not found" - save progress failed`,
      );
      throw new NotFoundException('Book not found for the given document hash');
    }

    await this.applyProgressForResolvedFile(userId, bookFile, {
      percentage: data.percentage,
      progress: data.progress,
      device,
      deviceId,
      timestamp: data.timestamp,
    });

    this.logger.log(
      `[${SYNC_EVENT}] [end] userId=${userId} bookFileId=${bookFile.id} device=${device} durationMs=${Date.now() - startedAt} percentage=${data.percentage} - save progress completed`,
    );

    return { document: data.document, timestamp: data.timestamp ?? Math.floor(Date.now() / 1000) };
  }

  async applyProgressForResolvedFile(
    userId: number,
    bookFile: { id: number; bookId: number; libraryId: number },
    data: { percentage: number; progress?: string; device: string; deviceId: string; timestamp?: number },
    options?: { skipSharedProgress?: boolean },
  ) {
    const chapterIndex = this.chapterService.parseChapterIndexFromProgress(data.progress ?? null);

    const previousDeviceProgress = await this.repo.getLatestDeviceProgress(bookFile.id, userId);

    this.chapterExtractor.extractAndStoreChapters(bookFile.id).catch(() => {});

    await this.repo.upsertDeviceProgress({
      bookFileId: bookFile.id,
      userId,
      device: data.device,
      deviceId: data.deviceId,
      percentage: data.percentage,
      progress: data.progress ?? null,
      chapterIndex,
      syncTimestamp: data.timestamp ?? null,
    });

    if (options?.skipSharedProgress) return;

    const previousPercentage = previousDeviceProgress?.percentage != null ? toBookorbitPercentage(previousDeviceProgress.percentage) : null;
    await this.applySharedProgress(userId, bookFile, data, previousPercentage);
  }

  /**
   * Bulk sibling of applyProgressForResolvedFile for whole-library sweeps. Reads every
   * file's device and reader progress in bounded batch queries, decides staleness in
   * memory so later entries observe earlier ones, writes the device rows in one
   * statement, and runs the remaining per-book work under bounded concurrency.
   *
   * A sweep can carry a stale sidecar position from a secondary device (book last opened
   * there long ago). The per-device row is recorded regardless, but the shared
   * reading_progress and status updates are skipped when something newer is already
   * known server-side.
   */
  async applyBulkProgress(
    userId: number,
    entries: BulkProgressEntry[],
    device: { device: string; deviceId: string },
  ): Promise<{ shared: number; stale: number }> {
    if (entries.length === 0) return { shared: 0, stale: 0 };

    const bookFileIds = entries.map((entry) => entry.bookFile.id);
    const [deviceRows, readerUpdatedAt] = await Promise.all([
      this.repo.getDeviceProgressForFiles(bookFileIds, userId),
      this.repo.getReadingProgressUpdatedAtForFiles(bookFileIds, userId),
    ]);

    const appliedAt = new Date();
    const appliedAtSeconds = Math.floor(appliedAt.getTime() / 1000);
    const fileStates = new Map<number, { otherDevicesNewest: number; ownDeviceNewest: number; latestPercentage: number | null }>();
    for (const bookFileId of new Set(bookFileIds)) {
      const rows = deviceRows.get(bookFileId) ?? [];
      let otherDevicesNewest = 0;
      let ownDeviceNewest = 0;
      for (const row of rows) {
        const rowSeconds = row.syncTimestamp ?? Math.floor((row.updatedAt?.getTime() ?? 0) / 1000);
        if (row.device === device.device && row.deviceId === device.deviceId) ownDeviceNewest = Math.max(ownDeviceNewest, rowSeconds);
        else otherDevicesNewest = Math.max(otherDevicesNewest, rowSeconds);
      }
      const readerSeconds = readerUpdatedAt.get(bookFileId);
      if (readerSeconds) otherDevicesNewest = Math.max(otherDevicesNewest, Math.floor(readerSeconds.getTime() / 1000));
      fileStates.set(bookFileId, { otherDevicesNewest, ownDeviceNewest, latestPercentage: rows[0]?.percentage ?? null });
    }

    const plans = entries.map((entry) => {
      const state = fileStates.get(entry.bookFile.id)!;
      const newestKnown = Math.max(state.otherDevicesNewest, state.ownDeviceNewest);
      const stale = entry.timestamp ? entry.timestamp < newestKnown : false;
      const previousPercentage = state.latestPercentage != null ? toBookorbitPercentage(state.latestPercentage) : null;
      // Mirror the row this batch is about to write, so a later entry for the same file
      // sees what a sequential apply would have seen.
      state.ownDeviceNewest = entry.timestamp ?? appliedAtSeconds;
      state.latestPercentage = entry.percentage;
      return { entry, stale, previousPercentage };
    });

    const deviceUpserts = new Map<number, DeviceProgressUpsert>();
    for (const { entry } of plans) {
      deviceUpserts.set(entry.bookFile.id, {
        bookFileId: entry.bookFile.id,
        userId,
        device: device.device,
        deviceId: device.deviceId,
        percentage: entry.percentage,
        progress: entry.progress ?? null,
        chapterIndex: this.chapterService.parseChapterIndexFromProgress(entry.progress ?? null),
        syncTimestamp: entry.timestamp ?? null,
      });
    }
    await this.repo.upsertDeviceProgressMany([...deviceUpserts.values()], appliedAt);

    const shared = plans.filter((plan) => !plan.stale);
    // Chapter extraction parses an EPUB per file, so it stays off the request path as it
    // does for a single sync, but bounded instead of one unawaited call per item.
    const extractionFileIds = [...new Set(shared.map((plan) => plan.entry.bookFile.id))];
    void mapWithConcurrency(extractionFileIds, CHAPTER_EXTRACTION_CONCURRENCY, async (bookFileId) => {
      await this.chapterExtractor.extractAndStoreChapters(bookFileId).catch(() => {});
    });

    // Several entries can resolve to one book through different files, and the status and
    // reread heuristics depend on order, so one book's entries stay sequential.
    const byBook = new Map<number, typeof shared>();
    for (const plan of shared) {
      const group = byBook.get(plan.entry.bookFile.bookId);
      if (group) group.push(plan);
      else byBook.set(plan.entry.bookFile.bookId, [plan]);
    }
    await mapWithConcurrency([...byBook.values()], SHARED_PROGRESS_CONCURRENCY, async (group) => {
      for (const plan of group) {
        await this.applySharedProgress(
          userId,
          plan.entry.bookFile,
          { percentage: plan.entry.percentage, progress: plan.entry.progress, timestamp: plan.entry.timestamp },
          plan.previousPercentage,
        );
      }
    });

    return { shared: shared.length, stale: plans.length - shared.length };
  }

  private async applySharedProgress(
    userId: number,
    bookFile: { id: number; bookId: number; libraryId: number },
    data: { percentage: number; progress?: string; timestamp?: number },
    previousPercentage: number | null,
  ) {
    const bookorbitPercentage = toBookorbitPercentage(data.percentage);
    const cfi = data.progress ? await this.convertProgressToCfi(bookFile.id, data.progress) : null;
    await this.repo.upsertReadingProgress(bookFile.id, userId, bookorbitPercentage, cfi, data.progress ?? null);
    await this.bookService.syncKoboReadingStateForExternalProgress(userId, bookFile.id, bookorbitPercentage).catch(() => undefined);
    const strongRereadEvidence = previousPercentage !== null && previousPercentage - bookorbitPercentage >= 10;
    await this.bookService.autoUpdateReadStatusForProgress(userId, bookFile, bookorbitPercentage, {
      origin: 'koreader',
      occurredOn: data.timestamp ? new Date(data.timestamp * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      strongRereadEvidence,
    });
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED, {
      userId,
      bookId: bookFile.bookId,
      bookFileId: bookFile.id,
      progress: bookorbitPercentage,
      source: 'koreader',
    });
  }

  private async convertProgressToCfi(bookFileId: number, xpointer: string): Promise<string | null> {
    try {
      const outcome = await this.positionConverter.xpointerPointToCfi({ bookFileId, pos: xpointer });
      return outcome.status === 'failed' ? null : (outcome.cfi ?? null);
    } catch {
      return null;
    }
  }

  async getProgress(userId: number, documentHash: string) {
    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(userId);
    const bookFile = await this.repo.resolveBookFileByHash(documentHash, accessibleLibraryIds, userId);

    if (!bookFile) return null;

    const latestDevice = await this.repo.getLatestDeviceProgress(bookFile.id, userId);
    const readingProg = await this.repo.getReadingProgress(bookFile.id, userId);

    if (!latestDevice && !readingProg) return null;

    // Compare server timestamps to find the most recent source.
    // reading_progress.updatedAt is only set by the web reader (KOReader sync deliberately
    // preserves the existing value), so this comparison is accurate.
    const deviceTime = latestDevice?.updatedAt?.getTime() ?? 0;
    const readerTime = readingProg?.updatedAt?.getTime() ?? 0;

    if (latestDevice && deviceTime >= readerTime) {
      return {
        document: documentHash,
        percentage: latestDevice.percentage,
        progress: latestDevice.progress ?? '',
        device: latestDevice.device,
        device_id: latestDevice.deviceId,
        timestamp: latestDevice.syncTimestamp ?? Math.floor(deviceTime / 1000),
      };
    }

    if (readingProg) {
      let xpointer = readingProg.koreaderProgress ?? null;
      if (!xpointer && readingProg.cfi) {
        const chapterIndex = this.chapterService.parseChapterIndexFromCfi(readingProg.cfi);
        if (chapterIndex !== null && chapterIndex >= 0) {
          xpointer = `/body/DocFragment[${chapterIndex + 1}]/body`;
        }
      }

      return {
        document: documentHash,
        percentage: toKoreaderPercentage(readingProg.percentage),
        progress: xpointer,
        device: 'web',
        device_id: 'bookorbit-web',
        timestamp: Math.floor(readerTime / 1000),
      };
    }

    return null;
  }

  async getSyncStatus(userId: number): Promise<KoreaderSyncStatus> {
    const [credentials, deviceRows, deviceSettings, totalSyncedBooks, sweepRows, pluginTotals, versionInfo] = await Promise.all([
      this.getCredentials(userId),
      this.repo.getDevicesList(userId),
      this.repo.getDeviceFileNamingPatterns(userId),
      this.repo.getTotalSyncedBooks(userId),
      this.pluginRepo.listSweeps(userId),
      this.pluginRepo.getPluginTotals(userId),
      this.packageService.getVersionInfo(),
    ]);
    const devices = this.mapDevices(deviceRows, deviceSettings);
    const lastSyncAt = devices.length > 0 ? devices[0]!.lastSyncAt : null;
    const latestPluginVersion = versionInfo.pluginVersion === 'unknown' ? null : versionInfo.pluginVersion;
    const settingsByDevice = new Map(deviceSettings.map((setting) => [setting.deviceId, setting]));
    const sweeps = sweepRows.map((row) => {
      const setting = settingsByDevice.get(row.deviceId);
      return {
        deviceId: row.deviceId,
        deviceModel: row.deviceModel,
        pluginVersion: row.pluginVersion,
        latestPluginVersion,
        updateAvailable: isSemverNewer(latestPluginVersion, row.pluginVersion),
        lastSweepAt: row.lastSweepAt.toISOString(),
        lastSweepBooksMatched: row.lastSweepBooksMatched,
        lastSweepPageStats: row.lastSweepPageStats,
        lastSweepAnnotations: row.lastSweepAnnotations,
        fileNamingPattern: setting?.fileNamingPattern ?? null,
        seriesFileNamingPattern: setting?.seriesFileNamingPattern ?? null,
        standaloneFileNamingPattern: setting?.standaloneFileNamingPattern ?? null,
      };
    });
    const pluginUpdateAvailable = sweeps.some((sweep) => sweep.updateAvailable === true);

    return { credentials, devices, totalSyncedBooks, lastSyncAt, latestPluginVersion, pluginUpdateAvailable, sweeps, pluginTotals };
  }

  async getDevices(userId: number): Promise<KoreaderDeviceInfo[]> {
    const [rows, settings] = await Promise.all([this.repo.getDevicesList(userId), this.repo.getDeviceFileNamingPatterns(userId)]);
    return this.mapDevices(rows, settings);
  }

  private mapDevices(
    rows: Awaited<ReturnType<KoreaderRepository['getDevicesList']>>,
    settings: Awaited<ReturnType<KoreaderRepository['getDeviceFileNamingPatterns']>>,
  ): KoreaderDeviceInfo[] {
    const settingsByDevice = new Map(settings.map((setting) => [setting.deviceId, setting]));
    return rows.map((r) => {
      const setting = settingsByDevice.get(r.deviceId);
      return {
        device: r.device,
        deviceId: r.deviceId,
        lastSyncAt: r.lastSyncAt.toISOString(),
        lastBookTitle: r.lastBookTitle,
        fileNamingPattern: setting?.fileNamingPattern ?? null,
        seriesFileNamingPattern: setting?.seriesFileNamingPattern ?? null,
        standaloneFileNamingPattern: setting?.standaloneFileNamingPattern ?? null,
      };
    });
  }

  async getKoreaderUserDefaultPattern(userId: number): Promise<string> {
    return this.fileNamingCache.get(this.fileNamingCacheScope(userId), 'user-default', async () => {
      return (await this.repo.getKoreaderUserDefaultPattern(userId)) ?? DEFAULT_KOREADER_DEVICE_PATTERN;
    });
  }

  async setKoreaderUserDefaultPattern(userId: number, pattern: string): Promise<void> {
    const startedAt = Date.now();
    this.logger.log(`[${FILE_NAMING_EVENT}] [start] userId=${userId} scope=user-default - file naming pattern update started`);

    try {
      await this.repo.setKoreaderUserDefaultPattern(userId, pattern);
      this.fileNamingCache.clearForScope(this.fileNamingCacheScope(userId));
      this.logger.log(
        `[${FILE_NAMING_EVENT}] [end] userId=${userId} scope=user-default durationMs=${Date.now() - startedAt} - file naming pattern updated`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `[${FILE_NAMING_EVENT}] [fail] userId=${userId} scope=user-default durationMs=${Date.now() - startedAt} errorClass=${errorClass} - file naming pattern update failed`,
      );
      throw error;
    }
  }

  getDeviceFileNamingPattern(userId: number, deviceId: string) {
    return this.fileNamingCache.get(this.fileNamingCacheScope(userId), `device:${deviceId}`, () => {
      return this.repo.getDeviceFileNamingPattern(userId, deviceId);
    });
  }

  async setDeviceFileNamingPattern(
    userId: number,
    deviceId: string,
    config: { fileNamingPattern: string; seriesFileNamingPattern: string; standaloneFileNamingPattern: string },
  ): Promise<void> {
    const startedAt = Date.now();
    const safeDeviceId = sanitizeLogValue(deviceId);
    this.logger.log(`[${FILE_NAMING_EVENT}] [start] userId=${userId} deviceId="${safeDeviceId}" scope=device - file naming pattern update started`);

    try {
      await this.repo.setDeviceFileNamingPattern(userId, deviceId, config);
      this.fileNamingCache.clearForScope(this.fileNamingCacheScope(userId));
      this.logger.log(
        `[${FILE_NAMING_EVENT}] [end] userId=${userId} deviceId="${safeDeviceId}" scope=device durationMs=${Date.now() - startedAt} - file naming pattern updated`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `[${FILE_NAMING_EVENT}] [fail] userId=${userId} deviceId="${safeDeviceId}" scope=device durationMs=${Date.now() - startedAt} errorClass=${errorClass} - file naming pattern update failed`,
      );
      throw error;
    }
  }

  async clearDeviceFileNamingPattern(userId: number, deviceId: string): Promise<void> {
    const startedAt = Date.now();
    const safeDeviceId = sanitizeLogValue(deviceId);
    this.logger.log(`[${FILE_NAMING_EVENT}] [start] userId=${userId} deviceId="${safeDeviceId}" scope=device - file naming pattern clear started`);

    try {
      await this.repo.clearDeviceFileNamingPattern(userId, deviceId);
      this.fileNamingCache.clearForScope(this.fileNamingCacheScope(userId));
      this.logger.log(
        `[${FILE_NAMING_EVENT}] [end] userId=${userId} deviceId="${safeDeviceId}" scope=device durationMs=${Date.now() - startedAt} - file naming pattern cleared`,
      );
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `[${FILE_NAMING_EVENT}] [fail] userId=${userId} deviceId="${safeDeviceId}" scope=device durationMs=${Date.now() - startedAt} errorClass=${errorClass} - file naming pattern clear failed`,
      );
      throw error;
    }
  }

  async removeDevice(userId: number, deviceId: string): Promise<void> {
    const startedAt = Date.now();
    const safeDeviceId = sanitizeLogValue(deviceId);
    this.logger.log(`[${DEVICE_REMOVE_EVENT}] [start] userId=${userId} deviceId="${safeDeviceId}" - remove device started`);

    const deletedRows = await this.repo.removeDevice(userId, deviceId);

    if (deletedRows === 0) {
      this.logger.warn(
        `[${DEVICE_REMOVE_EVENT}] [fail] userId=${userId} deviceId="${safeDeviceId}" durationMs=${Date.now() - startedAt} errorClass=NotFoundException error="device not found" - remove device failed`,
      );
      throw new NotFoundException('KOReader device not found');
    }

    this.fileNamingCache.clearForScope(this.fileNamingCacheScope(userId));

    this.logger.log(
      `[${DEVICE_REMOVE_EVENT}] [end] userId=${userId} deviceId="${safeDeviceId}" durationMs=${Date.now() - startedAt} deletedRows=${deletedRows} - remove device completed`,
    );
  }

  private fileNamingCacheScope(userId: number): string {
    return `koreader-file-naming:${userId}`;
  }

  async getBookProgress(userId: number, bookId: number): Promise<KoreaderBookSyncInfo | null> {
    const bookFileId = await this.repo.findBookFileIdByBookId(bookId);
    if (!bookFileId) return null;

    const { deviceProgress, readingProgress } = await this.repo.getBookProgressForDashboard(bookFileId, userId);
    if (deviceProgress.length === 0 && !readingProgress) return null;

    const chapters = await this.repo.getChapters(bookFileId);
    const latestDevice = deviceProgress[0];
    const deviceTime = latestDevice?.updatedAt?.getTime() ?? 0;
    const readerTime = readingProgress?.updatedAt?.getTime() ?? 0;

    const isKoreaderLatest = latestDevice && deviceTime >= readerTime;
    const canonicalPercentage = isKoreaderLatest ? toBookorbitPercentage(latestDevice.percentage ?? 0) : (readingProgress?.percentage ?? 0);
    const canonicalChapterIndex = isKoreaderLatest ? (latestDevice.chapterIndex ?? null) : null;

    const lastWriteTime = await this.repo.getLastFileWriteTime(bookFileId);
    const fileModifiedSinceLastSync =
      !!lastWriteTime &&
      deviceProgress.some((dp) => {
        const dpTime = dp.updatedAt?.getTime() ?? 0;
        return dpTime > 0 && lastWriteTime > new Date(dpTime);
      });

    return {
      bookId,
      bookFileId,
      canonicalPercentage,
      canonicalChapterIndex,
      canonicalChapterTitle: canonicalChapterIndex != null ? (chapters.find((c) => c.chapterIndex === canonicalChapterIndex)?.title ?? null) : null,
      canonicalSource: isKoreaderLatest ? 'koreader' : 'web_reader',
      canonicalUpdatedAt: new Date(Math.max(deviceTime, readerTime)).toISOString(),
      devices: deviceProgress.map((dp) => ({
        device: dp.device,
        deviceId: dp.deviceId,
        percentage: toBookorbitPercentage(dp.percentage ?? 0),
        chapterIndex: dp.chapterIndex,
        chapterTitle: dp.chapterIndex != null ? (chapters.find((c) => c.chapterIndex === dp.chapterIndex)?.title ?? null) : null,
        updatedAt: dp.updatedAt!.toISOString(),
      })),
      fileModifiedSinceLastSync,
    };
  }
}

function toBookorbitPercentage(koreaderPct: number): number {
  return Math.round(koreaderPct * 10000) / 100;
}

function toKoreaderPercentage(bookorbitPct: number): number {
  return Math.round(bookorbitPct * 100) / 10000;
}
