import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';

import type { ReadStatus, UserBookStatus } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { mapWithConcurrency } from '../../common/utils/batch.utils';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, AchievementEventsService } from '../achievement/achievement-events.service';
import { UserBookNoteService, type UserBookNoteDto } from '../user-book-note/user-book-note.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import type { BookStateDto, BookStatesUploadDto, BulkProgressDto, MatchCheckDto, SweepCompleteDto } from './dto';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderService, type BulkProgressEntry } from './koreader.service';

const MATCH_EVENT = 'koreader.plugin.match_check';
const BOOK_STATES_EVENT = 'koreader.plugin.book_states';
const BULK_PROGRESS_EVENT = 'koreader.plugin.bulk_progress';
const SWEEP_EVENT = 'koreader.plugin.sweep';
const UNMATCHED_SOURCE_RANK = { statistics: 0, file: 1, current_file: 2 } as const;
const STATUS_WRITE_CONCURRENCY = 8;

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

/**
 * Server state for one book-states request, read in bounded batches up front and then
 * advanced in memory so later entries resolving to the same book observe earlier ones.
 */
interface BookStateBatch {
  statuses: Map<number, UserBookStatus>;
  staleStatusBookIds: Set<number>;
  ratings: Map<number, { rating: number | null; updatedAt: Date }>;
  notes: Map<number, UserBookNoteDto>;
  ratingWrites: Map<number, number | null>;
  noteWrites: Map<number, string | null>;
  appliedAt: Date;
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

