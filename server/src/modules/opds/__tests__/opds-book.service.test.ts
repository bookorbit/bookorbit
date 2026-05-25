import { ForbiddenException } from '@nestjs/common';

import { OpdsBookService } from '../opds-book.service';

function makeChain(result: unknown, fields?: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const key of Object.keys(fields ?? {})) {
    chain[key] = { key };
  }

  const methods = ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit', 'offset', '$dynamic', 'as'] as const;
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);

  return chain;
}

function makeDb(selectQueue: unknown[] = []) {
  const queue = [...selectQueue];

  return {
    select: vi.fn((fields?: Record<string, unknown>) => makeChain(queue.shift() ?? [], fields)),
  };
}

function makeService(selectQueue: unknown[] = [], queryBuilderOverrides: Record<string, unknown> = {}) {
  const db = makeDb(selectQueue);
  const queryBuilder = {
    buildWhere: vi.fn().mockReturnValue(undefined),
    ...queryBuilderOverrides,
  };
  const service = new OpdsBookService(db as never, queryBuilder as never);
  return { service, db, queryBuilder };
}

function collectValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value === null || typeof value !== 'object') return [value];
  if (seen.has(value)) return [];
  seen.add(value);

  const values: unknown[] = [];
  if ('value' in value) values.push((value as { value: unknown }).value);
  for (const key of Object.getOwnPropertyNames(value)) {
    values.push(...collectValues((value as Record<string, unknown>)[key], seen));
  }
  return values;
}

