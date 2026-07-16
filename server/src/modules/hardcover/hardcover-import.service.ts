import {
  isAudioFormat,
  type ApplyHardcoverImportPayload,
  type HardcoverImportedReadStatus,
  type HardcoverImportApplyResult,
  type HardcoverImportMatchMethod,
  type HardcoverImportPreview,
  type HardcoverImportPreviewOutcome,
  type HardcoverImportPreviewRow,
  type HardcoverImportSummary,
} from '@bookorbit/types';
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { distance } from 'fastest-levenshtein';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { LibraryService } from '../library/library.service';
import { UserBookStatusService } from '../user-book-status/user-book-status.service';
import { ReadingAttemptService } from '../user-book-status/reading-attempt.service';
import { HARDCOVER_STATUS } from './hardcover.constants';
import { HardcoverClientService } from './hardcover-client.service';
import { type HardcoverImportLocalBook, HardcoverRepository } from './hardcover.repository';
import { HardcoverSettingsService } from './hardcover-settings.service';

const IMPORT_PAGE_SIZE = 100;
const TITLE_AUTHOR_ACCEPT_SCORE = 86;
const TITLE_AUTHOR_TIE_MARGIN = 5;

const IMPORTABLE_STATUS_MAP: Record<number, { status: HardcoverImportedReadStatus; label: string }> = {
  [HARDCOVER_STATUS.WANT_TO_READ]: { status: 'want_to_read', label: 'Want to Read' },
  [HARDCOVER_STATUS.CURRENTLY_READING]: { status: 'reading', label: 'Currently Reading' },
  [HARDCOVER_STATUS.READ]: { status: 'read', label: 'Read' },
  [HARDCOVER_STATUS.PAUSED]: { status: 'on_hold', label: 'Paused' },
  [HARDCOVER_STATUS.DNF]: { status: 'abandoned', label: 'Did Not Finish' },
};

const HARDCOVER_STATUS_LABELS: Record<number, string> = {
  ...Object.fromEntries(Object.entries(IMPORTABLE_STATUS_MAP).map(([id, value]) => [id, value.label])),
  [HARDCOVER_STATUS.IGNORED]: 'Ignored',
};

const IMPORT_USER_BOOKS_QUERY = `
query PullReadStatus($limit: Int!, $offset: Int!) {
  me {
    user_books(limit: $limit, offset: $offset, order_by: { updated_at: desc }) {
      id
      book_id
      edition_id
      status_id
      first_started_reading_date
      last_read_date
      user_book_status {
        status
      }
      book {
        id
        title
        slug
        cached_contributors
      }
      edition {
        id
        isbn_10
        isbn_13
        pages
        audio_seconds
      }
      user_book_reads(order_by: { id: desc }, limit: 10) {
        id
        started_at
        finished_at
        progress
        progress_pages
        progress_seconds
      }
    }
  }
}`;

interface HardcoverImportGraphQLResult {
  me?: Array<{
    user_books?: HardcoverUserBook[];
  }>;
}

interface HardcoverUserBook {
  id: number;
  book_id: number;
  edition_id: number | null;
  status_id: number;
  first_started_reading_date: string | null;
  last_read_date: string | null;
  user_book_status?: {
    status?: string | null;
  } | null;
  book?: {
    id: number;
    title?: string | null;
    slug?: string | null;
    cached_contributors?: unknown;
  } | null;
  edition?: {
    id: number;
    isbn_10?: string | null;
    isbn_13?: string | null;
    pages?: number | null;
    audio_seconds?: number | null;
  } | null;
  user_book_reads?: Array<{
    id: number;
    started_at: string | null;
    finished_at: string | null;
    progress: number | null;
    progress_pages: number | null;
    progress_seconds: number | null;
  }> | null;
}

interface LocalIndexes {
  books: HardcoverImportLocalBook[];
  byHardcoverId: Map<number, HardcoverImportLocalBook[]>;
  byHardcoverSlug: Map<string, HardcoverImportLocalBook[]>;
  byIsbn: Map<string, HardcoverImportLocalBook[]>;
}

