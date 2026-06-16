import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RatingEvaluator } from './rating.evaluator';
import { ACHIEVEMENT_EVENT_BACKFILL, ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED } from '../achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    countRatings: vi.fn().mockResolvedValue(0),
    countRatingsAtMost: vi.fn().mockResolvedValue(0),
    countDistinctRatingValues: vi.fn().mockResolvedValue(0),
    existsRatingValue: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function makeRatingPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return { userId: 1, bookIds: [100], rating: 4, ...overrides };
}

describe('RatingEvaluator', () => {
  let evaluator: RatingEvaluator;
  let repo: ReturnType<typeof makeRepo>;
  const backfillCtx = { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never };

  beforeEach(() => {
    repo = makeRepo();
    evaluator = new RatingEvaluator(repo as never);
  });

  function ratingCtx(payload = makeRatingPayload()) {
    return { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED, payload: payload as never };
  }

  it('supports rating-changed and backfill events', () => {
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BOOK_RATING_CHANGED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BACKFILL)).toBe(true);
    expect(evaluator.supports('other')).toBe(false);
  });

  describe('first_verdict', () => {
    it('awards first_verdict on first rating', async () => {
      repo.countRatings.mockResolvedValue(1);
      const awards = await evaluator.evaluate(ratingCtx(), new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'first_verdict' }));
    });

    it('does nothing when the rating was removed (null)', async () => {
      repo.countRatings.mockResolvedValue(5);
      const awards = await evaluator.evaluate(ratingCtx(makeRatingPayload({ rating: null })), new Set());
      expect(awards).toHaveLength(0);
    });
  });

  describe('critic tiers', () => {
    it('awards critic_1 at 10 ratings', async () => {
      repo.countRatings.mockResolvedValue(10);
      const awards = await evaluator.evaluate(ratingCtx(), new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'critic_1' }));
    });

    it('awards multiple critic tiers at once', async () => {
      repo.countRatings.mockResolvedValue(220);
      const keys = (await evaluator.evaluate(ratingCtx(), new Set())).map((a) => a.key);
      expect(keys).toContain('critic_1');
      expect(keys).toContain('critic_2');
      expect(keys).toContain('critic_3');
      expect(keys).not.toContain('critic_4');
    });

    it('skips already earned tiers', async () => {
      repo.countRatings.mockResolvedValue(60);
      const keys = (await evaluator.evaluate(ratingCtx(), new Set(['critic_1']))).map((a) => a.key);
      expect(keys).not.toContain('critic_1');
      expect(keys).toContain('critic_2');
    });
  });

  describe('standing_ovation', () => {
    it('awards on a 5-star rating', async () => {
      const awards = await evaluator.evaluate(ratingCtx(makeRatingPayload({ rating: 5 })), new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'standing_ovation' }));
    });

    it('does not award below 5 stars', async () => {
      const awards = await evaluator.evaluate(ratingCtx(makeRatingPayload({ rating: 4 })), new Set());
      expect(awards.find((a) => a.key === 'standing_ovation')).toBeUndefined();
    });

    it('awards via backfill when a 5-star rating exists', async () => {
      repo.existsRatingValue.mockResolvedValue(true);
      const awards = await evaluator.evaluate(backfillCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'standing_ovation' }));
      expect(repo.existsRatingValue).toHaveBeenCalledWith(1, 5);
    });
  });

  describe('across_the_board', () => {
    it('awards when all five star values have been used', async () => {
      repo.countDistinctRatingValues.mockResolvedValue(5);
      const awards = await evaluator.evaluate(ratingCtx(), new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'across_the_board' }));
    });

    it('does not award with only 4 distinct values', async () => {
      repo.countDistinctRatingValues.mockResolvedValue(4);
      const awards = await evaluator.evaluate(ratingCtx(), new Set());
      expect(awards.find((a) => a.key === 'across_the_board')).toBeUndefined();
    });
  });

  describe('tough_crowd', () => {
    it('awards when 10 ratings are 2 stars or lower', async () => {
      repo.countRatingsAtMost.mockResolvedValue(10);
      const awards = await evaluator.evaluate(ratingCtx(), new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'tough_crowd' }));
      expect(repo.countRatingsAtMost).toHaveBeenCalledWith(1, 2);
    });

    it('does not award below 10 low ratings', async () => {
      repo.countRatingsAtMost.mockResolvedValue(9);
      const awards = await evaluator.evaluate(ratingCtx(), new Set());
      expect(awards.find((a) => a.key === 'tough_crowd')).toBeUndefined();
    });
  });

  describe('backfill', () => {
    it('awards rating badges from DB scans', async () => {
      repo.countRatings.mockResolvedValue(10);
      repo.countDistinctRatingValues.mockResolvedValue(5);
      repo.countRatingsAtMost.mockResolvedValue(10);
      const keys = (await evaluator.evaluate(backfillCtx, new Set())).map((a) => a.key);
      expect(keys).toContain('first_verdict');
      expect(keys).toContain('critic_1');
      expect(keys).toContain('across_the_board');
      expect(keys).toContain('tough_crowd');
    });
  });
});
