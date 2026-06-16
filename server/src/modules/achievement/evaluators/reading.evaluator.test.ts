import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReadingEvaluator } from './reading.evaluator';
import {
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
} from '../achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    countFinishedBooks: vi.fn().mockResolvedValue(0),
    getBookTitle: vi.fn().mockResolvedValue('Test Book'),
    sumPagesRead: vi.fn().mockResolvedValue(0),
    sumReadingHours: vi.fn().mockResolvedValue(0),
    getBookPageCount: vi.fn().mockResolvedValue(null),
    wasBookStartedAndFinishedOnSameDay: vi.fn().mockResolvedValue(false),
    countBooksFinishedInDateRange: vi.fn().mockResolvedValue(0),
    hasSessionLongerThan: vi.fn().mockResolvedValue(false),
    hasSessionInHourRange: vi.fn().mockResolvedValue(false),
    hasSessionStartingInHourRange: vi.fn().mockResolvedValue(false),
    getMaxFinishedBookPageCount: vi.fn().mockResolvedValue(0),
    hasFinishedBookWithMinPages: vi.fn().mockResolvedValue(false),
    hasAnyBookStartedAndFinishedOnSameDay: vi.fn().mockResolvedValue(false),
    getBookStartedAndFinishedAt: vi.fn().mockResolvedValue(null),
    hasAnySlowBurnBook: vi.fn().mockResolvedValue(false),
    hasMonthWithBooksFinished: vi.fn().mockResolvedValue(false),
    hasSessionWithProgressDeltaAtLeast: vi.fn().mockResolvedValue(false),
    countBooksFinishedInMonth: vi.fn().mockResolvedValue(0),
    getPageCountByBookFile: vi.fn().mockResolvedValue(null),
    getMaxSessionPages: vi.fn().mockResolvedValue(0),
    getPagesOnDay: vi.fn().mockResolvedValue(0),
    getMaxPagesInADay: vi.fn().mockResolvedValue(0),
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
    timezone: 'UTC',
    ...overrides,
  };
}

function makeStatusPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 1,
    bookId: 100,
    newStatus: 'read',
    oldStatus: 'reading',
    ...overrides,
  };
}