interface MatchResult {
  book: HardcoverImportLocalBook;
  method: HardcoverImportMatchMethod;
  confidence: number;
}

interface MatchFailure {
  outcome: 'unmatched' | 'skipped';
  reason: string;
}

@Injectable()
export class HardcoverImportService {
  private readonly logger = new Logger(HardcoverImportService.name);

  constructor(
    private readonly repo: HardcoverRepository,
    private readonly client: HardcoverClientService,
    private readonly settingsService: HardcoverSettingsService,
    private readonly libraryService: LibraryService,
    private readonly userBookStatusService: UserBookStatusService,
    @Optional() private readonly readingAttempts?: ReadingAttemptService,
  ) {}

  async previewImport(user: RequestUser): Promise<HardcoverImportPreview> {
    const startedAt = Date.now();
    this.logger.log(`[hardcover.import_status] [start] userId=${user.id} mode=preview - import preview started`);

    try {
      const preview = await this.buildPreview(user);
      this.logger.log(
        `[hardcover.import_status] [end] userId=${user.id} mode=preview durationMs=${Date.now() - startedAt} totalHardcoverBooks=${preview.summary.totalHardcoverBooks} willUpdate=${preview.summary.willUpdate} needsReview=${preview.summary.needsReview} conflicts=${preview.summary.conflicts} unmatched=${preview.summary.unmatched} skipped=${preview.summary.skipped} - import preview completed`,
      );
      return preview;
    } catch (err) {
      this.logFailure(user.id, startedAt, err, 'import preview failed');
      throw err;
    }
  }

  async applyImport(user: RequestUser, payload: ApplyHardcoverImportPayload = {}): Promise<HardcoverImportApplyResult> {
    const startedAt = Date.now();
    this.logger.log(`[hardcover.import_status] [start] userId=${user.id} mode=apply - import apply started`);

    try {
      const preview = await this.buildPreview(user);
      const selectedIds = payload.hardcoverUserBookIds ? new Set(payload.hardcoverUserBookIds) : null;
      const importProgress = payload.importProgress === true;
      let applied = 0;
      let progressApplied = 0;
      let failed = 0;

      for (const row of preview.rows) {
        if (!canApplyRow(row, selectedIds) || row.localBookId == null || row.importedStatus == null) continue;

        try {
          if (this.readingAttempts) {
            for (const read of [...(row.hardcoverReads ?? [])].sort((left, right) => left.id - right.id)) {
              await this.readingAttempts.importExternalRead(user.id, row.localBookId, {
                provider: 'hardcover',
                externalId: String(read.id),
                startedOn: read.startedAt?.slice(0, 10) ?? null,
                endedOn: read.finishedAt?.slice(0, 10) ?? null,
              });
            }
          }
          await this.userBookStatusService.updateManual(user.id, row.localBookId, {
            status: row.importedStatus,
            startedAt: toDate(row.importedStartedAt),
            finishedAt: toDate(row.importedFinishedAt),
          });

          const progressImported = await this.applyProgressIfRequested(user.id, row, importProgress, startedAt);

          await this.repo.upsertBookState({
            userId: user.id,
            bookId: row.localBookId,
            hardcoverBookId: row.hardcoverBookId,
            hardcoverEditionId: row.hardcoverEditionId,
            hardcoverUserBookId: row.hardcoverUserBookId,
            hardcoverReadId: row.hardcoverReadId,
            matchMethod: row.matchMethod,
            matchError: null,
            syncError: null,
            lastSyncedAt: new Date(),
            lastSyncedStatus: row.importedStatus,
            lastSyncedProgress: progressImported ? row.importedProgressPercent : null,
            lastSyncedStartedAt: row.importedStartedAt,
            lastSyncedFinishedAt: row.importedFinishedAt,
          });

          if (progressImported) {
            progressApplied++;
          }

          applied++;
        } catch (err) {
          failed++;
          const errorClass = err instanceof Error ? err.constructor.name : 'Error';
          const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
          this.logger.warn(
            `[hardcover.import_status] [fail] userId=${user.id} bookId=${row.localBookId} hardcoverBookId=${row.hardcoverBookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - import row failed`,
          );
        }
      }

      const result: HardcoverImportApplyResult = {
        ...preview.summary,
        applied,
        progressApplied,
        failed,
      };

      this.logger.log(
        `[hardcover.import_status] [end] userId=${user.id} mode=apply durationMs=${Date.now() - startedAt} totalHardcoverBooks=${result.totalHardcoverBooks} applied=${applied} progressApplied=${progressApplied} failed=${failed} needsReview=${result.needsReview} conflicts=${result.conflicts} unmatched=${result.unmatched} skipped=${result.skipped} - import apply completed`,
      );

      return result;
    } catch (err) {
      this.logFailure(user.id, startedAt, err, 'import apply failed');
      throw err;
    }
  }

