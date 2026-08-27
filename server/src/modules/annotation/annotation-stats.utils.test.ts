import type { AnnotationHubActivityWeek } from '@bookorbit/types';

import {
  foldActivityRows,
  foldActivityWeeks,
  foldChapterRows,
  longestQuietWeeks,
  spinePosition,
  type ActivityStatRow,
  type ChapterStatRow,
} from './annotation-stats.utils';

function chapterRow(overrides: Partial<ChapterStatRow> = {}): ChapterStatRow {
  return {
    title: 'Loomings',
    color: 'yellow',
    count: 1,
    chapterIndex: null,
    cfiSpineStep: null,
    firstCreatedAt: new Date('2026-04-02T00:00:00Z'),
    ...overrides,
  };
}

describe('spinePosition', () => {
  it('prefers the chapter index the converter recorded', () => {
    expect(spinePosition(6, 99)).toBe(6);
  });

  it('reads a spine index out of the doubled CFI step', () => {
    expect(spinePosition(null, 2)).toBe(0);
    expect(spinePosition(null, 14)).toBe(6);
  });

  it('has no position when neither source is present', () => {
    expect(spinePosition(null, null)).toBeNull();
  });

  it('rejects a step that cannot address a spine item', () => {
    expect(spinePosition(null, 0)).toBeNull();
  });
});

