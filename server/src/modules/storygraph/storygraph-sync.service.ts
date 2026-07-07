import type { ReadStatus } from '@bookorbit/types';
import type {
  StorygraphActiveSyncStatus,
  StorygraphSyncFailure,
  StorygraphBookSyncEffectiveReason,
  StorygraphBookSyncState,
  StorygraphEdition,
  StorygraphLinkedBook,
  StorygraphLinkResult,
  StorygraphSettings,
  StorygraphSyncPendingSummary,
  UpdateStorygraphBookSyncPayload,
} from '@bookorbit/types';

import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { distinctUntilChanged, filter, map, merge, Observable, of, Subject } from 'rxjs';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { StorygraphBookMatchService } from './storygraph-book-match.service';
import { StorygraphClientService, type StorygraphCookies } from './storygraph-client.service';
import { type BookSyncData, StorygraphRepository } from './storygraph.repository';
import { StorygraphSettingsService } from './storygraph-settings.service';
import { STORYGRAPH_STATUS } from './storygraph.constants';
import {
  normalizeStorygraphBookSyncOverride,
  resolveStorygraphBookSyncDecision,
  resolveStorygraphBookSyncOverrideForToggle,
} from './storygraph-sync-policy';

// "Linked books" only needs to manage matches for books actively being read right now —
// finished/want-to-read books aren't useful to manually re-link from that view.
const CURRENTLY_READING_STATUSES = new Set<ReadStatus>(['reading', 'rereading']);

const STATUS_MAP: Partial<Record<ReadStatus, string>> = {
  want_to_read: STORYGRAPH_STATUS.WANT_TO_READ,
  reading: STORYGRAPH_STATUS.CURRENTLY_READING,
  rereading: STORYGRAPH_STATUS.REREADING,
  on_hold: STORYGRAPH_STATUS.PAUSED,
  read: STORYGRAPH_STATUS.READ,
  skimmed: STORYGRAPH_STATUS.READ,
  abandoned: STORYGRAPH_STATUS.DID_NOT_FINISH,
};

export type StorygraphSyncBookResult = 'synced' | 'skipped' | 'failed';
type StorygraphBookStateSnapshot = Awaited<ReturnType<StorygraphRepository['findBookState']>>;

function isSuccessStatus(status: number): boolean {
  return (status >= 200 && status < 300) || status === 302 || status === 303;
}

@Injectable()
export class StorygraphSyncService {
  private readonly logger = new Logger(StorygraphSyncService.name);
  private readonly cancelRequests = new Set<number>();
  private readonly syncStatusEvents = new Subject<{ userId: number; status: StorygraphActiveSyncStatus | null }>();
  private readonly activeSyncs = new Map<number, StorygraphActiveSyncStatus>();
  private syncRunCounter = 0;

  constructor(
    private readonly repo: StorygraphRepository,
    private readonly client: StorygraphClientService,
    private readonly matchService: StorygraphBookMatchService,
    private readonly settingsService: StorygraphSettingsService,
  ) {}

  async syncBook(userId: number, bookId: number): Promise<StorygraphSyncBookResult> {
    const cookies = await this.settingsService.getCookiesForUser(userId);
    if (!cookies) return 'skipped';

    const book = await this.repo.findBookSyncData(userId, bookId);
    if (!book) return 'skipped';

    const [settings, state] = await Promise.all([this.settingsService.getSettings(userId), this.repo.findBookState(userId, book.bookId)]);
    const decision = this.resolveBookSyncDecision(settings, book, state, true);
    if (!decision.syncEnabled) {
      // A book taken back to "unread" no longer maps to a StoryGraph shelf entry, so drop the
      // synced markers (keeping the match) — otherwise re-adding it later reads as "already
      // synced" against a stale status and is silently skipped.
      if (decision.effectiveReason === 'unread' && state?.lastSyncedAt) {
        await this.repo.resetSyncProgress(userId, book.bookId);
      }
      return 'skipped';
    }
    if (!this.hasChanges(book, state)) return 'skipped';

    return this.syncSingleBook(userId, cookies, book, state);
  }

