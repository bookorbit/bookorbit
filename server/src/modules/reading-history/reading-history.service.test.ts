import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { RequestUser } from '../../common/types/request-user';
import { ReadingHistoryService } from './reading-history.service';

const user = {
  id: 7,
  isSuperuser: false,
  settings: { timezone: 'Asia/Kolkata', dashboardConfig: { readingGoal: 12 } },
  contentFilters: { includeTagIds: [], includeGenreIds: [], excludeTagIds: [], excludeGenreIds: [] },
} as unknown as RequestUser;

function setup() {
  const repo = {
    getAccessibleLibraryIds: vi.fn(() => Promise.resolve([1, 2])),
    list: vi.fn(() => Promise.resolve([])),
    count: vi.fn(() => Promise.resolve(0)),
    months: vi.fn(() => Promise.resolve([])),
    totals: vi.fn(() =>
      Promise.resolve({
        reads: 14,
        books: 12,
        rereads: 2,
        pages: 3000,
        averageRating: 4.5 as number | null,
        ratedReads: 2,
        notCounted: 1,
        outcomes: { completed: 14, skimmed: 1, abandoned: 0 },
      }),
    ),
    readingTimeTotal: vi.fn(() => Promise.resolve({ seconds: 3600, days: 4 })),
    completedByMonth: vi.fn(() => Promise.resolve([{ month: 2, reads: 9, rereads: 1 }])),
    readingTimeByMonth: vi.fn(() => Promise.resolve([{ month: 2, seconds: 1800, days: 2 }])),
    records: vi.fn(() => Promise.resolve({ longestBook: null, longestRead: null, fastest: null, mostReread: null })),
    formats: vi.fn(() => Promise.resolve([])),
    sources: vi.fn(() => Promise.resolve([])),
    years: vi.fn(() => Promise.resolve({ years: [{ year: 2026, reads: 14 }], undated: 3 })),
    goalMetOn: vi.fn(() => Promise.resolve('2026-05-02')),
    findOwnedRead: vi.fn(),
    setReadRating: vi.fn(() => Promise.resolve(undefined)),
    marks: vi.fn(() => Promise.resolve({ highlights: [], highlightCount: 4, journal: [], journalCount: 1 })),
  };
  const bookService = { bulkSetRating: vi.fn(() => Promise.resolve(undefined)) };
  const events = { on: vi.fn(), removeListener: vi.fn() };
  const service = new ReadingHistoryService(repo as never, bookService as never, events as never);
  return { service, repo, bookService };
}

