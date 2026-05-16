import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExplorationEvaluator } from './exploration.evaluator';
import { ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, ACHIEVEMENT_EVENT_BACKFILL } from '../achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    countDistinctGenresRead: vi.fn().mockResolvedValue(0),
    countDistinctLanguagesRead: vi.fn().mockResolvedValue(0),
    getBookPublishedYear: vi.fn().mockResolvedValue(null),
    getBookTitle: vi.fn().mockResolvedValue('Test Book'),
    countDistinctCenturiesRead: vi.fn().mockResolvedValue(0),
    maxBooksPerAuthor: vi.fn().mockResolvedValue(0),
    hasFinishedBookPublishedBefore: vi.fn().mockResolvedValue(false),
    hasFinishedBookPublishedInYear: vi.fn().mockResolvedValue(false),
    countDistinctDecadesRead: vi.fn().mockResolvedValue(0),
    countFinishedBooksByMaxPageCount: vi.fn().mockResolvedValue(0),
    hasFinishedBookUnderPages: vi.fn().mockResolvedValue(false),
    hasFinishedBookOverPages: vi.fn().mockResolvedValue(false),
    hasCompletedSeriesOfSize: vi.fn().mockResolvedValue(false),
    maxBooksPerGenre: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function makeStatusPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return { userId: 1, bookId: 100, newStatus: 'read', oldStatus: 'reading', ...overrides };
}