describe('OpdsBookService', () => {
  it('returns accessible library ids for superusers and regular users', async () => {
    const superDb = makeDb([[{ id: 1 }, { id: 4 }]]);
    const superService = new OpdsBookService(superDb as never, {} as never);
    await expect(superService.getAccessibleLibraryIds(7, true)).resolves.toEqual([1, 4]);

    const userDb = makeDb([[{ libraryId: 2 }, { libraryId: 3 }]]);
    const userService = new OpdsBookService(userDb as never, {} as never);
    await expect(userService.getAccessibleLibraryIds(7, false)).resolves.toEqual([2, 3]);
  });

  it('handles getBooksPage access checks and smartScope delegation', async () => {
    const { service } = makeService([[{ userId: 999 }], [{ userId: 7 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const smartScopeSpy = vi.spyOn(service as never, 'getBooksBySmartScope');
    const paginatedSpy = vi.spyOn(service as never, 'paginatedBookQuery');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getBooksPage(7, 'recent', 1, 50)).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { libraryId: 2 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { collectionId: 11 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ entries: [{ id: 5 }], total: 1 });
    await expect(service.getBooksPage(7, 'recent', 3, 25, { smartScopeId: 4 })).resolves.toEqual({ entries: [{ id: 5 }], total: 1 });
    expect(smartScopeSpy).toHaveBeenCalledWith(7, 4, [1, 2], 'recent', 3, 25, undefined);

    accessSpy.mockResolvedValueOnce([1, 2]);
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 9 }], total: 1 });
    const searchSpy = vi.spyOn(service as never, 'buildCatalogSearchClause');
    await expect(
      service.getBooksPage(7, 'title_asc', 2, 20, {
        libraryId: 1,
        collectionId: 10,
        author: 'Frank Herbert',
        series: 'Dune',
        q: 'arrakis',
      }),
    ).resolves.toEqual({ entries: [{ id: 9 }], total: 1 });
    expect(paginatedSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy).toHaveBeenCalledWith('arrakis');
  });

  it('builds catalog search across title, author, series, and normalized ISBN', () => {
    const { service, db } = makeService();

    const clause = (service as unknown as { buildCatalogSearchClause(q: string): unknown }).buildCatalogSearchClause('978-0 141187761');
    const values = collectValues(clause);

    expect(db.select).toHaveBeenCalledWith({ one: expect.anything() });
    expect(values).toContain('%978-0 141187761%');
    expect(values).toContain('9780141187761');
  });

  it('escapes catalog search LIKE patterns', () => {
    const { service } = makeService();

    const clause = (service as unknown as { buildCatalogSearchClause(q: string): unknown }).buildCatalogSearchClause('100%_\\');
    const values = collectValues(clause);

    expect(values).toContain('%100\\%\\_\\\\%');
  });

  it('handles getRecentBooksPage empty-access and delegated paths', async () => {
    const { service } = makeService();
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const paginatedSpy = vi.spyOn(service as never, 'paginatedBookQuery');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getRecentBooksPage(5, 1, 30)).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([2, 3]);
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 1 }], total: 1 });
    await expect(service.getRecentBooksPage(5, 2, 15)).resolves.toEqual({ entries: [{ id: 1 }], total: 1 });
  });

  it('handles getRandomBooks guard branches and wrapped id selection', async () => {
    const { service } = makeService([[{ minId: null, maxId: null }], [{ minId: 10, maxId: 12 }], [{ id: 11 }], [{ id: 10 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const fetchSpy = vi.spyOn(service as never, 'fetchBookEntries');

    await expect(service.getRandomBooks(7, 0)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    fetchSpy.mockResolvedValueOnce([{ id: 11 }, { id: 10 }]);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([{ id: 11 }, { id: 10 }]);
    expect(fetchSpy).toHaveBeenCalledWith([11, 10]);
  });

  it('returns distinct authors and series with and without access', async () => {
    const { service } = makeService([[{ name: 'Frank Herbert', bookCount: 2 }], [{ name: 'Dune', bookCount: 2 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getDistinctAuthors(1)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getDistinctAuthors(1)).resolves.toEqual([{ name: 'Frank Herbert', bookCount: 2 }]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getDistinctSeries(1)).resolves.toEqual([{ name: 'Dune', bookCount: 2 }]);
  });

  it('returns user collections and smartScopes', async () => {
    const { service } = makeService([[{ id: 4, name: 'Favorites', bookCount: 1 }], [{ id: 7, name: 'Unread', icon: 'sparkles' }]]);

    await expect(service.getUserCollections(8)).resolves.toEqual([{ id: 4, name: 'Favorites', bookCount: 1 }]);
    await expect(service.getUserSmartScopes(8)).resolves.toEqual([{ id: 7, name: 'Unread', icon: 'sparkles' }]);
  });

  it('enforces validateBookAccess ownership checks', async () => {
    const { service } = makeService([[{ libraryId: 3 }], [{ libraryId: 4 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');

    accessSpy.mockResolvedValueOnce([1, 2]);
    await expect(service.validateBookAccess(5, 7)).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1, 4]);
    await expect(service.validateBookAccess(5, 7)).resolves.toBeUndefined();
  });

  it('resolves getBookFiles with fallback formatting and title values', async () => {
    const { service } = makeService([[], [{ absolutePath: '/books/a.epub', format: null, title: null }], []]);

    await expect(service.getBookFiles(7, 42)).resolves.toBeNull();

    await expect(service.getBookFiles(7)).resolves.toEqual({
      absolutePath: '/books/a.epub',
      format: 'unknown',
      title: 'book-7',
      authorName: '',
    });
  });

  it('returns no smartScope books when smartScope is missing or private to another user', async () => {
    const { service } = makeService([[], [{ id: 5, userId: 99, isPublic: false, filter: null }]]);

    await expect((service as never).getBooksBySmartScope(7, 5, [1], 'recent', 1, 25)).resolves.toEqual({ entries: [], total: 0 });
    await expect((service as never).getBooksBySmartScope(7, 5, [1], 'recent', 1, 25)).resolves.toEqual({ entries: [], total: 0 });
  });

  it('builds smartScope filters and delegates smartScope pagination', async () => {
    const { service, queryBuilder } = makeService([[{ id: 9, userId: 7, isPublic: false, filter: { op: 'and' } }]], {
      buildWhere: vi.fn().mockReturnValue({ kind: 'where' }),
    });
    const paginatedSpy = vi.spyOn(service as never, 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });

    await expect((service as never).getBooksBySmartScope(7, 9, [1, 2], 'title_desc', 2, 10)).resolves.toEqual({ entries: [{ id: 1 }], total: 1 });
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith({ op: 'and' }, { accessibleLibraryIds: [1, 2], userId: 7 });
    expect(paginatedSpy).toHaveBeenCalledTimes(1);
  });

  it('paginates ids and only fetches entries when rows are present', async () => {
    const empty = makeService([[], [{ total: 5 }]]);
    await expect((empty.service as never).paginatedBookQuery({ kind: 'where' }, 'recent', 2, 10)).resolves.toEqual({ entries: [], total: 5 });

    const filled = makeService([[{ id: 3 }, { id: 1 }], [{ total: 2 }]]);
    const fetchSpy = vi.spyOn(filled.service as never, 'fetchBookEntries').mockResolvedValue([{ id: 3 }, { id: 1 }]);

    await expect((filled.service as never).paginatedBookQuery({ kind: 'where' }, 'author_asc', 1, 25)).resolves.toEqual({
      entries: [{ id: 3 }, { id: 1 }],
      total: 2,
    });
    expect(fetchSpy).toHaveBeenCalledWith([3, 1]);
  });

  it('every sort order includes a books.id tiebreaker as its final ORDER BY clause', async () => {
    const sortOrders = ['recent', 'title_asc', 'title_desc', 'author_asc', 'author_desc', 'series_asc', 'series_desc'] as const;

    for (const sortOrder of sortOrders) {
      const { service, db } = makeService([[], [{ total: 0 }]]);
      await (service as never).paginatedBookQuery({ kind: 'where' }, sortOrder, 1, 25);

      const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r: { value: Record<string, unknown> }) => r.value);
      const orderByArgs = chains.flatMap((chain: Record<string, unknown>) => {
        const fn = chain['orderBy'] as ReturnType<typeof vi.fn>;
        return fn.mock.calls.flat() as unknown[];
      });

      const allValues = orderByArgs.flatMap((arg: unknown) => collectValues(arg));
      const hasIdTiebreaker = allValues.some((v) => v === 'id');

      expect(hasIdTiebreaker, `sort order "${sortOrder}" is missing books.id tiebreaker`).toBe(true);
    }
  });

  it('maps metadata, authors, and files into ordered OPDS entries', async () => {
    const now = new Date('2026-04-15T00:00:00.000Z');
    const { service } = makeService([
      [
        {
          id: 2,
          folderPath: '/library/second',
          addedAt: now,
          bookUpdatedAt: now,
          title: null,
          description: null,
          seriesName: null,
          seriesIndex: null,
          language: null,
          publisher: null,
          isbn13: null,
          coverSource: null,
        },
        {
          id: 1,
          folderPath: '/library/first',
          addedAt: now,
          bookUpdatedAt: now,
          title: 'First',
          description: 'Desc',
          seriesName: 'Series',
          seriesIndex: 1,
          language: 'en',
          publisher: 'Pub',
          isbn13: '123',
          coverSource: 'extracted',
        },
      ],
      [
        { bookId: 1, name: 'Author One' },
        { bookId: 2, name: 'Author Two' },
      ],
      [
        { bookId: 1, id: 10, format: 'epub', role: 'primary' },
        { bookId: 2, id: 20, format: null, role: 'primary' },
      ],
    ]);

    await expect((service as never).fetchBookEntries([1, 2])).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        title: 'First',
        hasCover: true,
        authors: ['Author One'],
        files: [{ id: 10, format: 'epub' }],
      }),
      expect.objectContaining({
        id: 2,
        title: 'second',
        hasCover: false,
        authors: ['Author Two'],
        files: [{ id: 20, format: 'unknown' }],
      }),
    ]);

    await expect((service as never).fetchBookEntries([])).resolves.toEqual([]);
  });
});
