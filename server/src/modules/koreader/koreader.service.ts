import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { hash as bcryptHash } from 'bcryptjs';
import { createHash } from 'crypto';

import { DEFAULT_KOREADER_DEVICE_PATTERN, type KoreaderBookSyncInfo, type KoreaderDeviceInfo, type KoreaderSyncStatus } from '@bookorbit/types';
import { StatsCache } from '../../common/cache/stats-cache';
import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { syncEstimateSessionId } from '../../common/utils/sync-estimate-session.utils';
import { isSemverNewer } from '../../common/utils/semver.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { KoreaderRepository, type DeviceProgressUpsert } from './koreader.repository';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderPackageService } from './koreader-package.service';
import { pluginRequiresManualUpdate } from './koreader-plugin-update.util';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { isPagedReadingFormat, parseKoreaderPageNumber } from './koreader-progress-position.util';
import { BookService } from '../book/book.service';
import { PositionConverterService } from '../position-converter/position-converter.service';
import { ReadingSessionService } from '../reading-session/reading-session.service';
import { AchievementEventsService, ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED } from '../achievement/achievement-events.service';

const BCRYPT_ROUNDS = 12;
const SYNC_EVENT = 'koreader.sync';
const SYNC_SESSION_EVENT = 'koreader.sync_session';
const CREDENTIALS_EVENT = 'koreader.credentials';
const DEVICE_REMOVE_EVENT = 'koreader.device_remove';
const DEVICE_RETIRE_EVENT = 'koreader.device_retire';
const FILE_NAMING_EVENT = 'koreader.file_naming';
const DEFAULT_DEVICE = 'KOReader';
const FILE_NAMING_CACHE_TTL_MS = 30_000;
const FILE_NAMING_CACHE_MAX_ENTRIES = 5_000;
const SHARED_PROGRESS_CONCURRENCY = 4;
const CHAPTER_EXTRACTION_CONCURRENCY = 2;
const RESET_DEVICE = 'web';
const RESET_DEVICE_ID = 'bookorbit-web';
/** The start of a paged document, in the page-number form KOReader sends for those formats. */
const RESET_PAGED_POSITION = '1';
/** The start of a reflowable document, in the same xpointer shape the web branch synthesises. */
const RESET_REFLOWABLE_POSITION = '/body/DocFragment[1]/body';
/**
 * Only used when a device reports no position at all. A percentage cannot carry this on its
 * own: page 1 of a hundred-page comic already reads as 1%, so any threshold tight enough to
 * mean "the start" of a long book would never be reachable on a short one, and that device
 * would stay held forever.
 */
const RESET_CONVERGED_PERCENTAGE_FALLBACK = 0.01;
/**
 * Bounds on a reading session estimated from the gap between two sync pushes. Below the floor
 * the gap is a page turn rather than a sitting; above the ceiling it is mostly idle time, and
 * recording it whole would credit a night's sleep as reading.
 */
const MIN_SYNC_SESSION_SECONDS = 60;
const MAX_SYNC_SESSION_SECONDS = 30 * 60;
/**
 * How long a device is still treated as reporting its own page timings after its last sweep.
 * Bounded rather than permanent: a plugin that is removed, or quietly stops working, would
 * otherwise leave that device unable to have its reading recorded ever again. An estimate that
 * does turn out to overlap a later sweep's measured session is retired by that sweep.
 */
const PLUGIN_SWEEP_SILENCE_MS = 30 * 24 * 60 * 60 * 1000;

/** `format` routes the incoming position to the cfi or the pageNumber column. */
export interface KoreaderProgressBookFile {
  id: number;
  bookId: number;
  libraryId: number;
  format: string | null;
}

/** What one applied sync push changed, for callers that have to reason about the move it made. */
export interface KoreaderProgressApplyResult {
  /** Whether shared reading progress moved; false when the push was held behind a reset. */
  shared: boolean;
  /** BookOrbit-scale position held before this push, across every device of this user. */
  previousPercentage: number | null;
  /** BookOrbit-scale position this push wrote. */
  percentage: number;
  /** When this same device last pushed a position for this file, before this push. */
  deviceLastPushedAt: Date | null;
  /** BookOrbit-scale position this same device last reported for this file, before this push. */
  deviceLastPercentage: number | null;
}

