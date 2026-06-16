import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevicesEvaluator } from './devices.evaluator';
import {
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
  ACHIEVEMENT_EVENT_READING_SESSION_SAVED,
} from '../achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    hasAnyExternalDevice: vi.fn().mockResolvedValue(false),
    countDistinctSources: vi.fn().mockResolvedValue(0),
    maxSourcesOnSingleBook: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('DevicesEvaluator', () => {
  let evaluator: DevicesEvaluator;
  let repo: ReturnType<typeof makeRepo>;
  const progressCtx = {
    userId: 1,
    isSuperuser: false,
    eventName: ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED,
    payload: { userId: 1, bookId: 5, progress: 50, source: 'kobo' } as never,
  };
  const backfillCtx = { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never };

  beforeEach(() => {
    repo = makeRepo();
    evaluator = new DevicesEvaluator(repo as never);
  });

  it('supports progress-changed, reading-session, and backfill events', () => {
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BOOK_PROGRESS_CHANGED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_READING_SESSION_SAVED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BACKFILL)).toBe(true);
    expect(evaluator.supports('other')).toBe(false);
  });

  describe('synced_up', () => {
    it('awards when an external device has synced', async () => {
      repo.hasAnyExternalDevice.mockResolvedValue(true);
      const awards = await evaluator.evaluate(progressCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'synced_up' }));
    });

    it('does not award without an external device', async () => {
      repo.hasAnyExternalDevice.mockResolvedValue(false);
      const awards = await evaluator.evaluate(progressCtx, new Set());
      expect(awards.find((a) => a.key === 'synced_up')).toBeUndefined();
    });
  });

  describe('full_orbit', () => {
    it('awards when all 3 sources are present', async () => {
      repo.hasAnyExternalDevice.mockResolvedValue(true);
      repo.countDistinctSources.mockResolvedValue(3);
      const awards = await evaluator.evaluate(progressCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'full_orbit' }));
    });

    it('does not award with only 2 sources', async () => {
      repo.countDistinctSources.mockResolvedValue(2);
      const awards = await evaluator.evaluate(progressCtx, new Set());
      expect(awards.find((a) => a.key === 'full_orbit')).toBeUndefined();
    });
  });

  describe('two_worlds', () => {
    it('awards when a single book has 2 sources', async () => {
      repo.maxSourcesOnSingleBook.mockResolvedValue(2);
      const awards = await evaluator.evaluate(progressCtx, new Set());
      expect(awards).toContainEqual(expect.objectContaining({ key: 'two_worlds' }));
    });

    it('does not award when no book has 2 sources', async () => {
      repo.maxSourcesOnSingleBook.mockResolvedValue(1);
      const awards = await evaluator.evaluate(progressCtx, new Set());
      expect(awards.find((a) => a.key === 'two_worlds')).toBeUndefined();
    });
  });

  describe('reading-session gating', () => {
    it('short-circuits a web session when the user has no external device', async () => {
      repo.hasAnyExternalDevice.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_READING_SESSION_SAVED, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toHaveLength(0);
      expect(repo.countDistinctSources).not.toHaveBeenCalled();
      expect(repo.maxSourcesOnSingleBook).not.toHaveBeenCalled();
    });
  });

  it('does nothing when all device badges are already earned', async () => {
    const awards = await evaluator.evaluate(progressCtx, new Set(['synced_up', 'full_orbit', 'two_worlds']));
    expect(awards).toHaveLength(0);
    expect(repo.hasAnyExternalDevice).not.toHaveBeenCalled();
  });

  describe('backfill', () => {
    it('awards all device badges from DB scans', async () => {
      repo.hasAnyExternalDevice.mockResolvedValue(true);
      repo.countDistinctSources.mockResolvedValue(3);
      repo.maxSourcesOnSingleBook.mockResolvedValue(2);
      const keys = (await evaluator.evaluate(backfillCtx, new Set())).map((a) => a.key);
      expect(keys).toContain('synced_up');
      expect(keys).toContain('full_orbit');
      expect(keys).toContain('two_worlds');
    });
  });
});