describe('foldChapterRows', () => {
  it('orders a part-synced book correctly across both position sources', () => {
    // Kobo highlights arrive as raw CFIs and KOReader ones as a converted chapter index. Sorting
    // the two raw numbers against each other interleaved the chapters of the same book.
    const result = foldChapterRows([
      chapterRow({ title: 'The Spouter-Inn', cfiSpineStep: 6 }),
      chapterRow({ title: 'The Lee Shore', chapterIndex: 7 }),
      chapterRow({ title: 'The Sermon', cfiSpineStep: 8 }),
    ]);

    expect(result.map((c) => c.title)).toEqual(['The Spouter-Inn', 'The Sermon', 'The Lee Shore']);
  });

  it('collapses the colour grouping into one entry per chapter', () => {
    const result = foldChapterRows([
      chapterRow({ title: 'Loomings', color: 'yellow', count: 5, chapterIndex: 2 }),
      chapterRow({ title: 'Loomings', color: '#38BDF8', count: 3, chapterIndex: 2 }),
      chapterRow({ title: 'Cetology', color: 'yellow', count: 1, chapterIndex: 8 }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ title: 'Loomings', count: 8 });
    expect(result[0].colors).toEqual([
      { color: 'yellow', count: 5 },
      { color: '#38BDF8', count: 3 },
    ]);
    expect(result[1]).toMatchObject({ title: 'Cetology', count: 1 });
  });

  it('orders chapters by their position through the book', () => {
    const result = foldChapterRows([
      chapterRow({ title: 'Epilogue', chapterIndex: 120 }),
      chapterRow({ title: 'Loomings', chapterIndex: 2 }),
      chapterRow({ title: 'The Whiteness of the Whale', chapterIndex: 42 }),
    ]);

    expect(result.map((c) => c.title)).toEqual(['Loomings', 'The Whiteness of the Whale', 'Epilogue']);
  });

  it('falls back to first-marked order for chapters with no resolvable position', () => {
    const result = foldChapterRows([
      chapterRow({ title: 'Later', firstCreatedAt: new Date('2026-05-01T00:00:00Z') }),
      chapterRow({ title: 'Earlier', firstCreatedAt: new Date('2026-04-01T00:00:00Z') }),
    ]);

    expect(result.map((c) => c.title)).toEqual(['Earlier', 'Later']);
  });

  it('sorts positioned chapters ahead of unpositioned ones', () => {
    const result = foldChapterRows([
      chapterRow({ title: 'No position', firstCreatedAt: new Date('2026-01-01T00:00:00Z') }),
      chapterRow({ title: 'Positioned', chapterIndex: 90, firstCreatedAt: new Date('2026-09-01T00:00:00Z') }),
    ]);

    expect(result.map((c) => c.title)).toEqual(['Positioned', 'No position']);
  });

  it('keeps highlights with no chapter title as their own entry', () => {
    const result = foldChapterRows([chapterRow({ title: null, count: 4 })]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBeNull();
    expect(result[0].count).toBe(4);
  });

  it('takes the lowest chapter index and the earliest timestamp across the group', () => {
    const result = foldChapterRows([
      chapterRow({ color: 'yellow', chapterIndex: 7, firstCreatedAt: new Date('2026-04-05T00:00:00Z') }),
      chapterRow({ color: '#F472B6', chapterIndex: 6, firstCreatedAt: new Date('2026-04-02T00:00:00Z') }),
    ]);

    expect(result[0].chapterIndex).toBe(6);
    expect(result[0].order).toBe(6);
    expect(result[0].firstCreatedAt).toBe('2026-04-02T00:00:00.000Z');
  });

  it('ignores null indexes rather than treating them as zero', () => {
    const result = foldChapterRows([
      chapterRow({ color: 'yellow', chapterIndex: null, cfiSpineStep: null }),
      chapterRow({ color: '#38BDF8', chapterIndex: 4 }),
    ]);

    expect(result[0].chapterIndex).toBe(4);
    expect(result[0].order).toBe(4);
  });

  it('returns nothing for a book with no highlights', () => {
    expect(foldChapterRows([])).toEqual([]);
  });
});

describe('foldActivityRows', () => {
  function activityRow(overrides: Partial<ActivityStatRow> = {}): ActivityStatRow {
    return { day: '2026-08-19', origin: 'kobo', count: 1, ...overrides };
  }

  it('collapses the origin grouping into one entry per day, newest first', () => {
    const result = foldActivityRows([
      activityRow({ day: '2026-08-13', origin: 'web', count: 2 }),
      activityRow({ day: '2026-08-19', origin: 'kobo', count: 3 }),
      activityRow({ day: '2026-08-19', origin: 'koreader', count: 1 }),
    ]);

    expect(result).toEqual([
      {
        day: '2026-08-19',
        count: 4,
        origins: [
          { origin: 'kobo', count: 3 },
          { origin: 'koreader', count: 1 },
        ],
      },
      { day: '2026-08-13', count: 2, origins: [{ origin: 'web', count: 2 }] },
    ]);
  });

  it('returns nothing for a book with no highlights', () => {
    expect(foldActivityRows([])).toEqual([]);
  });
});

describe('foldActivityWeeks', () => {
  it('collapses the (week, origin) grouping into one entry per week, oldest first', () => {
    const weeks = foldActivityWeeks([
      { weekStart: '2026-08-17', origin: 'web', count: 4 },
      { weekStart: '2026-08-03', origin: 'kobo', count: 2 },
      { weekStart: '2026-08-17', origin: 'kobo', count: 6 },
    ]);

    expect(weeks.map((week) => week.weekStart)).toEqual(['2026-08-03', '2026-08-17']);
    expect(weeks[1]!.count).toBe(10);
    // Heaviest origin first, so a stacked bar draws its dominant source at the base.
    expect(weeks[1]!.origins).toEqual([
      { origin: 'kobo', count: 6 },
      { origin: 'web', count: 4 },
    ]);
  });

  it('returns nothing for an empty grouping', () => {
    expect(foldActivityWeeks([])).toEqual([]);
  });
});

describe('longestQuietWeeks', () => {
  const week = (weekStart: string, count = 1): AnnotationHubActivityWeek => ({ weekStart, count, origins: [] });

  it('counts the empty weeks between two marked ones', () => {
    // 03 Aug then 24 Aug leaves the 10th and the 17th empty.
    const weeks = [week('2026-08-03'), week('2026-08-24')];
    expect(longestQuietWeeks(weeks, new Date('2026-08-25T00:00:00.000Z'))).toBe(2);
  });

  it('counts the run since the last mark when that is the longest', () => {
    const weeks = [week('2026-06-01'), week('2026-06-08')];
    expect(longestQuietWeeks(weeks, new Date('2026-07-06T00:00:00.000Z'))).toBe(4);
  });

  it('measures from the first mark, not the window edge', () => {
    // A library that only started last week must not report a quiet year.
    const weeks = [week('2026-08-17'), week('2026-08-24')];
    expect(longestQuietWeeks(weeks, new Date('2026-08-25T00:00:00.000Z'))).toBe(0);
  });

  it('is zero when nothing was ever marked', () => {
    expect(longestQuietWeeks([], new Date('2026-08-25T00:00:00.000Z'))).toBe(0);
  });
});
