import {
  type HardcoverActiveSyncStatus,
  type HardcoverBookSyncState,
  type HardcoverEditionsResult,
  type HardcoverLinkedBooksResult,
  type HardcoverSettings,
  type HardcoverSyncPendingSummary,
  isAudioFormat,
  type ReadStatus,
  type SetHardcoverEditionResult,
  type UpdateHardcoverBookSyncPayload,
} from '@bookorbit/types';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { distinctUntilChanged, filter, map, merge, Observable, of, Subject } from 'rxjs';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookService } from '../book/book.service';
import { HARDCOVER_STATUS } from './hardcover.constants';
import { HardcoverBookMatchService } from './hardcover-book-match.service';
import { HardcoverClientService } from './hardcover-client.service';
import { parseHardcoverBookId } from './hardcover-id.utils';
import {
  attemptOwnedReadId,
  type HardcoverReadCandidate,
  type HardcoverReadTarget,
  readTargetForAttempt,
  readTargetForBook,
  type ReadingAttemptForSync,
  selectAdoptableReadId,
  selectPrimaryAttempt,
} from './hardcover-read-selection';
import { type BookSyncData, HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import {
  normalizeHardcoverBookSyncOverride,
  resolveHardcoverBookSyncDecision,
  resolveHardcoverBookSyncOverrideForToggle,
} from './hardcover-sync-policy';

const LINKED_BOOKS_LIMIT = 200;

// Bounds how many times a lost ownership race may force reselection before the sync mints a new read.
const MAX_READ_ADOPTION_ROUNDS = 3;

const STATUS_MAP: Partial<Record<ReadStatus, number>> = {
  want_to_read: HARDCOVER_STATUS.WANT_TO_READ,
  reading: HARDCOVER_STATUS.CURRENTLY_READING,
  rereading: HARDCOVER_STATUS.CURRENTLY_READING,
  on_hold: HARDCOVER_STATUS.PAUSED,
  read: HARDCOVER_STATUS.READ,
  skimmed: HARDCOVER_STATUS.READ,
  abandoned: HARDCOVER_STATUS.DNF,
};

const INSERT_USER_BOOK_MUTATION = `
mutation InsertUserBook($object: UserBookCreateInput!) {
  insert_user_book(object: $object) {
    user_book {
      id
    }
    error
  }
}`;

const FIND_USER_BOOK_QUERY = `
query FindUserBook($bookId: Int!) {
  me {
    user_books(where: { book_id: { _eq: $bookId } }, limit: 1) {
      id
    }
  }
}`;

const UPDATE_USER_BOOK_MUTATION = `
mutation UpdateUserBook($id: Int!, $object: UserBookUpdateInput!) {
  update_user_book(id: $id, object: $object) {
    user_book {
      id
    }
    error
  }
}`;

const INSERT_USER_BOOK_READ_MUTATION = `
mutation InsertUserBookRead($userBookId: Int!, $object: DatesReadInput!) {
  insert_user_book_read(user_book_id: $userBookId, user_book_read: $object) {
    user_book_read {
      id
    }
    error
  }
}`;

const UPDATE_USER_BOOK_READ_MUTATION = `
mutation UpdateUserBookRead($id: Int!, $object: DatesReadInput!) {
  update_user_book_read(id: $id, object: $object) {
    user_book_read {
      id
    }
    error
  }
}`;

const FIND_USER_BOOK_READS_QUERY = `
query FindUserBookReads($userBookId: Int!) {
  user_book_reads(where: { user_book_id: { _eq: $userBookId } }, order_by: [{ id: desc }], limit: 20) {
    id
    started_at
    finished_at
    progress_pages
    progress_seconds
  }
}`;

type InsertUserBookResult = { insert_user_book: { user_book: { id: number } | null; error: string | null } };
type UpdateUserBookResult = { update_user_book: { user_book: { id: number } | null; error: string | null } };
type FindUserBookResult = { me: { user_books: { id: number }[] } };
type InsertUserBookReadResult = { insert_user_book_read: { user_book_read: { id: number } | null; error: string | null } };
type UpdateUserBookReadResult = { update_user_book_read: { user_book_read: { id: number } | null; error: string | null } };
type FindUserBookReadsResult = {
  user_book_reads: Array<{
    id: number;
    started_at: string | null;
    finished_at: string | null;
    progress_pages: number | null;
    progress_seconds: number | null;
  }>;
};

export type HardcoverSyncBookResult = 'synced' | 'skipped' | 'failed';
type HardcoverBookStateSnapshot = Awaited<ReturnType<HardcoverRepository['findBookState']>>;

/** Drizzle hides the driver error - and with it the constraint name - behind `cause`. */
function describeErrorCause(error: unknown): string {
  let current: unknown = error instanceof Error ? error.cause : undefined;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const entry = current as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    const parts = [entry.code, entry.constraint, entry.message].filter((part): part is string => typeof part === 'string' && part.length > 0);
    if (parts.length > 0) return parts.join(' ');
    current = entry.cause;
  }
  return '';
}

