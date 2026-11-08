import { describe, expect, it } from 'vitest';

import {
  YearSessionAccumulator,
  busiestIndex,
  computePersonality,
  dayDifference,
  isShelfLabel,
  localHour,
  longestStreak,
  rankByBooks,
  type PersonalityInput,
  type YearSessionInput,
} from './year-review.calculations';

function session(bookId: number, start: string, minutes: number, sessionType = 'read'): YearSessionInput {
  const startedAt = new Date(start);
  return {
    bookId,
    sessionType,
    startedAt,
    endedAt: new Date(startedAt.getTime() + minutes * 60_000),
    durationSeconds: minutes * 60,
    progressDelta: null,
  };
}

describe('YearSessionAccumulator', () => {
  it('keeps only the part of a New Year session that falls inside the year', () => {
    const accumulator = new YearSessionAccumulator(2026, '2026-12-31', 'UTC');
    accumulator.add(session(1, '2025-12-31T23:30:00Z', 60));
    accumulator.add(session(1, '2026-12-31T23:30:00Z', 60));
    const totals = accumulator.result();
    expect(totals.totalSeconds).toBe(3600);
    expect(totals.daily[0]).toBe(1800);
    expect(totals.daily[364]).toBe(1800);
    expect(totals.sessions).toBe(2);
  });

  it('places time on the reader’s own calendar', () => {
    const accumulator = new YearSessionAccumulator(2026, '2026-12-31', 'America/Los_Angeles');
    // 03:00 UTC on 1 March is the evening of 28 February in Los Angeles.
    accumulator.add(session(1, '2026-03-01T03:00:00Z', 30));
    const totals = accumulator.result();
    expect(totals.daily[dayDifference('2026-01-01', '2026-02-28')]).toBe(1800);
    expect(totals.months[1]!.readingSeconds).toBe(1800);
    expect(totals.hours[19]).toBe(1800);
  });

  it('splits reading from listening and ranks books by time', () => {
    const accumulator = new YearSessionAccumulator(2026, '2026-06-30', 'UTC');
    accumulator.add(session(1, '2026-02-01T10:00:00Z', 30));
    accumulator.add(session(2, '2026-02-02T10:00:00Z', 90, 'listen'));
    accumulator.add(session(2, '2026-02-03T10:00:00Z', 15, 'tts'));
    const totals = accumulator.result();
    expect(totals.readingSeconds).toBe(1800);
    expect(totals.listeningSeconds).toBe(105 * 60);
    expect(totals.bookSeconds.get(2)).toBe(105 * 60);
    expect(totals.longestSession).toEqual({ seconds: 5400, day: '2026-02-02', bookId: 2 });
  });

  it('ignores time after the last counted day of a running year', () => {
    const accumulator = new YearSessionAccumulator(2026, '2026-11-05', 'UTC');
    accumulator.add(session(1, '2026-11-06T10:00:00Z', 30));
    expect(accumulator.result().totalSeconds).toBe(0);
    expect(accumulator.result().daily).toHaveLength(dayDifference('2026-01-01', '2026-11-05') + 1);
  });
});

describe('year shape helpers', () => {
  it('finds the busiest slot, earliest on a tie, and nothing for an empty year', () => {
    expect(busiestIndex([0, 5, 9, 9, 1])).toBe(2);
    expect(busiestIndex([0, 0])).toBeNull();
  });

  it('finds the longest run of reading days', () => {
    expect(longestStreak([1, 1, 0, 1, 1, 1, 0], '2026-01-01')).toEqual({ days: 3, startDay: '2026-01-04', endDay: '2026-01-06' });
    expect(longestStreak([0, 0], '2026-01-01')).toBeNull();
  });

  it('counts a book once per genre however it is filed', () => {
    const ranked = rankByBooks(
      new Map([
        [1, 600],
        [2, 300],
      ]),
      new Map([
        [1, ['Fantasy', 'Fantasy', 'Adventure']],
        [2, ['Fantasy']],
      ]),
    );
    expect(ranked[0]).toEqual({ key: 'Fantasy', seconds: 900, books: 2 });
    expect(ranked[1]).toEqual({ key: 'Adventure', seconds: 600, books: 1 });
  });

  it('reads the local hour', () => {
    expect(localHour(new Date('2026-07-01T22:15:00Z'), 'Asia/Kolkata')).toBe(3);
  });
});