  private async buildPreview(user: RequestUser): Promise<HardcoverImportPreview> {
    const token = await this.settingsService.getTokenForUser(user.id);
    if (!token) {
      throw new BadRequestException('Hardcover sync is not available right now');
    }

    const [hardcoverBooks, accessibleLibraryIds] = await Promise.all([
      this.fetchAllUserBooks(user.id, token),
      this.libraryService.findAccessibleLibraryIds(user),
    ]);
    const localBooks = await this.repo.findImportCandidateBooks(user.id, accessibleLibraryIds, user.isSuperuser ? undefined : user.contentFilters);
    const states = await this.repo.findBookStatesByBookIds(
      user.id,
      localBooks.map((book) => book.bookId),
    );
    const indexes = this.buildIndexes(localBooks, states);

    const rows = hardcoverBooks.map((book) => this.buildPreviewRow(book, indexes));
    return {
      summary: summarize(rows),
      rows,
    };
  }

  private async fetchAllUserBooks(userId: number, token: string): Promise<HardcoverUserBook[]> {
    const rows: HardcoverUserBook[] = [];
    let offset = 0;

    while (true) {
      let data: HardcoverImportGraphQLResult;
      try {
        data = await this.client.query<HardcoverImportGraphQLResult>(userId, token, IMPORT_USER_BOOKS_QUERY, {
          limit: IMPORT_PAGE_SIZE,
          offset,
        });
      } catch (err) {
        const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
        this.logger.warn(
          `[hardcover.import_status] [fail] userId=${userId} errorClass=HardcoverApiError error="${error}" - Hardcover library fetch failed`,
        );
        throw new BadRequestException('Failed to fetch Hardcover library');
      }

      const page = data.me?.[0]?.user_books ?? [];
      rows.push(...page);
      if (page.length < IMPORT_PAGE_SIZE) break;
      offset += IMPORT_PAGE_SIZE;
    }

    return rows;
  }

  private buildIndexes(books: HardcoverImportLocalBook[], states: Array<Awaited<ReturnType<HardcoverRepository['findBookState']>>>): LocalIndexes {
    const indexes: LocalIndexes = {
      books,
      byHardcoverId: new Map(),
      byHardcoverSlug: new Map(),
      byIsbn: new Map(),
    };
    const booksById = new Map(books.map((book) => [book.bookId, book]));

    for (const book of books) {
      const metadataId = book.hardcoverMetadataId?.trim();
      if (metadataId) {
        const numericId = parseNumericId(metadataId);
        if (numericId != null) pushUnique(indexes.byHardcoverId, numericId, book);
        else pushUnique(indexes.byHardcoverSlug, normalizeSlug(metadataId), book);
      }

      for (const isbn of [book.isbn13, book.isbn10]) {
        const normalized = normalizeIsbn(isbn);
        if (normalized) pushUnique(indexes.byIsbn, normalized, book);
      }
    }

    for (const state of states) {
      if (!state) continue;
      const book = booksById.get(state.bookId);
      if (book && state.hardcoverBookId != null && !state.matchError) {
        pushUnique(indexes.byHardcoverId, state.hardcoverBookId, book);
      }
    }

    return indexes;
  }

