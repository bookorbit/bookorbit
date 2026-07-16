import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import type { ReadStatus } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, AchievementEventsService } from '../achievement/achievement-events.service';
import { UserBookNoteService } from '../user-book-note/user-book-note.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import type { BookStatesUploadDto, BulkProgressDto, MatchCheckDto, SweepCompleteDto } from './dto';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderService } from './koreader.service';

const MATCH_EVENT = 'koreader.plugin.match_check';
const BOOK_STATES_EVENT = 'koreader.plugin.book_states';
const BULK_PROGRESS_EVENT = 'koreader.plugin.bulk_progress';
const SWEEP_EVENT = 'koreader.plugin.sweep';
const UNMATCHED_SOURCE_RANK = { statistics: 0, file: 1, current_file: 2 } as const;

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
  results: {
    hash: string;
    statusApplied: boolean;
    ratingApplied: boolean;
    reviewApplied: boolean;
    rating: number | null;
    ratingSet: boolean;
    ratingUpdatedAt: string | null;
    reviewNote: string | null;
    reviewNoteSet: boolean;
    reviewUpdatedAt: string | null;
  }[];
  unmatched: string[];
}

interface RatingApplyResult {
  applied: boolean;
  rating: number | null;
  updatedAt: Date | null;
}

interface ReviewApplyResult {
  applied: boolean;
  note: string | null;
  updatedAt: string | null;
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
    private readonly userBookNoteService: UserBookNoteService,
    private readonly achievementEvents: AchievementEventsService,
  ) {}

  async matchCheck(user: RequestUser, dto: MatchCheckDto): Promise<MatchCheckResult> {
    const startedAtMs = Date.now();
    this.logger.log(
      `[${MATCH_EVENT}] [start] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} hashes=${dto.hashes.length} - match check started`,
    );

    const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(user.id);
    const hashes = [...new Set(dto.hashes.map((hash) => hash.toLowerCase()))];
    const resolved = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, user.id);
    const matchedHashes = [...resolved.keys()];
    const unmatchedCandidates = this.buildUnmatchedCandidates(hashes, matchedHashes, dto);
    await Promise.all([
      this.koreaderRepo.clearUnmatchedBooks(user.id, matchedHashes),
      this.koreaderRepo.upsertUnmatchedBooks(user.id, unmatchedCandidates, dto.deviceId),
    ]);

    const matches = [...resolved.entries()].map(([hash, match]) => ({
      hash,
      bookId: match.bookId,
      bookFileId: match.bookFileId,
    }));
    const libraryVersion = await this.computeLibraryVersion(user.id, accessibleLibraryIds);

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
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, user.id);

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
        if (book.status) {
          statusApplied = await this.applyStatus(user.id, match.bookId, book.status, book.statusModified);
        }

        const hasRatingField = Object.prototype.hasOwnProperty.call(book, 'rating');
        let ratingResult: RatingApplyResult;
        if (hasRatingField || book.ratingCleared === true) {
          ratingResult = await this.applyRating(user.id, match.bookId, hasRatingField ? (book.rating ?? null) : null, book.statusModified);
        } else {
          const current = await this.pluginRepo.getRating(user.id, match.bookId);
          ratingResult = { applied: false, rating: current?.rating ?? null, updatedAt: current?.updatedAt ?? null };
        }

        const hasReviewField = Object.prototype.hasOwnProperty.call(book, 'reviewNote');
        let reviewResult: ReviewApplyResult;
        if (hasReviewField || book.reviewCleared === true) {
          reviewResult = await this.applyReview(
            user.id,
            match.bookId,
            hasReviewField ? (book.reviewNote ?? null) : null,
            book.reviewModified ?? book.statusModified,
          );
        } else {
          const current = await this.userBookNoteService.findOne(user.id, match.bookId);
          reviewResult = { applied: false, note: current?.note ?? null, updatedAt: current?.updatedAt ?? null };
        }

        results.push({
          hash,
          statusApplied,
          ratingApplied: ratingResult.applied,
          reviewApplied: reviewResult.applied,
          rating: ratingResult.rating,
          ratingSet: ratingResult.rating != null,
          ratingUpdatedAt: ratingResult.updatedAt ? ratingResult.updatedAt.toISOString() : null,
          reviewNote: reviewResult.note,
          reviewNoteSet: reviewResult.note != null,
          reviewUpdatedAt: reviewResult.updatedAt,
        });
      }

      this.logger.log(
        `[${BOOK_STATES_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} applied=${results.filter((r) => r.statusApplied || r.ratingApplied || r.reviewApplied).length} unmatched=${unmatched.length} - book states upload completed`,
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
      const matches = await this.koreaderRepo.resolveBookFilesByHashes(hashes, accessibleLibraryIds, user.id);

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
          { id: match.bookFileId, bookId: match.bookId, libraryId: match.libraryId },
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
    const libraryVersion = await this.computeLibraryVersion(user.id, accessibleLibraryIds);

    this.logger.log(
      `[${SWEEP_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} booksMatched=${dto.booksMatched} pageStats=${dto.pageStatsUploaded} annotations=${dto.annotationsUpserted} - sweep recorded`,
    );

    return { ok: true, lastSweepAt: lastSweepAt.toISOString(), libraryVersion };
  }

  private async computeLibraryVersion(userId: number, accessibleLibraryIds: number[] | null): Promise<string> {
    const [fileMaxTs, linkVersion] = await Promise.all([
      this.pluginRepo.getLibraryMaxFileTimestamp(accessibleLibraryIds),
      this.pluginRepo.getHashLinkVersion(userId),
    ]);
    const maxTs = maxDate(fileMaxTs, linkVersion.maxTs);
    const libraryKey = accessibleLibraryIds === null ? 'all' : [...accessibleLibraryIds].sort((a, b) => a - b).join(',');
    const linkKey = `${linkVersion.count}:${linkVersion.maxTs ? linkVersion.maxTs.toISOString() : 'none'}`;
    return createHash('md5') // codeql[js/weak-cryptographic-algorithm] - non-security cache token
      .update(`${libraryKey}|${maxTs ? maxTs.toISOString() : 'none'}|${linkKey}`)
      .digest('hex')
      .slice(0, 16);
  }

  private buildUnmatchedCandidates(hashes: string[], matchedHashes: string[], dto: MatchCheckDto) {
    const matched = new Set(matchedHashes);
    const metadata = new Map<
      string,
      {
        hash: string;
        title?: string | null;
        authors?: string | null;
        lastOpen?: number | null;
        source?: 'current_file' | 'file' | 'statistics';
        metadataAmbiguous?: boolean;
      }
    >();
    for (const book of dto.books ?? []) {
      const hash = book.hash.toLowerCase();
      const existing = metadata.get(hash);
      const source = strongerUnmatchedSource(existing?.source, book.source);
      const incomingIsStronger = UNMATCHED_SOURCE_RANK[source] > UNMATCHED_SOURCE_RANK[existing?.source ?? 'statistics'];
      const incomingKeepsSource = source === (book.source ?? 'statistics');
      metadata.set(hash, {
        hash,
        title: incomingIsStronger || incomingKeepsSource ? (book.title ?? existing?.title ?? null) : (existing?.title ?? book.title ?? null),
        authors:
          incomingIsStronger || incomingKeepsSource ? (book.authors ?? existing?.authors ?? null) : (existing?.authors ?? book.authors ?? null),
        lastOpen: Math.max(book.lastOpen ?? 0, existing?.lastOpen ?? 0) || null,
        source,
        metadataAmbiguous: incomingIsStronger || incomingKeepsSource ? (book.metadataAmbiguous ?? false) : (existing?.metadataAmbiguous ?? false),
      });
    }

    return hashes.filter((hash) => !matched.has(hash)).map((hash) => metadata.get(hash) ?? { hash, source: 'statistics' as const });
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

  private async applyRating(userId: number, bookId: number, rating: number | null, statusModified?: string): Promise<RatingApplyResult> {
    const current = await this.pluginRepo.getRating(userId, bookId);
    if (current) {
      if (current.rating === rating) return { applied: true, rating: current.rating, updatedAt: current.updatedAt };
      const serverDate = current.updatedAt.toISOString().slice(0, 10);
      if (!statusModified || statusModified <= serverDate) {
        return { applied: false, rating: current.rating, updatedAt: current.updatedAt };
      }
    }

    const updated = await this.pluginRepo.upsertRating(userId, bookId, rating);
    this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId, bookIds: [bookId], rating });
    return { applied: true, rating: updated.rating, updatedAt: updated.updatedAt };
  }

  private async applyReview(userId: number, bookId: number, reviewNote: string | null, reviewModified?: string): Promise<ReviewApplyResult> {
    const current = await this.userBookNoteService.findRow(userId, bookId);
    const normalized = this.userBookNoteService.normalizeNote(reviewNote);
    if (current) {
      if ((current.note ?? null) === normalized) {
        return { applied: true, note: current.note ?? null, updatedAt: current.updatedAt.toISOString() };
      }
      const serverDate = current.updatedAt.toISOString().slice(0, 10);
      if (!reviewModified || reviewModified <= serverDate) {
        return { applied: false, note: current.note ?? null, updatedAt: current.updatedAt.toISOString() };
      }
    }

    const updated = await this.userBookNoteService.setNote(userId, bookId, normalized);
    return { applied: true, note: updated.note, updatedAt: updated.updatedAt };
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

function maxDate(...dates: (Date | null)[]): Date | null {
  let newest: Date | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (!newest || date > newest) newest = date;
  }
  return newest;
}

function strongerUnmatchedSource(
  existing: 'current_file' | 'file' | 'statistics' | undefined,
  incoming: 'current_file' | 'file' | 'statistics' | undefined,
): 'current_file' | 'file' | 'statistics' {
  const current = existing ?? 'statistics';
  const next = incoming ?? 'statistics';
  return UNMATCHED_SOURCE_RANK[next] > UNMATCHED_SOURCE_RANK[current] ? next : current;
}