describe('ReadingHistoryService', () => {
  it('lists finished reads in the reader zone, completed only unless asked, and lays out months on the first page', async () => {
    const { service, repo } = setup();
    await service.list(user, { year: 2026, quarter: 4 });
    const [scope, filter, offset, limit] = repo.list.mock.calls[0] as unknown as [
      { timeZone: string; libraryIds: number[] },
      { period: unknown; outcomes: string[]; sort: string },
      number,
      number,
    ];
    expect(scope).toMatchObject({ userId: 7, libraryIds: [1, 2], timeZone: 'Asia/Kolkata' });
    expect(filter).toMatchObject({ period: { from: '2026-10-01', until: '2027-01-01' }, outcomes: ['completed'], sort: 'newest' });
    expect([offset, limit]).toEqual([0, 100]);
    expect(repo.months).toHaveBeenCalledTimes(1);

    await service.list(user, { offset: 100, outcomes: ['abandoned', 'abandoned', 'completed'] });
    expect(repo.months).toHaveBeenCalledTimes(1);
    expect((repo.list.mock.calls[1] as unknown as [unknown, { period: unknown; outcomes: string[] }])[1]).toMatchObject({
      period: { from: null, until: null },
      outcomes: ['abandoned', 'completed'],
    });
  });

  it('bounds a quarter by its months and refuses a quarter without a year', async () => {
    const { service, repo } = setup();
    await service.list(user, { year: 2026, quarter: 2 });
    expect((repo.list.mock.calls[0] as unknown as [unknown, { period: unknown }])[1].period).toEqual({ from: '2026-04-01', until: '2026-07-01' });
    await expect(service.list(user, { quarter: 2 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('builds a year summary with every month, the goal and the day it was met', async () => {
    const { service } = setup();
    const summary = await service.summary(user, { year: 2026 });
    expect(summary.months).toHaveLength(12);
    expect(summary.months[1]).toEqual({ month: 2, reads: 9, rereads: 1, seconds: 1800 });
    expect(summary.goal).toEqual({ target: 12, reached: 14, metOn: '2026-05-02' });
    expect(summary).toMatchObject({ reads: 14, seconds: 3600, daysRead: 4, undatedReads: 3 });
  });

  it('measures a quarter against the whole year goal', async () => {
    const { service, repo } = setup();
    repo.totals.mockResolvedValueOnce({
      reads: 3,
      books: 3,
      rereads: 0,
      pages: 0,
      averageRating: null,
      ratedReads: 0,
      notCounted: 0,
      outcomes: { completed: 3, skimmed: 0, abandoned: 0 },
    });
    const summary = await service.summary(user, { year: 2026, quarter: 1 });
    expect(summary.months).toHaveLength(12);
    expect(repo.completedByMonth).toHaveBeenLastCalledWith(expect.anything(), { from: '2026-01-01', until: '2027-01-01' });
    expect(summary.goal?.reached).toBe(14);
  });

  it('rates the book too when the read is its latest finish', async () => {
    const { service, repo, bookService } = setup();
    repo.findOwnedRead.mockResolvedValueOnce({ id: 3, bookId: 40, startedOn: null, endedOn: '2026-01-01', latestCompleted: true });
    expect(await service.setRating(user, 3, 4)).toEqual({ rating: 4, bookRatingChanged: true });
    expect(repo.setReadRating).toHaveBeenCalledWith(7, 3, 4);
    expect(bookService.bulkSetRating).toHaveBeenCalledWith([40], 4, user);
  });

  it('rates an earlier read on its own, and never a deleted book', async () => {
    const { service, repo, bookService } = setup();
    repo.findOwnedRead.mockResolvedValueOnce({ id: 3, bookId: 40, startedOn: null, endedOn: '2025-01-01', latestCompleted: false });
    expect(await service.setRating(user, 3, 2)).toEqual({ rating: 2, bookRatingChanged: false });
    repo.findOwnedRead.mockResolvedValueOnce({ id: 4, bookId: null, startedOn: null, endedOn: '2025-01-01', latestCompleted: true });
    expect(await service.setRating(user, 4, null)).toEqual({ rating: null, bookRatingChanged: false });
    expect(bookService.bulkSetRating).not.toHaveBeenCalled();
  });

  it('answers 404 for a read that is not the reader own', async () => {
    const { service, repo } = setup();
    repo.findOwnedRead.mockResolvedValue(null);
    await expect(service.setRating(user, 99, 5)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.marks(user, 99)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('has no marks for a read of a deleted book or one with no finish date', async () => {
    const { service, repo } = setup();
    repo.findOwnedRead.mockResolvedValueOnce({ id: 5, bookId: null, startedOn: '2026-01-01', endedOn: '2026-01-03', latestCompleted: true });
    expect(await service.marks(user, 5)).toEqual({ highlights: [], highlightCount: 0, journal: [], journalCount: 0 });
    repo.findOwnedRead.mockResolvedValueOnce({ id: 6, bookId: 8, startedOn: '2026-01-01', endedOn: '2026-01-03', latestCompleted: true });
    expect((await service.marks(user, 6)).highlightCount).toBe(4);
    expect(repo.marks).toHaveBeenCalledWith(7, { bookId: 8, startedOn: '2026-01-01', endedOn: '2026-01-03' }, 'Asia/Kolkata', {
      highlights: 3,
      journal: 2,
    });
  });
});