export interface BulkProgressEntry {
  bookFile: KoreaderProgressBookFile;
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
    private readonly readingSessions: ReadingSessionService,
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
    user: RequestUser,
    data: { document: string; percentage: number; progress?: string; device?: string; device_id?: string; timestamp?: number },
  ) {
    const userId = user.id;
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

    const applied = await this.applyProgressForResolvedFile(userId, bookFile, {
      percentage: data.percentage,
      progress: data.progress,
      device,
      deviceId,
      timestamp: data.timestamp,
    });

    await this.recordSyncedReadingSession(user, bookFile, deviceId, applied);

    this.logger.log(
      `[${SYNC_EVENT}] [end] userId=${userId} bookFileId=${bookFile.id} device=${device} durationMs=${Date.now() - startedAt} percentage=${data.percentage} - save progress completed`,
    );

    return { document: data.document, timestamp: data.timestamp ?? Math.floor(Date.now() / 1000) };
  }

  async applyProgressForResolvedFile(
    userId: number,
    bookFile: KoreaderProgressBookFile,
    data: { percentage: number; progress?: string; device: string; deviceId: string; timestamp?: number },
    options?: { skipSharedProgress?: boolean },
  ): Promise<KoreaderProgressApplyResult> {
    const chapterIndex = this.chapterService.parseChapterIndexFromProgress(data.progress ?? null);

    const previousDeviceProgress = await this.repo.getLatestDeviceProgress(bookFile.id, userId);
    // No row at all means no row for this device either, and the newest one is this device's own
    // whenever a single device syncs the book, so the second lookup is the multi-device case only.
    const ownDeviceProgress = !previousDeviceProgress
      ? null
      : previousDeviceProgress.deviceId === data.deviceId
        ? previousDeviceProgress
        : await this.repo.getDeviceProgressForDevice(bookFile.id, userId, data.deviceId);

    const result: KoreaderProgressApplyResult = {
      shared: false,
      previousPercentage: previousDeviceProgress?.percentage != null ? toBookorbitPercentage(previousDeviceProgress.percentage) : null,
      percentage: toBookorbitPercentage(data.percentage),
      deviceLastPushedAt: ownDeviceProgress?.updatedAt ?? null,
      deviceLastPercentage: ownDeviceProgress?.percentage != null ? toBookorbitPercentage(ownDeviceProgress.percentage) : null,
    };

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

    // A retired device that syncs again is back in service. Clearing the marker keeps it
    // visible rather than letting activity accrue against a device the user cannot see.
    await this.repo.restoreDevice(userId, data.deviceId);

    if (options?.skipSharedProgress) return result;

    if (!(await this.resolveResetHold(userId, bookFile, data))) return result;

    await this.applySharedProgress(userId, bookFile, data, result.previousPercentage);
    result.shared = true;
    return result;
  }

  /**
   * Turns an advancing sync push into a reading session, for devices that can offer nothing
   * better.
   *
   * The kosync protocol carries a position and nothing else: no page timings, no session
   * boundaries, no idle detection. So the only evidence of reading time a plain KOReader
   * install ever produces is the interval between two of its own pushes, and without this the
   * reading log, the streak and every daily statistic show that device as having read nothing
   * at all.
   *
   * The interval is capped rather than trusted. A device that goes quiet overnight and pushes
   * again in the morning has not been reading the whole time, and the cap is what keeps a long
   * idle gap from being recorded as a long read.
   *
   * Both the interval and the distance read come from this device's own previous row, so a
   * second device syncing the same book in between cannot lend it either one.
   *
   * A device that has swept recently is excluded. It uploads KOReader's own page timings, which
   * produce real sessions for the same reading, and estimating from its pushes as well would
   * count that reading twice. The exclusion lapses once the device stops sweeping, so a removed
   * or broken plugin does not silently retire the device from every statistic.
   */
  private async recordSyncedReadingSession(
    user: RequestUser,
    bookFile: KoreaderProgressBookFile,
    deviceId: string,
    applied: KoreaderProgressApplyResult,
  ): Promise<void> {
    if (!applied.shared || applied.deviceLastPushedAt === null || applied.deviceLastPercentage === null) return;

    // Measured against this device's own last position, not the newest one across the shelf.
    // Another device syncing a stale position in between makes it the newest row, and reading
    // on from there would be scored as the whole distance between the two devices.
    const progressDelta = applied.percentage - applied.deviceLastPercentage;
    if (progressDelta <= 0) return;

    const endedAt = new Date();
    const elapsedSeconds = Math.floor((endedAt.getTime() - applied.deviceLastPushedAt.getTime()) / 1000);
    if (elapsedSeconds < MIN_SYNC_SESSION_SECONDS) return;

    const durationSeconds = Math.min(elapsedSeconds, MAX_SYNC_SESSION_SECONDS);
    const startedAt = new Date(endedAt.getTime() - durationSeconds * 1000);

    const operationStartedAt = Date.now();

    try {
      if (await this.pluginRepo.hasSweepSince(user.id, deviceId, new Date(endedAt.getTime() - PLUGIN_SWEEP_SILENCE_MS))) return;

      const sessionId = syncEstimateSessionId(deviceId, bookFile.id, applied.deviceLastPushedAt.getTime());

      const result = await this.readingSessions.recordSyncedSession({
        userId: user.id,
        bookFileId: bookFile.id,
        sessionId,
        startedAt,
        endedAt,
        durationSeconds,
        progressDelta,
        endProgress: applied.percentage,
        source: 'koreader',
        timeZone: resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC'),
      });

      this.logger.log(
        `[${SYNC_SESSION_EVENT}] [end] userId=${user.id} bookFileId=${bookFile.id} deviceId="${sanitizeLogValue(deviceId)}" durationMs=${Date.now() - operationStartedAt} durationSeconds=${durationSeconds} elapsedSeconds=${elapsedSeconds} outcome=${result.kind}${result.kind === 'skipped' ? ` reason=${result.reason}` : ''} - reading session estimated from sync progress`,
      );
    } catch (error) {
      // A device retries the whole push on failure, so a session that cannot be stored must not
      // take the position write down with it.
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      const message = sanitizeLogValue(error instanceof Error ? error.message : 'unknown error');
      this.logger.warn(
        `[${SYNC_SESSION_EVENT}] [fail] userId=${user.id} bookFileId=${bookFile.id} deviceId="${sanitizeLogValue(deviceId)}" durationMs=${Date.now() - operationStartedAt} errorClass=${errorClass} error="${message}" - estimating a reading session from sync progress failed`,
      );
    }
  }

  /**
   * Decides whether a pushed position may move shared progress while a reset is outstanding.
   *
   * The push clock cannot answer this. KOReader stamps a push with the time it sends it, not
   * the time the position was reached, so a device replaying a position from before the reset
   * looks exactly as recent as one that genuinely read on afterwards. What separates them is
   * whether that device has been observed at the reset position since the reset was made.
   *
   * The judgement is per device. Serving the reset proves nothing, because both clients can
   * classify it as a backward sync and drop it without telling anyone, so only the device's
   * own push counts, and one device converging says nothing about the others.
   */
  private async resolveResetHold(
    userId: number,
    bookFile: KoreaderProgressBookFile,
    data: { percentage: number; progress?: string; device: string; deviceId: string },
  ): Promise<boolean> {
    const resetAt = await this.repo.getProgressReset(bookFile.id, userId);
    if (!resetAt) return true;

    const atStart = isResetStartPosition(bookFile.format, data.percentage, data.progress);
    const converged = await this.repo.getConvergedResetDeviceIds(bookFile.id, userId);
    if (converged.has(data.deviceId)) {
      // This device took the reset and has since read on, so the reset has done its work and
      // must stop being served. The pull carries no device identity, so a marker kept alive
      // for some other device would be answered to this one too, and it would be asked to
      // jump back to the start on every sync for the rest of the book.
      if (!atStart) await this.repo.clearProgressReset(bookFile.id, userId);
      return true;
    }

    if (atStart) {
      await this.repo.recordResetConvergence(bookFile.id, userId, data.deviceId);
      return true;
    }

    this.logger.log(
      `[${SYNC_EVENT}] [end] userId=${userId} bookFileId=${bookFile.id} device="${sanitizeLogValue(data.device)}" deviceId="${sanitizeLogValue(data.deviceId)}" percentage=${data.percentage} resetAt=${resetAt.toISOString()} held=true - device position recorded but held behind a pending reset`,
    );
    return false;
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
  ): Promise<{ shared: number; stale: number; held: number }> {
    if (entries.length === 0) return { shared: 0, stale: 0, held: 0 };

    const bookFileIds = entries.map((entry) => entry.bookFile.id);
    const [deviceRows, readerUpdatedAt, resets, convergedByFile] = await Promise.all([
      this.repo.getDeviceProgressForFiles(bookFileIds, userId),
      this.repo.getReadingProgressUpdatedAtForFiles(bookFileIds, userId),
      this.repo.getProgressResetsForFiles(bookFileIds, userId),
      this.repo.getConvergedResetDeviceIdsForFiles(bookFileIds, userId),
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
      return { entry, stale, previousPercentage, heldByReset: false };
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
    await this.repo.restoreDevice(userId, device.deviceId);

    // A sweep carries the device's whole shelf, so a book the user reset in BookOrbit shows up
    // here holding its pre-reset sidecar position. Same judgement as a single push, for the one
    // device this sweep speaks for.
    const convergedResetFileIds = new Set<number>();
    const retiredResetFileIds = new Set<number>();
    for (const plan of plans) {
      if (plan.stale) continue;
      const bookFileId = plan.entry.bookFile.id;
      if (!resets.get(bookFileId)) continue;
      const atStart = isResetStartPosition(plan.entry.bookFile.format, plan.entry.percentage, plan.entry.progress);
      if (convergedByFile.get(bookFileId)?.has(device.deviceId)) {
        if (!atStart) retiredResetFileIds.add(bookFileId);
        continue;
      }
      if (atStart) convergedResetFileIds.add(bookFileId);
      else plan.heldByReset = true;
    }
    for (const bookFileId of convergedResetFileIds) await this.repo.recordResetConvergence(bookFileId, userId, device.deviceId);
    for (const bookFileId of retiredResetFileIds) await this.repo.clearProgressReset(bookFileId, userId);

    const held = plans.filter((plan) => plan.heldByReset).length;
    if (held > 0) {
      this.logger.log(
        `[${SYNC_EVENT}] [end] userId=${userId} deviceId="${sanitizeLogValue(device.deviceId)}" held=${held} - bulk positions recorded but held behind pending resets`,
      );
    }

    const shared = plans.filter((plan) => !plan.stale && !plan.heldByReset);
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

    return { shared: shared.length, stale: plans.filter((plan) => plan.stale).length, held };
  }

  private async applySharedProgress(
    userId: number,
    bookFile: KoreaderProgressBookFile,
    data: { percentage: number; progress?: string; timestamp?: number },
    previousPercentage: number | null,
  ) {
    const bookorbitPercentage = toBookorbitPercentage(data.percentage);
    // KOReader reports a paged document's position as a page number and a reflowable one's as
    // an xpointer, and the web reader resumes from a different column for each, so the format
    // decides which one this position becomes.
    const paged = isPagedReadingFormat(bookFile.format);
    const cfi = !paged && data.progress ? await this.convertProgressToCfi(bookFile.id, data.progress) : null;
    const pageNumber = paged ? parseKoreaderPageNumber(data.progress) : null;
    await this.repo.upsertReadingProgress({
      bookFileId: bookFile.id,
      userId,
      percentage: bookorbitPercentage,
      cfi,
      xpointer: data.progress ?? null,
      pageNumber,
    });
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
      if (outcome.status === 'failed') {
        this.logger.warn(
          `[koreader.progress_cfi_conversion] [fail] bookFileId=${bookFileId} reason=${sanitizeLogValue(outcome.reason ?? 'unknown')} - xpointer to cfi conversion failed, progress degrades to percent`,
        );
        return null;
      }
      return outcome.cfi ?? null;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(
        `[koreader.progress_cfi_conversion] [fail] bookFileId=${bookFileId} errorClass=${err.constructor.name} error="${sanitizeLogValue(err.message)}" - xpointer to cfi conversion threw, progress degrades to percent`,
      );
      return null;
    }
  }

  async getProgress(userId: number, documentHash: string) {
    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(userId);
    const bookFile = await this.repo.resolveBookFileByHash(documentHash, accessibleLibraryIds, userId);

    if (!bookFile) return null;

    // An outstanding reset is answered before anything stored, and answered with a position
    // rather than with silence. An empty body reads as "this server knows nothing about your
    // book", which is the one reply that leaves the device certain its own position is the
    // only one there is, and it pushes it back. Zero attributed to BookOrbit is a position the
    // device can act on, and the plugin's default forward strategy puts it to the reader.
    const resetAt = await this.repo.getProgressReset(bookFile.id, userId);
    if (resetAt) {
      this.logger.log(
        `[${SYNC_EVENT}] [end] userId=${userId} bookFileId=${bookFile.id} resetAt=${resetAt.toISOString()} - reset position served to device`,
      );
      return {
        document: documentHash,
        percentage: 0,
        // A real position, not an empty string: KOReader's own kosync plugin feeds this
        // straight to GotoPage or GotoXPointer with no percentage fallback, so an empty value
        // leaves it sitting exactly where it was. This is also the position a converged push
        // has to report back, so what we ask for and what we accept are the same thing.
        progress: isPagedReadingFormat(bookFile.format) ? RESET_PAGED_POSITION : RESET_REFLOWABLE_POSITION,
        device: RESET_DEVICE,
        device_id: RESET_DEVICE_ID,
        // Stamped now rather than when the user reset, because a live marker is a standing
        // instruction. Both clients compare this against their last page turn and default
        // backward syncs to disabled, so the original time would lose that comparison on any
        // pull deferred past a page turn, and be discarded without ever prompting.
        timestamp: Math.floor(Date.now() / 1000),
      };
    }

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
    const [credentials, deviceRows, deviceSettings, totalSyncedBooks, sweepRows, pluginTotals, versionInfo, retirements] = await Promise.all([
      this.getCredentials(userId),
      this.repo.getDevicesList(userId),
      this.repo.getDeviceFileNamingPatterns(userId),
      this.repo.getTotalSyncedBooks(userId),
      this.pluginRepo.listSweeps(userId),
      this.pluginRepo.getPluginTotals(userId),
      this.packageService.getVersionInfo(),
      this.repo.listRetiredDeviceIds(userId),
    ]);
    const devices = this.mapDevices(deviceRows, deviceSettings);
    // Rows are ordered newest first, so the first active device is the last sync that still counts.
    const lastSyncAt = devices.find((device) => device.retiredAt === null)?.lastSyncAt ?? null;
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
        requiresManualUpdate: pluginRequiresManualUpdate(row.pluginVersion),
        lastSweepAt: row.lastSweepAt.toISOString(),
        lastSweepBooksMatched: row.lastSweepBooksMatched,
        lastSweepPageStats: row.lastSweepPageStats,
        lastSweepAnnotations: row.lastSweepAnnotations,
        retiredAt: retirements.get(row.deviceId)?.toISOString() ?? null,
        fileNamingPattern: setting?.fileNamingPattern ?? null,
        seriesFileNamingPattern: setting?.seriesFileNamingPattern ?? null,
        standaloneFileNamingPattern: setting?.standaloneFileNamingPattern ?? null,
      };
    });
    const pluginUpdateAvailable = sweeps.some((sweep) => sweep.retiredAt === null && sweep.updateAvailable === true);

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
        retiredAt: r.retiredAt?.toISOString() ?? null,
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

  /**
   * Retiring hides a decommissioned device without touching a byte of what it synced.
   * Restoring is the same call with `retired: false`, and a device that syncs again
   * restores itself.
   */
  async setDeviceRetired(userId: number, deviceId: string, retired: boolean): Promise<void> {
    const startedAt = Date.now();
    const safeDeviceId = sanitizeLogValue(deviceId);

    if (!(await this.repo.deviceExists(userId, deviceId))) {
      this.logger.warn(
        `[${DEVICE_RETIRE_EVENT}] [fail] userId=${userId} deviceId="${safeDeviceId}" retired=${retired} durationMs=${Date.now() - startedAt} errorClass=NotFoundException error="device not found" - set device retired failed`,
      );
      throw new NotFoundException('KOReader device not found');
    }

    if (retired) await this.repo.retireDevice(userId, deviceId);
    else await this.repo.restoreDevice(userId, deviceId);

    this.logger.log(
      `[${DEVICE_RETIRE_EVENT}] [end] userId=${userId} deviceId="${safeDeviceId}" retired=${retired} durationMs=${Date.now() - startedAt} - set device retired completed`,
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
    const readerTime = readingProgress?.updatedAt?.getTime() ?? 0;

    // A held device's row can be newer than everything else and still not be the canonical
    // position, because it is a position the user asked to discard. Scoped to the devices
    // actually being held: once a device takes the reset, its reading counts again even though
    // the marker stays live for whichever devices have not.
    const resetAt = await this.repo.getProgressReset(bookFileId, userId);
    const convergedDeviceIds = resetAt ? await this.repo.getConvergedResetDeviceIds(bookFileId, userId) : null;
    const isHeld = (deviceId: string) => convergedDeviceIds !== null && !convergedDeviceIds.has(deviceId);
    const heldDevices = deviceProgress.filter((dp) => isHeld(dp.deviceId));
    const liveDevice = deviceProgress.find((dp) => !isHeld(dp.deviceId));
    const liveDeviceTime = liveDevice?.updatedAt?.getTime() ?? 0;
    const isKoreaderLatest = liveDevice && liveDeviceTime >= readerTime;
    const canonicalPercentage = isKoreaderLatest ? toBookorbitPercentage(liveDevice.percentage ?? 0) : (readingProgress?.percentage ?? 0);
    const canonicalTime = isKoreaderLatest ? Math.max(liveDeviceTime, readerTime) : readerTime;
    const canonicalChapterIndex = isKoreaderLatest ? (liveDevice.chapterIndex ?? null) : null;

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
      canonicalUpdatedAt: new Date(canonicalTime).toISOString(),
      devices: deviceProgress.map((dp) => ({
        device: dp.device,
        deviceId: dp.deviceId,
        percentage: toBookorbitPercentage(dp.percentage ?? 0),
        chapterIndex: dp.chapterIndex,
        chapterTitle: dp.chapterIndex != null ? (chapters.find((c) => c.chapterIndex === dp.chapterIndex)?.title ?? null) : null,
        updatedAt: dp.updatedAt!.toISOString(),
      })),
      fileModifiedSinceLastSync,
      heldByReset: heldDevices.map((dp) => ({
        device: dp.device,
        deviceId: dp.deviceId,
        percentage: toBookorbitPercentage(dp.percentage ?? 0),
        updatedAt: dp.updatedAt!.toISOString(),
      })),
    };
  }

  /**
   * Accepts a held device's position and stops holding it. The reader answered the prompt on
   * the device and said no, and without this the only ways out are reading the book in
   * BookOrbit or resetting again, neither of which is reachable from seeing the hold.
   */
  async releaseResetHold(userId: number, bookId: number, deviceId: string): Promise<void> {
    const startedAt = Date.now();
    const accessibleLibraryIds = await this.repo.getAccessibleLibraryIds(userId);
    const bookFile = await this.repo.findProgressBookFileByBookId(bookId, accessibleLibraryIds);
    if (!bookFile) throw new NotFoundException(`No synced file found for book ${bookId}`);

    const held = await this.repo.getDeviceProgressForDevice(bookFile.id, userId, deviceId);
    if (!held) throw new NotFoundException(`No KOReader progress found for device on book ${bookId}`);

    // Checked before writing, so a hold released twice, or released as the device converges on
    // its own, answers with a plain 404 rather than tripping the marker's foreign key.
    if ((await this.repo.getProgressReset(bookFile.id, userId)) === null) {
      throw new NotFoundException(`No pending reset for book ${bookId}`);
    }

    // Retired outright rather than recorded as convergence: the reader has said this position
    // is the one they want, so leaving the marker live would have the next pull answer zero
    // and ask the same device to go back to the start again.
    await this.repo.clearProgressReset(bookFile.id, userId);
    await this.applySharedProgress(
      userId,
      bookFile,
      { percentage: held.percentage ?? 0, progress: held.progress ?? undefined, timestamp: held.syncTimestamp ?? undefined },
      null,
    );

    this.logger.log(
      `[${SYNC_EVENT}] [end] userId=${userId} bookFileId=${bookFile.id} deviceId="${sanitizeLogValue(deviceId)}" durationMs=${Date.now() - startedAt} - reset hold released to the device position`,
    );
  }
}

