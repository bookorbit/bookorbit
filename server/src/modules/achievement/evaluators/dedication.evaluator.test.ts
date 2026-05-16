import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DedicationEvaluator } from './dedication.evaluator';
import {
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_BACKFILL,
} from '../achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    getCurrentStreak: vi.fn().mockResolvedValue(0),
    countDistinctMonthsWithReading: vi.fn().mockResolvedValue(0),
    wasBookAbandonedBefore: vi.fn().mockResolvedValue(false),
    getBookTitle: vi.fn().mockResolvedValue('Test Book'),
    getPreviousSessionEndedAt: vi.fn().mockResolvedValue(null),
    hasLargeGapBetweenAnySessions: vi.fn().mockResolvedValue(false),
    hasAnyBookRebornFromAbandoned: vi.fn().mockResolvedValue(false),
    countDistinctSeasonsWithReading: vi.fn().mockResolvedValue(0),
    hasReadEveryDayInAnyMonth: vi.fn().mockResolvedValue(false),
    hasConsecutiveDaysWithMinReading: vi.fn().mockResolvedValue(false),
    hasConsecutiveWeekendsWithReading: vi.fn().mockResolvedValue(false),
    sumWeekendReadingHours: vi.fn().mockResolvedValue(0),
    hasWeekendMarathon: vi.fn().mockResolvedValue(false),
    countBooksFinishedInYear: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeSessionPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 1,
    bookFileId: 42,
    durationSeconds: 600,
    startedAt: new Date('2026-03-15T10:00:00Z'),
    endedAt: new Date('2026-03-15T10:10:00Z'),
    ...overrides,
  };
}