  private buildPreviewRow(hardcoverBook: HardcoverUserBook, indexes: LocalIndexes): HardcoverImportPreviewRow {
    const statusMapping = IMPORTABLE_STATUS_MAP[hardcoverBook.status_id] ?? null;
    const hardcoverAuthors = extractHardcoverAuthors(hardcoverBook.book?.cached_contributors);
    const latestRead = hardcoverBook.user_book_reads?.find(hasReadSignal) ?? null;
    const importedStartedAt = latestRead?.started_at ?? hardcoverBook.first_started_reading_date ?? null;
    const importedFinishedAt = statusMapping?.status === 'read' ? (latestRead?.finished_at ?? hardcoverBook.last_read_date ?? null) : null;
    const base = {
      hardcoverUserBookId: hardcoverBook.id,
      hardcoverBookId: hardcoverBook.book_id,
      hardcoverEditionId: hardcoverBook.edition_id,
      hardcoverReadId: latestRead?.id ?? null,
      hardcoverTitle: hardcoverBook.book?.title ?? null,
      hardcoverAuthors,
      hardcoverStatusId: hardcoverBook.status_id,
      hardcoverStatusLabel: HARDCOVER_STATUS_LABELS[hardcoverBook.status_id] ?? hardcoverBook.user_book_status?.status ?? 'Unknown',
      importedStatus: statusMapping?.status ?? null,
      importedStartedAt,
      importedFinishedAt,
      importedProgressPercent: deriveImportedProgressPercent(hardcoverBook, latestRead, statusMapping?.status ?? null),
      hardcoverReads: (hardcoverBook.user_book_reads ?? []).filter(hasReadSignal).map((read) => ({
        id: read.id,
        startedAt: read.started_at,
        finishedAt: read.finished_at,
      })),
    };

    if (!statusMapping) {
      return this.toPreviewRow(base, null, null, null, 'skipped', 'Hardcover status is not imported');
    }

    const match = this.findLocalMatch(hardcoverBook, hardcoverAuthors, indexes);
    if ('outcome' in match) {
      return this.toPreviewRow(base, null, null, null, match.outcome, match.reason);
    }

    const localStatus = match.book.status;
    if (localStatus && localStatus !== 'unread') {
      return this.toPreviewRow(base, match.book, match.method, match.confidence, 'conflict', 'BookOrbit already has a read status');
    }

    if (match.method === 'title_author') {
      return this.toPreviewRow(base, match.book, match.method, match.confidence, 'needs_review', 'Review title and author match before import');
    }

    return this.toPreviewRow(base, match.book, match.method, match.confidence, 'will_update', 'Ready to import');
  }

  private toPreviewRow(
    base: Pick<
      HardcoverImportPreviewRow,
      | 'hardcoverUserBookId'
      | 'hardcoverBookId'
      | 'hardcoverEditionId'
      | 'hardcoverReadId'
      | 'hardcoverTitle'
      | 'hardcoverAuthors'
      | 'hardcoverStatusId'
      | 'hardcoverStatusLabel'
      | 'importedStatus'
      | 'importedStartedAt'
      | 'importedFinishedAt'
      | 'importedProgressPercent'
      | 'hardcoverReads'
    >,
    local: HardcoverImportLocalBook | null,
    matchMethod: HardcoverImportMatchMethod | null,
    confidence: number | null,
    outcome: HardcoverImportPreviewOutcome,
    reason: string,
  ): HardcoverImportPreviewRow {
    const progress = buildProgressPreview(base.importedProgressPercent, local, outcome);
    return {
      ...base,
      localBookId: local?.bookId ?? null,
      localPrimaryFileId: local?.primaryFileId ?? null,
      localTitle: local?.title ?? null,
      localAuthors: local?.authors ?? [],
      localReadStatus: local?.status ?? null,
      localProgressPercent: local?.progress ?? null,
      matchMethod,
      confidence,
      outcome,
      reason,
      ...progress,
    };
  }