function toDateString(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().split('T')[0]! : null;
}

@Injectable()
export class HardcoverSyncService {
  private readonly logger = new Logger(HardcoverSyncService.name);
  private readonly cancelRequests = new Set<number>();
  private readonly syncStatusEvents = new Subject<{ userId: number; status: HardcoverActiveSyncStatus | null }>();
  private readonly activeSyncs = new Map<number, HardcoverActiveSyncStatus>();
  private syncRunCounter = 0;

  constructor(
    private readonly repo: HardcoverRepository,
    private readonly client: HardcoverClientService,
    private readonly matchService: HardcoverBookMatchService,
    private readonly settingsService: HardcoverSettingsService,
    private readonly bookService: BookService,
  ) {}

  async syncBook(userId: number, bookId: number): Promise<HardcoverSyncBookResult> {
    const token = await this.settingsService.getTokenForUser(userId);
    if (!token) return 'skipped';

    const book = await this.repo.findBookSyncData(userId, bookId);
    if (!book) return 'skipped';

    const state = await this.repo.findBookState(userId, book.bookId);
    const settings = await this.settingsService.getSettings(userId);
    if (!this.isBookInSyncScope(settings, book, state)) return 'skipped';

    return this.syncSingleBook(userId, token, book, state);
  }

  async syncAll(userId: number): Promise<number> {
    const existing = this.activeSyncs.get(userId);
    if (existing) {
      this.logger.warn(`[hardcover.sync_all] userId=${userId} runId=${existing.runId} - sync already running`);
      this.emitSyncStatus(userId, existing);
      return existing.runId;
    }

    const token = await this.settingsService.getTokenForUser(userId);
    if (!token) return 0;

    const settings = await this.settingsService.getSettings(userId);
    const books = await this.repo.findSyncableBooks(userId);
    const states = await this.repo.findBookStatesByBookIds(
      userId,
      books.map((book) => book.bookId),
    );
    const stateByBookId = new Map(states.map((state) => [state.bookId, state]));
    const syncableBooks = books.filter((book) => this.isBookInSyncScope(settings, book, stateByBookId.get(book.bookId)));

    // Re-check: a concurrent syncAll may have won the race during findSyncableBooks
    const recheck = this.activeSyncs.get(userId);
    if (recheck) {
      this.logger.warn(`[hardcover.sync_all] userId=${userId} runId=${recheck.runId} - sync started concurrently`);
      this.emitSyncStatus(userId, recheck);
      return recheck.runId;
    }

    const runId = ++this.syncRunCounter;
    const status: HardcoverActiveSyncStatus = {
      runId,
      syncedBooks: 0,
      totalBooks: syncableBooks.length,
      status: 'running',
    };
    this.activeSyncs.set(userId, status);

    this.logger.log(`[hardcover.sync_all] [start] userId=${userId} runId=${runId} totalBooks=${syncableBooks.length} - sync all started`);
    this.emitSyncStatus(userId, status);

    this.runSyncAll(userId, token, syncableBooks, runId, settings).catch((err) => {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[hardcover.sync_all] [fail] userId=${userId} runId=${runId} errorClass=${err?.constructor?.name ?? 'Error'} error="${error}" - sync all crashed`,
      );
      this.cancelRequests.delete(userId);
      this.activeSyncs.delete(userId);
      this.emitSyncStatus(userId, null);
    });

    return runId;
  }

  cancelSync(userId: number): void {
    const run = this.activeSyncs.get(userId);
    if (!run) return;
    this.cancelRequests.add(userId);
    this.activeSyncs.delete(userId);
    this.emitSyncStatus(userId, null);
    this.logger.log(`[hardcover.sync_all] userId=${userId} runId=${run.runId} - sync cancelled`);
  }

  getSyncStatus(userId: number): HardcoverActiveSyncStatus | null {
    return this.activeSyncs.get(userId) ?? null;
  }

  streamSyncStatus(userId: number): Observable<HardcoverActiveSyncStatus | null> {
    return merge(
      of(this.getSyncStatus(userId)),
      this.syncStatusEvents.pipe(
        filter((event) => event.userId === userId),
        map((event) => event.status),
      ),
    ).pipe(distinctUntilChanged((prev, next) => this.isSameActiveStatus(prev, next)));
  }

  async getSyncPendingSummary(userId: number): Promise<HardcoverSyncPendingSummary> {
    const token = await this.settingsService.getTokenForUser(userId);
    if (!token) {
      return { totalBooks: 0, pendingBooks: 0 };
    }

    const settings = await this.settingsService.getSettings(userId);
    const books = await this.repo.findSyncableBooks(userId);
    if (books.length === 0) {
      return { totalBooks: 0, pendingBooks: 0 };
    }

    const states = await this.repo.findBookStatesByBookIds(
      userId,
      books.map((book) => book.bookId),
    );
    const stateByBookId = new Map(states.map((state) => [state.bookId, state]));

    let pendingBooks = 0;
    let totalBooks = 0;
    for (const book of books) {
      const state = stateByBookId.get(book.bookId);
      if (!this.isBookInSyncScope(settings, book, state)) continue;
      totalBooks++;
      const decision = this.resolveSyncDecision(settings, book, state);
      if (decision.canSyncNow) {
        pendingBooks++;
      }
    }

    return {
      totalBooks,
      pendingBooks,
    };
  }

  async getBookSyncState(userId: number, bookId: number): Promise<HardcoverBookSyncState> {
    const settings = await this.settingsService.getSettings(userId);
    const book = await this.repo.findBookSyncData(userId, bookId);
    if (!book) return this.bookNotFoundState(bookId);

    const state = await this.repo.findBookState(userId, bookId);
    return this.toBookSyncState(bookId, book, settings, state);
  }

  async updateBookSyncState(userId: number, bookId: number, payload: UpdateHardcoverBookSyncPayload): Promise<HardcoverBookSyncState> {
    const settings = await this.settingsService.getSettings(userId);
    const book = await this.repo.findBookSyncData(userId, bookId);
    if (!book) return this.bookNotFoundState(bookId);

    const syncOverride = resolveHardcoverBookSyncOverrideForToggle(settings.bookSyncMode, payload.syncEnabled);
    const state = await this.repo.setBookSyncOverride(userId, bookId, syncOverride);

    if (payload.syncEnabled) {
      void this.syncBook(userId, bookId).catch((err) => {
        this.logger.error(
          `[hardcover.sync_book_on_enable] [fail] userId=${userId} bookId=${bookId} errorClass=${err?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - immediate sync on enable failed`,
        );
      });
    }

    return this.toBookSyncState(bookId, book, settings, state);
  }

  async listLinkedBooks(userId: number): Promise<HardcoverLinkedBooksResult> {
    // One over the cap, so a full page can be told apart from a truncated one.
    const rows = await this.repo.findCurrentReadingBooks(userId, LINKED_BOOKS_LIMIT + 1);
    const books = rows.slice(0, LINKED_BOOKS_LIMIT);
    const states = await this.repo.findBookStatesByBookIds(
      userId,
      books.map((book) => book.bookId),
    );
    const stateByBookId = new Map(states.map((state) => [state.bookId, state]));

    return {
      books: books.map((book) => {
        const state = stateByBookId.get(book.bookId);
        return {
          bookId: book.bookId,
          title: book.title,
          authorName: book.authorName,
          hardcoverBookId: state?.hardcoverBookId ?? null,
          hardcoverEditionId: state?.hardcoverEditionId ?? null,
          matchMethod: state?.matchMethod ?? null,
          matchError: state?.matchError ?? null,
        };
      }),
      truncated: rows.length > LINKED_BOOKS_LIMIT,
    };
  }

  async getEditions(userId: number, bookId: number): Promise<HardcoverEditionsResult> {
    const { token, hardcoverBookId } = await this.requireMatchedBook(userId, bookId);
    return this.matchService.listEditions(userId, token, hardcoverBookId);
  }

  async setEdition(userId: number, bookId: number, editionId: number): Promise<SetHardcoverEditionResult> {
    const { token, hardcoverBookId } = await this.requireMatchedBook(userId, bookId);

    const edition = await this.matchService.findEditionForBook(userId, token, hardcoverBookId, editionId);
    if (!edition) {
      throw new BadRequestException(`Edition ${editionId} does not belong to the matched Hardcover book`);
    }

    await this.repo.upsertBookState({
      userId,
      bookId,
      hardcoverBookId,
      hardcoverEditionId: editionId,
      matchMethod: 'manual',
      matchError: null,
      lastSyncedAt: null,
    });

    await this.syncBook(userId, bookId);

    await this.bookService.setHardcoverEditionIdIfEmpty(bookId, String(editionId)).catch((err) => {
      this.logger.warn(
        `[hardcover.set_edition] [fail] userId=${userId} bookId=${bookId} errorClass=${err?.constructor?.name ?? 'Error'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - back-fill of shared metadata edition id failed`,
      );
    });

    return { success: true };
  }

  // Both edition routes need the same two preconditions, and neither can be reported as an empty
  // catalogue: "not connected" and "not matched yet" are distinct states the user can act on.
  private async requireMatchedBook(userId: number, bookId: number): Promise<{ token: string; hardcoverBookId: number }> {
    const token = await this.settingsService.getTokenForUser(userId);
    if (!token) throw new BadRequestException('Hardcover is not connected for this user');

    const state = await this.repo.findBookState(userId, bookId);
    if (!state?.hardcoverBookId) throw new BadRequestException(`Book ${bookId} is not matched to a Hardcover book yet`);

    return { token, hardcoverBookId: state.hardcoverBookId };
  }

  private async runSyncAll(userId: number, token: string, books: BookSyncData[], runId: number, settings: HardcoverSettings): Promise<void> {
    const startedAt = Date.now();
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const book of books) {
      if (this.cancelRequests.has(userId)) {
        this.cancelRequests.delete(userId);
        this.logger.log(`[hardcover.sync_all] userId=${userId} runId=${runId} - cancelled mid-run`);
        return;
      }

      const state = await this.repo.findBookState(userId, book.bookId);
      if (!this.isBookInSyncScope(settings, book, state)) {
        skipped++;
        this.emitProgress(userId, synced);
        continue;
      }

      const result = await this.syncSingleBook(userId, token, book, state);
      if (result === 'synced') synced++;
      else if (result === 'skipped') skipped++;
      else failed++;

      this.emitProgress(userId, synced);
    }

    // Handle cancel requested after the last book was processed (loop exited without hitting the top check)
    if (this.cancelRequests.has(userId)) {
      this.cancelRequests.delete(userId);
      this.logger.log(`[hardcover.sync_all] userId=${userId} runId=${runId} - cancelled after last book`);
      this.activeSyncs.delete(userId);
      return;
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[hardcover.sync_all] [end] userId=${userId} runId=${runId} durationMs=${durationMs} syncedBooks=${synced} failedBooks=${failed} skippedBooks=${skipped} - sync all completed`,
    );

    await this.repo.updateLastSyncedAt(userId, new Date());
    this.activeSyncs.delete(userId);
    this.emitSyncStatus(userId, null);
  }

  private emitProgress(userId: number, synced: number): void {
    const activeStatus = this.activeSyncs.get(userId);
    if (activeStatus) activeStatus.syncedBooks = synced;
    this.emitSyncStatus(userId, activeStatus ?? null);
  }

  private async syncSingleBook(
    userId: number,
    token: string,
    book: BookSyncData,
    initialState?: HardcoverBookStateSnapshot,
  ): Promise<HardcoverSyncBookResult> {
    const startedAt = Date.now();
    const latestState = await this.repo.findBookState(userId, book.bookId);
    const activeInitialState = latestState ?? initialState;
    const settings = await this.settingsService.getSettings(userId);
    if (!this.isBookInSyncScope(settings, book, latestState ?? activeInitialState)) return 'skipped';

    const hardcoverStatusId = STATUS_MAP[book.status as ReadStatus];
    if (!hardcoverStatusId) {
      if (book.status === 'unread') return 'skipped';
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        syncError: `no_status_mapping:${book.status}`,
        ...this.buildAttemptSnapshot(book),
      });
      return 'skipped';
    }

    const decision = this.resolveSyncDecision(settings, book, latestState ?? activeInitialState);
    if (!decision.canSyncNow) return 'skipped';

    const match = await this.matchService.matchBook(userId, token, book);
    if (!match) {
      const state = activeInitialState ?? (await this.repo.findBookState(userId, book.bookId));
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        hardcoverBookId: state?.hardcoverBookId ?? null,
        syncError: 'no_match',
        ...this.buildAttemptSnapshot(book),
      });
      this.logger.warn(
        `[hardcover.sync_book] [fail] userId=${userId} bookId=${book.bookId} durationMs=${Date.now() - startedAt} errorClass=MatchError error="no_match" - Hardcover book match not found`,
      );
      return 'skipped';
    }

