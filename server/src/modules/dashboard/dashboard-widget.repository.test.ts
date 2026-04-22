import { computeLongestStreak, computeStreakData, formatDay } from './dashboard-widget.calculations';

describe('formatDay', () => {
  it('formats a UTC date as YYYY-MM-DD', () => {
    expect(formatDay(new Date('2025-03-15T12:00:00Z'))).toBe('2025-03-15');
  });

  it('uses UTC date even near midnight', () => {
    expect(formatDay(new Date('2025-01-01T23:59:59Z'))).toBe('2025-01-01');
  });
});

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
    const result = computeStreakData(new Set(), new Date('2025-07-10T12:00:00Z'));
    expect(result).toEqual({
      currentStreak: 0,
      longestStreak: 0,
      lastSevenDays: [false, false, false, false, false, false, false],
    });
  });

  it('computes current streak starting from today', () => {
    const today = new Date('2025-07-10T12:00:00Z');
    const days = new Set(['2025-07-10', '2025-07-09', '2025-07-08']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it('computes current streak starting from yesterday if today has no reading', () => {
    const today = new Date('2025-07-10T12:00:00Z');
    const days = new Set(['2025-07-09', '2025-07-08', '2025-07-07']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(3);
    expect(result.longestStreak).toBe(3);
  });

  it('returns currentStreak 0 when neither today nor yesterday has reading', () => {
    const today = new Date('2025-07-10T12:00:00Z');
    const days = new Set(['2025-07-05', '2025-07-06']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(2);
  });

  it('builds lastSevenDays array oldest-first', () => {
    const today = new Date('2025-07-10T12:00:00Z');
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
    const today = new Date('2025-07-10T12:00:00Z');
    const days = new Set(['2025-07-10']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(1);
  });

  it('handles longest streak being different from current streak', () => {
    const today = new Date('2025-07-10T12:00:00Z');
    const days = new Set(['2025-07-10', '2025-06-01', '2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(1);
    expect(result.longestStreak).toBe(5);
  });

  it('handles year boundary in streak', () => {
    const today = new Date('2025-01-02T12:00:00Z');
    const days = new Set(['2025-01-02', '2025-01-01', '2024-12-31', '2024-12-30']);
    const result = computeStreakData(days, today);

    expect(result.currentStreak).toBe(4);
    expect(result.longestStreak).toBe(4);
  });
});