  async getBookSyncState(userId: number, bookId: number): Promise<StorygraphBookSyncState> {
    const [settings, book, state] = await Promise.all([
      this.settingsService.getSettings(userId),
      this.repo.findBookSyncData(userId, bookId),
      this.repo.findBookState(userId, bookId),
    ]);
    return this.toBookSyncState(bookId, settings, book, state);
  }

  async updateBookSyncState(userId: number, bookId: number, payload: UpdateStorygraphBookSyncPayload): Promise<StorygraphBookSyncState> {
    const [settings, book] = await Promise.all([this.settingsService.getSettings(userId), this.repo.findBookSyncData(userId, bookId)]);
    if (!book) return this.bookNotFoundState(bookId, settings);

    const state = await this.repo.setBookSyncOverride(
      userId,
      bookId,
      resolveStorygraphBookSyncOverrideForToggle(settings.bookSyncMode, payload.syncEnabled),
    );
    return this.toBookSyncState(bookId, settings, book, state);
  }

  // Clears a (possibly wrong) cached match and forces a fresh match + sync attempt, even if
  // status/progress haven't changed since the last sync.
  async rematchBook(userId: number, bookId: number): Promise<StorygraphSyncBookResult> {
    await this.repo.clearBookMatch(userId, bookId);
    return this.syncBook(userId, bookId);
  }

  // Links a book directly to a StoryGraph URL/id the user supplied, bypassing search/scoring
  // entirely — the user is telling us exactly which book is correct.
  async linkBookManually(userId: number, bookId: number, input: string): Promise<StorygraphLinkResult> {
    const cookies = await this.settingsService.getCookiesForUser(userId);
    if (!cookies) return { success: false };

    const resolved = await this.matchService.resolveManualInput(userId, cookies, input);
    if (!resolved) return { success: false };

    await this.repo.upsertBookState({
      userId,
      bookId,
      storygraphBookId: resolved.storygraphBookId,
      matchMethod: 'manual',
      matchError: null,
      lastSyncedAt: null,
    });

    await this.syncBook(userId, bookId);

    return { success: true, storygraphBookId: resolved.storygraphBookId, title: resolved.title };
  }

  async listEditions(userId: number, bookId: number): Promise<StorygraphEdition[]> {
    const cookies = await this.settingsService.getCookiesForUser(userId);
    if (!cookies) return [];

    const state = await this.repo.findBookState(userId, bookId);
    if (!state?.storygraphBookId) return [];

    return this.matchService.getEditions(userId, cookies, state.storygraphBookId);
  }

  async setEdition(userId: number, bookId: number, editionId: string): Promise<{ success: boolean }> {
    const cookies = await this.settingsService.getCookiesForUser(userId);
    if (!cookies) return { success: false };

    const state = await this.repo.findBookState(userId, bookId);
    const currentId = state?.storygraphBookId;
    if (!currentId) return { success: false };

    const switched = await this.matchService.switchEdition(userId, cookies, currentId, editionId);
    if (!switched) return { success: false };

    await this.repo.upsertBookState({
      userId,
      bookId,
      storygraphBookId: editionId,
      matchMethod: 'manual',
      matchError: null,
      lastSyncedAt: null,
    });

    await this.syncBook(userId, bookId);

    return { success: true };
  }

  async listLinkedBooks(userId: number): Promise<StorygraphLinkedBook[]> {
    const allBooks = await this.repo.findSyncableBooks(userId);
    const books = allBooks.filter((book) => CURRENTLY_READING_STATUSES.has(book.status as ReadStatus));
    const states = await this.repo.findBookStatesByBookIds(
      userId,
      books.map((book) => book.bookId),
    );
    const stateByBookId = new Map(states.map((state) => [state.bookId, state]));

    return books.map((book) => {
      const state = stateByBookId.get(book.bookId);
      return {
        bookId: book.bookId,
        title: book.title,
        authorName: book.authorName,
        storygraphBookId: state?.storygraphBookId ?? null,
        matchMethod: state?.matchMethod ?? null,
        matchError: state?.matchError ?? null,
      };
    });
  }

