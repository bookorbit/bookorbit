import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES, type ChapterHealthCategory } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { ChapterHealthRow } from './chapter-health.repository';
import { ChapterHealthService } from './chapter-health.service';

const USER = { id: 7, isSuperuser: false, contentFilters: EMPTY_CONTENT_FILTER_RULES } as RequestUser;

const REVIEW_RESULT = { provider: 'audible' as const, chapterCount: 12, runtimeMs: 37_206_520, totalDurationMs: 37_190_000, isAccurate: true };

function row(overrides: Partial<ChapterHealthRow> = {}): ChapterHealthRow {
  return {
    bookId: 41,
    title: 'The Long Book',
    authors: ['Ann Author'],
    libraryName: 'Audiobooks',
    audioFiles: 1,
    chapterCount: 0,
    source: null,
    audibleId: 'B0TESTASIN',
    reviewReason: 'runtime_mismatch',
    reviewResult: REVIEW_RESULT,
    ...overrides,
  };
}

function totals(values: Partial<Record<ChapterHealthCategory, { total: number; withAsin: number }>> = {}) {
  return {
    no_chapters: { total: 0, withAsin: 0 },
    one_per_file: { total: 0, withAsin: 0 },
    numbered_tracks: { total: 0, withAsin: 0 },
    needs_review: { total: 0, withAsin: 0 },
    edited: { total: 0, withAsin: 0 },
    ...values,
  };
}

function setup(editableLibraryIds = [2, 3]) {
  const repo = {
    summarize: vi.fn().mockResolvedValue(totals()),
    list: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    findLookupCandidates: vi.fn().mockResolvedValue([]),
    filterLookupCandidates: vi.fn().mockResolvedValue([]),
    enqueue: vi.fn().mockImplementation((ids: number[]) => Promise.resolve(ids.length)),
    stateFor: vi.fn().mockResolvedValue({ counts: new Map(), processing: null }),
    removeQueued: vi.fn().mockResolvedValue(0),
    removeFinished: vi.fn().mockResolvedValue(0),
    dismissReview: vi.fn().mockResolvedValue(true),
  };
  const libraryService = { findEditableLibraryIds: vi.fn().mockResolvedValue(editableLibraryIds) };
  return { service: new ChapterHealthService(repo as never, libraryService as never), repo, libraryService };
}

describe('ChapterHealthService.summary', () => {
  it('counts every category across the libraries the user can reach', async () => {
    const { service, repo, libraryService } = setup();
    repo.summarize.mockResolvedValue(
      totals({ no_chapters: { total: 5, withAsin: 2 }, numbered_tracks: { total: 3, withAsin: 3 }, edited: { total: 1, withAsin: 0 } }),
    );

    await expect(service.summary(USER)).resolves.toEqual({
      counts: { no_chapters: 5, one_per_file: 0, numbered_tracks: 3, needs_review: 0, edited: 1 },
      withAsin: { no_chapters: 2, one_per_file: 0, numbered_tracks: 3, needs_review: 0, edited: 0 },
    });
    expect(libraryService.findEditableLibraryIds).toHaveBeenCalledWith(USER);
    expect(repo.summarize).toHaveBeenCalledWith([2, 3], USER.contentFilters);
  });

  it('narrows to one library the user can reach', async () => {
    const { service, repo } = setup();

    await service.summary(USER, 3);

    expect(repo.summarize).toHaveBeenCalledWith([3], USER.contentFilters);
  });

  it('refuses a library the user cannot reach without counting anything', async () => {
    const { service, repo } = setup([2]);

    await expect(service.summary(USER, 3)).rejects.toThrow(ForbiddenException);
    expect(repo.summarize).not.toHaveBeenCalled();
  });

  it('passes an empty scope through for a user with no libraries', async () => {
    const { service, repo } = setup([]);

    await service.summary(USER);

    expect(repo.summarize).toHaveBeenCalledWith([], USER.contentFilters);
  });
});

describe('ChapterHealthService.list', () => {
  it('reads the first 50 books of a category by default, with no review attached outside needs_review', async () => {
    const { service, repo } = setup();
    repo.list.mockResolvedValue({ rows: [row({ chapterCount: 1 })], total: 1 });

    await expect(service.list(USER, { category: 'no_chapters' })).resolves.toEqual({
      total: 1,
      items: [
        {
          bookId: 41,
          title: 'The Long Book',
          authors: ['Ann Author'],
          libraryName: 'Audiobooks',
          audioFiles: 1,
          chapterCount: 1,
          source: null,
          audibleId: 'B0TESTASIN',
          review: null,
        },
      ],
    });
    expect(repo.list).toHaveBeenCalledWith([2, 3], 'no_chapters', 0, 50, USER.contentFilters);
  });

  it('turns a page into an offset within the chosen library', async () => {
    const { service, repo } = setup();

    await service.list(USER, { category: 'edited', libraryId: 2, page: 3, pageSize: 20 });

    expect(repo.list).toHaveBeenCalledWith([2], 'edited', 40, 20, USER.contentFilters);
  });

  it('attaches why each review stopped, dropping a reason it does not know', async () => {
    const { service, repo } = setup();
    repo.list.mockResolvedValue({
      rows: [row(), row({ bookId: 42, reviewReason: 'locked', reviewResult: null }), row({ bookId: 43, reviewReason: 'no_asin' })],
      total: 3,
    });

    const page = await service.list(USER, { category: 'needs_review' });

    expect(page.items.map((item) => item.review)).toEqual([
      { reason: 'runtime_mismatch', summary: REVIEW_RESULT },
      { reason: 'locked', summary: null },
      { reason: null, summary: REVIEW_RESULT },
    ]);
  });

  it('refuses a library the user cannot reach', async () => {
    const { service, repo } = setup([2]);

    await expect(service.list(USER, { category: 'no_chapters', libraryId: 9 })).rejects.toThrow(ForbiddenException);
    expect(repo.list).not.toHaveBeenCalled();
  });
});

