import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { readingAttempts } from '../../db/schema';
import { computeLongestStreak, computeStreakData, resolveResumeModes } from './dashboard-widget.calculations';
import { DashboardWidgetRepository } from './dashboard-widget.repository';

const dialect = new PgDialect();

/** A drizzle-shaped select chain that resolves to `rows` however far it is built. */
function makeQuery(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject);
  return query;
}

function render(fragment: unknown) {
  return dialect.sqlToQuery(fragment as SQL);
}

describe('computeLongestStreak', () => {
  it('returns 0 for empty set', () => {
    expect(computeLongestStreak(new Set())).toBe(0);
  });

  it('returns 1 for a single day', () => {
    expect(computeLongestStreak(new Set(['2025-06-01']))).toBe(1);
  });

  it('returns correct streak for consecutive days', () => {
    const days = new Set(['2025-06-01', '2025-06-02', '2025-06-03']);
    expect(computeLongestStreak(days)).toBe(3);
  });

  it('handles gaps and finds the longest run', () => {
    const days = new Set(['2025-06-01', '2025-06-02', '2025-06-05', '2025-06-06', '2025-06-07', '2025-06-08']);
    expect(computeLongestStreak(days)).toBe(4);
  });

  it('handles unsorted input', () => {
    const days = new Set(['2025-06-03', '2025-06-01', '2025-06-02']);
    expect(computeLongestStreak(days)).toBe(3);
  });

  it('returns 1 for non-consecutive days', () => {
    const days = new Set(['2025-06-01', '2025-06-05', '2025-06-10']);
    expect(computeLongestStreak(days)).toBe(1);
  });
});