  private findLocalMatch(hardcoverBook: HardcoverUserBook, hardcoverAuthors: string[], indexes: LocalIndexes): MatchResult | MatchFailure {
    const byHardcoverId = uniqueCandidate(indexes.byHardcoverId.get(hardcoverBook.book_id));
    if (byHardcoverId === 'ambiguous') return { outcome: 'skipped', reason: 'Multiple BookOrbit books match this Hardcover ID' };
    if (byHardcoverId) return { book: byHardcoverId, method: 'hardcover_id', confidence: 100 };

    const slug = hardcoverBook.book?.slug ? normalizeSlug(hardcoverBook.book.slug) : null;
    if (slug) {
      const bySlug = uniqueCandidate(indexes.byHardcoverSlug.get(slug));
      if (bySlug === 'ambiguous') return { outcome: 'skipped', reason: 'Multiple BookOrbit books match this Hardcover slug' };
      if (bySlug) return { book: bySlug, method: 'hardcover_id', confidence: 100 };
    }

    const isbnCandidates = [hardcoverBook.edition?.isbn_13, hardcoverBook.edition?.isbn_10]
      .map(normalizeIsbn)
      .filter((isbn): isbn is string => Boolean(isbn));
    for (const isbn of isbnCandidates) {
      const byIsbn = uniqueCandidate(indexes.byIsbn.get(isbn));
      if (byIsbn === 'ambiguous') return { outcome: 'skipped', reason: 'Multiple BookOrbit books match this ISBN' };
      if (byIsbn) return { book: byIsbn, method: 'isbn', confidence: 100 };
    }

    const titleMatch = this.findTitleAuthorMatch(hardcoverBook.book?.title ?? null, hardcoverAuthors, indexes.books);
    if (titleMatch) return titleMatch;

    return { outcome: 'unmatched', reason: 'No matching BookOrbit book found' };
  }

  private findTitleAuthorMatch(title: string | null, authors: string[], localBooks: HardcoverImportLocalBook[]): MatchResult | null {
    if (!title?.trim() || authors.length === 0) return null;

    const scored = localBooks
      .filter((book) => book.title?.trim() && book.authors.length > 0)
      .map((book) => {
        const titleScore = scoreTitle(title, book.title!);
        const authorScore = scoreAuthors(authors, book.authors);
        const confidence = Math.round((titleScore * 0.7 + authorScore * 0.3) * 100);
        return { book, titleScore, authorScore, confidence };
      })
      .filter((row) => row.titleScore >= 0.8 && row.authorScore >= 0.75 && row.confidence >= TITLE_AUTHOR_ACCEPT_SCORE)
      .sort((a, b) => b.confidence - a.confidence);

    const best = scored[0];
    if (!best) return null;
    const second = scored[1];
    if (second && best.confidence - second.confidence <= TITLE_AUTHOR_TIE_MARGIN) return null;
    return { book: best.book, method: 'title_author', confidence: best.confidence };
  }

