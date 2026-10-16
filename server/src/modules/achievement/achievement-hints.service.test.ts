import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import type { AchievementHint } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { AchievementRow } from '../../db/schema';
import { AchievementHintsService, languageKey, nextTargets } from './achievement-hints.service';
import { ACHIEVEMENT_SEED } from './seed/achievement-seed';

const CATALOGUE: AchievementRow[] = ACHIEVEMENT_SEED.map((row) => ({
  key: row.key,
  groupKey: row.groupKey ?? null,
  tier: row.tier ?? null,
  category: row.category,
  name: row.name,
  description: row.description,
  iconName: row.iconName,
  rarity: row.rarity,
  threshold: row.threshold ?? null,
  hidden: row.hidden ?? false,
  sortOrder: row.sortOrder,
}));

const NOW = new Date('2026-10-16T12:00:00Z');
const DAY_MS = 86_400_000;

function makeAchievementRepo(earned: string[] = []) {
  return {
    findAllAchievements: vi.fn().mockResolvedValue(CATALOGUE),
    findUserEarnedKeys: vi.fn().mockResolvedValue(new Set(earned)),
    sumReadingHours: vi.fn().mockResolvedValue(0),
  };
}

function makeHintsRepo() {
  return {
    sumReadingSecondsSince: vi.fn().mockResolvedValue(0),
    findMonthsWithReading: vi.fn().mockResolvedValue([]),
    findFinishedPeriods: vi.fn().mockResolvedValue([]),
    findUnfinishedByPeriod: vi.fn().mockResolvedValue([]),
    findStalledBook: vi.fn().mockResolvedValue(null),
    findUnratedFinished: vi.fn().mockResolvedValue({ count: 0, bookIds: [] }),
    findNearlyFinished: vi.fn().mockResolvedValue({ count: 0, bookIds: [], lead: null }),
    findUnfinishedByPageCount: vi.fn().mockResolvedValue({ count: 0, inProgress: 0, bookIds: [] }),
    findUnfinishedPublishedBefore: vi.fn().mockResolvedValue({ count: 0, bookIds: [] }),
    findAuthorToDeepen: vi.fn().mockResolvedValue(null),
    findFinishedLanguages: vi.fn().mockResolvedValue([]),
    findUnfinishedByLanguage: vi.fn().mockResolvedValue([]),
  };
}

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return { id: 7, isSuperuser: false, settings: { timezone: 'UTC' }, contentFilters: EMPTY_CONTENT_FILTER_RULES, ...overrides } as RequestUser;
}

function hintFor(hints: AchievementHint[], key: string): AchievementHint | undefined {
  return hints.find((hint) => hint.key === key);
}

