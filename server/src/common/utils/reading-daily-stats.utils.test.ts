import { describe, expect, it } from 'vitest';

import {
  aggregateReadingSessionDailyStats,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  splitReadingSessionByDay,
} from './reading-daily-stats.utils';

describe('reading daily stats utils', () => {
  it('keeps a same-day session on one local day', () => {
    const result = splitReadingSessionByDay(
      {
        startedAt: new Date('2026-04-15T10:00:00.000Z'),
        endedAt: new Date('2026-04-15T10:30:00.000Z'),
        durationSeconds: 1800,
        progressDelta: 4,
      },
      'UTC',
    );

    expect(result).toEqual([{ day: '2026-04-15', readingSeconds: 1800, progressDelta: 4, sessionsCount: 1 }]);
  });

  it('splits a continuous session across local midnight', () => {
    const result = splitReadingSessionByDay(
      {
        startedAt: new Date('2026-04-16T03:00:00.000Z'),
        endedAt: new Date('2026-04-16T04:30:00.000Z'),
        durationSeconds: 5400,
        progressDelta: 9,
      },
      'America/New_York',
    );

    expect(result).toEqual([
      { day: '2026-04-15', readingSeconds: 3600, progressDelta: 6, sessionsCount: 1 },
      { day: '2026-04-16', readingSeconds: 1800, progressDelta: 3, sessionsCount: 1 },
    ]);
  });

  it('preserves total seconds when proportional pieces need rounding', () => {
    const result = splitReadingSessionByDay(
      {
        startedAt: new Date('2026-04-15T23:59:58.000Z'),
        endedAt: new Date('2026-04-16T00:00:01.000Z'),
        durationSeconds: 10,
        progressDelta: 1,
      },
      'UTC',
    );

    expect(result.reduce((sum, row) => sum + row.readingSeconds, 0)).toBe(10);
    expect(result.map((row) => row.day)).toEqual(['2026-04-15', '2026-04-16']);
  });

  it('does not truncate sessions that span more than 400 local days', () => {
    const result = splitReadingSessionByDay(
      {
        startedAt: new Date('2024-01-01T00:00:00.000Z'),
        endedAt: new Date('2025-06-01T00:00:00.000Z'),
        durationSeconds: 86400,
        progressDelta: 10,
      },
      'UTC',
    );

    expect(result.at(-1)?.day).toBe('2025-05-31');
    expect(result.reduce((sum, row) => sum + row.readingSeconds, 0)).toBe(86400);
    expect(result.reduce((sum, row) => sum + row.progressDelta, 0)).toBeCloseTo(10);
  });

  it('returns local day keys for every day touched by a session', () => {
    const result = getReadingSessionDayKeys(
      {
        startedAt: new Date('2026-04-16T03:00:00.000Z'),
        endedAt: new Date('2026-04-16T04:30:00.000Z'),
        durationSeconds: 5400,
        progressDelta: 9,
      },
      'America/New_York',
    );

    expect(result).toEqual(['2026-04-15', '2026-04-16']);
  });

  it('handles non-positive, invalid, and clockless sessions defensively', () => {
    expect(
      splitReadingSessionByDay(
        {
          startedAt: new Date('2026-04-15T10:00:00.000Z'),
          endedAt: new Date('2026-04-15T10:00:00.000Z'),
          durationSeconds: 0,
          progressDelta: null,
        },
        'UTC',
      ),
    ).toEqual([]);

    expect(
      splitReadingSessionByDay(
        {
          startedAt: new Date(Number.NaN),
          endedAt: new Date('2026-04-15T10:00:00.000Z'),
          durationSeconds: 60,
          progressDelta: null,
        },
        'UTC',
      ),
    ).toEqual([]);

    expect(
      splitReadingSessionByDay(
        {
          startedAt: new Date('2026-04-15T10:00:00.000Z'),
          endedAt: new Date('2026-04-15T09:59:00.000Z'),
          durationSeconds: 60,
          progressDelta: null,
        },
        'UTC',
      ),
    ).toEqual([{ day: '2026-04-15', readingSeconds: 60, progressDelta: 0, sessionsCount: 1 }]);
  });

  it('aggregates only requested affected days', () => {
    const result = aggregateReadingSessionDailyStats(
      [
        {
          startedAt: new Date('2026-04-15T23:00:00.000Z'),
          endedAt: new Date('2026-04-16T01:00:00.000Z'),
          durationSeconds: 7200,
          progressDelta: null,
        },
        {
          startedAt: new Date('2026-04-16T10:00:00.000Z'),
          endedAt: new Date('2026-04-16T10:30:00.000Z'),
          durationSeconds: 1800,
          progressDelta: 2,
        },
      ],
      'UTC',
      new Set(['2026-04-16']),
    );

    expect(result).toEqual([{ day: '2026-04-16', readingSeconds: 5400, progressDelta: 2, sessionsCount: 2 }]);
  });

  it('builds an exclusive UTC range for timezone-local affected days', () => {
    const range = getDayRangeForDateKeys(['2026-04-15', '2026-04-16'], 'America/New_York');

    expect(range?.start.toISOString()).toBe('2026-04-15T04:00:00.000Z');
    expect(range?.end.toISOString()).toBe('2026-04-17T04:00:00.000Z');
  });

  it('returns null for an empty affected-day range', () => {
    expect(getDayRangeForDateKeys([], 'UTC')).toBeNull();
  });
});
