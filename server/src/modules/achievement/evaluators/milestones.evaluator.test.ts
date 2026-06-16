import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MilestonesEvaluator } from './milestones.evaluator';
import {
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED,
} from '../achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    countFinishedBooks: vi.fn().mockResolvedValue(0),
    getBookTitle: vi.fn().mockResolvedValue('Test Book'),
    countAnnotations: vi.fn().mockResolvedValue(0),
    sumWeekendReadingHours: vi.fn().mockResolvedValue(0),
    hasSessionOnJanFirst: vi.fn().mockResolvedValue(false),
    hasWeekendMarathon: vi.fn().mockResolvedValue(false),
    getBookSeriesName: vi.fn().mockResolvedValue(null),
    countBooksFinishedInYear: vi.fn().mockResolvedValue(0),
    countDistinctEarnedCategories: vi.fn().mockResolvedValue(0),
    hasFinishedBookInSeries: vi.fn().mockResolvedValue(false),
    hasAbandonedBook: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('MilestonesEvaluator', () => {
  let evaluator: MilestonesEvaluator;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    evaluator = new MilestonesEvaluator(repo as never);
  });

  it('supports reading session, book status, annotation, backfill, and achievement.awarded events', () => {
    expect(evaluator.supports(ACHIEVEMENT_EVENT_READING_SESSION_SAVED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_ANNOTATION_CREATED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BACKFILL)).toBe(true);
    expect(evaluator.supports('other')).toBe(false);
  });

  describe('bookmarked', () => {
    it('awards bookmarked on annotation creation', async () => {
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 5 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'bookmarked' }));
    });
  });

  describe('new_year_reader', () => {
    it('awards new_year_reader on January 1st session in UTC', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date('2026-01-01T10:00:00Z'),
            endedAt: new Date('2026-01-01T10:10:00Z'),
            timezone: 'UTC',
          } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'new_year_reader' }));
    });

    it('does not award on other days', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date('2026-03-15T10:00:00Z'),
            endedAt: new Date('2026-03-15T10:10:00Z'),
            timezone: 'UTC',
          } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'new_year_reader')).toBeUndefined();
    });

    it('awards new_year_reader when Jan 1 in user timezone even if UTC shows Dec 31', async () => {
      // midnight Jan 1 EST (UTC-5) = 5am Jan 1 UTC
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date('2026-01-01T05:00:00Z'),
            endedAt: new Date('2026-01-01T05:10:00Z'),
            timezone: 'America/New_York',
          } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'new_year_reader' }));
    });

    it('does not award when Dec 31 in user timezone even if UTC shows Jan 1', async () => {
      // 4am Jan 1 UTC = 11pm Dec 31 EST (UTC-5)
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: {
            userId: 1,
            bookFileId: 42,
            durationSeconds: 600,
            startedAt: new Date('2026-01-01T04:00:00Z'),
            endedAt: new Date('2026-01-01T04:10:00Z'),
            timezone: 'America/New_York',
          } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'new_year_reader')).toBeUndefined();
    });
  });

  describe('first_series', () => {
    it('awards first_series when user has finished any book in a series', async () => {
      repo.getBookSeriesName.mockResolvedValue('The Wheel of Time');
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'reading' } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'first_series' }));
    });

    it('does not award first_series when book has no series', async () => {
      repo.getBookSeriesName.mockResolvedValue(null);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'reading' } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'first_series')).toBeUndefined();
    });

    it('does not award first_series when series name is empty string', async () => {
      repo.getBookSeriesName.mockResolvedValue('   ');
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'reading' } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'first_series')).toBeUndefined();
    });

    it('does not award first_series when already earned', async () => {
      repo.getBookSeriesName.mockResolvedValue('Foundation');
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', oldStatus: 'reading' } as never,
        },
        new Set(['first_series']),
      );
      expect(awards.find((a) => a.key === 'first_series')).toBeUndefined();
    });

    it('awards first_series via backfill', async () => {
      repo.hasFinishedBookInSeries.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'first_series' }));
    });
  });

  describe('category_sweeper', () => {
    it('awards category_sweeper when all 4 categories have at least one badge earned', async () => {
      repo.countDistinctEarnedCategories.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED, payload: { userId: 1, keys: ['some_key'] } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'category_sweeper' }));
    });

    it('does not award category_sweeper below 4 categories', async () => {
      repo.countDistinctEarnedCategories.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED, payload: { userId: 1, keys: ['some_key'] } as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'category_sweeper')).toBeUndefined();
    });

    it('does not award category_sweeper when already earned', async () => {
      repo.countDistinctEarnedCategories.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ACHIEVEMENT_AWARDED, payload: { userId: 1, keys: ['some_key'] } as never },
        new Set(['category_sweeper']),
      );
      expect(awards.find((a) => a.key === 'category_sweeper')).toBeUndefined();
    });

    it('awards category_sweeper via backfill', async () => {
      repo.countDistinctEarnedCategories.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'category_sweeper' }));
    });

    it('does not award category_sweeper via backfill below 4 categories', async () => {
      repo.countDistinctEarnedCategories.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'category_sweeper')).toBeUndefined();
    });
  });

  describe('backfill for pre-existing milestones badges', () => {
    it('awards bookmarked via backfill when user has annotations', async () => {
      repo.countAnnotations.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'bookmarked' }));
    });

    it('does not award bookmarked via backfill when no annotations', async () => {
      repo.countAnnotations.mockResolvedValue(0);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'bookmarked')).toBeUndefined();
    });

    it('awards new_year_reader via backfill when a Jan 1 session exists', async () => {
      repo.hasSessionOnJanFirst.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'new_year_reader' }));
    });
  });

  describe('old_friend', () => {
    it('awards old_friend when a re-read is finished (previousStatus rereading)', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', previousStatus: 'rereading' } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'old_friend' }));
    });

    it('does not award old_friend for a first-time finish', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', previousStatus: 'reading' } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'old_friend')).toBeUndefined();
    });

    it('does not award old_friend when already earned', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'read', previousStatus: 'rereading' } as never,
        },
        new Set(['old_friend']),
      );
      expect(awards.find((a) => a.key === 'old_friend')).toBeUndefined();
    });
  });

  describe('dnf_self_aware', () => {
    it('awards dnf_self_aware when a book is abandoned', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'abandoned', previousStatus: 'reading' } as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'dnf_self_aware' }));
    });

    it('does not award dnf_self_aware for a non-abandoned status', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 5, newStatus: 'reading', previousStatus: 'unread' } as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'dnf_self_aware')).toBeUndefined();
    });

    it('awards dnf_self_aware via backfill when an abandoned book exists', async () => {
      repo.hasAbandonedBook.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'dnf_self_aware' }));
    });
  });
});