/**
 * Whether a reported position is the start of the book, which is what a device landing on a
 * reset looks like. Routed by format because KOReader describes the two kinds of document
 * differently, and judged on the position rather than the percentage wherever one is sent.
 */
export function isResetStartPosition(format: string | null | undefined, percentage: number, progress?: string | null): boolean {
  if (isPagedReadingFormat(format)) {
    const page = parseKoreaderPageNumber(progress);
    if (page !== null) return page <= 1;
  } else {
    const trimmed = progress?.trim();
    // The percentage has to agree for a reflowable book. An EPUB with a single spine item puts
    // every position in the first fragment, so the fragment alone would call a device converged
    // wherever it happens to be sitting. Paged formats need no such guard, because a page
    // number says exactly where the reader is however short the book.
    if (trimmed) {
      return /^\/body\/DocFragment\[1\](\/|$)/.test(trimmed) && percentage <= RESET_CONVERGED_PERCENTAGE_FALLBACK;
    }
  }
  return percentage <= RESET_CONVERGED_PERCENTAGE_FALLBACK;
}

function toBookorbitPercentage(koreaderPct: number): number {
  return Math.round(koreaderPct * 10000) / 100;
}

function toKoreaderPercentage(bookorbitPct: number): number {
  return Math.round(bookorbitPct * 100) / 10000;
}
