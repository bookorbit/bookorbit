import { ForbiddenException } from '@nestjs/common';

import { bookSeries, bookSeriesMemberships } from '../../../db/schema';
import { OpdsBookService } from '../opds-book.service';

type BookPageResult = { entries: unknown[]; total: number };

type TestableOpdsBookService = {
  buildCatalogSearchClause(q: string): unknown;
  buildReadStatusClause(userId: number, status: 'unread' | 'reading' | 'finished'): unknown;
  fetchBookEntries(bookIds: number[], options?: unknown): Promise<unknown[]>;
  getBooksBySmartScope(
    userId: number,
    smartScopeId: number,
    accessibleIds: number[],
    sortOrder: string,
    page: number,
    size: number,
    contentFilters?: unknown,
    q?: string,
  ): Promise<BookPageResult>;
  paginatedBookQuery(where: unknown, sortOrder: string, page: number, size: number, userId?: number, options?: unknown): Promise<BookPageResult>;
};

function testable(service: OpdsBookService): TestableOpdsBookService {
  return service as unknown as TestableOpdsBookService;
}

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
    const privateService = testable(service);
    const smartScopeSpy = vi.spyOn(privateService, 'getBooksBySmartScope');
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getBooksPage(7, 'recent', 1, 50)).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { libraryId: 2 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { collectionId: 11 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ entries: [{ id: 5 }], total: 1 });
    await expect(service.getBooksPage(7, 'recent', 3, 25, { smartScopeId: 4 })).resolves.toEqual({ entries: [{ id: 5 }], total: 1 });
    expect(smartScopeSpy).toHaveBeenCalledWith(7, 4, [1, 2], 'recent', 3, 25, undefined, undefined);

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ entries: [{ id: 6 }], total: 1 });
    await expect(service.getBooksPage(7, 'recent', 1, 20, { smartScopeId: 4, q: 'dune' })).resolves.toEqual({ entries: [{ id: 6 }], total: 1 });
    expect(smartScopeSpy).toHaveBeenCalledWith(7, 4, [1, 2], 'recent', 1, 20, undefined, 'dune');

    accessSpy.mockResolvedValueOnce([1, 2]);
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 9 }], total: 1 });
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');
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

    const clause = testable(service).buildCatalogSearchClause('978-0 141187761');
    const values = collectValues(clause);

    expect(db.select).toHaveBeenCalledWith({ one: expect.anything() });
    expect(values).toContain('%978-0 141187761%');
    expect(values).toContain('9780141187761');
  });

  it('escapes catalog search LIKE patterns', () => {
    const { service } = makeService();

    const clause = testable(service).buildCatalogSearchClause('100%_\\');
    const values = collectValues(clause);

    expect(values).toContain('%100\\%\\_\\\\%');
  });

  it('handles getRecentBooksPage empty-access and delegated paths', async () => {
    const { service } = makeService();
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const paginatedSpy = vi.spyOn(testable(service), 'paginatedBookQuery');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getRecentBooksPage(5, 1, 30)).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([2, 3]);
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 1 }], total: 1 });
    await expect(service.getRecentBooksPage(5, 2, 15)).resolves.toEqual({ entries: [{ id: 1 }], total: 1 });
  });

  it('handles getRandomBooks guard branches and wrapped id selection', async () => {
    const { service } = makeService([[{ minId: null, maxId: null }], [{ minId: 10, maxId: 12 }], [{ id: 11 }], [{ id: 10 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const fetchSpy = vi.spyOn(testable(service), 'fetchBookEntries');

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

  it('returns distinct authors and membership-backed series with and without access', async () => {
    const { service, db } = makeService([[{ name: 'Frank Herbert', bookCount: 2 }], [{ id: 42, name: 'Dune', bookCount: 2 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getDistinctAuthors(1)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getDistinctAuthors(1)).resolves.toEqual([{ name: 'Frank Herbert', bookCount: 2 }]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getDistinctSeries(1)).resolves.toEqual([{ id: 42, name: 'Dune', bookCount: 2 }]);

    const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value as Record<string, unknown>);
    const seriesChain = chains.at(-1)!;
    expect(seriesChain.from).toHaveBeenCalledWith(bookSeries);
    expect(seriesChain.innerJoin).toHaveBeenCalledWith(bookSeriesMemberships, expect.anything());
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

  it('applies text search inside smartScope when q is provided', async () => {
    const { service } = makeService([[{ id: 3, userId: 7, isPublic: false, filter: null }]]);
    const privateService = testable(service);
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery').mockResolvedValue({ entries: [], total: 0 });
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');

    await privateService.getBooksBySmartScope(7, 3, [1], 'title_asc', 1, 20, undefined, 'dune');

    expect(searchSpy).toHaveBeenCalledWith('dune');
    expect(paginatedSpy).toHaveBeenCalledTimes(1);
    const [where] = paginatedSpy.mock.calls[0] as unknown[];
    expect(collectValues(where)).toContain('%dune%');
  });

  it('omits text search clause inside smartScope when q is absent', async () => {
    const { service } = makeService([[{ id: 3, userId: 7, isPublic: false, filter: null }]]);
    const privateService = testable(service);
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery').mockResolvedValue({ entries: [], total: 0 });
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');

    await privateService.getBooksBySmartScope(7, 3, [1], 'title_asc', 1, 20);

    expect(searchSpy).not.toHaveBeenCalled();
    expect(paginatedSpy).toHaveBeenCalledTimes(1);
  });

  it('returns no smartScope books when smartScope is missing or private to another user', async () => {
    const { service } = makeService([[], [{ id: 5, userId: 99, isPublic: false, filter: null }]]);
    const privateService = testable(service);

    await expect(privateService.getBooksBySmartScope(7, 5, [1], 'recent', 1, 25)).resolves.toEqual({ entries: [], total: 0 });
    await expect(privateService.getBooksBySmartScope(7, 5, [1], 'recent', 1, 25)).resolves.toEqual({ entries: [], total: 0 });
  });

  it('builds smartScope filters and delegates smartScope pagination', async () => {
    const { service, queryBuilder } = makeService([[{ id: 9, userId: 7, isPublic: false, filter: { op: 'and' } }]], {
      buildWhere: vi.fn().mockReturnValue({ kind: 'where' }),
    });
    const privateService = testable(service);
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });

    await expect(privateService.getBooksBySmartScope(7, 9, [1, 2], 'title_desc', 2, 10)).resolves.toEqual({ entries: [{ id: 1 }], total: 1 });
    expect(queryBuilder.buildWhere).toHaveBeenCalledWith({ op: 'and' }, { accessibleLibraryIds: [1, 2], userId: 7 });
    expect(paginatedSpy).toHaveBeenCalledTimes(1);
  });

  it('paginates ids and only fetches entries when rows are present', async () => {
    const empty = makeService([[], [{ total: 5 }]]);
    await expect(testable(empty.service).paginatedBookQuery({ kind: 'where' }, 'recent', 2, 10)).resolves.toEqual({ entries: [], total: 5 });

    const filled = makeService([[{ id: 3 }, { id: 1 }], [{ total: 2 }]]);
    const filledPrivateService = testable(filled.service);
    const fetchSpy = vi.spyOn(filledPrivateService, 'fetchBookEntries').mockResolvedValue([{ id: 3 }, { id: 1 }]);

    await expect(filledPrivateService.paginatedBookQuery({ kind: 'where' }, 'author_asc', 1, 25)).resolves.toEqual({
      entries: [{ id: 3 }, { id: 1 }],
      total: 2,
    });
    expect(fetchSpy).toHaveBeenCalledWith([3, 1], {});
  });

  it('builds read-status, format, and id filters and forwards the user id to pagination', async () => {
    const { service } = makeService();
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const paginatedSpy = vi.spyOn(testable(service), 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });

    accessSpy.mockResolvedValueOnce([1, 2]);
    await expect(service.getBooksPage(7, 'recently_read', 1, 20, { readStatus: 'reading', format: 'EPUB', ids: [3, 1] })).resolves.toEqual({
      entries: [{ id: 1 }],
      total: 1,
    });

    expect(paginatedSpy).toHaveBeenCalledTimes(1);
    const [where, sortOrder, page, size, userId] = paginatedSpy.mock.calls[0] as unknown[];
    expect(sortOrder).toBe('recently_read');
    expect(page).toBe(1);
    expect(size).toBe(20);
    expect(userId).toBe(7);

    const values = collectValues(where);
    expect(values).toContain('reading');
    expect(values).toContain('epub');
    expect(values).toContain(3);
    expect(values).toContain(1);
  });

  it('builds membership-backed series filters from explicit and opaque legacy series ids', async () => {
    const explicit = makeService();
    const explicitAccessSpy = vi.spyOn(explicit.service, 'getAccessibleLibraryIds');
    const explicitPaginatedSpy = vi.spyOn(testable(explicit.service), 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });

    explicitAccessSpy.mockResolvedValueOnce([1]);
    await expect(explicit.service.getBooksPage(7, 'series_asc', 1, 20, { seriesId: 42 })).resolves.toEqual({
      entries: [{ id: 1 }],
      total: 1,
    });

    expect(explicitPaginatedSpy).toHaveBeenCalledTimes(1);
    expect((explicitPaginatedSpy.mock.calls[0] as unknown[])[5]).toEqual({ contextSeries: { seriesId: 42 } });
    expect(collectValues((explicitPaginatedSpy.mock.calls[0] as unknown[])[0])).toContain(42);

    const legacy = makeService();
    const legacyAccessSpy = vi.spyOn(legacy.service, 'getAccessibleLibraryIds');
    const legacyPaginatedSpy = vi.spyOn(testable(legacy.service), 'paginatedBookQuery').mockResolvedValue({ entries: [], total: 0 });

    legacyAccessSpy.mockResolvedValueOnce([1]);
    await legacy.service.getBooksPage(7, 'series_asc', 1, 20, { series: 'series:99' });

    expect((legacyPaginatedSpy.mock.calls[0] as unknown[])[5]).toEqual({ contextSeries: { seriesId: 99 } });
    expect(collectValues((legacyPaginatedSpy.mock.calls[0] as unknown[])[0])).toContain(99);
  });

  it('normalizes legacy series-name filters to membership identity', async () => {
    const { service } = makeService();
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const paginatedSpy = vi.spyOn(testable(service), 'paginatedBookQuery').mockResolvedValue({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([1]);
    await service.getBooksPage(7, 'series_asc', 1, 20, { series: ' Dune Saga ' });

    expect((paginatedSpy.mock.calls[0] as unknown[])[5]).toEqual({ contextSeries: { normalizedName: 'dune saga' } });
    expect(collectValues((paginatedSpy.mock.calls[0] as unknown[])[0])).toContain('dune saga');
  });

  it('returns paged distinct series from membership rows with stable ids', async () => {
    const { service, db } = makeService([
      [
        { id: 1, name: 'Dune', bookCount: 6 },
        { id: 2, name: 'World of Warcraft', bookCount: 9 },
      ],
    ]);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

    await expect(service.getDistinctSeriesPage(7, { q: 'war', limit: 1, offset: 0 })).resolves.toEqual({
      items: [{ id: 1, name: 'Dune', bookCount: 6 }],
      hasNext: true,
    });

    const chain = (db.select as ReturnType<typeof vi.fn>).mock.results.at(-1)!.value as Record<string, ReturnType<typeof vi.fn>>;
    expect(chain.from).toHaveBeenCalledWith(bookSeries);
    expect(chain.innerJoin).toHaveBeenCalledWith(bookSeriesMemberships, expect.anything());
    expect(collectValues(chain.where.mock.calls[0]?.[0])).toEqual(expect.arrayContaining([1, '%war%']));
  });

  it('short-circuits when an empty id filter is supplied', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 20, { ids: [] })).resolves.toEqual({ entries: [], total: 0 });
  });

  it('builds unread read-status as a negated active-status subquery', () => {
    const { service } = makeService();

    const readingClause = testable(service).buildReadStatusClause(7, 'reading');
    const unreadClause = testable(service).buildReadStatusClause(7, 'unread');

    expect(collectValues(readingClause)).toEqual(expect.arrayContaining([7, 'reading', 'rereading', 'on_hold']));
    expect(collectValues(unreadClause)).toEqual(expect.arrayContaining([7, 'read', 'skimmed', 'abandoned']));
  });

  it('every sort order includes a books.id tiebreaker as its final ORDER BY clause', async () => {
    const sortOrders = [
      'recent',
      'recent_asc',
      'updated',
      'updated_asc',
      'recently_read',
      'recently_read_asc',
      'title_asc',
      'title_desc',
      'author_asc',
      'author_desc',
      'series_asc',
      'series_desc',
    ] as const;

    for (const sortOrder of sortOrders) {
      const { service, db } = makeService([[], [{ total: 0 }]]);
      await testable(service).paginatedBookQuery({ kind: 'where' }, sortOrder, 1, 25, 7);

      const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value as Record<string, unknown>);
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
          seriesId: null,
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
          seriesId: 42,
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
        { bookId: 1, id: 10, format: 'epub', role: 'content' },
        { bookId: 1, id: 11, format: 'mobi', role: 'content' },
        { bookId: 1, id: 12, format: 'jpg', role: 'cover' },
        { bookId: 2, id: 20, format: null, role: 'content' },
      ],
    ]);

    await expect(testable(service).fetchBookEntries([1, 2])).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        title: 'First',
        seriesId: 42,
        hasCover: true,
        authors: ['Author One'],
        files: [
          { id: 10, format: 'epub' },
          { id: 11, format: 'mobi' },
        ],
      }),
      expect.objectContaining({
        id: 2,
        title: 'second',
        hasCover: false,
        authors: ['Author Two'],
        files: [{ id: 20, format: 'unknown' }],
      }),
    ]);

    await expect(testable(service).fetchBookEntries([])).resolves.toEqual([]);
  });

  it('overrides primary metadata with the contextual series membership for series-scoped pages', async () => {
    const now = new Date('2026-04-15T00:00:00.000Z');
    const { service } = makeService([
      [
        {
          id: 1,
          folderPath: '/library/first',
          addedAt: now,
          bookUpdatedAt: now,
          title: 'First',
          description: null,
          seriesId: 10,
          seriesName: 'Primary Saga',
          seriesIndex: 1,
          language: 'en',
          publisher: null,
          isbn13: null,
          coverSource: null,
        },
      ],
      [{ bookId: 1, name: 'Author One' }],
      [{ bookId: 1, id: 10, format: 'epub', role: 'content' }],
      [{ bookId: 1, seriesId: 42, seriesName: 'Secondary Arc', seriesIndex: 3 }],
    ]);

    await expect(testable(service).fetchBookEntries([1], { contextSeries: { seriesId: 42 } })).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        seriesId: 42,
        seriesName: 'Secondary Arc',
        seriesIndex: 3,
      }),
    ]);
  });
});