    const hardcoverRating = book.rating ?? null;

    try {
      const userBookId = await this.insertOrFindUserBook(userId, token, {
        bookId: match.hardcoverBookId,
        statusId: hardcoverStatusId,
        privacySettingId: settings.privacySettingId,
        editionId: match.hardcoverEditionId ?? undefined,
      });

      await this.updateUserBookFields(userId, token, userBookId, {
        statusId: hardcoverStatusId,
        privacySettingId: settings.privacySettingId,
        rating: hardcoverRating,
        editionId: match.hardcoverEditionId ?? undefined,
      });

      const state = await this.repo.findBookState(userId, book.bookId);
      const syncState = activeInitialState ?? state;
      const startDate = toDateString(book.startedAt);
      const endDate = toDateString(book.finishedAt);
      let hardcoverReadId: number | null = syncState?.hardcoverReadId ?? null;
      let progressSynced = true;

      const localAttempts = typeof this.repo.findReadingAttempts === 'function' ? await this.repo.findReadingAttempts(userId, book.bookId) : [];
      const primaryAttempt = selectPrimaryAttempt(localAttempts);
      // Every read id already owned on this book, tombstones included, so no attempt adopts one that
      // reading_attempts_external_uidx would refuse. Grows as this run claims further ids.
      const reserved = new Set<number>(
        typeof this.repo.findClaimedHardcoverReadIds === 'function' ? await this.repo.findClaimedHardcoverReadIds(userId, book.bookId) : [],
      );
      const historyAttempts = localAttempts.filter(
        (attempt) => attempt.id !== primaryAttempt?.id && attempt.outcome !== 'skimmed' && attempt.outcome !== 'abandoned',
      );
      const syncsPrimaryRead = startDate !== null || endDate !== null || book.progress != null;
      const syncsAudioProgress = book.format != null && isAudioFormat(book.format);
      if (syncsPrimaryRead && book.progress != null) {
        if (syncsAudioProgress && !match.editionAudioSeconds) throw new Error('missing_edition_audio_seconds');
        if (!syncsAudioProgress && !match.editionPages) throw new Error('missing_edition_pages');
      }
      const reads = syncsPrimaryRead || historyAttempts.length > 0 ? await this.findUserBookReads(userId, token, userBookId) : [];

      if (syncsPrimaryRead) {
        const progressPages =
          book.progress != null && !syncsAudioProgress && match.editionPages ? Math.round((book.progress / 100) * match.editionPages) : undefined;
        const progressSeconds =
          book.progress != null && syncsAudioProgress && match.editionAudioSeconds
            ? Math.round((book.progress / 100) * match.editionAudioSeconds)
            : undefined;
        progressSynced = book.progress == null || progressPages != null || progressSeconds != null;

        hardcoverReadId = await this.syncAttemptRead(userId, token, {
          userBookId,
          attempt: primaryAttempt,
          // The projection writes the primary attempt's dates onto the book, so the book-level dates
          // this sync sends are the same dates the read must carry.
          target: readTargetForBook(startDate, endDate),
          reads,
          reserved,
          startedAt: startDate,
          finishedAt: endDate,
          progressPages,
          progressSeconds,
          editionId: match.hardcoverEditionId ?? undefined,
        });

        if ((progressPages != null || progressSeconds != null) && hardcoverReadId != null) {
          await this.updateAdditionalOpenReads(userId, token, {
            reads,
            primaryReadId: hardcoverReadId,
            reservedReadIds: reserved,
            startedAt: startDate,
            finishedAt: endDate,
            progressPages,
            progressSeconds,
            editionId: match.hardcoverEditionId ?? undefined,
          });

          this.logger.log(
            `[hardcover.sync_progress] [end] userId=${userId} bookId=${book.bookId} hardcoverBookId=${match.hardcoverBookId} hardcoverReadId=${hardcoverReadId} durationMs=${Date.now() - startedAt} progress=${book.progress} progressPages=${progressPages ?? null} progressSeconds=${progressSeconds ?? null} - progress sent to Hardcover`,
          );
        }
      }

      for (const attempt of historyAttempts) {
        await this.syncAttemptRead(userId, token, {
          userBookId,
          attempt,
          target: readTargetForAttempt(attempt),
          reads,
          reserved,
          startedAt: attempt.startedOn,
          finishedAt: attempt.outcome === 'completed' ? attempt.endedOn : null,
          editionId: match.hardcoverEditionId ?? undefined,
        });
      }

      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        hardcoverBookId: match.hardcoverBookId,
        hardcoverEditionId: match.hardcoverEditionId,
        hardcoverUserBookId: userBookId,
        hardcoverReadId,
        matchMethod: match.matchMethod,
        matchError: null,
        syncError: null,
        lastSyncedAt: new Date(),
        lastSyncedStatus: book.status,
        lastSyncedProgress: progressSynced ? book.progress : null,
        lastSyncedRating: book.rating,
        lastSyncedStartedAt: startDate,
        lastSyncedFinishedAt: endDate,
      });

      this.logger.log(
        `[hardcover.sync_book] [end] userId=${userId} bookId=${book.bookId} hardcoverBookId=${match.hardcoverBookId} hardcoverEditionId=${match.hardcoverEditionId ?? null} hardcoverUserBookId=${userBookId} hardcoverReadId=${hardcoverReadId ?? null} durationMs=${Date.now() - startedAt} matchMethod=${match.matchMethod} statusId=${hardcoverStatusId} rating=${hardcoverRating ?? null} - synced`,
      );
      return 'synced';
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      const cause = describeErrorCause(err);
      const causeField = cause ? ` cause="${sanitizeLogValue(cause)}"` : '';
      this.logger.error(
        `[hardcover.sync_book] [fail] userId=${userId} bookId=${book.bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}"${causeField} - sync failed`,
      );
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        hardcoverBookId: match.hardcoverBookId,
        matchMethod: match.matchMethod,
        syncError: error,
      });
      return 'failed';
    }
  }

  private async insertOrFindUserBook(
    userId: number,
    token: string,
    input: { bookId: number; statusId: number; privacySettingId: number; editionId?: number },
  ): Promise<number> {
    const insertResult = await this.client.query<InsertUserBookResult>(userId, token, INSERT_USER_BOOK_MUTATION, {
      object: {
        book_id: input.bookId,
        status_id: input.statusId,
        privacy_setting_id: input.privacySettingId,
        ...(input.editionId != null && { edition_id: input.editionId }),
      },
    });

    const userBookId = insertResult.insert_user_book?.user_book?.id;
    if (userBookId) return userBookId;

    const findResult = await this.client.query<FindUserBookResult>(userId, token, FIND_USER_BOOK_QUERY, {
      bookId: input.bookId,
    });

    const existingId = findResult.me?.user_books?.[0]?.id;
    if (!existingId) throw new Error(`Book ${input.bookId} not found in Hardcover library after insert`);

    return existingId;
  }

  private async updateUserBookFields(
    userId: number,
    token: string,
    userBookId: number,
    fields: { statusId: number; privacySettingId: number; rating: number | null; editionId?: number },
  ): Promise<void> {
    try {
      const result = await this.client.query<UpdateUserBookResult>(userId, token, UPDATE_USER_BOOK_MUTATION, {
        id: userBookId,
        object: {
          status_id: fields.statusId,
          privacy_setting_id: fields.privacySettingId,
          ...(fields.rating != null && { rating: fields.rating }),
          ...(fields.editionId != null && { edition_id: fields.editionId }),
        },
      });

      if (result.update_user_book?.error) {
        throw new Error(result.update_user_book.error);
      }
    } catch (err) {
      this.logger.warn(
        `[hardcover.sync_book] update_user_book failed for userBookId=${userBookId}: ${sanitizeLogValue(err instanceof Error ? err.message : String(err))}`,
      );
    }
  }

  private async upsertUserBookRead(
    userId: number,
    token: string,
    input: {
      userBookId: number;
      existingReadId: number | null;
      startedAt?: string | null;
      finishedAt?: string | null;
      progressPages?: number;
      progressSeconds?: number;
      editionId?: number;
    },
  ): Promise<number | null> {
    const object: Record<string, unknown> = {};
    if (input.startedAt) object['started_at'] = input.startedAt;
    if (input.finishedAt) object['finished_at'] = input.finishedAt;
    if (input.progressPages != null) object['progress_pages'] = input.progressPages;
    if (input.progressSeconds != null) object['progress_seconds'] = input.progressSeconds;
    if (input.editionId != null) object['edition_id'] = input.editionId;

    if (input.existingReadId) {
      return this.updateUserBookRead(userId, token, input.existingReadId, object);
    }

    const result = await this.client.query<InsertUserBookReadResult>(userId, token, INSERT_USER_BOOK_READ_MUTATION, {
      userBookId: input.userBookId,
      object,
    });

    if (result.insert_user_book_read?.error) {
      throw new Error(result.insert_user_book_read.error);
    }

    return result.insert_user_book_read?.user_book_read?.id ?? null;
  }

  private async updateUserBookRead(userId: number, token: string, readId: number, object: Record<string, unknown>): Promise<number> {
    const result = await this.client.query<UpdateUserBookReadResult>(userId, token, UPDATE_USER_BOOK_READ_MUTATION, {
      id: readId,
      object,
    });

    if (result.update_user_book_read?.error) {
      throw new Error(result.update_user_book_read.error);
    }

    return result.update_user_book_read?.user_book_read?.id ?? readId;
  }

  private async findUserBookReads(userId: number, token: string, userBookId: number): Promise<FindUserBookReadsResult['user_book_reads']> {
    const result = await this.client.query<FindUserBookReadsResult>(userId, token, FIND_USER_BOOK_READS_QUERY, { userBookId });
    return result.user_book_reads ?? [];
  }

  /**
   * Resolves the one Hardcover read that represents `attempt` and writes this sync's values to it.
   *
   * Ownership lives on reading_attempts.external_id, never on the book-level cache. An attempt that
   * already owns a read keeps it; an unlinked attempt may only adopt a read nothing else owns, and
   * claims it locally before the remote write so a lost race cannot edit another attempt's read.
   * When nothing is adoptable the sync mints a fresh read rather than sharing an existing one.
   */
  private async syncAttemptRead(
    userId: number,
    token: string,
    input: {
      userBookId: number;
      attempt: ReadingAttemptForSync | null | undefined;
      target: HardcoverReadTarget;
      reads: readonly HardcoverReadCandidate[];
      reserved: Set<number>;
      startedAt?: string | null;
      finishedAt?: string | null;
      progressPages?: number;
      progressSeconds?: number;
      editionId?: number;
    },
  ): Promise<number | null> {
    const attempt = input.attempt ?? null;
    const write = (existingReadId: number | null): Promise<number | null> =>
      this.upsertUserBookRead(userId, token, {
        userBookId: input.userBookId,
        existingReadId,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        progressPages: input.progressPages,
        progressSeconds: input.progressSeconds,
        editionId: input.editionId,
      });

    const owned = attempt ? attemptOwnedReadId(attempt) : null;
    if (owned != null && attempt) {
      input.reserved.add(owned);
      const readId = await write(owned);
      if (readId == null || readId === owned) return readId;
      // Hardcover answered with a different read, so move the stamp rather than leave it stale.
      input.reserved.add(readId);
      if ((await this.repo.linkReadingAttempt(userId, attempt.id, readId)) === 'conflict') {
        throw new Error('read_link_conflict');
      }
      return readId;
    }

    const excluded = new Set(input.reserved);
    for (let round = 0; round < MAX_READ_ADOPTION_ROUNDS; round++) {
      const candidate = selectAdoptableReadId(input.reads, input.target, excluded);
      if (candidate == null) break;
      if (attempt && (await this.repo.linkReadingAttempt(userId, attempt.id, candidate)) === 'conflict') {
        excluded.add(candidate);
        continue;
      }
      input.reserved.add(candidate);
      return await write(candidate);
    }

    const created = await write(null);
    if (created == null) return null;
    input.reserved.add(created);
    if (attempt && (await this.repo.linkReadingAttempt(userId, attempt.id, created)) === 'conflict') {
      throw new Error('read_link_conflict');
    }
    return created;
  }

  private async updateAdditionalOpenReads(
    userId: number,
    token: string,
    input: {
      reads: FindUserBookReadsResult['user_book_reads'];
      primaryReadId: number;
      reservedReadIds: ReadonlySet<number>;
      startedAt?: string | null;
      finishedAt?: string | null;
      progressPages?: number;
      progressSeconds?: number;
      editionId?: number;
    },
  ): Promise<void> {
    const siblingReadIds = input.reads
      .filter((read) => read.id !== input.primaryReadId && !read.finished_at && !input.reservedReadIds.has(read.id))
      .map((read) => read.id);

    if (siblingReadIds.length === 0) return;

    await Promise.all(
      siblingReadIds.map((readId) =>
        this.updateUserBookRead(userId, token, readId, {
          ...(input.startedAt ? { started_at: input.startedAt } : {}),
          ...(input.finishedAt ? { finished_at: input.finishedAt } : {}),
          ...(input.progressPages != null ? { progress_pages: input.progressPages } : {}),
          ...(input.progressSeconds != null ? { progress_seconds: input.progressSeconds } : {}),
          ...(input.editionId != null ? { edition_id: input.editionId } : {}),
        }).catch(() => undefined),
      ),
    );
  }

  private hasChanges(book: BookSyncData, state: Awaited<ReturnType<HardcoverRepository['findBookState']>>): boolean {
    if (!state?.lastSyncedAt) return true;
    if (book.attemptsUpdatedAt && book.attemptsUpdatedAt > state.lastSyncedAt) return true;
    if (book.hardcoverMetadataId && state.syncError === 'no_match') return true;
    const metadataHardcoverId = parseHardcoverBookId(book.hardcoverMetadataId);
    if (metadataHardcoverId !== null && metadataHardcoverId !== state.hardcoverBookId) return true;
    if (book.status !== state.lastSyncedStatus) return true;
    if (book.progress !== state.lastSyncedProgress) return true;
    if (book.rating !== state.lastSyncedRating) return true;
    const startDate = toDateString(book.startedAt);
    const endDate = toDateString(book.finishedAt);
    if (startDate !== state.lastSyncedStartedAt) return true;
    if (endDate !== state.lastSyncedFinishedAt) return true;
    return false;
  }

  private buildAttemptSnapshot(book: BookSyncData) {
    return {
      lastSyncedAt: new Date(),
      lastSyncedStatus: book.status,
      lastSyncedProgress: book.progress,
      lastSyncedRating: book.rating,
      lastSyncedStartedAt: toDateString(book.startedAt),
      lastSyncedFinishedAt: toDateString(book.finishedAt),
    };
  }

  private resolveSyncDecision(
    settings: Awaited<ReturnType<HardcoverSettingsService['getSettings']>>,
    book: BookSyncData,
    state?: HardcoverBookStateSnapshot,
  ) {
    const syncOverride = normalizeHardcoverBookSyncOverride(state);
    const decision = resolveHardcoverBookSyncDecision({
      settings,
      status: book.status,
      syncOverride,
    });

    return {
      ...decision,
      canSyncNow: decision.syncEnabled && this.hasChanges(book, state),
    };
  }

  private isBookInSyncScope(
    settings: Awaited<ReturnType<HardcoverSettingsService['getSettings']>>,
    book: BookSyncData,
    state?: HardcoverBookStateSnapshot,
  ): boolean {
    if (!settings.effectiveEnabled) return false;
    if (book.status === 'unread') return false;

    const syncOverride = normalizeHardcoverBookSyncOverride(state);
    if (syncOverride === 'excluded') return false;
    if (syncOverride === 'included') return true;
    return settings.bookSyncMode === 'all_eligible';
  }

  private toBookSyncState(
    bookId: number,
    book: BookSyncData,
    settings: Awaited<ReturnType<HardcoverSettingsService['getSettings']>>,
    state?: HardcoverBookStateSnapshot,
  ): HardcoverBookSyncState {
    const syncOverride = normalizeHardcoverBookSyncOverride(state);
    const decision = resolveHardcoverBookSyncDecision({
      settings,
      status: book.status,
      syncOverride,
    });

    return {
      bookId,
      syncOverride,
      syncEnabled: decision.syncEnabled,
      canSyncNow: decision.syncEnabled && this.hasChanges(book, state),
      effectiveReason: decision.effectiveReason,
      lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
      syncError: state?.syncError ?? null,
    };
  }

  private bookNotFoundState(bookId: number): HardcoverBookSyncState {
    return {
      bookId,
      syncOverride: null,
      syncEnabled: false,
      canSyncNow: false,
      effectiveReason: 'unsupported_status',
      lastSyncedAt: null,
      syncError: null,
    };
  }

  private isSameActiveStatus(prev: HardcoverActiveSyncStatus | null, next: HardcoverActiveSyncStatus | null): boolean {
    if (prev === next) return true;
    if (!prev || !next) return false;
    return prev.runId === next.runId && prev.status === next.status && prev.syncedBooks === next.syncedBooks && prev.totalBooks === next.totalBooks;
  }

  private emitSyncStatus(userId: number, status: HardcoverActiveSyncStatus | null): void {
    this.syncStatusEvents.next({ userId, status });
  }
}
