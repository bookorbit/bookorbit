import { describe, expect, it, vi } from 'vitest';

import type { RequestUser } from '../../common/types/request-user';
import { SearchService } from './search.service';

const user = { id: 7, isSuperuser: false } as RequestUser;

function createService() {
  const bookService = {
    globalQuery: vi.fn(),
    queryForLibrary: vi.fn(),
  };
  const authorsService = { findAll: vi.fn() };
  const seriesService = { findAll: vi.fn() };
  const service = new SearchService(bookService as never, authorsService as never, seriesService as never);
  return { service, bookService, authorsService, seriesService };
}

describe('SearchService', () => {
  it('returns grouped totals and explains matches across fields', async () => {
    const { service, bookService, authorsService, seriesService } = createService();
    const book = {
      id: 1,
      title: 'Dune',
      authors: ['Frank Herbert'],
      seriesName: 'Dune',
      narrators: ['Simon Vance'],
      seriesMemberships: [],
    };
    const author = { id: 2, name: 'Frank Herbert', bookCount: 8 };
    const series = { id: 3, name: 'Dune', authors: ['Frank Herbert'], bookCount: 6 };
    bookService.globalQuery.mockResolvedValue({ items: [book], total: 12, page: 0, size: 5 });
    authorsService.findAll.mockResolvedValue({ items: [author], total: 1, page: 0, size: 5 });
    seriesService.findAll.mockResolvedValue({ items: [series], total: 2, page: 0, size: 5 });

    const result = await service.search(user, { q: 'dune', limit: 5 });

    expect(result.query).toBe('dune');
    expect(result.books.total).toBe(12);
    expect(result.books.items[0]).toMatchObject({ item: book, matchedField: 'title', matchedText: 'Dune' });
    expect(result.authors.items[0]).toMatchObject({ item: author, matchedField: 'name', matchedText: 'Frank Herbert' });
    expect(result.series.items[0]).toMatchObject({ item: series, matchedField: 'name', matchedText: 'Dune' });
    expect(bookService.globalQuery).toHaveBeenCalledWith(user, {
      q: 'dune',
      sort: [{ field: 'relevance', dir: 'desc' }],
      pagination: { page: 0, size: 5 },
    });
  });

  it('scopes every entity query to a requested library', async () => {
    const { service, bookService, authorsService, seriesService } = createService();
    bookService.queryForLibrary.mockResolvedValue({ items: [], total: 0, page: 0, size: 3 });
    authorsService.findAll.mockResolvedValue({ items: [], total: 0, page: 0, size: 3 });
    seriesService.findAll.mockResolvedValue({ items: [], total: 0, page: 0, size: 3 });

    await service.search(user, { q: 'dune', limit: 3, libraryId: 11 });

    expect(bookService.queryForLibrary).toHaveBeenCalledWith(user, 11, expect.any(Object));
    expect(bookService.globalQuery).not.toHaveBeenCalled();
    expect(authorsService.findAll).toHaveBeenCalledWith(user, expect.objectContaining({ libraryId: 11, size: 3 }));
    expect(seriesService.findAll).toHaveBeenCalledWith(user, expect.objectContaining({ libraryId: 11, size: 3 }));
  });

  it('identifies narrator-only book matches', async () => {
    const { service, bookService, authorsService, seriesService } = createService();
    const book = {
      id: 1,
      title: 'The Hobbit',
      authors: ['J. R. R. Tolkien'],
      seriesName: null,
      narrators: ['Andy Serkis'],
      seriesMemberships: [],
    };
    bookService.globalQuery.mockResolvedValue({ items: [book], total: 1, page: 0, size: 5 });
    authorsService.findAll.mockResolvedValue({ items: [], total: 0, page: 0, size: 5 });
    seriesService.findAll.mockResolvedValue({ items: [], total: 0, page: 0, size: 5 });

    const result = await service.search(user, { q: 'serkis' });

    expect(result.books.items[0]).toMatchObject({ matchedField: 'narrator', matchedText: 'Andy Serkis' });
  });
});
