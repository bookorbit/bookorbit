import { BadRequestException } from '@nestjs/common';
import type { ReadingHistorySummary } from '@bookorbit/types';
import { describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import type { ReadingHistoryService } from '../reading-history/reading-history.service';
import type { ReadingAttemptEventsService } from '../user-book-status/reading-attempt-events.service';
import type { YearReviewRepository, YearReviewSessionRow } from './year-review.repository';
import { YearReviewService } from './year-review.service';

const user = {
  id: 7,
  isSuperuser: false,
  settings: { timezone: 'UTC' },
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
} as unknown as RequestUser;

function summary(overrides: Partial<ReadingHistorySummary> = {}): ReadingHistorySummary {
  return {
    year: 2026,
    quarter: null,
    years: [],
    undatedReads: 0,
    reads: 3,
    books: 2,
    rereads: 1,
    pages: 900,
    seconds: 0,
    daysRead: 0,
    averageRating: null,
    ratedReads: 0,
    notCounted: 0,
    outcomes: { completed: 3, skimmed: 0, abandoned: 0 },
    months: [],
    records: { longestBook: null, mostReread: null, longestRead: null, fastest: null },
    formats: [],
    sources: [],
    goal: { target: 12, reached: 3, metOn: null },
    ...overrides,
  };
}

function row(id: number, bookId: number, start: string, minutes: number, sessionType = 'read'): YearReviewSessionRow {
  const startedAt = new Date(start);
  return {
    id,
    bookId,
    sessionType,
    startedAt,
    endedAt: new Date(startedAt.getTime() + minutes * 60_000),
    durationSeconds: minutes * 60,
    progressDelta: null,
  };
}

function setup(sessions: YearReviewSessionRow[] = []) {
  const libraryScope = { visibleIdsOrAll: vi.fn(() => Promise.resolve([1])) };
  const repo = {
    getSessionPage: vi.fn((_scope: unknown, _window: unknown, afterId: number) => Promise.resolve(sessions.filter((item) => item.id > afterId))),
    getFinishedBooks: vi.fn(() =>
      Promise.resolve([
        { bookId: 10, title: 'First', authors: ['A'], hasCover: true, coverVersion: null, endedOn: '2026-02-03', pageCount: 300, rating: 5 },
        { bookId: 11, title: 'Second', authors: ['B'], hasCover: false, coverVersion: null, endedOn: '2026-02-20', pageCount: 600, rating: null },
      ]),
    ),
    getBooks: vi.fn((ids: number[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, { bookId: id, title: `Book ${id}`, authors: ['Author'], hasCover: true, coverVersion: 'v1' }]))),
    ),
    getGenresByBook: vi.fn(() =>
      Promise.resolve(
        new Map([
          [10, ['Fantasy']],
          [11, ['Fantasy', 'Mystery']],
        ]),
      ),
    ),
    getAuthorsByBook: vi.fn(() =>
      Promise.resolve(
        new Map([
          [10, [{ authorId: 5, name: 'Ursula', hasPhoto: true }]],
          [11, [{ authorId: 6, name: 'Agatha', hasPhoto: false }]],
        ]),
      ),
    ),
    countHighlights: vi.fn(() => Promise.resolve({ highlights: 4, notes: 1 })),
    pickHighlight: vi.fn(() =>
      Promise.resolve({
        annotationId: 99,
        bookId: 10,
        text: 'A quotable line',
        note: null,
        chapterTitle: 'One',
        color: 'yellow',
        createdAt: '2026-02-01T10:00:00.000Z',
        starred: true,
      }),
    ),
    mostHighlightedBook: vi.fn(() => Promise.resolve({ bookId: 10, highlights: 3 })),
  };
  const history = {
    summary: vi.fn((_user: RequestUser, query: { year: number }) =>
      Promise.resolve(query.year === 2026 ? summary() : summary({ year: query.year, books: 1, seconds: 7200 })),
    ),
  };
  const events = { on: vi.fn(), removeListener: vi.fn(), flushPendingChanges: vi.fn() };
  const service = new YearReviewService(
    repo as unknown as YearReviewRepository,
    history as unknown as ReadingHistoryService,
    events as unknown as ReadingAttemptEventsService,
    libraryScope as never,
  );
  return { repo, history, events, service };
}

