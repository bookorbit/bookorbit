import { BadRequestException, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import { TaxonomyService } from './taxonomy.service';

function reqUser(overrides: Record<string, unknown> = {}) {
  return { id: 7, isSuperuser: false, permissions: [], contentFilters: EMPTY_CONTENT_FILTER_RULES, settings: {}, ...overrides } as never;
}

const BOOK_QUERY = { pagination: { page: 0, size: 50 }, sort: [{ field: 'title', dir: 'asc' }] } as never;

function makeService() {
  const repo = {
    findPage: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    countVisible: vi.fn().mockResolvedValue(0),
    findCoverBookIds: vi.fn().mockResolvedValue(new Map()),
    findEntry: vi.fn().mockResolvedValue({ id: 5, name: 'Fantasy' }),
    findLibraryCounts: vi.fn().mockResolvedValue([]),
    findSimilar: vi.fn().mockResolvedValue([]),
    hasVisibleBooks: vi.fn().mockResolvedValue(true),
    membershipClause: vi.fn().mockReturnValue(sql`member`),
  };
  const libraryService = { findAccessibleLibraryIds: vi.fn().mockResolvedValue([1, 2]) };
  const bookService = {
    executeBooksQuery: vi.fn().mockResolvedValue({ items: [], total: 0, page: 0, size: 50 }),
    executeJumpBucketsQuery: vi.fn().mockResolvedValue({ buckets: [], total: 0, kind: 'letter', granularity: null }),
  };
  const queryBuilder = { buildWhere: vi.fn().mockReturnValue(sql`visible`) };
  const service = new TaxonomyService(repo as never, libraryService as never, bookService as never, queryBuilder as never);
  return { service, repo, libraryService, bookService, queryBuilder };
}

describe('TaxonomyService', () => {
  describe('findPage', () => {
    it('attaches covers and both kind totals to the page', async () => {
      const { service, repo } = makeService();
      repo.findPage.mockResolvedValue({
        items: [{ id: 3, name: 'Fantasy', bookCount: 12, readCount: 4, readingCount: 1, libraryCount: 2, lastAddedAt: '2026-01-01' }],
        total: 1,
      });
      repo.countVisible.mockImplementation((kind: string) => Promise.resolve(kind === 'genre' ? 40 : 9));
      repo.findCoverBookIds.mockResolvedValue(new Map([[3, [10, 11]]]));

      const page = await service.findPage('genre', reqUser(), { page: 0, size: 50, sort: 'bookCount', order: 'desc', q: 'fan' });

      expect(page).toEqual({
        items: [expect.objectContaining({ id: 3, coverBookIds: [10, 11] })],
        total: 1,
        page: 0,
        size: 50,
        totals: { genre: 40, tag: 9 },
      });
      expect(repo.findPage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'genre', q: 'fan', sort: 'bookCount', order: 'desc', userId: 7 }));
      expect(repo.findCoverBookIds).toHaveBeenCalledWith('genre', [3], expect.objectContaining({ libraryIds: [1, 2] }));
    });

    it('narrows to one library the viewer can open', async () => {
      const { service, repo } = makeService();

      await service.findPage('tag', reqUser(), { libraryId: 2 });

      expect(repo.findPage).toHaveBeenCalledWith(expect.objectContaining({ visibility: expect.objectContaining({ libraryIds: [2] }) }));
    });

    it('answers empty for a library the viewer cannot open, without querying', async () => {
      const { service, repo } = makeService();

      const page = await service.findPage('tag', reqUser(), { libraryId: 99 });

      expect(page).toEqual({ items: [], total: 0, page: 0, size: 50, totals: { genre: 0, tag: 0 } });
      expect(repo.findPage).not.toHaveBeenCalled();
    });

    it('rejects a window deeper than the offset limit', async () => {
      const { service } = makeService();

      await expect(service.findPage('genre', reqUser(), { page: 1000, size: 200 })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('applies content filters to everyone but superusers', async () => {
      const { service, repo } = makeService();

      await service.findPage('genre', reqUser(), {});
      await service.findPage('genre', reqUser({ isSuperuser: true }), {});

      expect(repo.findPage.mock.calls[0][0].visibility.contentFilters).toBe(EMPTY_CONTENT_FILTER_RULES);
      expect(repo.findPage.mock.calls[1][0].visibility.contentFilters).toBeUndefined();
    });
  });

  describe('findDetail', () => {
    it('sums the per-library counts', async () => {
      const { service, repo } = makeService();
      repo.findLibraryCounts.mockResolvedValue([
        { id: 1, name: 'Fiction', bookCount: 30 },
        { id: 2, name: 'Comics', bookCount: 4 },
      ]);

      await expect(service.findDetail('genre', 5, reqUser())).resolves.toEqual({
        id: 5,
        kind: 'genre',
        name: 'Fantasy',
        bookCount: 34,
        libraries: [
          { id: 1, name: 'Fiction', bookCount: 30 },
          { id: 2, name: 'Comics', bookCount: 4 },
        ],
      });
    });

    it('is not found when no visible book carries the name', async () => {
      const { service } = makeService();

      await expect(service.findDetail('genre', 5, reqUser())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is not found when the name does not exist', async () => {
      const { service, repo } = makeService();
      repo.findEntry.mockResolvedValue(null);

      await expect(service.findDetail('tag', 5, reqUser())).rejects.toThrow('Tag not found');
    });

    it('is not found for a viewer with no libraries', async () => {
      const { service, repo, libraryService } = makeService();
      libraryService.findAccessibleLibraryIds.mockResolvedValue([]);

      await expect(service.findDetail('genre', 5, reqUser())).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findEntry).not.toHaveBeenCalled();
    });
  });

  describe('findSimilar', () => {
    it('looks up look-alikes of the stored name', async () => {
      const { service, repo } = makeService();
      repo.findSimilar.mockResolvedValue([{ id: 6, name: 'Epic Fantasy', bookCount: 8 }]);

      await expect(service.findSimilar('genre', 5, reqUser())).resolves.toEqual({ items: [{ id: 6, name: 'Epic Fantasy', bookCount: 8 }] });
      expect(repo.findSimilar).toHaveBeenCalledWith('genre', { id: 5, name: 'Fantasy' }, expect.objectContaining({ libraryIds: [1, 2] }), 40);
    });

    it('is not found, like the page, when no visible book carries the name', async () => {
      const { service, repo } = makeService();
      repo.hasVisibleBooks.mockResolvedValue(false);

      await expect(service.findSimilar('tag', 5, reqUser())).rejects.toThrow('Tag not found');
      expect(repo.hasVisibleBooks).toHaveBeenCalledWith('tag', 5, expect.objectContaining({ libraryIds: [1, 2] }));
      expect(repo.findSimilar).not.toHaveBeenCalled();
    });
  });

  describe('queryBooks', () => {
    it('adds the membership clause to the visible-book filter', async () => {
      const { service, repo, bookService, queryBuilder } = makeService();
      const user = reqUser();

      await service.queryBooks('tag', 5, user, BOOK_QUERY);

      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(undefined, expect.objectContaining({ accessibleLibraryIds: [1, 2], userId: 7 }));
      expect(repo.membershipClause).toHaveBeenCalledWith('tag', 5);
      expect(bookService.executeBooksQuery).toHaveBeenCalledWith(7, expect.anything(), BOOK_QUERY, expect.objectContaining({ viewer: user }));
    });

    it('narrows to the requested library', async () => {
      const { service, queryBuilder } = makeService();

      await service.queryBooks('genre', 5, reqUser(), BOOK_QUERY, 1);

      expect(queryBuilder.buildWhere).toHaveBeenCalledWith(undefined, expect.objectContaining({ accessibleLibraryIds: [1] }));
    });

    it('returns an empty page for a library outside the viewer scope', async () => {
      const { service, bookService } = makeService();

      await expect(service.queryBooks('genre', 5, reqUser(), BOOK_QUERY, 42)).resolves.toEqual({ items: [], total: 0, page: 0, size: 50 });
      expect(bookService.executeBooksQuery).not.toHaveBeenCalled();
    });
  });

  describe('queryJumpBuckets', () => {
    it('uses the viewer time zone', async () => {
      const { service, bookService } = makeService();

      await service.queryJumpBuckets('genre', 5, reqUser({ settings: { timezone: 'Europe/Berlin' } }), BOOK_QUERY);

      expect(bookService.executeJumpBucketsQuery).toHaveBeenCalledWith(7, expect.anything(), BOOK_QUERY, 'Europe/Berlin', {
        seriesSelectionFilter: undefined,
      });
    });
  });
});