  private async applyProgressIfRequested(
    userId: number,
    row: HardcoverImportPreviewRow,
    importProgress: boolean,
    startedAt: number,
  ): Promise<boolean> {
    if (!importProgress || !canApplyProgress(row)) return false;

    try {
      return await this.repo.upsertImportProgress(userId, row.localPrimaryFileId!, row.importedProgressPercent!);
    } catch (err) {
      const errorClass = err instanceof Error ? err.constructor.name : 'Error';
      const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[hardcover.import_progress] [fail] userId=${userId} bookId=${row.localBookId} hardcoverBookId=${row.hardcoverBookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - import progress failed`,
      );
      return false;
    }
  }

  private logFailure(userId: number, startedAt: number, err: unknown, message: string): void {
    const errorClass = err instanceof Error ? err.constructor.name : 'Error';
    const error = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    this.logger.warn(
      `[hardcover.import_status] [fail] userId=${userId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${error}" - ${message}`,
    );
  }
}

function summarize(rows: HardcoverImportPreviewRow[]): HardcoverImportSummary {
  const summary: HardcoverImportSummary = {
    totalHardcoverBooks: rows.length,
    matchedBooks: 0,
    willUpdate: 0,
    needsReview: 0,
    conflicts: 0,
    unmatched: 0,
    skipped: 0,
    progressWillUpdate: 0,
    progressConflicts: 0,
    progressSkipped: 0,
  };

  for (const row of rows) {
    if (row.localBookId != null) summary.matchedBooks++;
    switch (row.outcome) {
      case 'will_update':
        summary.willUpdate++;
        break;
      case 'needs_review':
        summary.needsReview++;
        break;
      case 'conflict':
        summary.conflicts++;
        break;
      case 'unmatched':
        summary.unmatched++;
        break;
      case 'skipped':
        summary.skipped++;
        break;
    }

    switch (row.progressOutcome) {
      case 'will_update':
        summary.progressWillUpdate++;
        break;
      case 'conflict':
        summary.progressConflicts++;
        break;
      case 'skipped':
        summary.progressSkipped++;
        break;
    }
  }

  return summary;
}

function buildProgressPreview(
  importedProgressPercent: number | null,
  local: HardcoverImportLocalBook | null,
  outcome: HardcoverImportPreviewOutcome,
): Pick<HardcoverImportPreviewRow, 'progressOutcome' | 'progressReason'> {
  if (importedProgressPercent == null) return { progressOutcome: 'skipped', progressReason: 'No Hardcover progress to import' };
  if (!local) return { progressOutcome: 'skipped', progressReason: 'No matching BookOrbit book found' };
  if (outcome !== 'will_update' && outcome !== 'needs_review') {
    return { progressOutcome: 'skipped', progressReason: 'Read status import is not available for this row' };
  }
  if (local.primaryFileId == null) return { progressOutcome: 'skipped', progressReason: 'BookOrbit book has no primary file' };
  if (local.primaryFileFormat && isAudioFormat(local.primaryFileFormat)) {
    return { progressOutcome: 'skipped', progressReason: 'Audiobook progress import is not supported yet' };
  }
  if (local.progress != null && local.progress > 0) {
    return { progressOutcome: 'conflict', progressReason: 'BookOrbit already has reading progress' };
  }
  return { progressOutcome: 'will_update', progressReason: 'Ready to import progress' };
}

function canApplyRow(row: HardcoverImportPreviewRow, selectedIds: Set<number> | null): boolean {
  if (row.outcome !== 'will_update' && row.outcome !== 'needs_review') return false;
  if (!selectedIds) return row.outcome === 'will_update';
  return selectedIds.has(row.hardcoverUserBookId);
}

function canApplyProgress(row: HardcoverImportPreviewRow): boolean {
  return row.progressOutcome === 'will_update' && row.localPrimaryFileId != null && row.importedProgressPercent != null;
}

function deriveImportedProgressPercent(
  hardcoverBook: HardcoverUserBook,
  latestRead: NonNullable<HardcoverUserBook['user_book_reads']>[number] | null,
  importedStatus: HardcoverImportedReadStatus | null,
): number | null {
  if (!importedStatus) return null;
  if (importedStatus === 'read') return 100;
  if (importedStatus === 'want_to_read') return null;

  const directProgress = roundProgressPercent(latestRead?.progress);
  if (directProgress != null && directProgress > 0) return directProgress;

  const progressPages = toFiniteNumber(latestRead?.progress_pages);
  const editionPages = toFiniteNumber(hardcoverBook.edition?.pages);
  if (progressPages != null && editionPages != null && editionPages > 0) {
    const percent = roundProgressPercent((progressPages / editionPages) * 100);
    if (percent != null && percent > 0) return percent;
  }

  const progressSeconds = toFiniteNumber(latestRead?.progress_seconds);
  const editionSeconds = toFiniteNumber(hardcoverBook.edition?.audio_seconds);
  if (progressSeconds != null && editionSeconds != null && editionSeconds > 0) {
    const percent = roundProgressPercent((progressSeconds / editionSeconds) * 100);
    if (percent != null && percent > 0) return percent;
  }

  return null;
}

function hasReadSignal(read: NonNullable<HardcoverUserBook['user_book_reads']>[number]): boolean {
  return (
    Boolean(read.started_at) || Boolean(read.finished_at) || read.progress != null || read.progress_pages != null || read.progress_seconds != null
  );
}

function uniqueCandidate(candidates: HardcoverImportLocalBook[] | undefined): HardcoverImportLocalBook | 'ambiguous' | null {
  if (!candidates || candidates.length === 0) return null;
  const unique = new Map(candidates.map((book) => [book.bookId, book]));
  if (unique.size > 1) return 'ambiguous';
  return unique.values().next().value ?? null;
}

function pushUnique<K>(map: Map<K, HardcoverImportLocalBook[]>, key: K, book: HardcoverImportLocalBook): void {
  const current = map.get(key);
  if (!current) {
    map.set(key, [book]);
    return;
  }
  if (!current.some((candidate) => candidate.bookId === book.bookId)) current.push(book);
}

function parseNumericId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

function normalizeIsbn(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^0-9X]/gi, '').toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function extractHardcoverAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const authors: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const author = 'author' in entry ? (entry as { author?: unknown }).author : null;
    if (author && typeof author === 'object' && 'name' in author && typeof (author as { name?: unknown }).name === 'string') {
      authors.push((author as { name: string }).name.trim());
      continue;
    }
    if ('name' in entry && typeof (entry as { name?: unknown }).name === 'string') {
      authors.push((entry as { name: string }).name.trim());
    }
  }
  return authors.filter((author) => author.length > 0);
}