describe('YearReviewService', () => {
  const now = new Date('2026-11-05T12:00:00Z');

  it('refuses a year that has not begun or predates the route', async () => {
    const { service } = setup();
    await expect(service.getYear(user, 2027, now)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.getYear(user, 1999, now)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts a running year up to today', async () => {
    const { service } = setup([row(1, 10, '2026-02-01T10:00:00Z', 30)]);
    const review = await service.getYear(user, 2026, now);
    expect(review.partial).toBe(true);
    expect(review.throughDay).toBe('2026-11-05');
    expect(review.dailyMinutes).toHaveLength(309);
  });

  it('counts a closed year to December 31', async () => {
    const { service } = setup();
    const review = await service.getYear(user, 2025, now);
    expect(review.partial).toBe(false);
    expect(review.throughDay).toBe('2025-12-31');
    expect(review.dailyMinutes).toHaveLength(365);
  });

  it('assembles the year from sessions, finished reads and highlights', async () => {
    const sessions = [
      row(1, 10, '2026-02-01T22:00:00Z', 60),
      row(2, 10, '2026-02-02T22:00:00Z', 60),
      row(3, 11, '2026-02-03T22:00:00Z', 30, 'listen'),
    ];
    const { service } = setup(sessions);
    const review = await service.getYear(user, 2026, now);

    expect(review.totals).toMatchObject({
      booksFinished: 2,
      reads: 3,
      rereads: 1,
      pages: 900,
      totalSeconds: 150 * 60,
      readingSeconds: 120 * 60,
      listeningSeconds: 30 * 60,
      activeDays: 3,
      sessions: 3,
      booksOpened: 2,
      highlights: 4,
      notes: 1,
    });
    expect(review.previousYear).toEqual({ year: 2025, booksFinished: 1, totalSeconds: 7200 });
    expect(review.goal).toEqual({ target: 12, reached: 3, metOn: null });
    expect(review.months[1]).toMatchObject({ month: 2, seconds: 150 * 60, booksFinished: 2 });
    expect(review.busiestMonth).toBe(2);
    expect(review.busiestHour).toBe(22);
    expect(review.longestStreak).toEqual({ days: 3, startDay: '2026-02-01', endDay: '2026-02-03' });
    expect(review.topBooks.map((book) => [book.bookId, book.seconds])).toEqual([
      [10, 7200],
      [11, 1800],
    ]);
    expect(review.topGenres[0]).toEqual({ name: 'Fantasy', seconds: 9000, books: 2 });
    expect(review.topAuthors[0]).toMatchObject({ authorId: 5, name: 'Ursula', hasPhoto: true, seconds: 7200, books: 1 });
    expect(review.highlight).toMatchObject({ annotationId: 99, starred: true, book: { bookId: 10, title: 'Book 10' } });
    expect(review.mostHighlightedBook).toMatchObject({ highlights: 3, book: { bookId: 10 } });
    expect(review.finishedBooks.map((book) => book.title)).toEqual(['First', 'Second']);
  });

  it('serves a repeat from the cache and recomputes after a change to the reader’s reads', async () => {
    const { service, repo, events } = setup();
    await service.getYear(user, 2025, now);
    await service.getYear(user, 2025, now);
    expect(repo.getFinishedBooks).toHaveBeenCalledTimes(1);

    service.onModuleInit();
    const listener = events.on.mock.calls[0]![1] as (payload: { userId: number | null }) => void;
    listener({ userId: 7 });
    await service.getYear(user, 2025, now);
    expect(repo.getFinishedBooks).toHaveBeenCalledTimes(2);
  });

  it('leaves the comparison out when the year before had no reading', async () => {
    const { service, history } = setup();
    history.summary.mockImplementation((_user: RequestUser, query: { year: number }) =>
      Promise.resolve(query.year === 2026 ? summary() : summary({ books: 0, seconds: 0 })),
    );
    const review = await service.getYear(user, 2026, now);
    expect(review.previousYear).toBeNull();
    expect(review.personality).toBeNull();
  });
});