describe('ExplorationEvaluator', () => {
  let evaluator: ExplorationEvaluator;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    evaluator = new ExplorationEvaluator(repo as never);
  });

  it('supports only book status event', () => {
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED)).toBe(true);
    expect(evaluator.supports('other')).toBe(false);
  });

  it('returns empty when status is not read', async () => {
    const awards = await evaluator.evaluate(
      {
        userId: 1,
        isSuperuser: false,
        eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
        payload: makeStatusPayload({ newStatus: 'reading' }) as never,
      },
      new Set(),
    );
    expect(awards).toHaveLength(0);
  });

  describe('genre_explorer tiers', () => {
    it('awards tier 1 at 5 genres', async () => {
      repo.countDistinctGenresRead.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'genre_explorer_1' }));
    });
  });

  describe('polyglot tiers', () => {
    it('awards tier 1 at 2 languages', async () => {
      repo.countDistinctLanguagesRead.mockResolvedValue(2);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'polyglot_1' }));
    });
  });

  describe('old_soul', () => {
    it('awards old_soul for pre-1900 book', async () => {
      repo.getBookPublishedYear.mockResolvedValue(1850);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'old_soul' }));
    });

    it('does not award old_soul for 1900+ book', async () => {
      repo.getBookPublishedYear.mockResolvedValue(1901);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'old_soul')).toBeUndefined();
    });
  });

  describe('new_release', () => {
    it('awards new_release for current year book', async () => {
      repo.getBookPublishedYear.mockResolvedValue(new Date().getFullYear());
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'new_release' }));
    });
  });

  describe('century_span', () => {
    it('awards century_span at 3+ centuries', async () => {
      repo.countDistinctCenturiesRead.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'century_span' }));
    });
  });

  describe('author_deep_dive', () => {
    it('awards author_deep_dive at 5+ books from same author', async () => {
      repo.maxBooksPerAuthor.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'author_deep_dive' }));
    });
  });

  describe('decade_sampler', () => {
    it('awards decade_sampler when 5+ distinct decades read', async () => {
      repo.countDistinctDecadesRead.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'decade_sampler' }));
    });

    it('does not award decade_sampler below 5 decades', async () => {
      repo.countDistinctDecadesRead.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'decade_sampler')).toBeUndefined();
    });

    it('does not award decade_sampler when already earned', async () => {
      repo.countDistinctDecadesRead.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(['decade_sampler']),
      );
      expect(awards.find((a) => a.key === 'decade_sampler')).toBeUndefined();
    });
  });

  describe('short_story_fan', () => {
    it('awards short_story_fan when 5+ short books finished', async () => {
      repo.countFinishedBooksByMaxPageCount.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'short_story_fan' }));
    });

    it('does not award short_story_fan below 5 short books', async () => {
      repo.countFinishedBooksByMaxPageCount.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'short_story_fan')).toBeUndefined();
    });

    it('does not award short_story_fan when already earned', async () => {
      repo.countFinishedBooksByMaxPageCount.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(['short_story_fan']),
      );
      expect(awards.find((a) => a.key === 'short_story_fan')).toBeUndefined();
    });
  });

  describe('thick_and_thin', () => {
    it('awards thick_and_thin when both thin and thick books exist', async () => {
      repo.hasFinishedBookUnderPages.mockResolvedValue(true);
      repo.hasFinishedBookOverPages.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'thick_and_thin' }));
    });

    it('does not award thick_and_thin when only thin book exists', async () => {
      repo.hasFinishedBookUnderPages.mockResolvedValue(true);
      repo.hasFinishedBookOverPages.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'thick_and_thin')).toBeUndefined();
    });

    it('does not award thick_and_thin when only thick book exists', async () => {
      repo.hasFinishedBookUnderPages.mockResolvedValue(false);
      repo.hasFinishedBookOverPages.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'thick_and_thin')).toBeUndefined();
    });

    it('short-circuits when no thin book - does not query thick books', async () => {
      repo.hasFinishedBookUnderPages.mockResolvedValue(false);
      await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(repo.hasFinishedBookOverPages).not.toHaveBeenCalled();
    });

    it('does not award thick_and_thin when already earned', async () => {
      repo.hasFinishedBookUnderPages.mockResolvedValue(true);
      repo.hasFinishedBookOverPages.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(['thick_and_thin']),
      );
      expect(awards.find((a) => a.key === 'thick_and_thin')).toBeUndefined();
    });
  });

  describe('trilogy_master', () => {
    it('awards trilogy_master when a 3-book series is completed', async () => {
      repo.hasCompletedSeriesOfSize.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'trilogy_master' }));
    });

    it('does not award trilogy_master when no 3-book series completed', async () => {
      repo.hasCompletedSeriesOfSize.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'trilogy_master')).toBeUndefined();
    });

    it('passes size=3 to repo method', async () => {
      repo.hasCompletedSeriesOfSize.mockResolvedValue(true);
      await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(repo.hasCompletedSeriesOfSize).toHaveBeenCalledWith(1, 3);
    });

    it('does not award trilogy_master when already earned', async () => {
      repo.hasCompletedSeriesOfSize.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(['trilogy_master']),
      );
      expect(awards.find((a) => a.key === 'trilogy_master')).toBeUndefined();
    });
  });

  describe('genre_devotee', () => {
    it('awards genre_devotee when 10+ books in same genre', async () => {
      repo.maxBooksPerGenre.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'genre_devotee' }));
    });

    it('does not award genre_devotee below 10 books in a genre', async () => {
      repo.maxBooksPerGenre.mockResolvedValue(9);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'genre_devotee')).toBeUndefined();
    });

    it('does not award genre_devotee when already earned', async () => {
      repo.maxBooksPerGenre.mockResolvedValue(20);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED, payload: makeStatusPayload() as never },
        new Set(['genre_devotee']),
      );
      expect(awards.find((a) => a.key === 'genre_devotee')).toBeUndefined();
    });
  });

  describe('backfill for new exploration badges', () => {
    const backfillCtx = { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never };

    it('awards decade_sampler in backfill', async () => {
      repo.countDistinctDecadesRead.mockResolvedValue(5);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'decade_sampler' }));
    });

    it('awards short_story_fan in backfill', async () => {
      repo.countFinishedBooksByMaxPageCount.mockResolvedValue(5);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'short_story_fan' }));
    });

    it('awards thick_and_thin in backfill', async () => {
      repo.hasFinishedBookUnderPages.mockResolvedValue(true);
      repo.hasFinishedBookOverPages.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'thick_and_thin' }));
    });

    it('awards trilogy_master in backfill', async () => {
      repo.hasCompletedSeriesOfSize.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'trilogy_master' }));
    });

    it('awards genre_devotee in backfill', async () => {
      repo.maxBooksPerGenre.mockResolvedValue(10);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'genre_devotee' }));
    });

    it('awards old_soul in backfill', async () => {
      repo.hasFinishedBookPublishedBefore.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'old_soul' }));
    });

    it('does not award old_soul in backfill when no pre-1900 book', async () => {
      repo.hasFinishedBookPublishedBefore.mockResolvedValue(false);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards.find((a) => a.key === 'old_soul')).toBeUndefined();
    });

    it('awards new_release in backfill', async () => {
      repo.hasFinishedBookPublishedInYear.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'new_release' }));
    });

    it('does not award new_release in backfill when no current year book', async () => {
      repo.hasFinishedBookPublishedInYear.mockResolvedValue(false);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards.find((a) => a.key === 'new_release')).toBeUndefined();
    });
  });
});