describe('ChapterHealthService.enqueue', () => {
  it('queues the chosen books that can be looked up, counting the rest as skipped', async () => {
    const { service, repo } = setup();
    repo.filterLookupCandidates.mockResolvedValue([11, 13]);

    await expect(service.enqueue(USER, { bookIds: [11, 12, 13, 11, 14] })).resolves.toEqual({ queued: 2, skipped: 2 });
    expect(repo.filterLookupCandidates).toHaveBeenCalledWith([2, 3], [11, 12, 13, 14], USER.contentFilters);
    expect(repo.enqueue).toHaveBeenCalledWith([11, 13], USER.id);
    expect(repo.findLookupCandidates).not.toHaveBeenCalled();
  });

  it('queues every book with an ASIN in a category, capped per request', async () => {
    const { service, repo } = setup();
    repo.findLookupCandidates.mockResolvedValue([21, 22, 23]);

    await expect(service.enqueue(USER, { category: 'one_per_file', libraryId: 3 })).resolves.toEqual({ queued: 3, skipped: 0 });
    expect(repo.findLookupCandidates).toHaveBeenCalledWith([3], 'one_per_file', 5_000, USER.contentFilters);
    expect(repo.enqueue).toHaveBeenCalledWith([21, 22, 23], USER.id);
  });

  it('uses the chosen books over a category when both are given', async () => {
    const { service, repo } = setup();
    repo.filterLookupCandidates.mockResolvedValue([11]);

    await expect(service.enqueue(USER, { bookIds: [11], category: 'no_chapters' })).resolves.toEqual({ queued: 1, skipped: 0 });
    expect(repo.findLookupCandidates).not.toHaveBeenCalled();
  });

  it('refuses a request naming neither books nor a category', async () => {
    const { service, repo } = setup();

    await expect(service.enqueue(USER, {})).rejects.toThrow(BadRequestException);
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it('refuses a library the user cannot reach before choosing any book', async () => {
    const { service, repo } = setup([2]);

    await expect(service.enqueue(USER, { category: 'no_chapters', libraryId: 3 })).rejects.toThrow(ForbiddenException);
    expect(repo.findLookupCandidates).not.toHaveBeenCalled();
    expect(repo.enqueue).not.toHaveBeenCalled();
  });
});

describe('ChapterHealthService queue state', () => {
  it("reports the user's own waiting, running and finished lookups, zero where there are none", async () => {
    const { service, repo } = setup();
    repo.stateFor.mockResolvedValue({
      counts: new Map([
        ['queued', 4],
        ['processing', 1],
        ['applied', 9],
        ['review', 2],
      ]),
      processing: { bookId: 41, title: 'The Long Book' },
    });

    await expect(service.state(USER)).resolves.toEqual({
      queued: 4,
      processing: { bookId: 41, title: 'The Long Book' },
      finished: { applied: 9, review: 2, not_found: 0, failed: 0, skipped: 0 },
    });
    expect(repo.stateFor).toHaveBeenCalledWith(USER.id, [2, 3], USER.contentFilters);
  });

  it("cancels and clears only the user's own rows", async () => {
    const { service, repo } = setup();
    repo.removeQueued.mockResolvedValue(3);
    repo.removeFinished.mockResolvedValue(5);

    await expect(service.cancel(USER)).resolves.toEqual({ removed: 3 });
    await expect(service.clearFinished(USER)).resolves.toEqual({ removed: 5 });
    expect(repo.removeQueued).toHaveBeenCalledWith(USER.id);
    expect(repo.removeFinished).toHaveBeenCalledWith(USER.id);
  });
});

describe('ChapterHealthService.dismissReview', () => {
  it('dismisses a review on a book in a library the user can reach', async () => {
    const { service, repo } = setup();

    await expect(service.dismissReview(USER, 41)).resolves.toBeUndefined();
    expect(repo.dismissReview).toHaveBeenCalledWith(41, [2, 3], USER.contentFilters);
  });

  it('answers 404 when no review waits for that book within reach', async () => {
    const { service, repo } = setup();
    repo.dismissReview.mockResolvedValue(false);

    await expect(service.dismissReview(USER, 41)).rejects.toThrow(NotFoundException);
  });
});