function scoreTitle(a: string, b: string): number {
  const left = normalizeTitle(a);
  const right = normalizeTitle(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.startsWith(right) || right.startsWith(left)) return 0.94;
  if (left.includes(right) || right.includes(left)) return 0.9;

  const tokenScore = tokenOverlap(left, right);
  const editScore = normalizedLevenshtein(left, right);
  return Math.max(tokenScore, editScore >= 0.7 ? editScore : 0);
}

function scoreAuthors(hardcoverAuthors: string[], localAuthors: string[]): number {
  let best = 0;
  for (const hardcoverAuthor of hardcoverAuthors) {
    for (const localAuthor of localAuthors) {
      best = Math.max(best, scoreAuthor(hardcoverAuthor, localAuthor));
    }
  }
  return best;
}

function scoreAuthor(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (haveEqualTokenSet(leftTokens, rightTokens)) return 0.98;
  const overlap = tokenOverlap(left, right);
  const edit = normalizedLevenshtein(left, right);
  return Math.max(overlap, edit >= 0.76 ? edit : 0);
}

function normalizeTitle(value: string): string {
  const stripped = value.split(/:\s+| - /)[0] ?? value;
  return normalizeName(stripped);
}

function normalizeName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  return value.split(' ').filter((token) => token.length > 1);
}

function tokenOverlap(a: string, b: string): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return overlap / Math.max(left.size, right.size);
}

function normalizedLevenshtein(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance(a, b) / maxLen;
}

function haveEqualTokenSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((token, index) => token === right[index]);
}

function roundProgressPercent(value: number | null | undefined): number | null {
  const finite = toFiniteNumber(value);
  if (finite == null) return null;
  const clamped = Math.max(0, Math.min(100, finite));
  return Math.round(clamped * 10) / 10;
}

function toFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}