      const entries: { hash: string; book: BookStateDto; bookId: number; index: number }[] = [];
      const unmatched: string[] = [];
      for (const book of dto.books) {
        const hash = book.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }
        entries.push({ hash, book, bookId: match.bookId, index: entries.length });
      }

      const bookIds = [...new Set(entries.map((entry) => entry.bookId))];
      const [statuses, ratings, notes] = await Promise.all([
        this.userBookStatusService.findByBookIds(user.id, bookIds),
        this.pluginRepo.getRatings(user.id, bookIds),
        this.userBookNoteService.findByBookIds(user.id, bookIds),
      ]);

      const state: BookStateBatch = {
        statuses,
        staleStatusBookIds: new Set<number>(),
        ratings,
        notes,
        ratingWrites: new Map<number, number | null>(),
        noteWrites: new Map<number, string | null>(),
        appliedAt: new Date(),
      };

      // Several input entries can resolve to one book (duplicate hashes, or different
      // files of the same book), so entries for a book run in input order against the
      // evolving state while different books run concurrently.
      const groups = new Map<number, typeof entries>();
      for (const entry of entries) {
        const group = groups.get(entry.bookId);
        if (group) group.push(entry);
        else groups.set(entry.bookId, [entry]);
      }

      const results: BookStatesUploadResult['results'] = new Array(entries.length);
      await mapWithConcurrency([...groups.values()], STATUS_WRITE_CONCURRENCY, async (group) => {
        for (const entry of group) {
          results[entry.index] = await this.resolveBookState(user.id, entry.hash, entry.book, entry.bookId, state);
        }
      });

      await Promise.all([this.flushRatings(user.id, state), this.flushReviews(user.id, state)]);

      this.logger.log(
        `[${BOOK_STATES_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} applied=${results.filter((r) => r.statusApplied || r.ratingApplied || r.reviewApplied).length} ratingWrites=${state.ratingWrites.size} reviewWrites=${state.noteWrites.size} unmatched=${unmatched.length} - book states upload completed`,
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
      const entries: BulkProgressEntry[] = [];

      for (const item of dto.items) {
        const hash = item.hash.toLowerCase();
        const match = matches.get(hash);
        if (!match) {
          unmatched.push(hash);
          continue;
        }

        entries.push({
          bookFile: { id: match.bookFileId, bookId: match.bookId, libraryId: match.libraryId },
          percentage: item.percentage,
          progress: item.progress,
          timestamp: item.timestamp,
        });
        results.push({ hash, accepted: true });
      }

      const applied = await this.koreaderService.applyBulkProgress(user.id, entries, {
        device: dto.deviceModel,
        deviceId: dto.deviceId,
      });

      this.logger.log(
        `[${BULK_PROGRESS_EVENT}] [end] userId=${user.id} deviceId=${dto.deviceId.slice(0, 8)} durationMs=${Date.now() - startedAtMs} accepted=${results.length} shared=${applied.shared} stale=${applied.stale} unmatched=${unmatched.length} - bulk progress completed`,
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

  // Snapshot token for anything that must notice a library change: bulk
  // manifest cursors bind to it, and match freshness invalidates on it.
  async getLibraryVersion(userId: number): Promise<string> {
    const accessibleLibraryIds = await this.koreaderRepo.getAccessibleLibraryIds(userId);
    return this.computeLibraryVersion(userId, accessibleLibraryIds);
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

  private async resolveBookState(
    userId: number,
    hash: string,
    book: BookStateDto,
    bookId: number,
    state: BookStateBatch,
  ): Promise<BookStatesUploadResult['results'][number]> {
    let statusApplied = false;
    if (book.status) {
      statusApplied = await this.applyStatus(userId, bookId, book.status, state, book.statusModified);
    }

    const hasRatingField = Object.prototype.hasOwnProperty.call(book, 'rating');
    let ratingResult: RatingApplyResult;
    if (hasRatingField || book.ratingCleared === true) {
      ratingResult = this.applyRating(bookId, hasRatingField ? (book.rating ?? null) : null, state, book.statusModified);
    } else {
      const current = state.ratings.get(bookId);
      ratingResult = { applied: false, rating: current?.rating ?? null, updatedAt: current?.updatedAt ?? null };
    }

    const hasReviewField = Object.prototype.hasOwnProperty.call(book, 'reviewNote');
    let reviewResult: ReviewApplyResult;
    if (hasReviewField || book.reviewCleared === true) {
      reviewResult = this.applyReview(bookId, hasReviewField ? (book.reviewNote ?? null) : null, state, book.reviewModified ?? book.statusModified);
    } else {
      const current = state.notes.get(bookId);
      reviewResult = { applied: false, note: current?.note ?? null, updatedAt: current?.updatedAt ?? null };
    }

    return {
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
    };
  }

  /**
   * Status writes stay on UserBookStatusService because setManual drives reading-attempt
   * lifecycle bookkeeping that a bulk row write would silently skip. It also projects a
   * status that can differ from the requested one, so a book written during this batch is
   * re-read only if a later entry resolves to it again.
   */
  private async applyStatus(userId: number, bookId: number, deviceStatus: string, state: BookStateBatch, statusModified?: string): Promise<boolean> {
    const mapped = DEVICE_STATUS_TO_READ_STATUS[deviceStatus];
    if (!mapped) return false;

    if (state.staleStatusBookIds.delete(bookId)) {
      const refreshed = await this.userBookStatusService.findOne(userId, bookId);
      if (refreshed) state.statuses.set(bookId, refreshed);
      else state.statuses.delete(bookId);
    }

    const existing = state.statuses.get(bookId);
    if (existing) {
      if (existing.status === mapped) return true;
      // Newest change wins at date granularity; a same-day tie keeps the server value.
      const serverDate = existing.updatedAt.slice(0, 10);
      if (!statusModified || statusModified <= serverDate) return false;
    }

    await this.userBookStatusService.setManual(userId, bookId, mapped);
    state.staleStatusBookIds.add(bookId);
    return true;
  }

  private applyRating(bookId: number, rating: number | null, state: BookStateBatch, statusModified?: string): RatingApplyResult {
    const current = state.ratings.get(bookId);
    if (current) {
      if (current.rating === rating) return { applied: true, rating: current.rating, updatedAt: current.updatedAt };
      const serverDate = current.updatedAt.toISOString().slice(0, 10);
      if (!statusModified || statusModified <= serverDate) {
        return { applied: false, rating: current.rating, updatedAt: current.updatedAt };
      }
    }

    state.ratingWrites.set(bookId, rating);
    state.ratings.set(bookId, { rating, updatedAt: state.appliedAt });
    return { applied: true, rating, updatedAt: state.appliedAt };
  }

  private applyReview(bookId: number, reviewNote: string | null, state: BookStateBatch, reviewModified?: string): ReviewApplyResult {
    const current = state.notes.get(bookId);
    const normalized = this.userBookNoteService.normalizeNote(reviewNote);
    if (current) {
      if ((current.note ?? null) === normalized) {
        return { applied: true, note: current.note ?? null, updatedAt: current.updatedAt };
      }
      const serverDate = current.updatedAt.slice(0, 10);
      if (!reviewModified || reviewModified <= serverDate) {
        return { applied: false, note: current.note ?? null, updatedAt: current.updatedAt };
      }
    }

    state.noteWrites.set(bookId, normalized);
    state.notes.set(bookId, { note: normalized, updatedAt: state.appliedAt.toISOString() });
    return { applied: true, note: normalized, updatedAt: state.appliedAt.toISOString() };
  }

  private async flushRatings(userId: number, state: BookStateBatch): Promise<void> {
    if (state.ratingWrites.size === 0) return;

    await this.pluginRepo.upsertRatings(
      userId,
      [...state.ratingWrites].map(([bookId, rating]) => ({ bookId, rating })),
      state.appliedAt,
    );

    // One event per distinct rating value: the payload carries a book-ID array but a
    // single rating, and the rating value drives evaluator behavior.
    const bookIdsByRating = new Map<number | null, number[]>();
    for (const [bookId, rating] of state.ratingWrites) {
      const bucket = bookIdsByRating.get(rating);
      if (bucket) bucket.push(bookId);
      else bookIdsByRating.set(rating, [bookId]);
    }
    for (const [rating, bookIds] of bookIdsByRating) {
      this.achievementEvents.emit(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, { userId, bookIds, rating });
    }
  }

  private async flushReviews(userId: number, state: BookStateBatch): Promise<void> {
    if (state.noteWrites.size === 0) return;
    await this.userBookNoteService.setNotes(
      userId,
      [...state.noteWrites].map(([bookId, note]) => ({ bookId, note })),
      state.appliedAt,
    );
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
