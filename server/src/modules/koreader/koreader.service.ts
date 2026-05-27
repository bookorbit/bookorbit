import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash } from 'crypto';

import type {
  KoreaderBookSyncInfo,
  KoreaderDeviceInfo,
  KoreaderDevicePoint,
  KoreaderHeatmapPoint,
  KoreaderHourPoint,
  KoreaderMonthlyPoint,
  KoreaderSessionLengthBin,
  KoreaderStatsResponse,
  KoreaderStatsSummary,
  KoreaderSyncStatus,
  KoreaderTabData,
  KoreaderTopAnnotatedItem,
  KoreaderTopBookItem,
  KoreaderWeekdayPoint,
} from '@bookorbit/types';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import type { SaveStatsDto } from './dto';

const BCRYPT_ROUNDS = 12;
const SYNC_EVENT = 'koreader.sync';
const CREDENTIALS_EVENT = 'koreader.credentials';
const STATS_EVENT = 'koreader.stats';
const DEFAULT_DEVICE = 'KOReader';
const DAY_MS = 86_400_000;
const HOURS_PER_DAY = 24;
const WEEKDAY_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

@Injectable()
export class KoreaderService {
  private readonly logger = new Logger(KoreaderService.name);

  constructor(
    private readonly repo: KoreaderRepository,
    private readonly chapterService: KoreaderChapterService,
    private readonly chapterExtractor: KoreaderChapterExtractorService,
    private readonly userBookStatusService: UserBookStatusService,
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

    const chapterIndex = this.chapterService.parseChapterIndexFromProgress(data.progress ?? null);

    this.chapterExtractor.extractAndStoreChapters(bookFile.id).catch(() => {});

    await this.repo.upsertDeviceProgress({
      bookFileId: bookFile.id,
      userId,
      device,
      deviceId,
      percentage: data.percentage,
      progress: data.progress ?? null,
      chapterIndex,
      syncTimestamp: data.timestamp ?? null,
    });

    const bookorbitPercentage = toBookorbitPercentage(data.percentage);
    await this.repo.upsertReadingProgress(bookFile.id, userId, bookorbitPercentage);
    await this.userBookStatusService.autoUpdate(userId, bookFile.bookId, bookorbitPercentage);

    this.logger.debug(
      `[${SYNC_EVENT}] [end] userId=${userId} bookFileId=${bookFile.id} device=${device} durationMs=${Date.now() - startedAt} percentage=${data.percentage} - save progress completed`,
    );

    return { document: data.document, timestamp: data.timestamp ?? Math.floor(Date.now() / 1000) };
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
      // Convert the web reader's CFI spine index to a KOReader-compatible XPointer chapter start.
      // The CFI encodes the spine item index directly (no file I/O needed — spine data is
      // pre-computed in book_file_chapters during scan). KOReader will navigate to the
      // beginning of the correct chapter. Percentage drives fine-grained position within it.
      let xpointer: string | null = null;
      if (readingProg.cfi) {
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
    const [credentials, devices, totalSyncedBooks, aggregateStats] = await Promise.all([
      this.getCredentials(userId),
      this.getDevices(userId),
      this.repo.getTotalSyncedBooks(userId),
      this.repo.getKoreaderAggregateStats(userId),
    ]);
    const lastSyncAt = devices.length > 0 ? devices[0]!.lastSyncAt : null;

    return {
      credentials,
      devices,
      totalSyncedBooks,
      lastSyncAt,
      booksWithStats: aggregateStats.booksWithStats,
      totalReadingSeconds: aggregateStats.totalReadingSeconds,
    };
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

  async saveStats(userId: number, dto: SaveStatsDto): Promise<KoreaderStatsResponse> {
    const startedAt = Date.now();
    this.logger.log(`[${STATS_EVENT}] [start] userId=${userId} bookCount=${dto.books.length} - stats sync started`);

    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(userId);
    let processed = 0;
    let unmatched = 0;

    for (const bookDto of dto.books) {
      const docKey = bookDto.md5 && bookDto.md5.length > 0 ? bookDto.md5 : bookDto.document;
      const bookFile = await this.repo.resolveBookFileByHash(docKey, accessibleLibraryIds);

      if (!bookFile) {
        unmatched++;
        continue;
      }

      const lastOpenAt = bookDto.last_open && bookDto.last_open > 0 ? new Date(bookDto.last_open * 1000) : null;

      await this.repo.upsertKoreaderBookStats({
        bookFileId: bookFile.id,
        userId,
        totalReadSecs: bookDto.total_read_secs ?? 0,
        totalReadPages: bookDto.total_read_pages ?? 0,
        highlightsCount: bookDto.highlights ?? 0,
        notesCount: bookDto.notes ?? 0,
        lastOpenAt,
      });

      const validSessions = (bookDto.page_sessions ?? [])
        .filter((s) => s.duration > 0 && s.total_pages > 0)
        .map((s) => ({
          bookFileId: bookFile.id,
          userId,
          sessionHash: createHash('sha256').update(`${userId}:${bookFile.id}:${s.page}:${s.start_time}`).digest('hex'),
          page: s.page,
          startedAt: new Date(s.start_time * 1000),
          durationSeconds: s.duration,
          totalPages: s.total_pages,
        }));

      await this.repo.bulkInsertKoreaderReadingSessions(validSessions);

      if (lastOpenAt) {
        await this.userBookStatusService.setStartedAtIfNull(userId, bookFile.bookId, lastOpenAt);
      }

      processed++;
    }

    this.logger.log(
      `[${STATS_EVENT}] [end] userId=${userId} bookCount=${dto.books.length} processed=${processed} unmatched=${unmatched} durationMs=${Date.now() - startedAt} - stats sync completed`,
    );

    return { processed, unmatched };
  }

  async getKoreaderTabData(userId: number, bookId: number, page: number, pageSize: number): Promise<KoreaderTabData | null> {
    const bookFileId = await this.repo.findBookFileIdByBookId(bookId);
    if (!bookFileId) return null;

    const statsRow = await this.repo.getKoreaderBookStats(bookFileId, userId);
    if (!statsRow) return null;

    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 100);

    const [{ rows, total }, dailySummary] = await Promise.all([
      this.repo.getKoreaderReadingSessions(bookFileId, userId, safePage, safePageSize),
      this.repo.getKoreaderSessionsDailySummary(bookFileId, userId),
    ]);

    return {
      stats: {
        bookFileId,
        totalReadSecs: statsRow.totalReadSecs,
        totalReadPages: statsRow.totalReadPages,
        highlightsCount: statsRow.highlightsCount,
        notesCount: statsRow.notesCount,
        lastOpenAt: statsRow.lastOpenAt?.toISOString() ?? null,
        updatedAt: statsRow.updatedAt.toISOString(),
      },
      sessions: rows.map((r) => ({
        id: r.id,
        page: r.page,
        startedAt: r.startedAt.toISOString(),
        durationSeconds: r.durationSeconds,
        totalPages: r.totalPages,
      })),
      dailySummary,
      total,
      page: safePage,
      pageSize: safePageSize,
    };
  }

  async getKoreaderAggregateSyncStats(userId: number): Promise<{ booksWithStats: number; totalReadingSeconds: number }> {
    return this.repo.getKoreaderAggregateStats(userId);
  }

  async getKoreaderStatsSummary(userId: number): Promise<KoreaderStatsSummary> {
    const [activeDates, totals] = await Promise.all([this.repo.getKoreaderStatsActiveDates(userId), this.repo.getKoreaderStatsTotals(userId)]);

    const { currentStreak, longestStreak } = computeStreaks(normalizeStreakDates(activeDates));

    return {
      totalReadSecs: totals.totalDurationSecs,
      totalSessions: totals.totalSessions,
      totalHighlights: totals.totalHighlights,
      totalNotes: totals.totalNotes,
      booksWithStats: totals.booksWithStats,
      currentStreak,
      longestStreak,
    };
  }

  async getKoreaderActivityHeatmap(userId: number): Promise<KoreaderHeatmapPoint[]> {
    return this.repo.getKoreaderActivityHeatmap(userId);
  }

  async getKoreaderMonthlyReading(userId: number): Promise<KoreaderMonthlyPoint[]> {
    return this.repo.getKoreaderMonthlyReading(userId);
  }

  async getKoreaderTimeOfDay(userId: number): Promise<KoreaderHourPoint[]> {
    const rows = await this.repo.getKoreaderTimeOfDay(userId);
    const durationsByHour = new Map(rows.map((row) => [row.hour, row.durationSeconds]));
    return Array.from({ length: HOURS_PER_DAY }, (_, hour) => ({
      hour,
      durationSeconds: durationsByHour.get(hour) ?? 0,
    }));
  }

  async getKoreaderSessionLengths(userId: number): Promise<KoreaderSessionLengthBin[]> {
    return this.repo.getKoreaderSessionLengths(userId);
  }

  async getKoreaderTopBooks(userId: number): Promise<KoreaderTopBookItem[]> {
    return this.repo.getKoreaderTopBooks(userId);
  }

  async getKoreaderTopAnnotated(userId: number): Promise<KoreaderTopAnnotatedItem[]> {
    return this.repo.getKoreaderTopAnnotated(userId);
  }

  async getKoreaderWeeklyRhythm(userId: number): Promise<KoreaderWeekdayPoint[]> {
    const rows = await this.repo.getKoreaderWeeklyRhythm(userId);
    const durationsByDow = new Map(rows.map((row) => [row.dow, row.durationSeconds]));
    return WEEKDAY_LABELS.map((label, index) => {
      const dow = index + 1;
      return { dow, label, durationSeconds: durationsByDow.get(dow) ?? 0 };
    });
  }

  async getKoreaderDevices(userId: number): Promise<KoreaderDevicePoint[]> {
    return this.repo.getKoreaderDevices(userId);
  }
}

function toBookorbitPercentage(koreaderPct: number): number {
  return Math.round(koreaderPct * 10000) / 100;
}

function toKoreaderPercentage(bookorbitPct: number): number {
  return Math.round(bookorbitPct * 100) / 10000;
}

function computeStreaks(sortedDates: string[]): { currentStreak: number; longestStreak: number } {
  if (sortedDates.length === 0) return { currentStreak: 0, longestStreak: 0 };

  let longestStreak = 1;
  let currentRun = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]!);
    const curr = new Date(sortedDates[i]!);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / DAY_MS);
    if (diffDays === 1) {
      currentRun++;
      if (currentRun > longestStreak) longestStreak = currentRun;
    } else if (diffDays > 1) {
      currentRun = 1;
    }
  }

  const todayUtc = new Date().toISOString().slice(0, 10);
  const yesterdayUtc = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
  const lastDate = sortedDates[sortedDates.length - 1]!;
  const isActive = lastDate === todayUtc || lastDate === yesterdayUtc;

  if (!isActive) return { currentStreak: 0, longestStreak };

  let streak = 1;
  for (let i = sortedDates.length - 2; i >= 0; i--) {
    const curr = new Date(sortedDates[i + 1]!);
    const prev = new Date(sortedDates[i]!);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / DAY_MS);
    if (diffDays === 1) streak++;
    else break;
  }

  return { currentStreak: streak, longestStreak };
}

function normalizeStreakDates(dates: string[]): string[] {
  const unique = new Set<string>();
  for (const day of dates) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) unique.add(day);
  }
  return [...unique].sort();
}