describe('AchievementHintsService', () => {
  let achievements: ReturnType<typeof makeAchievementRepo>;
  let hints: ReturnType<typeof makeHintsRepo>;
  let service: AchievementHintsService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    achievements = makeAchievementRepo();
    hints = makeHintsRepo();
    service = new AchievementHintsService(achievements as never, hints as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('has only reasons something is out of reach when the library and history offer nothing', async () => {
    const { hints: result } = await service.getHints(makeUser());

    expect(result.map((hint) => [hint.key, hint.kind])).toEqual([
      ['long_book_1', 'unavailable'],
      ['old_soul', 'unavailable'],
      ['year_round_reader', 'unavailable'],
    ]);
  });

  it('speaks to the next unearned tier of a set and skips achievements already earned', async () => {
    achievements = makeAchievementRepo(['hours_read_1', 'hours_read_2', 'slow_burn']);
    service = new AchievementHintsService(achievements as never, hints as never);
    achievements.sumReadingHours.mockResolvedValue(474);
    hints.sumReadingSecondsSince.mockResolvedValue(44.3 * 3600);
    hints.findStalledBook.mockResolvedValue({ bookId: 1, title: 'x', percent: 50, startedAt: new Date(), fileId: 2, format: 'epub', total: 1 });

    const { hints: result } = await service.getHints(makeUser());

    expect(hintFor(result, 'hours_read_3')).toEqual({
      key: 'hours_read_3',
      kind: 'reading_pace',
      values: { hours: 44, days: 30, remaining: 26, etaDays: 18 },
    });
    expect(hintFor(result, 'slow_burn')).toBeUndefined();
    expect(hints.findStalledBook).not.toHaveBeenCalled();
    expect(hints.sumReadingSecondsSince).toHaveBeenCalledWith(7, new Date(NOW.getTime() - 30 * DAY_MS));
  });

  it('leaves out a reading pace under an hour', async () => {
    hints.sumReadingSecondsSince.mockResolvedValue(40 * 60);

    const { hints: result } = await service.getHints(makeUser());

    expect(hintFor(result, 'hours_read_1')).toBeUndefined();
  });

  it('names the in-progress book that would earn Slow Burn, with a way back into it', async () => {
    const startedAt = new Date('2026-01-09T07:12:00Z');
    hints.findStalledBook.mockResolvedValue({
      bookId: 112,
      title: ' The Elements ',
      percent: 93.36,
      startedAt,
      fileId: 118,
      format: 'epub',
      total: 17,
    });

    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findStalledBook).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }), new Date(NOW.getTime() - 90 * DAY_MS));
    expect(hintFor(result, 'slow_burn')).toEqual({
      key: 'slow_burn',
      kind: 'stalled_book',
      count: 17,
      bookIds: [112],
      bookTitles: ['The Elements'],
      values: { title: 'The Elements', percent: 93, startedAt: startedAt.toISOString(), resume: { bookId: 112, fileId: 118, format: 'epub' } },
    });
  });

  it('offers no resume target for a book without a primary file', async () => {
    hints.findNearlyFinished.mockResolvedValue({ count: 2, bookIds: [5, 6], lead: { bookId: 5, fileId: null, format: null } });

    const { hints: result } = await service.getHints(makeUser());

    expect(hintFor(result, 'books_finished_1')).toEqual({
      key: 'books_finished_1',
      kind: 'nearly_finished',
      count: 2,
      bookIds: [5, 6],
      values: { minPercent: 90, resume: null },
    });
  });

  it('loads unrated finished books once for both rating achievements', async () => {
    hints.findUnratedFinished.mockResolvedValue({ count: 45, bookIds: [163, 837, 317] });

    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findUnratedFinished).toHaveBeenCalledTimes(1);
    expect(hintFor(result, 'critic_1')).toMatchObject({ kind: 'unrated_finished', count: 45, bookIds: [163, 837, 317] });
    expect(hintFor(result, 'first_verdict')).toMatchObject({ kind: 'unrated_finished', count: 45 });
  });

  it('marks a long-book tier unavailable when no unfinished book is long enough', async () => {
    achievements = makeAchievementRepo(['long_book_1', 'page_turner', 'long_book_3']);
    service = new AchievementHintsService(achievements as never, hints as never);
    hints.findUnfinishedByPageCount.mockImplementation((_scope, bounds: { atLeast?: number }) =>
      Promise.resolve(bounds.atLeast ? { count: 0, inProgress: 0, bookIds: [] } : { count: 8, inProgress: 2, bookIds: [663, 37, 674] }),
    );

    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findUnfinishedByPageCount).toHaveBeenCalledWith(expect.anything(), { atLeast: 1000 });
    expect(hintFor(result, 'tome_tamer')).toEqual({ key: 'tome_tamer', kind: 'unavailable', values: { reason: 'no_long_book', pages: 1000 } });
    expect(hintFor(result, 'short_story_fan')).toEqual({
      key: 'short_story_fan',
      kind: 'short_books',
      count: 8,
      bookIds: [663, 37, 674],
      values: { maxPages: 100, inProgress: 2 },
    });
  });

  it('points at the largest unfinished decade and says when too few centuries exist', async () => {
    hints.findFinishedPeriods.mockImplementation((_userId: number, years: number) =>
      Promise.resolve(years === 10 ? [1980, 2000, 2010, 2020] : [1900, 2000]),
    );
    hints.findUnfinishedByPeriod.mockImplementation((_scope, years: number) =>
      Promise.resolve(
        years === 10
          ? [
              { period: 1990, count: 17, bookIds: [614, 532, 496] },
              { period: 1970, count: 4, bookIds: [1] },
            ]
          : [],
      ),
    );

    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findUnfinishedByPeriod).toHaveBeenCalledWith(expect.anything(), 10, [1980, 2000, 2010, 2020]);
    expect(hintFor(result, 'decade_sampler')).toEqual({
      key: 'decade_sampler',
      kind: 'period_unread',
      count: 17,
      bookIds: [614, 532, 496],
      values: { period: 1990, years: 10 },
    });
    expect(hintFor(result, 'century_span')).toEqual({
      key: 'century_span',
      kind: 'unavailable',
      values: { reason: 'too_few_periods', years: 100, reachable: 2 },
    });
  });

  it('marks Old Soul unavailable when nothing before 1900 is left to read', async () => {
    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findUnfinishedPublishedBefore).toHaveBeenCalledWith(expect.anything(), 1900);
    expect(hintFor(result, 'old_soul')).toEqual({ key: 'old_soul', kind: 'unavailable', values: { reason: 'nothing_before_year', year: 1900 } });
  });

  it('names the author to read more of', async () => {
    hints.findAuthorToDeepen.mockResolvedValue({ authorId: 231, name: 'S.D. Perry', finished: 1, count: 10, bookIds: [337, 334, 232] });

    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findAuthorToDeepen).toHaveBeenCalledWith(expect.anything(), 5);
    expect(hintFor(result, 'author_deep_dive')).toEqual({
      key: 'author_deep_dive',
      kind: 'author_unread',
      count: 10,
      bookIds: [337, 334, 232],
      values: { authorId: 231, author: 'S.D. Perry', finished: 1 },
    });
  });

  it('suggests a language not read at all, treating spellings of one language as one', async () => {
    hints.findFinishedLanguages.mockResolvedValue(['en', 'English']);
    hints.findUnfinishedByLanguage.mockResolvedValue([
      { language: 'en-US', count: 40, bookIds: [1, 2, 3], bookTitles: ['A', 'B', 'C'] },
      { language: 'eng', count: 9, bookIds: [4], bookTitles: ['D'] },
      { language: 'Spanish', count: 2, bookIds: [100, 236], bookTitles: ['Cien años', null] },
      { language: 'es', count: 1, bookIds: [7], bookTitles: ['Rayuela'] },
      { language: 'UND', count: 30, bookIds: [8], bookTitles: ['E'] },
      { language: 'it', count: 2, bookIds: [227], bookTitles: ['F'] },
    ]);

    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findUnfinishedByLanguage).toHaveBeenCalledWith(expect.anything(), ['en', 'English']);
    expect(hintFor(result, 'polyglot_1')).toEqual({
      key: 'polyglot_1',
      kind: 'language_unread',
      count: 3,
      bookIds: [100, 236, 7],
      bookTitles: ['Cien años', null, 'Rayuela'],
      values: { language: 'es' },
    });
  });

  it('skips decade, century and language hints before a first finished book', async () => {
    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findUnfinishedByPeriod).not.toHaveBeenCalled();
    expect(hints.findUnfinishedByLanguage).not.toHaveBeenCalled();
    expect(hintFor(result, 'decade_sampler')).toBeUndefined();
    expect(hintFor(result, 'century_span')).toBeUndefined();
    expect(hintFor(result, 'polyglot_1')).toBeUndefined();
  });

  it('lists the months left this year when none has been missed', async () => {
    hints.findMonthsWithReading.mockResolvedValue([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const { hints: result } = await service.getHints(makeUser());

    expect(hints.findMonthsWithReading).toHaveBeenCalledWith(7, 2026);
    expect(hintFor(result, 'year_round_reader')).toEqual({
      key: 'year_round_reader',
      kind: 'months_left',
      count: 2,
      values: { year: 2026, monthsRead: 10, months: [11, 12] },
    });
  });

  it('says the year is out of reach once a month has passed without reading', async () => {
    hints.findMonthsWithReading.mockResolvedValue([1, 2, 4, 5, 6, 7, 8, 9, 10]);

    const { hints: result } = await service.getHints(makeUser());

    expect(hintFor(result, 'year_round_reader')).toEqual({
      key: 'year_round_reader',
      kind: 'unavailable',
      values: { reason: 'missed_month', year: 2026, month: 3 },
    });
  });

  it("reads the year and month in the user's timezone", async () => {
    vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));

    await service.getHints(makeUser({ settings: { timezone: 'Pacific/Kiritimati' } }));

    expect(hints.findMonthsWithReading).toHaveBeenCalledWith(7, 2027);
  });

  it('leaves out a hint whose query fails and keeps the rest', async () => {
    hints.findStalledBook.mockRejectedValue(new Error('boom'));
    hints.findUnratedFinished.mockResolvedValue({ count: 3, bookIds: [1] });

    const { hints: result } = await service.getHints(makeUser());

    expect(hintFor(result, 'slow_burn')).toBeUndefined();
    expect(hintFor(result, 'critic_1')).toBeDefined();
  });

  it('applies content filters to regular users and not to superusers', async () => {
    const contentFilters = { ...EMPTY_CONTENT_FILTER_RULES, excludeGenreIds: [4] };

    await service.getHints(makeUser({ contentFilters }));
    expect(hints.findNearlyFinished).toHaveBeenLastCalledWith({ userId: 7, isSuperuser: false, contentFilters }, 90);

    await service.getHints(makeUser({ isSuperuser: true, contentFilters }));
    expect(hints.findNearlyFinished).toHaveBeenLastCalledWith({ userId: 7, isSuperuser: true, contentFilters: undefined }, 90);
  });
});