  async syncAll(userId: number): Promise<number> {
    const existing = this.activeSyncs.get(userId);
    if (existing) {
      this.logger.warn(`[storygraph.sync_all] userId=${userId} runId=${existing.runId} - sync already running`);
      this.emitSyncStatus(userId, existing);
      return existing.runId;
    }

    const cookies = await this.settingsService.getCookiesForUser(userId);
    if (!cookies) return 0;

    const books = await this.filterBooksInSyncScope(userId, await this.repo.findSyncableBooks(userId));

    // Re-check: a concurrent syncAll may have won the race during findSyncableBooks
    const recheck = this.activeSyncs.get(userId);
    if (recheck) {
      this.logger.warn(`[storygraph.sync_all] userId=${userId} runId=${recheck.runId} - sync started concurrently`);
      this.emitSyncStatus(userId, recheck);
      return recheck.runId;
    }

    const runId = ++this.syncRunCounter;
    const status: StorygraphActiveSyncStatus = {
      runId,
      syncedBooks: 0,
      skippedBooks: 0,
      failedBooks: 0,
      processedBooks: 0,
      totalBooks: books.length,
      status: 'running',
    };
    this.activeSyncs.set(userId, status);

    this.logger.log(`[storygraph.sync_all] [start] userId=${userId} runId=${runId} totalBooks=${books.length} - sync all started`);
    this.emitSyncStatus(userId, status);

    this.runSyncAll(userId, cookies, books, runId).catch((err) => {
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[storygraph.sync_all] [fail] userId=${userId} runId=${runId} errorClass=${err?.constructor?.name ?? 'Error'} error="${error}" - sync all crashed`,
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
    this.emitSyncStatus(userId, { ...run, status: 'cancelled' });
    this.emitSyncStatus(userId, null);
    this.logger.log(`[storygraph.sync_all] userId=${userId} runId=${run.runId} - sync cancelled`);
  }

  getSyncStatus(userId: number): StorygraphActiveSyncStatus | null {
    return this.activeSyncs.get(userId) ?? null;
  }

  streamSyncStatus(userId: number): Observable<StorygraphActiveSyncStatus | null> {
    return merge(
      of(this.getSyncStatus(userId)),
      this.syncStatusEvents.pipe(
        filter((event) => event.userId === userId),
        map((event) => event.status),
      ),
    ).pipe(distinctUntilChanged((prev, next) => this.isSameActiveStatus(prev, next)));
  }

  async listSyncFailures(userId: number): Promise<StorygraphSyncFailure[]> {
    const rows = await this.repo.findBooksWithSyncErrors(userId);
    return rows.map((row) => ({
      bookId: row.bookId,
      title: row.title ?? 'Unknown title',
      authorName: row.authorName,
      syncError: row.syncError,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    }));
  }

  async getSyncPendingSummary(userId: number): Promise<StorygraphSyncPendingSummary> {
    const cookies = await this.settingsService.getCookiesForUser(userId);
    if (!cookies) {
      return { totalBooks: 0, pendingBooks: 0 };
    }

    const books = await this.filterBooksInSyncScope(userId, await this.repo.findSyncableBooks(userId));
    if (books.length === 0) {
      return { totalBooks: 0, pendingBooks: 0 };
    }

    const states = await this.repo.findBookStatesByBookIds(
      userId,
      books.map((book) => book.bookId),
    );
    const stateByBookId = new Map(states.map((state) => [state.bookId, state]));

    let pendingBooks = 0;
    for (const book of books) {
      if (book.status === 'unread') continue;
      if (this.hasChanges(book, stateByBookId.get(book.bookId))) {
        pendingBooks++;
      }
    }

    return {
      totalBooks: books.length,
      pendingBooks,
    };
  }

  private async runSyncAll(userId: number, cookies: StorygraphCookies, books: BookSyncData[], runId: number): Promise<void> {
    const startedAt = Date.now();
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    for (const book of books) {
      if (this.cancelRequests.has(userId)) {
        this.cancelRequests.delete(userId);
        this.logger.log(`[storygraph.sync_all] userId=${userId} runId=${runId} - cancelled mid-run`);
        return;
      }

      if (book.status === 'unread') {
        skipped++;
        this.emitProgress(userId, { synced, skipped, failed });
        continue;
      }

      const state = await this.repo.findBookState(userId, book.bookId);
      const settings = await this.settingsService.getSettings(userId);
      if (!this.resolveBookSyncDecision(settings, book, state, true).syncEnabled) {
        skipped++;
        this.emitProgress(userId, { synced, skipped, failed });
        continue;
      }

      if (!this.hasChanges(book, state)) {
        skipped++;
        this.emitProgress(userId, { synced, skipped, failed });
        continue;
      }

      const result = await this.syncSingleBook(userId, cookies, book, state);
      if (result === 'synced') synced++;
      else if (result === 'skipped') skipped++;
      else failed++;

      this.emitProgress(userId, { synced, skipped, failed });
    }

    // Handle cancel requested after the last book was processed (loop exited without hitting the top check)
    if (this.cancelRequests.has(userId)) {
      this.cancelRequests.delete(userId);
      this.logger.log(`[storygraph.sync_all] userId=${userId} runId=${runId} - cancelled after last book`);
      this.activeSyncs.delete(userId);
      return;
    }

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[storygraph.sync_all] [end] userId=${userId} runId=${runId} durationMs=${durationMs} syncedBooks=${synced} failedBooks=${failed} skippedBooks=${skipped} - sync all completed`,
    );

    await this.repo.updateLastSyncedAt(userId, new Date());
    const current = this.activeSyncs.get(userId);
    if (current) {
      this.emitSyncStatus(userId, { ...current, status: 'completed' });
    }
    this.activeSyncs.delete(userId);
    this.emitSyncStatus(userId, null);
  }

  private emitProgress(userId: number, counts: { synced: number; skipped: number; failed: number }): void {
    const activeStatus = this.activeSyncs.get(userId);
    if (!activeStatus) {
      this.emitSyncStatus(userId, null);
      return;
    }
    // Emit a fresh snapshot: mutating the stored object in place would make the stream's
    // distinctUntilChanged compare an object against itself and drop every progress update.
    const next: StorygraphActiveSyncStatus = {
      ...activeStatus,
      syncedBooks: counts.synced,
      skippedBooks: counts.skipped,
      failedBooks: counts.failed,
      processedBooks: counts.synced + counts.skipped + counts.failed,
    };
    this.activeSyncs.set(userId, next);
    this.emitSyncStatus(userId, next);
  }

  private async syncSingleBook(
    userId: number,
    cookies: StorygraphCookies,
    book: BookSyncData,
    initialState?: StorygraphBookStateSnapshot,
  ): Promise<StorygraphSyncBookResult> {
    const startedAt = Date.now();

    const storygraphStatus = STATUS_MAP[book.status as ReadStatus];
    if (!storygraphStatus) {
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        syncError: `no_status_mapping:${book.status}`,
        ...this.buildAttemptSnapshot(book),
      });
      return 'skipped';
    }