describe('computePersonality', () => {
  const base: PersonalityInput = {
    totalSeconds: 100 * 3600,
    listeningSeconds: 0,
    sessions: 200,
    hours: Array.from({ length: 24 }, () => (100 * 3600) / 24),
    weekdays: Array.from({ length: 7 }, () => (100 * 3600) / 7),
    sessionSeconds: Array.from({ length: 200 }, () => 20 * 60),
    activeDays: 100,
    daysElapsed: 300,
    genreSeconds: [40 * 3600, 30 * 3600, 30 * 3600],
    topAuthorSeconds: 20 * 3600,
    booksFinished: 10,
  };

  it('says nothing about a thin year', () => {
    expect(computePersonality({ ...base, totalSeconds: 1800 })).toBeNull();
    expect(computePersonality({ ...base, sessions: 3 })).toBeNull();
  });

  it('calls a reader who is a little of everything a free spirit', () => {
    expect(computePersonality(base)?.code).toBe('free-spirit');
  });

  it('picks the trait that stands out most', () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ([21, 22, 23].includes(hour) ? 30 * 3600 : (10 * 3600) / 21));
    const nightOwl = computePersonality({ ...base, hours });
    expect(nightOwl?.code).toBe('night-owl');
    expect(nightOwl?.traits.nightShare).toBeGreaterThan(0.9);

    expect(computePersonality({ ...base, listeningSeconds: 80 * 3600 })?.code).toBe('listener');
    expect(computePersonality({ ...base, sessionSeconds: [90 * 60, 80 * 60, 70 * 60] })?.code).toBe('marathoner');
    expect(computePersonality({ ...base, activeDays: 290 })?.code).toBe('daily-ritual');
  });

  it('keeps the listed order on a tie', () => {
    // Both exactly at their threshold: night owl is listed first.
    const night = new Set([21, 22, 23, 0, 1, 2, 3]);
    const hours = Array.from({ length: 24 }, (_, hour) => (hour === 22 ? 40 * 3600 : night.has(hour) ? 0 : (60 * 3600) / 17));
    const result = computePersonality({ ...base, hours, activeDays: 180 });
    expect(result?.code).toBe('night-owl');
  });
});

describe('isShelfLabel', () => {
  it('drops shelf, format and audience labels but keeps real genres', () => {
    expect(['Books', 'Audiobook', 'Fiction & Literature', 'ADULT', 'to-read', 'Book Club'].every(isShelfLabel)).toBe(true);
    expect(['Fantasy', 'Literary Fiction', 'Science Fiction', 'Mystery'].some(isShelfLabel)).toBe(false);
  });
});

describe('computePersonality range', () => {
  it('needs a reader’s time spread across genres to call them an explorer', () => {
    const input = {
      totalSeconds: 100 * 3600,
      listeningSeconds: 0,
      sessions: 200,
      hours: Array.from({ length: 24 }, () => (100 * 3600) / 24),
      weekdays: Array.from({ length: 7 }, () => (100 * 3600) / 7),
      sessionSeconds: Array.from({ length: 200 }, () => 20 * 60),
      activeDays: 100,
      daysElapsed: 300,
      topAuthorSeconds: 10 * 3600,
      booksFinished: 10,
    };
    // Ten tags on every book of one kind: each genre holds all of the time.
    expect(computePersonality({ ...input, genreSeconds: Array.from({ length: 10 }, () => 100 * 3600) })?.code).toBe('free-spirit');
    // Twelve genres, none holding more than a sixth of the year.
    expect(computePersonality({ ...input, genreSeconds: Array.from({ length: 12 }, () => 15 * 3600) })?.code).toBe('explorer');
  });
});