describe('nextTargets', () => {
  it('keeps the lowest unearned tier of each set and every unearned single achievement', () => {
    const targets = nextTargets(CATALOGUE, new Set(['books_finished_1', 'books_finished_3', 'slow_burn']));

    expect(targets.get('books_finished')?.key).toBe('books_finished_2');
    expect(targets.get('decade_sampler')?.key).toBe('decade_sampler');
    expect(targets.has('slow_burn')).toBe(false);
  });

  it('never targets a secret achievement', () => {
    const targets = nextTargets(CATALOGUE, new Set());

    expect(targets.has('all_nighter')).toBe(false);
    expect(targets.has('reborn')).toBe(false);
  });

  it('has nothing for a set with every tier earned', () => {
    const targets = nextTargets(CATALOGUE, new Set(['critic_1', 'critic_2', 'critic_3', 'critic_4']));

    expect(targets.has('critic')).toBe(false);
  });
});

describe('languageKey', () => {
  it.each([
    ['en', 'en'],
    ['English', 'en'],
    ['english', 'en'],
    ['eng', 'en'],
    ['en-US', 'en'],
    ['Spanish', 'es'],
    ['spa', 'es'],
    ['ja-jp', 'ja'],
    ['ger', 'de'],
  ])('reads %s as %s', (value, key) => {
    expect(languageKey(value)).toBe(key);
  });

  it.each(['', '  ', 'UND', 'mul', 'zxx', '1234'])('has no key for %j', (value) => {
    expect(languageKey(value)).toBeNull();
  });
});
