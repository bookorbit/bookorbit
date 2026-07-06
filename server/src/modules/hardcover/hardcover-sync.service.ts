import type {
  HardcoverActiveSyncStatus,
  HardcoverBookSyncState,
  HardcoverSettings,
  HardcoverSyncPendingSummary,
  ReadStatus,
  UpdateHardcoverBookSyncPayload,
} from '@bookorbit/types';

import { Injectable, Logger } from '@nestjs/common';
import { distinctUntilChanged, filter, map, merge, Observable, of, Subject } from 'rxjs';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { HARDCOVER_STATUS } from './hardcover.constants';
import { HardcoverBookMatchService } from './hardcover-book-match.service';
import { HardcoverClientService } from './hardcover-client.service';
import { type BookSyncData, HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';
import {
  normalizeHardcoverBookSyncOverride,
  resolveHardcoverBookSyncDecision,
  resolveHardcoverBookSyncOverrideForToggle,
} from './hardcover-sync-policy';

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
  }
}`;

type InsertUserBookResult = { insert_user_book: { user_book: { id: number } | null; error: string | null } };
type UpdateUserBookResult = { update_user_book: { user_book: { id: number } | null; error: string | null } };
type FindUserBookResult = { me: { user_books: { id: number }[] } };
type InsertUserBookReadResult = { insert_user_book_read: { user_book_read: { id: number } | null; error: string | null } };
type UpdateUserBookReadResult = { update_user_book_read: { user_book_read: { id: number } | null; error: string | null } };
type FindUserBookReadsResult = {
  user_book_reads: Array<{ id: number; started_at: string | null; finished_at: string | null; progress_pages: number | null }>;
};

export type HardcoverSyncBookResult = 'synced' | 'skipped' | 'failed';
type HardcoverBookStateSnapshot = Awaited<ReturnType<HardcoverRepository['findBookState']>>;

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

      if (startDate || endDate || book.progress != null) {
        if (book.progress != null && !match.editionPages) {
          throw new Error('missing_edition_pages');
        }

        const progressPages = book.progress != null && match.editionPages ? Math.round((book.progress / 100) * match.editionPages) : undefined;
        progressSynced = book.progress == null || progressPages != null;

        const reads = await this.findUserBookReads(userId, token, userBookId);
        const targetReadId = this.resolveTargetReadId(hardcoverReadId, reads);

        hardcoverReadId = await this.upsertUserBookRead(userId, token, {
          userBookId,
          existingReadId: targetReadId,
          startedAt: startDate,
          finishedAt: endDate,
          progressPages,
          editionId: match.hardcoverEditionId ?? undefined,
        });

        if (progressPages != null && hardcoverReadId != null) {
          await this.updateAdditionalOpenReads(userId, token, {
            reads,
            primaryReadId: hardcoverReadId,
            startedAt: startDate,
            finishedAt: endDate,
            progressPages,
            editionId: match.hardcoverEditionId ?? undefined,
          });

          this.logger.log(
            `[hardcover.sync_progress] [end] userId=${userId} bookId=${book.bookId} hardcoverBookId=${match.hardcoverBookId} hardcoverReadId=${hardcoverReadId} durationMs=${Date.now() - startedAt} progress=${book.progress} progressPages=${progressPages} - progress sent to Hardcover`,
          );
        }
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
      this.logger.error(
        `[hardcover.sync_book] [fail] userId=${userId} bookId=${book.bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - sync failed`,
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
      editionId?: number;
    },
  ): Promise<number | null> {
    const object: Record<string, unknown> = {};
    if (input.startedAt) object['started_at'] = input.startedAt;
    if (input.finishedAt) object['finished_at'] = input.finishedAt;
    if (input.progressPages != null) object['progress_pages'] = input.progressPages;
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
    try {
      const result = await this.client.query<FindUserBookReadsResult>(userId, token, FIND_USER_BOOK_READS_QUERY, { userBookId });
      return result.user_book_reads ?? [];
    } catch {
      return [];
    }
  }

  private resolveTargetReadId(existingReadId: number | null, reads: FindUserBookReadsResult['user_book_reads']): number | null {
    const openRead = reads.find((read) => !read.finished_at);
    if (openRead) return openRead.id;
    if (existingReadId) return existingReadId;
    return reads[0]?.id ?? null;
  }

  private async updateAdditionalOpenReads(
    userId: number,
    token: string,
    input: {
      reads: FindUserBookReadsResult['user_book_reads'];
      primaryReadId: number;
      startedAt?: string | null;
      finishedAt?: string | null;
      progressPages: number;
      editionId?: number;
    },
  ): Promise<void> {
    const siblingReadIds = input.reads.filter((read) => read.id !== input.primaryReadId && !read.finished_at).map((read) => read.id);

    if (siblingReadIds.length === 0) return;

    await Promise.all(
      siblingReadIds.map((readId) =>
        this.updateUserBookRead(userId, token, readId, {
          ...(input.startedAt ? { started_at: input.startedAt } : {}),
          ...(input.finishedAt ? { finished_at: input.finishedAt } : {}),
          progress_pages: input.progressPages,
          ...(input.editionId != null ? { edition_id: input.editionId } : {}),
        }).catch(() => undefined),
      ),
    );
  }

  private hasChanges(book: BookSyncData, state: Awaited<ReturnType<HardcoverRepository['findBookState']>>): boolean {
    if (!state?.lastSyncedAt) return true;
    if (book.hardcoverMetadataId && state.syncError === 'no_match') return true;
    const metadataHardcoverId = this.parseNumericHardcoverMetadataId(book.hardcoverMetadataId);
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

  private parseNumericHardcoverMetadataId(value: string | null | undefined): number | null {
    if (!value) return null;
    const id = parseInt(value, 10);
    return isNaN(id) ? null : id;
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