describe('DedicationEvaluator', () => {
  let evaluator: DedicationEvaluator;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    evaluator = new DedicationEvaluator(repo as never);
  });

  it('supports reading session and book status events', () => {
    expect(evaluator.supports(ACHIEVEMENT_EVENT_READING_SESSION_SAVED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED)).toBe(true);
    expect(evaluator.supports('other')).toBe(false);
  });

  describe('streak tiers', () => {
    it('awards streak_1 at 7-day streak', async () => {
      repo.getCurrentStreak.mockResolvedValue(7);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'streak_1' }));
    });

    it('awards multiple streak tiers at once', async () => {
      repo.getCurrentStreak.mockResolvedValue(35);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      const keys = awards.map((a) => a.key);
      expect(keys).toContain('streak_1');
      expect(keys).toContain('streak_2');
      expect(keys).not.toContain('streak_3');
    });
  });

  describe('year_round_reader', () => {
    it('awards year_round_reader at 12 months', async () => {
      repo.countDistinctMonthsWithReading.mockResolvedValue(12);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'year_round_reader' }));
    });
  });

  describe('reborn', () => {
    it('awards reborn when a previously abandoned book is finished', async () => {
      repo.wasBookAbandonedBefore.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'abandoned' } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'reborn' }));
    });
  });

  describe('comeback_kid', () => {
    it('awards comeback_kid when returning after 30+ days', async () => {
      const thirtyOneDaysAgo = new Date('2026-02-12T10:00:00Z');
      repo.getPreviousSessionEndedAt.mockResolvedValue(thirtyOneDaysAgo);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'comeback_kid' }));
    });

    it('does not award comeback_kid for recent activity', async () => {
      const fiveDaysAgo = new Date('2026-03-10T10:00:00Z');
      repo.getPreviousSessionEndedAt.mockResolvedValue(fiveDaysAgo);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'comeback_kid')).toBeUndefined();
    });
  });

  describe('seasonal_reader', () => {
    it('awards seasonal_reader when 4 distinct seasons have reading activity', async () => {
      repo.countDistinctSeasonsWithReading.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'seasonal_reader' }));
    });

    it('does not award seasonal_reader below 4 seasons', async () => {
      repo.countDistinctSeasonsWithReading.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'seasonal_reader')).toBeUndefined();
    });

    it('does not award seasonal_reader when already earned', async () => {
      repo.countDistinctSeasonsWithReading.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(['seasonal_reader']),
      );
      expect(awards.find((a) => a.key === 'seasonal_reader')).toBeUndefined();
    });

    it('awards seasonal_reader via backfill', async () => {
      repo.countDistinctSeasonsWithReading.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'seasonal_reader' }));
    });
  });

  describe('perfect_month', () => {
    it('awards perfect_month when user read every day in any calendar month', async () => {
      repo.hasReadEveryDayInAnyMonth.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'perfect_month' }));
    });

    it('does not award perfect_month when no qualifying month', async () => {
      repo.hasReadEveryDayInAnyMonth.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'perfect_month')).toBeUndefined();
    });

    it('does not award perfect_month when already earned', async () => {
      repo.hasReadEveryDayInAnyMonth.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(['perfect_month']),
      );
      expect(awards.find((a) => a.key === 'perfect_month')).toBeUndefined();
    });

    it('awards perfect_month via backfill', async () => {
      repo.hasReadEveryDayInAnyMonth.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'perfect_month' }));
    });
  });

  describe('consistent_reader', () => {
    it('awards consistent_reader when 30+ consecutive days with min 5 minutes each', async () => {
      repo.hasConsecutiveDaysWithMinReading.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'consistent_reader' }));
    });

    it('does not award consistent_reader when condition not met', async () => {
      repo.hasConsecutiveDaysWithMinReading.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'consistent_reader')).toBeUndefined();
    });

    it('does not award consistent_reader when already earned', async () => {
      repo.hasConsecutiveDaysWithMinReading.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(['consistent_reader']),
      );
      expect(awards.find((a) => a.key === 'consistent_reader')).toBeUndefined();
    });

    it('awards consistent_reader via backfill', async () => {
      repo.hasConsecutiveDaysWithMinReading.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'consistent_reader' }));
    });
  });

  describe('weekend_rhythm', () => {
    it('awards weekend_rhythm when 4+ consecutive weekends have reading', async () => {
      repo.hasConsecutiveWeekendsWithReading.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'weekend_rhythm' }));
    });

    it('does not award weekend_rhythm when condition not met', async () => {
      repo.hasConsecutiveWeekendsWithReading.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'weekend_rhythm')).toBeUndefined();
    });

    it('does not award weekend_rhythm when already earned', async () => {
      repo.hasConsecutiveWeekendsWithReading.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(['weekend_rhythm']),
      );
      expect(awards.find((a) => a.key === 'weekend_rhythm')).toBeUndefined();
    });

    it('awards weekend_rhythm via backfill', async () => {
      repo.hasConsecutiveWeekendsWithReading.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'weekend_rhythm' }));
    });
  });

  describe('weekend_warrior', () => {
    it('awards weekend_warrior for 5+ hours on a UTC weekend', async () => {
      repo.sumWeekendReadingHours.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date(Date.UTC(2026, 2, 14, 10, 0, 0)),
            endedAt: new Date(Date.UTC(2026, 2, 14, 15, 0, 0)),
            timezone: 'UTC',
          } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'weekend_warrior' }));
    });

    it('passes Saturday date string to repo', async () => {
      repo.sumWeekendReadingHours.mockResolvedValue(5);
      await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date(Date.UTC(2026, 2, 14, 10, 0, 0)),
            endedAt: new Date(Date.UTC(2026, 2, 14, 15, 0, 0)),
            timezone: 'UTC',
          } as never,
        },
        new Set(),
      );
      expect(repo.sumWeekendReadingHours).toHaveBeenCalledWith(1, '2026-03-14');
    });

    it('does not award on weekdays', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date(Date.UTC(2026, 2, 16, 10, 0, 0)),
            endedAt: new Date(Date.UTC(2026, 2, 16, 15, 0, 0)),
            timezone: 'UTC',
          } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'weekend_warrior')).toBeUndefined();
    });

    it('awards weekend_warrior using local timezone when UTC is Sunday but local is Saturday', async () => {
      repo.sumWeekendReadingHours.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date('2026-03-15T01:00:00Z'),
            endedAt: new Date('2026-03-15T02:00:00Z'),
            timezone: 'America/New_York',
          } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'weekend_warrior' }));
      expect(repo.sumWeekendReadingHours).toHaveBeenCalledWith(1, '2026-03-14');
    });

    it('awards weekend_warrior via backfill when user has a weekend marathon', async () => {
      repo.hasWeekendMarathon.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'weekend_warrior' }));
    });
  });

  describe('yearly_finisher_12', () => {
    it('awards yearly_finisher_12 when 12+ books finished in current year', async () => {
      repo.countBooksFinishedInYear.mockResolvedValue(12);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'reading' } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'yearly_finisher_12' }));
    });

    it('does not award yearly_finisher_12 below 12 books', async () => {
      repo.countBooksFinishedInYear.mockResolvedValue(11);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'reading' } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'yearly_finisher_12')).toBeUndefined();
    });

    it('does not award yearly_finisher_12 when already earned', async () => {
      repo.countBooksFinishedInYear.mockResolvedValue(20);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'reading' } as never,
        },
        new Set(['yearly_finisher_12']),
      );
      expect(awards.find((a) => a.key === 'yearly_finisher_12')).toBeUndefined();
    });

    it('awards yearly_finisher_12 via backfill', async () => {
      repo.countBooksFinishedInYear.mockResolvedValue(12);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'yearly_finisher_12' }));
    });
  });

  describe('backfill for pre-existing dedication badges', () => {
    it('awards comeback_kid via backfill when large session gap exists', async () => {
      repo.hasLargeGapBetweenAnySessions.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'comeback_kid' }));
    });

    it('does not award comeback_kid via backfill when no large gap', async () => {
      repo.hasLargeGapBetweenAnySessions.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'comeback_kid')).toBeUndefined();
    });

    it('awards reborn via backfill when a previously abandoned book was finished', async () => {
      repo.hasAnyBookRebornFromAbandoned.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'reborn' }));
    });

    it('does not award reborn via backfill when no abandoned book was finished', async () => {
      repo.hasAnyBookRebornFromAbandoned.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'reborn')).toBeUndefined();
    });
  });
});
