import { BadRequestException, Injectable } from '@nestjs/common';

import {
  NOTEBOOK_BOOK_COLOR_MIX_MAX,
  NOTEBOOK_BOOKS_PAGE_SIZE_DEFAULT,
  NOTEBOOK_ON_THIS_DAY_MAX,
  NOTEBOOK_PAGE_SIZE_DEFAULT,
  NOTEBOOK_REVIEW_DAILY_SIZE,
  NOTEBOOK_REVIEW_SHUFFLE_MAX,
  normalizeCoverAspectRatio,
  type AnnotationItem,
  type NotebookBookLabel,
  type NotebookBookRow,
  type NotebookBooksResponse,
  type NotebookEntriesResponse,
  type NotebookEntry,
  type NotebookEntryKind,
  type NotebookHighlightEntry,
  type NotebookJournalItem,
  type NotebookOnThisDayResponse,
  type NotebookOnThisDayYear,
  type NotebookOverview,
  type NotebookReviewResponse,
  type NotebookTrashResponse,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { buildSearchPattern } from '../../common/utils/accent-insensitive-search.utils';
import { resolveTimeZone } from '../../common/utils/timezone.utils';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { LibraryService } from '../library/library.service';
import type {
  NotebookBooksQueryDto,
  NotebookEntriesQueryDto,
  NotebookOnThisDayQueryDto,
  NotebookOverviewQueryDto,
  NotebookReviewQueryDto,
  NotebookTrashQueryDto,
} from './dto/notebook-query.dto';
import { decodeNotebookCursor, encodeNotebookCursor } from './notebook-cursor';
import { isoFromSortKey, localYearOfSortKey, onThisDayRanges, rangeYearOfSortKey, reviewOlderThan } from './notebook-dates';
import { NOTEBOOK_KIND_RANK, notebookKindForRank, resolveNotebookKinds, toNotebookFilters, type NotebookScope } from './notebook-filters';
import {
  toNotebookBookLabel,
  toNotebookBookmark,
  toNotebookHighlight,
  toNotebookJournal,
  toNotebookReview,
  type NotebookMapOptions,
} from './notebook-mapper';
import { NotebookRepository, type NotebookEntryKey } from './notebook.repository';

type EntryRef = Pick<NotebookEntryKey, 'kindRank' | 'id'>;
type LoadOptions = NotebookMapOptions & { status: 'active' | 'trashed' };

const TRASH_KINDS: NotebookEntryKind[] = ['highlight', 'journal'];
const OVERVIEW_ORIGINS = new Set<string>(['web', 'koreader', 'kobo']);

function entryMapKey(kind: NotebookEntryKind, id: number): string {
  return `${kind}:${id}`;
}

/** Drops a row that changed state between the keyset query and the load, so a listing never mixes trash and active. */
function inStatus(deletedAt: Date | null, status: LoadOptions['status']): boolean {
  return status === 'trashed' ? deletedAt != null : deletedAt == null;
}

@Injectable()
export class NotebookService {
  constructor(
    private readonly repo: NotebookRepository,
    private readonly libraryService: LibraryService,
    private readonly coverStore: BookCoverStore,
  ) {}

  async entries(user: RequestUser, query: NotebookEntriesQueryDto): Promise<NotebookEntriesResponse> {
    const sort = query.sort ?? 'newest';
    const cursor = query.cursor ? decodeNotebookCursor(query.cursor, sort) : undefined;
    const limit = query.limit ?? NOTEBOOK_PAGE_SIZE_DEFAULT;
    const filters = toNotebookFilters(query);
    const kinds = resolveNotebookKinds(query.kinds, filters);
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0 || kinds.length === 0) return { items: [], books: {}, nextCursor: null };
    const keys = await this.repo.findEntryKeys(scope, {
      kinds,
      status: 'active',
      filters,
      sortColumn: sort === 'edited' ? 'edited' : 'written',
      direction: sort === 'oldest' ? 'asc' : 'desc',
      cursor,
      limit: limit + 1,
    });
    const page = keys.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      keys.length > limit && last ? encodeNotebookCursor({ scope: sort, key: last.sortKey, rank: last.kindRank, id: last.id }) : null;
    const [items, books] = await Promise.all([this.loadEntries(user.id, page, { status: 'active' }), this.labels(page.map((key) => key.bookId))]);
    return { items, books, nextCursor };
  }

  async overview(user: RequestUser, query: NotebookOverviewQueryDto): Promise<NotebookOverview> {
    const filters = toNotebookFilters(query);
    const kinds = resolveNotebookKinds(undefined, filters);
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0) return emptyOverview();
    const row = await this.repo.findOverview(scope, filters, kinds);
    return {
      total: row.highlights + row.journal + row.bookmarks + row.reviews,
      highlights: row.highlights,
      journal: row.journal,
      bookmarks: row.bookmarks,
      reviews: row.reviews,
      starred: row.starred,
      withNotes: row.withNotes,
      approximate: row.approximate,
      books: row.books,
      colors: row.colors,
      origins: row.origins
        .filter((entry) => OVERVIEW_ORIGINS.has(entry.origin))
        .map((entry) => ({ origin: entry.origin as AnnotationItem['origin'], count: entry.count })),
    };
  }

  async books(user: RequestUser, query: NotebookBooksQueryDto): Promise<NotebookBooksResponse> {
    const cursor = query.cursor ? decodeNotebookCursor(query.cursor, 'books') : undefined;
    const limit = query.limit ?? NOTEBOOK_BOOKS_PAGE_SIZE_DEFAULT;
    const term = query.q?.trim();
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0) return { items: [], nextCursor: null };
    const rows = await this.repo.findBookActivity(scope, { searchPattern: term ? buildSearchPattern(term) : undefined, cursor, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const bookIds = page.map((row) => row.bookId);
    const [latestKeys, colorRows, labels] = await Promise.all([
      this.repo.findLatestEntryPerBook(user.id, bookIds),
      this.repo.findColorMix(user.id, bookIds),
      this.labels(bookIds),
    ]);
    const latestEntries = await this.loadEntries(user.id, latestKeys, { status: 'active' });
    const latestByBook = new Map(latestEntries.map((entry) => [entry.bookId, entry]));
    const colorsByBook = new Map<number, { color: string; count: number }[]>();
    for (const row of colorRows) {
      const mix = colorsByBook.get(row.bookId) ?? [];
      if (mix.length < NOTEBOOK_BOOK_COLOR_MIX_MAX) mix.push({ color: row.color, count: Number(row.count) });
      colorsByBook.set(row.bookId, mix);
    }

    const items: NotebookBookRow[] = [];
    for (const row of page) {
      const book = labels[String(row.bookId)];
      if (!book) continue;
      items.push({
        book,
        highlights: row.highlights,
        journal: row.journal,
        bookmarks: row.bookmarks,
        hasReview: row.hasReview,
        colors: colorsByBook.get(row.bookId) ?? [],
        lastActivityAt: isoFromSortKey(row.lastKey),
        latest: latestByBook.get(row.bookId) ?? null,
      });
    }
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeNotebookCursor({ scope: 'books', key: last.lastKey, rank: 0, id: last.bookId }) : null;
    return { items, nextCursor };
  }

  async review(user: RequestUser, query: NotebookReviewQueryDto): Promise<NotebookReviewResponse> {
    const hasDate = query.date !== undefined;
    const hasSeed = query.seed !== undefined;
    if (hasDate === hasSeed) throw new BadRequestException('Pass exactly one of date and seed');
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0) return { items: [], books: {} };
    const picks =
      query.date !== undefined
        ? await this.repo.findDailyReview(scope, { date: query.date, olderThan: reviewOlderThan(query.date), limit: NOTEBOOK_REVIEW_DAILY_SIZE })
        : await this.repo.findSeededReview(scope, { filters: toNotebookFilters(query), seed: query.seed!, limit: NOTEBOOK_REVIEW_SHUFFLE_MAX });
    const refs = picks.map((pick) => ({ kindRank: NOTEBOOK_KIND_RANK.highlight, id: pick.id }));
    const [items, books] = await Promise.all([this.loadEntries(user.id, refs, { status: 'active' }), this.labels(picks.map((pick) => pick.bookId))]);
    return { items: items as NotebookHighlightEntry[], books };
  }

  async onThisDay(user: RequestUser, query: NotebookOnThisDayQueryDto): Promise<NotebookOnThisDayResponse> {
    const timeZone = query.tz?.trim() || resolveTimeZone(user.settings?.timezone, 'UTC');
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0) return { date: query.date, years: [], books: {} };
    const firstAt = await this.repo.findFirstEntryAt(user.id);
    const ranges = onThisDayRanges(query.date, firstAt ? localYearOfSortKey(firstAt, timeZone) : null, timeZone);
    const keys = await this.repo.findOnThisDayKeys(scope, { ranges, limit: NOTEBOOK_ON_THIS_DAY_MAX });
    const [entries, books] = await Promise.all([this.loadEntryMap(user.id, keys, { status: 'active' }), this.labels(keys.map((key) => key.bookId))]);

    const years: NotebookOnThisDayYear[] = [];
    for (const key of keys) {
      const entry = entries.get(entryMapKey(notebookKindForRank(key.kindRank), key.id));
      const year = rangeYearOfSortKey(key.sortKey, ranges);
      if (!entry || year === null) continue;
      const current = years.at(-1);
      if (current?.year === year) current.items.push(entry);
      else years.push({ year, items: [entry] });
    }
    return { date: query.date, years, books };
  }

  async trash(user: RequestUser, query: NotebookTrashQueryDto): Promise<NotebookTrashResponse> {
    const cursor = query.cursor ? decodeNotebookCursor(query.cursor, 'trash') : undefined;
    const limit = query.limit ?? NOTEBOOK_PAGE_SIZE_DEFAULT;
    const scope = await this.scope(user);
    if (scope.libraryIds.length === 0) return { items: [], books: {}, nextCursor: null };
    const keys = await this.repo.findEntryKeys(scope, {
      kinds: TRASH_KINDS,
      status: 'trashed',
      sortColumn: 'deleted',
      direction: 'desc',
      cursor,
      limit: limit + 1,
    });
    const page = keys.slice(0, limit);
    const last = page.at(-1);
    const nextCursor =
      keys.length > limit && last ? encodeNotebookCursor({ scope: 'trash', key: last.sortKey, rank: last.kindRank, id: last.id }) : null;
    const [items, books] = await Promise.all([
      this.loadEntries(user.id, page, { status: 'trashed', withDeletedAt: true }),
      this.labels(page.map((key) => key.bookId)),
    ]);
    return { items: items as (NotebookHighlightEntry | NotebookJournalItem)[], books, nextCursor };
  }

  private async scope(user: RequestUser): Promise<NotebookScope> {
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    return { userId: user.id, libraryIds, contentFilters: user.isSuperuser ? undefined : user.contentFilters };
  }

  private async loadEntries(userId: number, refs: readonly EntryRef[], options: LoadOptions): Promise<NotebookEntry[]> {
    const entries = await this.loadEntryMap(userId, refs, options);
    return refs
      .map((ref) => entries.get(entryMapKey(notebookKindForRank(ref.kindRank), ref.id)))
      .filter((entry): entry is NotebookEntry => entry !== undefined);
  }

  /** Loads each kind's rows for the page in one query per kind, keyed by kind and id. */
  private async loadEntryMap(userId: number, refs: readonly EntryRef[], options: LoadOptions): Promise<Map<string, NotebookEntry>> {
    const idsOf = (kind: NotebookEntryKind) => [...new Set(refs.filter((ref) => ref.kindRank === NOTEBOOK_KIND_RANK[kind]).map((ref) => ref.id))];
    const [highlights, journal, bookmarks, reviews] = await Promise.all([
      this.repo.findHighlights(userId, idsOf('highlight')),
      this.repo.findJournal(userId, idsOf('journal')),
      this.repo.findBookmarks(userId, idsOf('bookmark')),
      this.repo.findReviews(userId, idsOf('review')),
    ]);
    const entries = new Map<string, NotebookEntry>();
    for (const row of highlights) {
      if (inStatus(row.deletedAt, options.status)) entries.set(entryMapKey('highlight', row.id), toNotebookHighlight(row, options));
    }
    for (const row of journal) {
      if (inStatus(row.deletedAt, options.status)) entries.set(entryMapKey('journal', row.id), toNotebookJournal(row, options));
    }
    for (const row of bookmarks) {
      if (inStatus(row.deletedAt, options.status)) entries.set(entryMapKey('bookmark', row.id), toNotebookBookmark(row));
    }
    for (const row of reviews) {
      if (options.status === 'active') entries.set(entryMapKey('review', row.bookId), toNotebookReview(row));
    }
    return entries;
  }

  /** The label sidecar: one query for the books and one for their cover slots, whatever the page size. */
  private async labels(bookIds: readonly number[]): Promise<Record<string, NotebookBookLabel>> {
    const ids = [...new Set(bookIds)];
    if (ids.length === 0) return {};
    const [rows, slotsByBook] = await Promise.all([this.repo.findLabels(ids), this.coverStore.slotsFor(ids)]);
    const labels: Record<string, NotebookBookLabel> = {};
    for (const row of rows) {
      const coverVersion = this.coverStore.coverVersion(
        normalizeCoverAspectRatio(row.coverAspectRatio),
        slotsByBook.get(row.id) ?? [],
        row.updatedAt.toISOString(),
      );
      labels[String(row.id)] = toNotebookBookLabel(row, coverVersion);
    }
    return labels;
  }
}

function emptyOverview(): NotebookOverview {
  return {
    total: 0,
    highlights: 0,
    journal: 0,
    bookmarks: 0,
    reviews: 0,
    starred: 0,
    withNotes: 0,
    approximate: 0,
    books: 0,
    colors: [],
    origins: [],
  };
}