describe('computeStreakData', () => {
  it('returns all zeros and false for empty reading days', () => {
    const result = computeStreakData(new Set(), '2025-07-10');
    expect(result).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      lastSevenDays: [false, false, false, false, false, false, false],
    });
  });

  it('computes current streak starting from today', () => {
    const today = '2025-07-10';
    const days = new Set(['2025-07-10', '2025-07-09', '2025-07-08']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it('computes current streak starting from yesterday if today has no reading', () => {
    const today = '2025-07-10';
    const days = new Set(['2025-07-09', '2025-07-08', '2025-07-07']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it('returns currentStreak 0 when neither today nor yesterday has reading', () => {
    const today = '2025-07-10';
    const days = new Set(['2025-07-05', '2025-07-06']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(2);
  });

  it('builds lastSevenDays array oldest-first', () => {
    const today = '2025-07-10';
    const days = new Set(['2025-07-10', '2025-07-08', '2025-07-04']);

    const result = computeStreakData(days, today);

    expect(result.lastSevenDays).toEqual([
      true, // July 4
      false, // July 5
      false, // July 6
      false, // July 7
      true, // July 8
      false, // July 9
      true, // July 10
    ]);
  });

  it('handles a streak of exactly 1 day (today only)', () => {
    const today = '2025-07-10';
    const days = new Set(['2025-07-10']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it('handles longest streak being different from current streak', () => {
    const today = '2025-07-10';
    const days = new Set(['2025-07-10', '2025-06-01', '2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(5);
  });

  it('handles year boundary in streak', () => {
    const today = '2025-01-02';
    const days = new Set(['2025-01-02', '2025-01-01', '2024-12-31', '2024-12-30']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(4);
    expect(result.longestStreak).toBe(4);
  });
});

describe('resolveResumeModes', () => {
  const file = (id: number, format: string | null, mediaOverlayAvailable = false) => ({ id, format, mediaOverlayAvailable });

  it('reports all three modes for a narrated EPUB that also has an audiobook', () => {
    const files = [file(1, 'epub', true), file(2, 'mobi'), file(3, 'm4b')];

    expect(resolveResumeModes(files, 1)).toEqual({
      readFileId: 1,
      readFileFormat: 'epub',
      readAlongFileId: 1,
      hasAudio: true,
    });
  });

  it('keeps the primary file as the read file even when a better-ranked format exists', () => {
    const files = [file(1, 'pdf'), file(2, 'epub')];

    expect(resolveResumeModes(files, 1)).toMatchObject({ readFileId: 1, readFileFormat: 'pdf' });
  });

  it("falls back to the library's best readable file when the primary is an audiobook", () => {
    const files = [file(1, 'm4b'), file(2, 'pdf'), file(3, 'mobi')];

    expect(resolveResumeModes(files, 1)).toEqual({
      readFileId: 2,
      readFileFormat: 'pdf',
      readAlongFileId: null,
      hasAudio: true,
    });
    expect(resolveResumeModes(files, 1, ['m4b', 'mobi', 'pdf'])).toMatchObject({ readFileId: 3, readFileFormat: 'mobi' });
  });

  it('reads the plain EPUB and keeps the read-along copy for read-along', () => {
    const files = [file(1, 'm4b'), file(2, 'epub', true), file(3, 'epub')];

    expect(resolveResumeModes(files, 1)).toMatchObject({ readFileId: 3, readAlongFileId: 2, hasAudio: true });
  });

  it('offers no read file for an audio-only book', () => {
    const files = [file(1, 'm4b'), file(2, 'mp3')];

    expect(resolveResumeModes(files, 1)).toEqual({
      readFileId: null,
      readFileFormat: null,
      readAlongFileId: null,
      hasAudio: true,
    });
  });

  it('does not offer a KEPUB as the read file, since no reader opens one', () => {
    const files = [file(1, 'kepub')];

    expect(resolveResumeModes(files, 1)).toMatchObject({ readFileId: null, readFileFormat: null });
  });

  it('prefers the primary EPUB for read-along when several carry overlays', () => {
    const files = [file(1, 'epub', true), file(2, 'epub', true)];

    expect(resolveResumeModes(files, 2)).toMatchObject({ readAlongFileId: 2 });
  });

  it('ignores an overlay flag on a format that cannot carry media overlays', () => {
    const files = [file(1, 'mobi', true)];

    expect(resolveResumeModes(files, 1)).toMatchObject({ readAlongFileId: null });
  });

  it('reports nothing for a book with no files', () => {
    expect(resolveResumeModes([], null)).toEqual({
      readFileId: null,
      readFileFormat: null,
      readAlongFileId: null,
      hasAudio: false,
    });
  });
});

describe('DashboardWidgetRepository.countCompletedBooks', () => {
  it('counts every completed attempt between two local days rather than one status row per book', async () => {
    const query = makeQuery([{ count: 44 }]);
    const db = { select: vi.fn(() => query) };
    const repository = new DashboardWidgetRepository(db as never);

    await expect(repository.countCompletedBooks(1, [3, 4], '2026-01-01', '2027-01-01')).resolves.toBe(44);

    expect(query.from).toHaveBeenCalledWith(readingAttempts);
    const where = render(query.where!.mock.calls[0]![0]);
    expect(where.sql).toContain('"reading_attempts"."outcome" = $2');
    expect(where.sql).toContain('"reading_attempts"."deleted_at" is null');
    expect(where.sql).toContain('"reading_attempts"."ended_on" >= $3');
    expect(where.sql).toContain('"reading_attempts"."ended_on" < $4');
    expect(where.sql).not.toContain('user_book_status');
    expect(where.params).toEqual([1, 'completed', '2026-01-01', '2027-01-01', 3, 4]);
  });

  it('does not query without accessible libraries', async () => {
    const db = { select: vi.fn() };
    const repository = new DashboardWidgetRepository(db as never);

    await expect(repository.countCompletedBooks(1, [], '2026-01-01', '2027-01-01')).resolves.toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('DashboardWidgetRepository.getYearProjectionData', () => {
  const window = {
    yearStartDay: '2026-01-01',
    nextYearStartDay: '2027-01-01',
    recentStartDay: '2026-08-29',
    recentEndDay: '2026-09-28',
    recentStart: new Date('2026-08-29T06:00:00Z'),
  };

  it('takes finished books from the same count as the reading goal, re-reads included', async () => {
    const hoursQuery = makeQuery([{ hours: 22.75 }]);
    const db = { select: vi.fn(() => hoursQuery) };
    const repository = new DashboardWidgetRepository(db as never);
    const count = vi.spyOn(repository, 'countCompletedBooks').mockResolvedValueOnce(44).mockResolvedValueOnce(2);
    const pages = vi
      .spyOn(repository as unknown as { estimatePagesReadSince: (...args: unknown[]) => Promise<unknown> }, 'estimatePagesReadSince')
      .mockResolvedValue({ pagesRead: 4_008, avgPageCount: 350 });

    const result = await repository.getYearProjectionData(1, [3], window);

    expect(count).toHaveBeenNthCalledWith(1, 1, [3], '2026-01-01', '2027-01-01', undefined);
    expect(count).toHaveBeenNthCalledWith(2, 1, [3], '2026-08-29', '2026-09-28', undefined);
    expect(pages).toHaveBeenCalledWith(1, [3], window.recentStart, '2026-08-29', undefined);
    expect(render(hoursQuery.where!.mock.calls[0]![0]).params).toEqual([1, 3, '2026-08-29']);
    expect(result).toEqual({ booksCompletedYtd: 44, booksCompletedLast30Days: 2, pagesReadLast30Days: 4_008, hoursReadLast30Days: 22.75 });
  });

  it('estimates pages from sessions when the books finished in the window have no page count', async () => {
    const db = { select: vi.fn() };
    // In the order the queries are built: the page estimate's five, then the hours rollup.
    db.select
      .mockReturnValueOnce(makeQuery([{ avg: 350 }]))
      // The one book finished in the window has no page count, which is what made the old
      // finished-books-only figure report zero pages.
      .mockReturnValueOnce(makeQuery([{ total: 0 }]))
      .mockReturnValueOnce(makeQuery([{ total: 2_794 }]))
      .mockReturnValueOnce(makeQuery([{ totalProgress: 346.95 }]))
      .mockReturnValueOnce(makeQuery([{ totalProgress: 434.15 }]))
      .mockReturnValueOnce(makeQuery([{ hours: 20 }]));
    const repository = new DashboardWidgetRepository(db as never);
    vi.spyOn(repository, 'countCompletedBooks').mockResolvedValue(0);

    const result = await repository.getYearProjectionData(1, [3], window);

    // 2,794 pages from sessions on books with a page count, plus 346.95% of a book at the
    // reader's 350-page average from sessions on books without one.
    expect(result.pagesReadLast30Days).toBe(2_794 + 1_214);
  });
});

describe('DashboardWidgetRepository.getReadingDnaData', () => {
  it("buckets the peak hour and the lookback's first day on the reader's clock", async () => {
    const dailyQuery = makeQuery([]);
    const peakQuery = makeQuery([{ hour: 20, total: 3_600 }]);
    const db = { select: vi.fn() };
    db.select
      .mockReturnValueOnce(makeQuery([{ avg: 300, total: 10 }]))
      .mockReturnValueOnce(makeQuery([{ count: 4 }]))
      .mockReturnValueOnce(dailyQuery)
      .mockReturnValueOnce(peakQuery)
      .mockReturnValueOnce(makeQuery([{ totalPages: 0, totalSeconds: 0 }]))
      .mockReturnValueOnce(makeQuery([{ totalProgress: 0, totalSeconds: 0 }]));
    const repository = new DashboardWidgetRepository(db as never);

    const result = await repository.getReadingDnaData(1, [3], new Date('2026-03-28T03:00:00Z'), 'America/Denver');

    const hour = render((db.select.mock.calls[3]![0] as { hour: unknown }).hour);
    expect(hour.sql).toBe('extract(hour from ("reading_sessions"."started_at" at time zone $1))::int');
    expect(hour.params).toEqual(['America/Denver']);
    expect(render(peakQuery.groupBy!.mock.calls[0]![0]).sql).toBe('1');
    expect(render(dailyQuery.where!.mock.calls[0]![0]).params).toContain('2026-03-27');
    expect(result.peakHour).toBe(20);
  });
});
