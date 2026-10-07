import { ON_THIS_DAY_YEARS_MAX, isoFromSortKey, localYearOfSortKey, onThisDayRanges, rangeYearOfSortKey, reviewOlderThan } from './notebook-dates';

describe('onThisDayRanges', () => {
  it('is empty when the reader has no history', () => {
    expect(onThisDayRanges('2026-10-04', null, 'UTC')).toEqual([]);
  });

  it('is empty when the oldest entry is from this year', () => {
    expect(onThisDayRanges('2026-10-04', 2026, 'UTC')).toEqual([]);
  });

  it('covers each earlier year back to the first entry year, newest first, as local days', () => {
    expect(onThisDayRanges('2026-10-04', 2024, 'Europe/Berlin')).toEqual([
      { year: 2025, start: '2025-10-03T22:00:00.000Z', end: '2025-10-04T22:00:00.000Z' },
      { year: 2024, start: '2024-10-03T22:00:00.000Z', end: '2024-10-04T22:00:00.000Z' },
    ]);
  });

  it('follows the zone across a daylight saving change', () => {
    // 2025-03-30 is 23 hours long in Berlin.
    expect(onThisDayRanges('2026-03-30', 2025, 'Europe/Berlin')).toEqual([
      { year: 2025, start: '2025-03-29T23:00:00.000Z', end: '2025-03-30T22:00:00.000Z' },
    ]);
    expect(onThisDayRanges('2026-10-04', 2025, 'America/Los_Angeles')[0]).toEqual({
      year: 2025,
      start: '2025-10-04T07:00:00.000Z',
      end: '2025-10-05T07:00:00.000Z',
    });
  });

  it('skips years without 29 February', () => {
    expect(onThisDayRanges('2028-02-29', 2019, 'UTC').map((range) => range.year)).toEqual([2024, 2020]);
  });

  it(`looks back at most ${ON_THIS_DAY_YEARS_MAX} years however old the oldest entry claims to be`, () => {
    const ranges = onThisDayRanges('2026-10-04', 1, 'UTC');
    expect(ranges).toHaveLength(ON_THIS_DAY_YEARS_MAX);
    expect(ranges.at(-1)?.year).toBe(2026 - ON_THIS_DAY_YEARS_MAX);
  });
});

describe('reviewOlderThan', () => {
  it('is the UTC start of the day thirty days before the deck date', () => {
    expect(reviewOlderThan('2026-10-04')).toBe('2026-09-04T00:00:00.000Z');
    expect(reviewOlderThan('2026-03-01')).toBe('2026-01-30T00:00:00.000Z');
  });
});

describe('isoFromSortKey', () => {
  it('drops the microseconds to the millisecond ISO form', () => {
    expect(isoFromSortKey('2026-10-04T17:50:19.006736Z')).toBe('2026-10-04T17:50:19.006Z');
  });
});

describe('localYearOfSortKey', () => {
  it('reads the year in the reader zone', () => {
    expect(localYearOfSortKey('2022-12-31T20:00:00.000000Z', 'Asia/Kolkata')).toBe(2023);
    expect(localYearOfSortKey('2022-12-31T20:00:00.000000Z', 'UTC')).toBe(2022);
    expect(localYearOfSortKey('2023-01-01T03:00:00.000000Z', 'America/Los_Angeles')).toBe(2022);
  });
});

describe('rangeYearOfSortKey', () => {
  const ranges = onThisDayRanges('2026-10-04', 2024, 'Europe/Berlin');

  it('finds the range a key falls in, half-open at the end', () => {
    expect(rangeYearOfSortKey('2025-10-03T22:00:00.000000Z', ranges)).toBe(2025);
    expect(rangeYearOfSortKey('2025-10-04T21:59:59.999999Z', ranges)).toBe(2025);
    expect(rangeYearOfSortKey('2025-10-04T22:00:00.000000Z', ranges)).toBeNull();
    expect(rangeYearOfSortKey('2024-10-04T12:00:00.000000Z', ranges)).toBe(2024);
  });
});
