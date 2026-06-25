import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash } from 'crypto';

import type { KoreaderBookSyncInfo, KoreaderDeviceInfo, KoreaderSyncStatus } from '@bookorbit/types';
import { isSemverNewer } from '../../common/utils/semver.utils';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderPackageService } from './koreader-package.service';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { BookService } from '../book/book.service';
import { PositionConverterService } from '../position-converter/position-converter.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../achievement/achievement-events.service';

const BCRYPT_ROUNDS = 12;
const SYNC_EVENT = 'koreader.sync';
const CREDENTIALS_EVENT = 'koreader.credentials';
const DEFAULT_DEVICE = 'KOReader';

@Injectable()
export class KoreaderService {
  private readonly logger = new Logger(KoreaderService.name);

  constructor(
    private readonly repo: KoreaderRepository,
    private readonly pluginRepo: KoreaderPluginRepository,
    private readonly chapterService: KoreaderChapterService,
    private readonly chapterExtractor: KoreaderChapterExtractorService,
    private readonly userBookStatusService: UserBookStatusService,
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
    const bookFile = await this.repo.resolveBookFileByHash(data.document, accessibleLibraryIds);

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
    bookFile: { id: number; bookId: number },
    data: { percentage: number; progress?: string; device: string; deviceId: string; timestamp?: number },
    options?: { skipSharedProgress?: boolean },
  ) {
    const chapterIndex = this.chapterService.parseChapterIndexFromProgress(data.progress ?? null);

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

    const bookorbitPercentage = toBookorbitPercentage(data.percentage);
    const cfi = data.progress ? await this.convertProgressToCfi(bookFile.id, data.progress) : null;
    await this.repo.upsertReadingProgress(bookFile.id, userId, bookorbitPercentage, cfi, data.progress ?? null);
    await this.bookService.syncKoboReadingStateForExternalProgress(userId, bookFile.id, bookorbitPercentage).catch(() => undefined);
    await this.userBookStatusService.autoUpdate(userId, bookFile.bookId, bookorbitPercentage);
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
    const bookFile = await this.repo.resolveBookFileByHash(documentHash, accessibleLibraryIds);

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
    const [credentials, devices, totalSyncedBooks, sweepRows, pluginTotals, versionInfo] = await Promise.all([
      this.getCredentials(userId),
      this.getDevices(userId),
      this.repo.getTotalSyncedBooks(userId),
      this.pluginRepo.listSweeps(userId),
      this.pluginRepo.getPluginTotals(userId),
      this.packageService.getVersionInfo(),
    ]);
    const lastSyncAt = devices.length > 0 ? devices[0]!.lastSyncAt : null;
    const latestPluginVersion = versionInfo.pluginVersion === 'unknown' ? null : versionInfo.pluginVersion;
    const sweeps = sweepRows.map((row) => ({
      deviceId: row.deviceId,
      deviceModel: row.deviceModel,
      pluginVersion: row.pluginVersion,
      latestPluginVersion,
      updateAvailable: isSemverNewer(latestPluginVersion, row.pluginVersion),
      lastSweepAt: row.lastSweepAt.toISOString(),
      lastSweepBooksMatched: row.lastSweepBooksMatched,
      lastSweepPageStats: row.lastSweepPageStats,
      lastSweepAnnotations: row.lastSweepAnnotations,
    }));
    const pluginUpdateAvailable = sweeps.some((sweep) => sweep.updateAvailable === true);

    return { credentials, devices, totalSyncedBooks, lastSyncAt, latestPluginVersion, pluginUpdateAvailable, sweeps, pluginTotals };
  }

  async getDevices(userId: number): Promise<KoreaderDeviceInfo[]> {
    const rows = await this.repo.getDevicesList(userId);
    return rows.map((r) => ({
      device: r.device,
      deviceId: r.deviceId,
      lastSyncAt: r.lastSyncAt.toISOString(),
      lastBookTitle: r.lastBookTitle,
    }));
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
