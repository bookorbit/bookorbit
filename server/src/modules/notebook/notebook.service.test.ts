import { BadRequestException } from '@nestjs/common';

import {
  EMPTY_CONTENT_FILTER_RULES,
  NOTEBOOK_BOOK_COLOR_MIX_MAX,
  NOTEBOOK_ON_THIS_DAY_MAX,
  NOTEBOOK_REVIEW_DAILY_SIZE,
  NOTEBOOK_REVIEW_SHUFFLE_MAX,
} from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { decodeNotebookCursor, encodeNotebookCursor } from './notebook-cursor';
import { NotebookService } from './notebook.service';

const user: RequestUser = {
  id: 8,
  username: 'reader',
  name: 'Reader',
  email: null,
  active: true,
  isDefaultPassword: false,
  tokenVersion: 1,
  settings: { timezone: 'Asia/Kolkata' },
  avatarUrl: null,
  provisioningMethod: 'local',
  isSuperuser: false,
  permissions: [],
  contentFilters: { ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [3] },
};

const at = new Date('2026-02-03T04:05:06.000Z');

function highlightRow(id: number, bookId: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    bookId,
    text: `text ${id}`,
    color: 'yellow',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    sourceCreatedAt: null,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    starredAt: null,
    cfi: null,
    cfiStatus: null,
    ...overrides,
  };
}

function labelRow(id: number) {
  return {
    id,
    title: `Book ${id}`,
    author: 'Author',
    coverSource: 'extracted',
    coverAspectRatio: '2/3',
    updatedAt: at,
    readFileId: id * 10,
    readFileFormat: 'epub',
    hasAudio: false,
  };
}

function key(kindRank: number, id: number, bookId: number, sortKey = '2026-02-03T04:05:06.123456Z') {
  return { kindRank, id, bookId, sortKey };
}

function makeService(libraryIds = [1, 2]) {
  const repo = {
    findEntryKeys: vi.fn().mockResolvedValue([]),
    findOverview: vi.fn(),
    findBookActivity: vi.fn().mockResolvedValue([]),
    findLatestEntryPerBook: vi.fn().mockResolvedValue([]),
    findColorMix: vi.fn().mockResolvedValue([]),
    findDailyReview: vi.fn().mockResolvedValue([]),
    findSeededReview: vi.fn().mockResolvedValue([]),
    findFirstEntryAt: vi.fn().mockResolvedValue(null),
    findOnThisDayKeys: vi.fn().mockResolvedValue([]),
    findHighlights: vi.fn().mockResolvedValue([]),
    findJournal: vi.fn().mockResolvedValue([]),
    findBookmarks: vi.fn().mockResolvedValue([]),
    findReviews: vi.fn().mockResolvedValue([]),
    findLabels: vi.fn().mockImplementation((ids: number[]) => Promise.resolve(ids.map(labelRow))),
  };
  const libraryService = { findAccessibleLibraryIds: vi.fn().mockResolvedValue(libraryIds) };
  const coverStore = {
    slotsFor: vi.fn().mockResolvedValue(new Map()),
    coverVersion: vi.fn((ratio: string, _slots: unknown[], legacy: string) => `legacy:${ratio}:${legacy}`),
  };
  const service = new NotebookService(repo as never, libraryService as never, coverStore as never);
  return { service, repo, libraryService, coverStore };
}