    const match = await this.matchService.matchBook(userId, cookies, book);
    if (!match) {
      const state = initialState ?? (await this.repo.findBookState(userId, book.bookId));
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        storygraphBookId: state?.storygraphBookId ?? null,
        syncError: 'no_match',
        ...this.buildAttemptSnapshot(book),
      });
      this.logger.warn(
        `[storygraph.sync_book] [fail] userId=${userId} bookId=${book.bookId} durationMs=${Date.now() - startedAt} errorClass=MatchError error="no_match" - StoryGraph book match not found`,
      );
      return 'skipped';
    }

    try {
      await this.updateStatus(userId, cookies, match.storygraphBookId, storygraphStatus);

      let progressSynced = true;
      if (book.progress != null) {
        progressSynced = await this.updateProgress(userId, cookies, match.storygraphBookId, book.progress);
      }

      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        storygraphBookId: match.storygraphBookId,
        matchMethod: match.matchMethod,
        matchError: null,
        syncError: null,
        lastSyncedAt: new Date(),
        lastSyncedStatus: book.status,
        lastSyncedProgress: progressSynced ? book.progress : null,
      });

      this.logger.log(
        `[storygraph.sync_book] [end] userId=${userId} bookId=${book.bookId} storygraphBookId=${match.storygraphBookId} durationMs=${Date.now() - startedAt} matchMethod=${match.matchMethod} status=${storygraphStatus} - synced`,
      );
      return 'synced';
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.error(
        `[storygraph.sync_book] [fail] userId=${userId} bookId=${book.bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - sync failed`,
      );
      await this.repo.upsertBookState({
        userId,
        bookId: book.bookId,
        storygraphBookId: match.storygraphBookId,
        matchMethod: match.matchMethod,
        syncError: error,
      });
      return 'failed';
    }
  }

  private async fetchBookPage(userId: number, cookies: StorygraphCookies, storygraphBookId: string): Promise<{ html: string; csrf: string }> {
    const response = await this.client.get(userId, cookies, `/books/${storygraphBookId}`);
    if (response.redirectedToSignIn) {
      throw new Error('storygraph_session_expired');
    }
    const csrf = this.client.extractCsrfToken(response.html);
    if (!csrf) {
      throw new Error('missing_csrf_token');
    }
    return { html: response.html, csrf };
  }

  private async updateStatus(userId: number, cookies: StorygraphCookies, storygraphBookId: string, status: string): Promise<void> {
    const { csrf } = await this.fetchBookPage(userId, cookies, storygraphBookId);

    const response = await this.client.post(userId, cookies, `/update-status.js?book_id=${storygraphBookId}&status=${status}`, {}, csrf);

    if (isSuccessStatus(response.status) && !response.redirectedToSignIn) return;

    if (status === STORYGRAPH_STATUS.CURRENTLY_READING) {
      const retry = await this.client.post(
        userId,
        cookies,
        `/update-status.js?book_id=${storygraphBookId}&status=${STORYGRAPH_STATUS.REREADING}`,
        {},
        csrf,
      );
      if (isSuccessStatus(retry.status) && !retry.redirectedToSignIn) return;
      throw new Error(`status_update_failed:${retry.status}`);
    }

    throw new Error(`status_update_failed:${response.status}`);
  }

  private async updateProgress(userId: number, cookies: StorygraphCookies, storygraphBookId: string, progress: number): Promise<boolean> {
    const { html, csrf } = await this.fetchBookPage(userId, cookies, storygraphBookId);
    const bookNumOfPages = this.extractBookNumOfPages(html);

    const response = await this.client.post(
      userId,
      cookies,
      '/update-progress',
      {
        'read_status[progress_number]': String(Math.round(progress)),
        'read_status[progress_type]': 'percentage',
        'read_status[book_num_of_pages]': bookNumOfPages,
        book_id: storygraphBookId,
        on_book_page: 'true',
      },
      csrf,
    );

    return isSuccessStatus(response.status) && !response.redirectedToSignIn;
  }

  private extractBookNumOfPages(html: string): string {
    const $ = cheerio.load(html);
    const value = $('input[name="read_status[book_num_of_pages]"]').attr('value');
    return value ?? '0';
  }

  private async filterBooksInSyncScope(userId: number, books: BookSyncData[]): Promise<BookSyncData[]> {
    const [settings, states] = await Promise.all([
      this.settingsService.getSettings(userId),
      this.repo.findBookStatesByBookIds(
        userId,
        books.map((book) => book.bookId),
      ),
    ]);
    const stateByBookId = new Map(states.map((state) => [state.bookId, state]));
    return books.filter((book) => this.resolveBookSyncDecision(settings, book, stateByBookId.get(book.bookId), true).syncEnabled);
  }

  private hasChanges(book: BookSyncData, state: StorygraphBookStateSnapshot): boolean {
    if (!state?.lastSyncedAt) return true;
    if (book.status !== state.lastSyncedStatus) return true;
    if (book.progress !== state.lastSyncedProgress) return true;
    return false;
  }

  private toBookSyncState(
    bookId: number,
    settings: StorygraphSettings,
    book: BookSyncData | null,
    state: StorygraphBookStateSnapshot,
  ): StorygraphBookSyncState {
    if (!book) return this.bookNotFoundState(bookId, settings, state);

    const decision = this.resolveBookSyncDecision(settings, book, state);
    return {
      bookId,
      syncOverride: normalizeStorygraphBookSyncOverride(state),
      syncEnabled: decision.syncEnabled,
      canSyncNow: decision.syncEnabled && this.hasChanges(book, state),
      effectiveReason: decision.effectiveReason,
      lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
      syncError: state?.syncError ?? null,
    };
  }

  private bookNotFoundState(bookId: number, settings: StorygraphSettings, state?: StorygraphBookStateSnapshot): StorygraphBookSyncState {
    const effectiveReason = settings.effectiveEnabled ? 'unsupported_status' : (settings.disabledReason ?? 'global_disabled');
    return {
      bookId,
      syncOverride: normalizeStorygraphBookSyncOverride(state),
      syncEnabled: false,
      canSyncNow: false,
      effectiveReason,
      lastSyncedAt: state?.lastSyncedAt?.toISOString() ?? null,
      syncError: state?.syncError ?? null,
    };
  }

  private resolveBookSyncDecision(
    settings: StorygraphSettings,
    book: BookSyncData,
    state: StorygraphBookStateSnapshot,
    allowUnsupportedStatus = false,
  ): { syncEnabled: boolean; effectiveReason: StorygraphBookSyncEffectiveReason | null } {
    if (allowUnsupportedStatus && !STATUS_MAP[book.status as ReadStatus] && book.status !== 'unread') {
      const syncOverride = normalizeStorygraphBookSyncOverride(state);
      if (!settings.effectiveEnabled) return { syncEnabled: false, effectiveReason: settings.disabledReason ?? 'global_disabled' };
      if (syncOverride === 'excluded') return { syncEnabled: false, effectiveReason: 'excluded' };
      if (syncOverride === 'included' || settings.bookSyncMode === 'all_eligible') return { syncEnabled: true, effectiveReason: null };
      return { syncEnabled: false, effectiveReason: 'not_selected' };
    }

    return resolveStorygraphBookSyncDecision({
      settings,
      status: book.status,
      syncOverride: normalizeStorygraphBookSyncOverride(state),
    });
  }

  private buildAttemptSnapshot(book: BookSyncData) {
    return {
      lastSyncedAt: new Date(),
      lastSyncedStatus: book.status,
      lastSyncedProgress: book.progress,
    };
  }

  private isSameActiveStatus(prev: StorygraphActiveSyncStatus | null, next: StorygraphActiveSyncStatus | null): boolean {
    if (prev === next) return true;
    if (!prev || !next) return false;
    return (
      prev.runId === next.runId &&
      prev.status === next.status &&
      prev.syncedBooks === next.syncedBooks &&
      prev.processedBooks === next.processedBooks &&
      prev.failedBooks === next.failedBooks &&
      prev.totalBooks === next.totalBooks
    );
  }

  private emitSyncStatus(userId: number, status: StorygraphActiveSyncStatus | null): void {
    this.syncStatusEvents.next({ userId, status });
  }
}
