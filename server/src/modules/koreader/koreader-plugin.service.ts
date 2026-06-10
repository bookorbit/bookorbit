import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import type { ReadStatus } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, AchievementEventsService } from '../achievement/achievement-events.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import type { BookStatesUploadDto, BulkProgressDto, MatchCheckDto, SweepCompleteDto } from './dto';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderService } from './koreader.service';

const MATCH_EVENT = 'koreader.plugin.match_check';
const BOOK_STATES_EVENT = 'koreader.plugin.book_states';
const BULK_PROGRESS_EVENT = 'koreader.plugin.bulk_progress';
const SWEEP_EVENT = 'koreader.plugin.sweep';

const DEVICE_STATUS_TO_READ_STATUS: Record<string, ReadStatus> = {
  reading: 'reading',
  complete: 'read',
  abandoned: 'abandoned',
};

export interface MatchCheckResult {
  matches: { hash: string; bookId: number; bookFileId: number }[];
  libraryVersion: string;
}

export interface BookStatesUploadResult {
  results: { hash: string; statusApplied: boolean; ratingApplied: boolean }[];
  unmatched: string[];
}

export interface BulkProgressResult {
  results: { hash: string; accepted: boolean }[];
  unmatched: string[];
}

export interface SweepCompleteResult {
  ok: true;
  lastSweepAt: string;
  libraryVersion: string;
}

@Injectable()
export class KoreaderPluginService {
  private readonly logger = new Logger(KoreaderPluginService.name);

  constructor(
    private readonly koreaderRepo: KoreaderRepository,
    private readonly pluginRepo: KoreaderPluginRepository,
    private readonly koreaderService: KoreaderService,
    private readonly userBookStatusService: UserBookStatusService,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  async matchCheck(user: RequestUser, dto: MatchCheckDto): Promise<MatchCheckResult> {
    const startedAtMs = Date.now();
    this.logger.log(
      `[${MATCH_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} hashes=${dto.hashes.length} - match check started`,
    );

    const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
    const hashes = [...new Set(dto.hashes.map((hash) => hash.toLowerCase()))];
    const resolved = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds);

    const matches = [...resolved.entries()].map(([hash, match]) => ({
      hash,
      bookId: match.bookId,
      bookFileId: match.bookFileId,
    }));
    const libraryVersion = await this.computeLibraryVersion(accessibleLibraryIds);

    this.logger.log(
      `[${MATCH_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} matched=${matches.length} total=${hashes.length} - match check completed`,
    );

    return { matches, libraryVersion };
  }

  async uploadBookStates(user: RequestUser, dto: BookStatesUploadDto): Promise<BookStatesUploadResult> {
    const startedAtMs = Date.now();
    this.logger.log(
      `[${BOOK_STATES_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} books=${dto.books.length} - book states upload started`,
    );

    try {
      const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
      const hashes = [...new Set(dto.books.map((book) => book.hash.toLowerCase()))];
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds);

      const results: BookStatesUploadResult['results'] = [];
      const unmatched: string[] = [];

      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }

