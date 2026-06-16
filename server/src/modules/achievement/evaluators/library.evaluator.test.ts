import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LibraryEvaluator } from './library.evaluator';
import {
  ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
  ACHIEVEMENT_EVENT_COLLECTION_CREATED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED,
  ACHIEVEMENT_EVENT_BACKFILL,
} from '../achievement-events.service';

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    countAccessibleBooks: vi.fn().mockResolvedValue(0),
    countAnnotations: vi.fn().mockResolvedValue(0),
    countDistinctFormats: vi.fn().mockResolvedValue(0),
    countCollections: vi.fn().mockResolvedValue(0),
    countAnnotationsWithNotes: vi.fn().mockResolvedValue(0),
    countAnnotationsOnDay: vi.fn().mockResolvedValue(0),
    hasAnyDayWithAnnotationCount: vi.fn().mockResolvedValue(false),
    getAnnotationNoteLength: vi.fn().mockResolvedValue(null),
    getMaxNoteLength: vi.fn().mockResolvedValue(0),
    countDistinctColors: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('LibraryEvaluator', () => {
  let evaluator: LibraryEvaluator;
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
    evaluator = new LibraryEvaluator(repo as never);
  });

  it('supports annotation, collection, book status, and library catalog events', () => {
    expect(evaluator.supports(ACHIEVEMENT_EVENT_ANNOTATION_CREATED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_COLLECTION_CREATED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED)).toBe(true);
    expect(evaluator.supports(ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED)).toBe(true);
    expect(evaluator.supports('other')).toBe(false);
  });

  describe('library_builder tiers', () => {
    it('awards tier 1 at 50 books', async () => {
      repo.countAccessibleBooks.mockResolvedValue(50);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 1, newStatus: 'read', oldStatus: 'reading' },
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'library_builder_1' }));
    });

    it('skips check when status is not read', async () => {
      repo.countAccessibleBooks.mockResolvedValue(1000);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 1, newStatus: 'reading', oldStatus: 'unread' },
        },
        new Set(),
      );
      expect(awards.filter((a) => a.key.startsWith('library_builder'))).toHaveLength(0);
    });

    it('awards tiers on library catalog changes without requiring read status transitions', async () => {
      repo.countAccessibleBooks.mockResolvedValue(250);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, payload: { userId: 1, libraryId: 10 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'library_builder_1' }));
      expect(awards).toContainEqual(expect.objectContaining({ key: 'library_builder_2' }));
    });
  });

  describe('annotator tiers', () => {
    it('awards annotator_1 at 10 annotations', async () => {
      repo.countAnnotations.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'annotator_1' }));
    });

    it('does not include bookmarked (now handled by MilestonesEvaluator)', async () => {
      repo.countAnnotations.mockResolvedValue(1);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'bookmarked')).toBeUndefined();
    });
  });

  describe('multi_format', () => {
    it('awards multi_format when 3+ formats', async () => {
      repo.countDistinctFormats.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        {
          userId: 1,
          isSuperuser: false,
          eventName: ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
          payload: { userId: 1, bookId: 1, newStatus: 'read', oldStatus: 'reading' },
        },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'multi_format' }));
    });

    it('awards multi_format on library catalog changes', async () => {
      repo.countDistinctFormats.mockResolvedValue(3);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED, payload: { userId: 1, libraryId: 2 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'multi_format' }));
    });
  });

  describe('curator', () => {
    it('awards curator at 10 collections', async () => {
      repo.countCollections.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_COLLECTION_CREATED, payload: { userId: 1 } },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'curator' }));
    });

    it('does not award curator below 10', async () => {
      repo.countCollections.mockResolvedValue(9);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_COLLECTION_CREATED, payload: { userId: 1 } },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'curator')).toBeUndefined();
    });
  });

  describe('note_keeper', () => {
    it('awards note_keeper when 20+ annotations have notes', async () => {
      repo.countAnnotationsWithNotes.mockResolvedValue(25);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'note_keeper' }));
    });

    it('does not award note_keeper below 20', async () => {
      repo.countAnnotationsWithNotes.mockResolvedValue(24);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'note_keeper')).toBeUndefined();
    });

    it('does not award note_keeper when already earned', async () => {
      repo.countAnnotationsWithNotes.mockResolvedValue(50);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(['note_keeper']),
      );
      expect(awards.find((a) => a.key === 'note_keeper')).toBeUndefined();
    });

    it('awards note_keeper via backfill', async () => {
      repo.countAnnotationsWithNotes.mockResolvedValue(25);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'note_keeper' }));
    });
  });

  describe('deep_dive_session', () => {
    it('awards deep_dive_session when 10+ annotations created today', async () => {
      repo.countAnnotationsOnDay.mockResolvedValue(10);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'deep_dive_session' }));
    });

    it('does not award deep_dive_session below 10 today', async () => {
      repo.countAnnotationsOnDay.mockResolvedValue(9);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'deep_dive_session')).toBeUndefined();
    });

    it('does not award deep_dive_session when already earned', async () => {
      repo.countAnnotationsOnDay.mockResolvedValue(15);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1 } },
        new Set(['deep_dive_session']),
      );
      expect(awards.find((a) => a.key === 'deep_dive_session')).toBeUndefined();
    });

    it('awards deep_dive_session via backfill', async () => {
      repo.hasAnyDayWithAnnotationCount.mockResolvedValue(true);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'deep_dive_session' }));
    });

    it('does not award deep_dive_session via backfill when no qualifying day', async () => {
      repo.hasAnyDayWithAnnotationCount.mockResolvedValue(false);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'deep_dive_session')).toBeUndefined();
    });
  });

  describe('wordsmith', () => {
    it('awards wordsmith for a note longer than 280 chars', async () => {
      repo.getAnnotationNoteLength.mockResolvedValue(300);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1, annotationId: 9 } },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'wordsmith' }));
    });

    it('does not award wordsmith for a note of exactly 280 chars', async () => {
      repo.getAnnotationNoteLength.mockResolvedValue(280);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1, annotationId: 9 } },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'wordsmith')).toBeUndefined();
    });

    it('does not award wordsmith when the annotation has no note', async () => {
      repo.getAnnotationNoteLength.mockResolvedValue(null);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1, annotationId: 9 } },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'wordsmith')).toBeUndefined();
    });

    it('awards wordsmith via backfill', async () => {
      repo.getMaxNoteLength.mockResolvedValue(500);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'wordsmith' }));
    });
  });

  describe('box_of_crayons', () => {
    it('awards box_of_crayons when all 5 colors are used', async () => {
      repo.countDistinctColors.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1, annotationId: 9 } },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'box_of_crayons' }));
    });

    it('does not award box_of_crayons with only 4 colors', async () => {
      repo.countDistinctColors.mockResolvedValue(4);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_ANNOTATION_CREATED, payload: { userId: 1, bookId: 1, annotationId: 9 } },
        new Set(),
      );
      expect(awards.find((a) => a.key === 'box_of_crayons')).toBeUndefined();
    });

    it('awards box_of_crayons via backfill', async () => {
      repo.countDistinctColors.mockResolvedValue(5);
      const awards = await evaluator.evaluate(
        { userId: 1, isSuperuser: false, eventName: ACHIEVEMENT_EVENT_BACKFILL, payload: { userId: 1 } as never },
        new Set(),
      );
      expect(awards).toContainEqual(expect.objectContaining({ key: 'box_of_crayons' }));
    });
  });
});