describe('ReadingEvaluator', () => {
  let evaluator: ReadingEvaluator;
  let repo: ReturnType<typeof makeRepo>;
  const backfillCtx = { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never };

  beforeEach(() => {
    repo = makeRepo();
    evaluator = new ReadingEvaluator(repo as never);
  });

  it('supports reading session, book status, and backfill events', () => {
    expect(evaluator.supports(ACHIEVEMENT_EVENT_READING_SESSION_SAVED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BACKFILL)).toBe(true);
    expect(evaluator.supports('some.other.event')).toBe(false);
  });

  describe('books_finished tiers', () => {
    it('awards tier 1 when 1 book finished', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'books_finished_1' }));
    });

    it('awards multiple tiers at once when count is high enough', async () => {
      repo.countFinishedBooks.mockResolvedValue(55);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      const keys = awards.map((a) => a.key);
      expect(keys).toContain('books_finished_1');
      expect(keys).toContain('books_finished_2');
      expect(keys).toContain('books_finished_3');
      expect(keys).not.toContain('books_finished_4');
    });

    it('skips already earned tiers', async () => {
      repo.countFinishedBooks.mockResolvedValue(55);
      const earned = new Set(['books_finished_1', 'books_finished_2']);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        earned,
      );
      const keys = awards.map((a) => a.key);
      expect(keys).not.toContain('books_finished_1');
      expect(keys).not.toContain('books_finished_2');
      expect(keys).toContain('books_finished_3');
    });

    it('does not award when status is not read', async () => {
      repo.countFinishedBooks.mockResolvedValue(100);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: makeStatusPayload({ newStatus: 'reading' }) as never,
        },
        new Set(),
      );
      expect(awards.filter((a) => a.key.startsWith('books_finished'))).toHaveLength(0);
    });
  });

  describe('pages_read tiers', () => {
    it('awards pages_read_1 at 500 pages', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      repo.sumPagesRead.mockResolvedValue(500);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'pages_read_1' }));
    });

    it('awards pages_read tiers on reading session events', async () => {
      repo.sumPagesRead.mockResolvedValue(500);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'pages_read_1' }));
    });
  });

  describe('hours_read tiers', () => {
    it('awards hours_read_1 at 10 hours', async () => {
      repo.sumReadingHours.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'hours_read_1' }));
    });
  });

  describe('marathoner', () => {
    it('awards marathoner for 90+ minute session', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({ durationSeconds: 5400 }) as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'marathoner' }));
    });

    it('does not award marathoner for short session', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({ durationSeconds: 1800 }) as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'marathoner')).toBeUndefined();
    });
  });

  describe('all_nighter', () => {
    it('awards all_nighter for 1am-3:59am session in UTC', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({
            startedAt: new Date(Date.UTC(2026, 2, 15, 1, 0, 0)),
            endedAt: new Date(Date.UTC(2026, 2, 15, 1, 30, 0)),
          }) as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'all_nighter' }));
    });

    it('awards all_nighter using local timezone when UTC hour is outside range', async () => {
      // 5am UTC = 1am EDT (America/New_York in March = UTC-4)
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({
            startedAt: new Date('2026-03-15T05:00:00Z'),
            endedAt: new Date('2026-03-15T05:30:00Z'),
            timezone: 'America/New_York',
          }) as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'all_nighter' }));
    });

    it('does not award all_nighter when local timezone puts session outside 1am-3:59am', async () => {
      // 4am UTC is outside the all_nighter range
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({
            startedAt: new Date('2026-03-15T04:00:00Z'),
            endedAt: new Date('2026-03-15T04:30:00Z'),
            timezone: 'UTC',
          }) as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'all_nighter')).toBeUndefined();
    });
  });

  describe('early_bird', () => {
    it('awards early_bird for session starting between 5am and 6:59am in UTC', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({
            startedAt: new Date(Date.UTC(2026, 2, 15, 5, 0, 0)),
            endedAt: new Date(Date.UTC(2026, 2, 15, 5, 30, 0)),
          }) as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'early_bird' }));
    });

    it('does not award early_bird for session starting before 5am', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({
            startedAt: new Date(Date.UTC(2026, 2, 15, 4, 0, 0)),
            endedAt: new Date(Date.UTC(2026, 2, 15, 4, 30, 0)),
          }) as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'early_bird')).toBeUndefined();
    });

    it('awards early_bird using local timezone when UTC hour is 9am but local is 5am', async () => {
      // 9am UTC = 5am EDT (America/New_York in March = UTC-4)
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({
            startedAt: new Date('2026-03-15T09:00:00Z'),
            endedAt: new Date('2026-03-15T09:30:00Z'),
            timezone: 'America/New_York',
          }) as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'early_bird' }));
    });

    it('does not award early_bird when 9am UTC but uses UTC timezone', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({
            startedAt: new Date('2026-03-15T09:00:00Z'),
            endedAt: new Date('2026-03-15T09:30:00Z'),
            timezone: 'UTC',
          }) as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'early_bird')).toBeUndefined();
    });
  });

  describe('long_book tiers', () => {
    it('awards long_book_1 for a 300+ page book', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      repo.getBookPageCount.mockResolvedValue(320);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'long_book_1' }));
      expect(awards.find((a) => a.key === 'page_turner')).toBeUndefined();
    });

    it('awards page_turner for a 500+ page book', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      repo.getBookPageCount.mockResolvedValue(550);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'long_book_1' }));
      expect(awards).toContainEqual(expect.objectContaining({ key: 'page_turner' }));
      expect(awards.find((a) => a.key === 'long_book_3')).toBeUndefined();
      expect(awards.find((a) => a.key === 'tome_tamer')).toBeUndefined();
    });

    it('awards through long_book_3 for a 750+ page book', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      repo.getBookPageCount.mockResolvedValue(780);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'long_book_1' }));
      expect(awards).toContainEqual(expect.objectContaining({ key: 'page_turner' }));
      expect(awards).toContainEqual(expect.objectContaining({ key: 'long_book_3' }));
      expect(awards.find((a) => a.key === 'tome_tamer')).toBeUndefined();
    });

    it('awards all long_book tiers for a 1000+ page book', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      repo.getBookPageCount.mockResolvedValue(1100);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'long_book_1' }));
      expect(awards).toContainEqual(expect.objectContaining({ key: 'page_turner' }));
      expect(awards).toContainEqual(expect.objectContaining({ key: 'long_book_3' }));
      expect(awards).toContainEqual(expect.objectContaining({ key: 'tome_tamer' }));
    });

    it('fetches page count only once when long_book tiers are unearned', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      repo.getBookPageCount.mockResolvedValue(1200);
      await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(repo.getBookPageCount).toHaveBeenCalledOnce();
    });
  });

  describe('sprint', () => {
    it('awards sprint when book started and finished same day', async () => {
      repo.countFinishedBooks.mockResolvedValue(1);
      repo.wasBookStartedAndFinishedOnSameDay.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'sprint' }));
    });
  });

  describe('binge_reader', () => {
    it('awards binge_reader when 3+ books finished in a week', async () => {
      repo.countFinishedBooks.mockResolvedValue(3);
      repo.countBooksFinishedInDateRange.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'binge_reader' }));
    });
  });

  describe('backfill', () => {
    it('awards books_finished tiers via DB scan without bookId payload', async () => {
      repo.countFinishedBooks.mockResolvedValue(10);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      const keys = awards.map((a) => a.key);
      expect(keys).toContain('books_finished_1');
      expect(keys).toContain('books_finished_2');
    });

    it('awards marathoner when a qualifying session exists in DB', async () => {
      repo.hasSessionLongerThan.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'marathoner' }));
    });

    it('does not award marathoner when no qualifying session', async () => {
      repo.hasSessionLongerThan.mockResolvedValue(false);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards.find((a) => a.key === 'marathoner')).toBeUndefined();
    });

    it('awards all_nighter via hour range check', async () => {
      repo.hasSessionInHourRange.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'all_nighter' }));
    });

    it('awards early_bird via hour check', async () => {
      repo.hasSessionStartingInHourRange.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'early_bird' }));
    });

    it('awards all long_book tiers for 1000+ page backfill', async () => {
      repo.getMaxFinishedBookPageCount.mockResolvedValue(1000);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      const keys = awards.map((a) => a.key);
      expect(keys).toContain('long_book_1');
      expect(keys).toContain('page_turner');
      expect(keys).toContain('long_book_3');
      expect(keys).toContain('tome_tamer');
    });

    it('awards tiers through page_turner for 500-749 page backfill', async () => {
      repo.getMaxFinishedBookPageCount.mockResolvedValue(500);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      const keys = awards.map((a) => a.key);
      expect(keys).toContain('long_book_1');
      expect(keys).toContain('page_turner');
      expect(keys).not.toContain('long_book_3');
      expect(keys).not.toContain('tome_tamer');
    });

    it('awards sprint when any book was started and finished same day', async () => {
      repo.hasAnyBookStartedAndFinishedOnSameDay.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'sprint' }));
    });

    it('skips already earned keys during backfill', async () => {
      repo.countFinishedBooks.mockResolvedValue(100);
      repo.hasSessionLongerThan.mockResolvedValue(true);
      const earned = new Set(['books_finished_1', 'books_finished_2', 'books_finished_3', 'books_finished_4', 'marathoner']);
      const awards = await evaluator.evaluate(backfillCtx, earned);
      const keys = awards.map((a) => a.key);
      expect(keys).not.toContain('books_finished_1');
      expect(keys).not.toContain('marathoner');
    });
  });

  describe('slow_burn', () => {
    it('awards slow_burn when book took over 90 days', async () => {
      const startedAt = new Date('2025-01-01T00:00:00Z');
      const finishedAt = new Date('2025-04-15T00:00:00Z'); // 104 days later
      repo.getBookStartedAndFinishedAt.mockResolvedValue({ startedAt, finishedAt });
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'slow_burn' }));
    });

    it('does not award slow_burn when book took exactly 90 days', async () => {
      const startedAt = new Date('2025-01-01T00:00:00Z');
      const finishedAt = new Date('2025-04-01T00:00:00Z'); // exactly 90 days
      repo.getBookStartedAndFinishedAt.mockResolvedValue({ startedAt, finishedAt });
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'slow_burn')).toBeUndefined();
    });

    it('does not award slow_burn when dates are missing', async () => {
      repo.getBookStartedAndFinishedAt.mockResolvedValue({ startedAt: null, finishedAt: null });
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'slow_burn')).toBeUndefined();
    });

    it('does not award slow_burn when status book info returns null', async () => {
      repo.getBookStartedAndFinishedAt.mockResolvedValue(null);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'slow_burn')).toBeUndefined();
    });

    it('does not award slow_burn when already earned', async () => {
      const startedAt = new Date('2025-01-01T00:00:00Z');
      const finishedAt = new Date('2025-05-01T00:00:00Z');
      repo.getBookStartedAndFinishedAt.mockResolvedValue({ startedAt, finishedAt });
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(['slow_burn']),
      );
      expect(awards.find((a) => a.key === 'slow_burn')).toBeUndefined();
    });

    it('awards slow_burn via backfill', async () => {
      repo.hasAnySlowBurnBook.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'slow_burn' }));
    });

    it('does not award slow_burn via backfill when no qualifying book', async () => {
      repo.hasAnySlowBurnBook.mockResolvedValue(false);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards.find((a) => a.key === 'slow_burn')).toBeUndefined();
    });
  });

  describe('one_sitting', () => {
    it('awards one_sitting when progressDelta >= 90', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({ progressDelta: 90 }) as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'one_sitting' }));
    });

    it('awards one_sitting when progressDelta > 90', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({ progressDelta: 95 }) as never,
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'one_sitting' }));
    });

    it('does not award one_sitting when progressDelta < 90', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({ progressDelta: 85 }) as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'one_sitting')).toBeUndefined();
    });

    it('does not award one_sitting when progressDelta is null', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({ progressDelta: null }) as never,
        },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'one_sitting')).toBeUndefined();
    });

    it('does not award one_sitting when already earned', async () => {
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
          payload: makeSessionPayload({ progressDelta: 100 }) as never,
        },
        new Set(['one_sitting']),
      );
      expect(awards.find((a) => a.key === 'one_sitting')).toBeUndefined();
    });

    it('awards one_sitting via backfill', async () => {
      repo.hasSessionWithProgressDeltaAtLeast.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'one_sitting' }));
    });

    it('does not award one_sitting via backfill when no qualifying session', async () => {
      repo.hasSessionWithProgressDeltaAtLeast.mockResolvedValue(false);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards.find((a) => a.key === 'one_sitting')).toBeUndefined();
    });
  });

  describe('monthly_reader_2', () => {
    it('awards monthly_reader_2 when 10+ books finished in current month', async () => {
      repo.countBooksFinishedInMonth.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'monthly_reader_2' }));
    });

    it('does not award monthly_reader_2 when fewer than 10 books', async () => {
      repo.countBooksFinishedInMonth.mockResolvedValue(9);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'monthly_reader_2')).toBeUndefined();
    });

    it('does not award monthly_reader_2 when already earned', async () => {
      repo.countBooksFinishedInMonth.mockResolvedValue(15);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(['monthly_reader_2']),
      );
      expect(awards.find((a) => a.key === 'monthly_reader_2')).toBeUndefined();
    });

    it('awards monthly_reader_2 via backfill', async () => {
      repo.hasMonthWithBooksFinished.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'monthly_reader_2' }));
    });

    it('does not award monthly_reader_2 via backfill when no qualifying month', async () => {
      repo.hasMonthWithBooksFinished.mockResolvedValue(false);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards.find((a) => a.key === 'monthly_reader_2')).toBeUndefined();
    });

    it('skips slow_burn, one_sitting, monthly_reader_2 in backfill when already earned', async () => {
      repo.hasAnySlowBurnBook.mockResolvedValue(true);
      repo.hasSessionWithProgressDeltaAtLeast.mockResolvedValue(true);
      repo.hasMonthWithBooksFinished.mockResolvedValue(true);
      const earned = new Set(['slow_burn', 'one_sitting', 'monthly_reader_2']);
      const awards = await evaluator.evaluate(backfillCtx, earned);
      const keys = awards.map((a) => a.key);
      expect(keys).not.toContain('slow_burn');
      expect(keys).not.toContain('one_sitting');
      expect(keys).not.toContain('monthly_reader_2');
      expect(repo.hasAnySlowBurnBook).not.toHaveBeenCalled();
      expect(repo.hasSessionWithProgressDeltaAtLeast).not.toHaveBeenCalled();
      expect(repo.hasMonthWithBooksFinished).not.toHaveBeenCalled();
    });
  });

  describe('power_hour', () => {
    it('awards power_hour for 75+ pages in a session', async () => {
      repo.getPageCountByBookFile.mockResolvedValue(300);
      const awards = await evaluator.evaluate(
        { userId: 1, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload({ progressDelta: 30 }) as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'power_hour' }));
    });

    it('does not award power_hour below 75 pages', async () => {
      repo.getPageCountByBookFile.mockResolvedValue(300);
      const awards = await evaluator.evaluate(
        { userId: 1, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload({ progressDelta: 10 }) as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'power_hour')).toBeUndefined();
    });

    it('does not award power_hour when progressDelta is null', async () => {
      repo.getPageCountByBookFile.mockResolvedValue(1000);
      const awards = await evaluator.evaluate(
        { userId: 1, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload({ progressDelta: null }) as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'power_hour')).toBeUndefined();
    });

    it('does not award power_hour when page count is unknown', async () => {
      repo.getPageCountByBookFile.mockResolvedValue(null);
      const awards = await evaluator.evaluate(
        { userId: 1, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload({ progressDelta: 50 }) as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'power_hour')).toBeUndefined();
    });

    it('awards power_hour via backfill', async () => {
      repo.getMaxSessionPages.mockResolvedValue(80);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'power_hour' }));
    });
  });

  describe('speed_reader', () => {
    it('awards speed_reader for 100+ pages in a day', async () => {
      repo.getPagesOnDay.mockResolvedValue(120);
      const awards = await evaluator.evaluate(
        { userId: 1, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'speed_reader' }));
    });

    it('does not award speed_reader below 100 pages', async () => {
      repo.getPagesOnDay.mockResolvedValue(99);
      const awards = await evaluator.evaluate(
        { userId: 1, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: makeSessionPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'speed_reader')).toBeUndefined();
    });

    it('awards speed_reader via backfill', async () => {
      repo.getMaxPagesInADay.mockResolvedValue(150);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'speed_reader' }));
    });
  });
});