        let statusApplied = false;
        let ratingApplied = false;
        if (book.status) {
          statusApplied = await this.applyStatus(user.id, match.bookId, book.status, book.statusModified);
        }
        if (book.rating) {
          ratingApplied = await this.applyRating(user.id, match.bookId, book.rating, book.statusModified);
        }
        results.push({ hash, statusApplied, ratingApplied });
      }

      this.logger.log(
        `[${BOOK_STATES_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} applied=${results.filter((r) => r.statusApplied || r.ratingApplied).length} unmatched=${unmatched.length} - book states upload completed`,
      );

      return { results, unmatched };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${BOOK_STATES_EVENT}] [fail] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - book states upload failed`,
      );
      throw error;
    }
  }

  async bulkProgress(user: RequestUser, dto: BulkProgressDto): Promise<BulkProgressResult> {
    const startedAtMs = Date.now();
    this.logger.log(
      `[${BULK_PROGRESS_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} items=${dto.items.length} - bulk progress started`,
    );

    try {
      const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
      const hashes = [...new Set(dto.items.map((item) => item.hash.toLowerCase()))];
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds);

      const results: BulkProgressResult['results'] = [];
      const unmatched: string[] = [];

      for (const item of dto.items) {
        const hash = item.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }

        // A sweep can carry a stale sidecar position from a secondary device (book last opened
        // there long ago). Record the per-device row regardless, but skip the shared
        // reading_progress/status updates when something newer is already known server-side.
        const stale = await this.isStaleProgress(user.id, match.bookFileId, item.timestamp);
        await this.koreaderService.applyProgressForResolvedFile(
          user.id,
          { id: match.bookFileId, bookId: match.bookId },
          {
            percentage: item.percentage,
            progress: item.progress,
            device: dto.deviceModel,
            deviceId: dto.deviceId,
            timestamp: item.timestamp,
          },
          { skipSharedProgress: stale },
        );
        results.push({ hash, accepted: true });
      }

      this.logger.log(
        `[${BULK_PROGRESS_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} accepted=${results.length} unmatched=${unmatched.length} - bulk progress completed`,
      );

      return { results, unmatched };
    } catch (error) {
      const errorClass = error instanceof Error ? error.constructor.name : 'UnknownError';
      this.logger.warn(
        `[${BULK_PROGRESS_EVENT}] [fail] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} errorClass=${errorClass} error="${sanitizeLogValue(error instanceof Error ? error.message : 'unknown error')}" - bulk progress failed`,
      );
      throw error;
    }
  }

  async sweepComplete(user: RequestUser, dto: SweepCompleteDto): Promise<SweepCompleteResult> {
    const startedAtMs = Date.now();
    const lastSweepAt = await this.pluginRepo.upsertSweep({
      userId: user.id,
      deviceId: dto.deviceId,
      deviceModel: dto.deviceModel,
      pluginVersion: dto.pluginVersion,
      booksMatched: dto.booksMatched,
      pageStatsUploaded: dto.pageStatsUploaded,
      annotationsUpserted: dto.annotationsUpserted,
    });

    const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
    const libraryVersion = await this.computeLibraryVersion(accessibleLibraryIds);

    this.logger.log(
      `[${SWEEP_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} booksMatched=${dto.booksMatched} pageStats=${dto.pageStatsUploaded} annotations=${dto.annotationsUpserted} - sweep recorded`,
    );

    return { ok: true, lastSweepAt: lastSweepAt.toISOString(), libraryVersion };
  }

  private async computeLibraryVersion(accessibleLibraryIds: number[] | null): Promise<string> {
    const maxTs = await this.pluginRepo.getLibraryMaxFileTimestamp(accessibleLibraryIds);
    const libraryKey = accessibleLibraryIds === null ? 'all' : [...accessibleLibraryIds].sort((a, b) => a - b).join(',');
    return createHash('md5') // codeql[js/weak-cryptographic-algorithm] - non-security cache token
      .update(`${libraryKey}|${maxTs ? maxTs.toISOString() : 'none'}`)
      .digest('hex')
      .slice(0, 16);
  }

  private async applyStatus(userId: number, bookId: number, deviceStatus: string, statusModified?: string): Promise<boolean> {
    const mapped = DEVICE_STATUS_TO_READ_STATUS[deviceStatus];
    if (!mapped) return false;

    const existing = await this.userBookStatusService.findOne(userId, bookId);
    if (existing) {
      if (existing.status === mapped) return true;
      // Newest change wins at date granularity; a same-day tie keeps the server value.
      const serverDate = existing.updatedAt.slice(0, 10);
      if (!statusModified || statusModified <= serverDate) return false;
    }

    await this.userBookStatusService.setManual(userId, bookId, mapped);
    return true;
  }

  private async applyRating(userId: number, bookId: number, rating: number, statusModified?: string): Promise<boolean> {
    const current = await this.pluginRepo.getRating(userId, bookId);
    if (current) {
      if (current.rating === rating) return true;
      const serverDate = current.updatedAt.toISOString().slice(0, 10);
      if (!statusModified || statusModified <= serverDate) return false;
    }

    await this.pluginRepo.upsertRating(userId, bookId, rating);
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId, bookIds: [bookId], rating });
    return true;
  }

  private async isStaleProgress(userId: number, bookFileId: number, timestamp?: number): Promise<boolean> {
    if (!timestamp) return false;

    const [deviceRows, readingProg] = await Promise.all([
      this.koreaderRepo.getAllDeviceProgress(bookFileId, userId),
      this.koreaderRepo.getReadingProgress(bookFileId, userId),
    ]);

    let newestKnown = 0;
    for (const row of deviceRows) {
      const rowTs = row.syncTimestamp ?? Math.floor((row.updatedAt?.getTime() ?? 0) / 1000);
      newestKnown = Math.max(newestKnown, rowTs);
    }
    if (readingProg?.updatedAt) {
      newestKnown = Math.max(newestKnown, Math.floor(readingProg.updatedAt.getTime() / 1000));
    }

    return timestamp < newestKnown;
  }
}