describe('NotebookService.entries', () => {
  it('returns an empty page without querying when the reader can open no library', async () => {
    const { service, repo } = makeService([]);
    await expect(service.entries(user, {})).resolves.toEqual({ items: [], books: {}, nextCursor: null });
    expect(repo.findEntryKeys).not.toHaveBeenCalled();
    expect(repo.findLabels).not.toHaveBeenCalled();
  });

  it('pages newest first by default with the scope, filters and one extra row', async () => {
    const { service, repo } = makeService();
    await service.entries(user, { hasNote: false, starred: true, q: '  50%  ' });
    expect(repo.findEntryKeys).toHaveBeenCalledWith(
      { userId: 8, libraryIds: [1, 2], contentFilters: user.contentFilters },
      expect.objectContaining({
        kinds: ['highlight'],
        status: 'active',
        filters: { starred: true, searchPattern: '%50\\%%' },
        sortColumn: 'written',
        direction: 'desc',
        cursor: undefined,
        limit: 41,
      }),
    );
  });

  it('drops content rules for a superuser', async () => {
    const { service, repo } = makeService();
    await service.entries({ ...user, isSuperuser: true }, {});
    expect(repo.findEntryKeys.mock.calls[0][0]).toEqual({ userId: 8, libraryIds: [1, 2], contentFilters: undefined });
  });

  it('skips the query when the filters leave no kind', async () => {
    const { service, repo } = makeService();
    await expect(service.entries(user, { kinds: ['journal'], colors: 'blue' })).resolves.toEqual({ items: [], books: {}, nextCursor: null });
    expect(repo.findEntryKeys).not.toHaveBeenCalled();
  });

  it('maps oldest and edited to their columns and directions', async () => {
    const { service, repo } = makeService();
    await service.entries(user, { sort: 'oldest' });
    await service.entries(user, { sort: 'edited' });
    expect(repo.findEntryKeys.mock.calls[0][1]).toMatchObject({ sortColumn: 'written', direction: 'asc' });
    expect(repo.findEntryKeys.mock.calls[1][1]).toMatchObject({ sortColumn: 'edited', direction: 'desc' });
  });

  it('keeps the key order across kinds, returns labels and a cursor at the last item', async () => {
    const { service, repo } = makeService();
    repo.findEntryKeys.mockResolvedValue([key(3, 5, 5, '2026-02-03T04:05:06.999999Z'), key(0, 11, 6), key(1, 2, 6, '2026-01-01T00:00:00.000001Z')]);
    repo.findHighlights.mockResolvedValue([highlightRow(11, 6)]);
    repo.findReviews.mockResolvedValue([{ bookId: 5, note: 'Great', updatedAt: at, rating: null }]);
    const result = await service.entries(user, { limit: 2 });
    expect(result.items.map((item) => [item.kind, item.id])).toEqual([
      ['review', 5],
      ['highlight', 11],
    ]);
    expect(repo.findJournal).toHaveBeenCalledWith(8, []);
    expect(Object.keys(result.books).sort()).toEqual(['5', '6']);
    expect(result.books['6']).toMatchObject({ id: 6, title: 'Book 6', coverVersion: `legacy:2/3:${at.toISOString()}`, readFileId: 60 });
    expect(decodeNotebookCursor(result.nextCursor!, 'newest')).toEqual({ scope: 'newest', key: '2026-02-03T04:05:06.123456Z', rank: 0, id: 11 });
  });

  it('has no next cursor on the last page', async () => {
    const { service, repo } = makeService();
    repo.findEntryKeys.mockResolvedValue([key(0, 11, 6)]);
    repo.findHighlights.mockResolvedValue([highlightRow(11, 6)]);
    expect((await service.entries(user, { limit: 2 })).nextCursor).toBeNull();
  });

  it('passes a valid cursor through and rejects one from another sort', async () => {
    const { service, repo } = makeService();
    const cursor = encodeNotebookCursor({ scope: 'oldest', key: '2026-02-03T04:05:06.123456Z', rank: 2, id: 9 });
    await service.entries(user, { sort: 'oldest', cursor });
    expect(repo.findEntryKeys.mock.calls[0][1].cursor).toEqual({ scope: 'oldest', key: '2026-02-03T04:05:06.123456Z', rank: 2, id: 9 });
    await expect(service.entries(user, { sort: 'newest', cursor })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.entries(user, { cursor: 'garbage!' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('drops a row that was trashed between the keys and the load', async () => {
    const { service, repo } = makeService();
    repo.findEntryKeys.mockResolvedValue([key(0, 11, 6), key(0, 12, 6)]);
    repo.findHighlights.mockResolvedValue([highlightRow(11, 6), highlightRow(12, 6, { deletedAt: at })]);
    expect((await service.entries(user, {})).items.map((item) => item.id)).toEqual([11]);
  });
});

describe('NotebookService.overview', () => {
  it('is all zeros with no accessible library', async () => {
    const { service, repo } = makeService([]);
    const overview = await service.overview(user, {});
    expect(overview).toMatchObject({ total: 0, books: 0, colors: [], origins: [] });
    expect(repo.findOverview).not.toHaveBeenCalled();
  });

  it('sums the kinds into the total and passes the kinds the filters allow', async () => {
    const { service, repo } = makeService();
    repo.findOverview.mockResolvedValue({
      highlights: 10,
      journal: 2,
      bookmarks: 3,
      reviews: 1,
      starred: 4,
      withNotes: 6,
      approximate: 5,
      books: 7,
      colors: [{ color: 'yellow', count: 10 }],
      origins: [
        { origin: 'kobo', count: 6 },
        { origin: 'web', count: 4 },
      ],
    });
    const overview = await service.overview(user, { origins: ['kobo'] });
    expect(repo.findOverview).toHaveBeenCalledWith(expect.anything(), { origins: ['kobo'] }, ['highlight', 'bookmark']);
    expect(overview).toEqual({
      total: 16,
      highlights: 10,
      journal: 2,
      bookmarks: 3,
      reviews: 1,
      starred: 4,
      withNotes: 6,
      approximate: 5,
      books: 7,
      colors: [{ color: 'yellow', count: 10 }],
      origins: [
        { origin: 'kobo', count: 6 },
        { origin: 'web', count: 4 },
      ],
    });
  });
});

describe('NotebookService.books', () => {
  it('builds rows with counts, a capped colour mix, the latest entry and a cursor', async () => {
    const { service, repo } = makeService();
    repo.findBookActivity.mockResolvedValue([
      { bookId: 6, highlights: 12, journal: 1, bookmarks: 0, hasReview: true, lastKey: '2026-02-03T04:05:06.123456Z' },
      { bookId: 7, highlights: 0, journal: 0, bookmarks: 1, hasReview: false, lastKey: '2026-02-01T00:00:00.000000Z' },
    ]);
    repo.findColorMix.mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((color, index) => ({ bookId: 6, color, count: 10 - index })));
    repo.findLatestEntryPerBook.mockResolvedValue([key(0, 11, 6)]);
    repo.findHighlights.mockResolvedValue([highlightRow(11, 6)]);

    const result = await service.books(user, { q: ' herbert ', limit: 1 });
    expect(repo.findBookActivity).toHaveBeenCalledWith(expect.anything(), { searchPattern: '%herbert%', cursor: undefined, limit: 2 });
    expect(repo.findLatestEntryPerBook).toHaveBeenCalledWith(8, [6]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      book: { id: 6, title: 'Book 6' },
      highlights: 12,
      journal: 1,
      bookmarks: 0,
      hasReview: true,
      lastActivityAt: '2026-02-03T04:05:06.123Z',
      latest: { kind: 'highlight', id: 11 },
    });
    expect(result.items[0].colors).toHaveLength(NOTEBOOK_BOOK_COLOR_MIX_MAX);
    expect(result.items[0].colors[0]).toEqual({ color: 'a', count: 10 });
    expect(decodeNotebookCursor(result.nextCursor!, 'books')).toMatchObject({ key: '2026-02-03T04:05:06.123456Z', id: 6 });
  });

  it('is empty with no accessible library', async () => {
    const { service, repo } = makeService([]);
    await expect(service.books(user, {})).resolves.toEqual({ items: [], nextCursor: null });
    expect(repo.findBookActivity).not.toHaveBeenCalled();
  });
});

describe('NotebookService.review', () => {
  it.each([[{}], [{ date: '2026-10-04', seed: 3 }]])('rejects %j: exactly one of date and seed', async (query) => {
    const { service } = makeService();
    await expect(service.review(user, query)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('builds the daily deck for the date, with its older-than boundary', async () => {
    const { service, repo } = makeService();
    repo.findDailyReview.mockResolvedValue([
      { id: 11, bookId: 6 },
      { id: 4, bookId: 2 },
    ]);
    repo.findHighlights.mockResolvedValue([highlightRow(4, 2), highlightRow(11, 6)]);
    const deck = await service.review(user, { date: '2026-10-04', starred: true });
    expect(repo.findDailyReview).toHaveBeenCalledWith(expect.anything(), {
      date: '2026-10-04',
      olderThan: '2026-09-04T00:00:00.000Z',
      limit: NOTEBOOK_REVIEW_DAILY_SIZE,
    });
    expect(deck.items.map((item) => item.id)).toEqual([11, 4]);
    expect(Object.keys(deck.books).sort()).toEqual(['2', '6']);
  });

  it('shuffles by seed with the entry filters', async () => {
    const { service, repo } = makeService();
    await service.review(user, { seed: 42, colors: 'blue', hasNote: false });
    expect(repo.findSeededReview).toHaveBeenCalledWith(expect.anything(), {
      filters: { colors: ['blue'] },
      seed: 42,
      limit: NOTEBOOK_REVIEW_SHUFFLE_MAX,
    });
  });

  it('is empty with no accessible library', async () => {
    const { service, repo } = makeService([]);
    await expect(service.review(user, { date: '2026-10-04' })).resolves.toEqual({ items: [], books: {} });
    expect(repo.findDailyReview).not.toHaveBeenCalled();
  });
});

describe('NotebookService.onThisDay', () => {
  it("defaults to the reader's zone and groups entries by year, newest first", async () => {
    const { service, repo } = makeService();
    // Late on 31 December 2022 in UTC is already 2023 in Kolkata.
    repo.findFirstEntryAt.mockResolvedValue('2022-12-31T20:00:00.000000Z');
    repo.findOnThisDayKeys.mockResolvedValue([
      key(0, 11, 6, '2025-10-04T18:29:59.999999Z'),
      key(1, 3, 6, '2025-10-03T18:30:00.000000Z'),
      key(0, 12, 7, '2023-10-04T00:00:00.000000Z'),
      key(0, 13, 7, '2025-10-05T00:00:00.000000Z'),
    ]);
    repo.findHighlights.mockResolvedValue([highlightRow(11, 6), highlightRow(12, 7), highlightRow(13, 7)]);
    repo.findJournal.mockResolvedValue([
      {
        id: 3,
        clientId: '4f9c7a52-3d1e-4b6a-9a51-0c2f6e8d7b13',
        bookId: 6,
        body: 'b',
        quote: null,
        chapterTitle: null,
        positionPercent: null,
        cfi: null,
        positionSeconds: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
      },
    ]);

    const result = await service.onThisDay(user, { date: '2026-10-04' });
    expect(repo.findFirstEntryAt).toHaveBeenCalledWith(8);
    const call = repo.findOnThisDayKeys.mock.calls[0][1];
    expect(call.limit).toBe(NOTEBOOK_ON_THIS_DAY_MAX);
    expect(call.ranges.map((range: { year: number }) => range.year)).toEqual([2025, 2024, 2023]);
    expect(call.ranges[0]).toEqual({ year: 2025, start: '2025-10-03T18:30:00.000Z', end: '2025-10-04T18:30:00.000Z' });
    expect(result.date).toBe('2026-10-04');
    expect(result.years.map((year) => [year.year, year.items.map((item) => `${item.kind}:${item.id}`)])).toEqual([
      [2025, ['highlight:11', 'journal:3']],
      [2023, ['highlight:12']],
    ]);
    expect(Object.keys(result.books).sort()).toEqual(['6', '7']);
  });

  it('uses the zone the request names and falls back to UTC without a setting', async () => {
    const { service, repo } = makeService();
    repo.findFirstEntryAt.mockResolvedValue('2025-01-01T00:00:00.000000Z');
    await service.onThisDay(user, { date: '2026-10-04', tz: 'Europe/Berlin' });
    await service.onThisDay({ ...user, settings: {} }, { date: '2026-10-04' });
    const [berlin, utc] = repo.findOnThisDayKeys.mock.calls.map((call) => call[1].ranges[0]);
    expect(berlin).toEqual({ year: 2025, start: '2025-10-03T22:00:00.000Z', end: '2025-10-04T22:00:00.000Z' });
    expect(utc).toEqual({ year: 2025, start: '2025-10-04T00:00:00.000Z', end: '2025-10-05T00:00:00.000Z' });
  });

  it('is empty with no accessible library', async () => {
    const { service, repo } = makeService([]);
    await expect(service.onThisDay(user, { date: '2026-10-04' })).resolves.toEqual({ date: '2026-10-04', years: [], books: {} });
    expect(repo.findFirstEntryAt).not.toHaveBeenCalled();
  });
});

describe('NotebookService.trash', () => {
  it('lists deleted highlights and journal entries by deletion time with deletedAt set', async () => {
    const { service, repo } = makeService();
    repo.findEntryKeys.mockResolvedValue([key(0, 11, 6), key(0, 12, 6)]);
    repo.findHighlights.mockResolvedValue([highlightRow(11, 6, { deletedAt: at }), highlightRow(12, 6)]);
    const result = await service.trash(user, { limit: 1 });
    expect(repo.findEntryKeys.mock.calls[0][1]).toMatchObject({
      kinds: ['highlight', 'journal'],
      status: 'trashed',
      sortColumn: 'deleted',
      direction: 'desc',
      limit: 2,
    });
    expect(result.items).toEqual([expect.objectContaining({ id: 11, deletedAt: at.toISOString() })]);
    expect(decodeNotebookCursor(result.nextCursor!, 'trash')).toMatchObject({ id: 11, rank: 0 });
  });

  it('rejects an entries cursor', async () => {
    const { service } = makeService();
    const cursor = encodeNotebookCursor({ scope: 'newest', key: '2026-02-03T04:05:06.123456Z', rank: 0, id: 1 });
    await expect(service.trash(user, { cursor })).rejects.toBeInstanceOf(BadRequestException);
  });
});
