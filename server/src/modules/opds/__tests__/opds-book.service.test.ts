import { ForbiddenException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES } from '@bookorbit/types';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { authors, bookSeries, bookSeriesMemberships } from '../../../db/schema';
import { OpdsBookService, readStatusBucket } from '../opds-book.service';
import { OpdsCollectionRepository } from '../opds-collection.repository';

type BookPageResult = { entries: unknown[]; total: number };

type TestableOpdsBookService = {
  buildCatalogSearchClause(q: string): unknown;
  buildReadStatusClause(userId: number, status: 'unread' | 'reading' | 'finished'): unknown;
  fetchBookEntries(bookIds: number[], options?: unknown): Promise<unknown[]>;
  buildSmartScopeWhere(userId: number, smartScopeId: number, accessibleIds: number[], contentFilters?: unknown, q?: string): Promise<unknown>;
  fetchManifestRows(bookIds: number[]): Promise<unknown[]>;
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

  const methods = ['from', 'leftJoin', 'innerJoin', 'where', 'groupBy', 'having', 'orderBy', 'limit', 'offset', '$dynamic', 'as'] as const;
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }

  chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);

  return chain;
}

function makeDb(selectQueue: unknown[] = [], distinctOnQueue: unknown[] = []) {
  const queue = [...selectQueue];
  const distinctQueue = [...distinctOnQueue];

  return {
    select: vi.fn((fields?: Record<string, unknown>) => makeChain(queue.shift() ?? [], fields)),
    selectDistinctOn: vi.fn((_on: unknown, fields?: Record<string, unknown>) => makeChain(distinctQueue.shift() ?? [], fields)),
  };
}

const dialect = new PgDialect();

function renderSql(fragment: unknown): { sql: string; params: unknown[] } {
  const value = fragment && typeof fragment === 'object' && 'getSQL' in fragment ? (fragment as { getSQL(): SQL }).getSQL() : (fragment as SQL);
  return dialect.sqlToQuery(value);
}

type ChainMock = Record<string, ReturnType<typeof vi.fn>>;

function selectChains(db: ReturnType<typeof makeDb>): ChainMock[] {
  return db.select.mock.results.map((result) => result.value as ChainMock);
}

function selectFields(db: ReturnType<typeof makeDb>, index: number): Record<string, unknown> {
  return db.select.mock.calls[index]![0] as Record<string, unknown>;
}

function orderText(chain: ChainMock): string {
  return (chain.orderBy.mock.calls[0] as unknown[]).map((clause) => renderSql(clause).sql).join(', ');
}

function makeService(selectQueue: unknown[] = [], queryBuilderOverrides: Record<string, unknown> = {}, distinctOnQueue: unknown[] = []) {
  const db = makeDb(selectQueue, distinctOnQueue);
  const queryBuilder = {
    buildWhere: vi.fn().mockReturnValue(undefined),
    ...queryBuilderOverrides,
  };
  const collectionRepository = new OpdsCollectionRepository(db as never);
  const service = new OpdsBookService(db as never, queryBuilder as never, collectionRepository);
  return { service, db, queryBuilder, collectionRepository };
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
    const superService = new OpdsBookService(superDb as never, {} as never, new OpdsCollectionRepository(superDb as never));
    await expect(superService.getAccessibleLibraryIds(7, true)).resolves.toEqual([1, 4]);

    const userDb = makeDb([[{ libraryId: 2 }, { libraryId: 3 }]]);
    const userService = new OpdsBookService(userDb as never, {} as never, new OpdsCollectionRepository(userDb as never));
    await expect(userService.getAccessibleLibraryIds(7, false)).resolves.toEqual([2, 3]);
  });

  it('handles getBooksPage access checks and smartScope delegation', async () => {
    const { service } = makeService([[{ userId: 999, isPublic: false }], [{ userId: 7, isPublic: false }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const privateService = testable(service);
    const smartScopeSpy = vi.spyOn(privateService, 'buildSmartScopeWhere');
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery');

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getBooksPage(7, 'recent', 1, 50)).resolves.toEqual({ entries: [], total: 0 });

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { libraryId: 2 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getBooksPage(7, 'recent', 1, 50, { collectionId: 11 })).rejects.toThrow(ForbiddenException);

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ kind: 'scope-where' });
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 5 }], total: 1 });
    await expect(service.getBooksPage(7, 'recent', 3, 25, { smartScopeId: 4 })).resolves.toEqual({ entries: [{ id: 5 }], total: 1 });
    expect(smartScopeSpy).toHaveBeenCalledWith(7, 4, [1, 2], undefined, undefined);

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce({ kind: 'scope-where' });
    paginatedSpy.mockResolvedValueOnce({ entries: [{ id: 6 }], total: 1 });
    await expect(service.getBooksPage(7, 'recent', 1, 20, { smartScopeId: 4, q: 'dune' })).resolves.toEqual({ entries: [{ id: 6 }], total: 1 });
    expect(smartScopeSpy).toHaveBeenCalledWith(7, 4, [1, 2], undefined, 'dune');

    accessSpy.mockResolvedValueOnce([1, 2]);
    smartScopeSpy.mockResolvedValueOnce(null);
    await expect(service.getBooksPage(7, 'recent', 1, 20, { smartScopeId: 4 })).resolves.toEqual({ entries: [], total: 0 });

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
    expect(paginatedSpy).toHaveBeenCalledTimes(3);
    expect(searchSpy).toHaveBeenCalledWith('arrakis');
  });

  it('pages the bulk manifest by book id and reports whether more rows follow', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    const privateService = testable(service);
    const fetchSpy = vi.spyOn(privateService, 'fetchManifestRows').mockResolvedValue([{ id: 3 }, { id: 7 }]);

    const chain = makeChain([{ id: 3 }, { id: 7 }, { id: 9 }]);
    const selectSpy = vi.spyOn(service as unknown as { db: { select: unknown } }, 'db', 'get');
    selectSpy.mockReturnValue({ select: vi.fn().mockReturnValue(chain) });

    await expect(service.getBookManifestPage(7, { afterId: 2, limit: 2 })).resolves.toEqual({
      rows: [{ id: 3 }, { id: 7 }],
      hasNext: true,
    });
    // One extra row is fetched purely to answer hasNext without a count query.
    expect(chain.limit).toHaveBeenCalledWith(3);
    expect(fetchSpy).toHaveBeenCalledWith([3, 7]);
  });

  it('returns an empty manifest page when the user can reach no library', async () => {
    const { service } = makeService();
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);

    await expect(service.getBookManifestPage(7, { limit: 50 })).resolves.toEqual({ rows: [], hasNext: false });
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

  it('handles getRandomBooks guard branches and randomized id selection', async () => {
    const { service, db } = makeService([[], [{ id: 11 }, { id: 10 }]]);
    const accessSpy = vi.spyOn(service, 'getAccessibleLibraryIds');
    const fetchSpy = vi.spyOn(testable(service), 'fetchBookEntries');

    await expect(service.getRandomBooks(7, 0)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([]);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([]);

    accessSpy.mockResolvedValueOnce([1]);
    fetchSpy.mockResolvedValueOnce([{ id: 11 }, { id: 10 }]);
    await expect(service.getRandomBooks(7, 2)).resolves.toEqual([{ id: 11 }, { id: 10 }]);
    expect(fetchSpy).toHaveBeenCalledWith([11, 10]);

    const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value as Record<string, unknown>);
    const orderBy = chains.at(-1)!['orderBy'] as ReturnType<typeof vi.fn>;
    const values = orderBy.mock.calls.flat().flatMap((arg: unknown) => collectValues(arg));
    expect(values).toContain('random()');
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

  it.each([
    { userId: 7, isPublic: false, allowed: true },
    { userId: 999, isPublic: true, allowed: true },
    { userId: 999, isPublic: false, allowed: false },
    undefined,
  ])('checks collection access for both catalog pages and counts: %j', async (collection) => {
    const { service, collectionRepository } = makeService();
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1]);
    vi.spyOn(collectionRepository, 'findById').mockResolvedValue(collection ? [collection] : []);
    const pageSpy = vi.spyOn(testable(service), 'paginatedBookQuery').mockResolvedValue({ entries: [], total: 0 });

    if (collection?.allowed) {
      await expect(service.getBooksPage(7, 'recent', 1, 20, { collectionId: 11 })).resolves.toEqual({ entries: [], total: 0 });
      await expect(service.countBooks(7, { collectionId: 11 })).resolves.toBe(0);
      expect(pageSpy).toHaveBeenCalledOnce();
    } else {
      await expect(service.getBooksPage(7, 'recent', 1, 20, { collectionId: 11 })).rejects.toThrow(ForbiddenException);
      await expect(service.countBooks(7, { collectionId: 11 })).rejects.toThrow(ForbiddenException);
      expect(pageSpy).not.toHaveBeenCalled();
    }
  });

  it('passes viewer permissions to collection counts', async () => {
    const { service, collectionRepository } = makeService();
    const filters = { ...EMPTY_CONTENT_FILTER_RULES, excludeTagIds: [12] };
    const listSpy = vi.spyOn(collectionRepository, 'findVisibleForUser').mockResolvedValue([{ id: 4, name: 'Favorites', bookCount: 1 }]);
    const countSpy = vi.spyOn(collectionRepository, 'countVisibleForUser').mockResolvedValue(3);
    await expect(service.getUserCollections(8, false, filters)).resolves.toEqual([{ id: 4, name: 'Favorites', bookCount: 1 }]);
    expect(listSpy).toHaveBeenCalledWith(8, false, filters, []);
    await expect(service.countUserCollections(8)).resolves.toBe(3);
    expect(countSpy).toHaveBeenCalledWith(8);
  });

  it('returns user smartScopes', async () => {
    const { service, db } = makeService([[{ id: 7, name: 'Unread', icon: 'sparkles' }]]);

    await expect(service.getUserSmartScopes(8)).resolves.toEqual([{ id: 7, name: 'Unread', icon: 'sparkles' }]);

    const chains = (db.select as ReturnType<typeof vi.fn>).mock.results.map((r) => r.value as Record<string, unknown>);
    const smartScopeChain = chains[0]!;
    const whereClause = (smartScopeChain.where as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(collectValues(whereClause)).toContain(8);
    expect(collectValues(whereClause)).toContain(true);
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
    const { service } = makeService([
      [],
      [{ id: 1, updatedAt: new Date('2026-01-01'), absolutePath: '/books/a.epub', format: null, title: null }],
      [],
    ]);

    await expect(service.getBookFiles(7, 42)).resolves.toBeNull();

    await expect(service.getBookFiles(7)).resolves.toEqual({
      id: 1,
      mtime: undefined,
      sizeBytes: undefined,
      ino: undefined,
      contentVersion: new Date('2026-01-01').toISOString(),
      absolutePath: '/books/a.epub',
      format: 'unknown',
      readAlong: false,
      title: 'book-7',
      authorName: '',
    });
  });

  it('serves a readable edition by default when the primary is an audiobook', async () => {
    const rows = [
      {
        id: 1,
        updatedAt: new Date('2026-01-01'),
        absolutePath: '/books/a.m4b',
        format: 'm4b',
        role: 'content',
        sizeBytes: 9,
        mediaOverlayAvailable: false,
        title: 'A',
        primaryFileId: 1,
        formatPriority: null,
      },
      {
        id: 2,
        updatedAt: new Date('2026-01-01'),
        absolutePath: '/books/a.epub',
        format: 'epub',
        role: 'content',
        sizeBytes: 9,
        mediaOverlayAvailable: true,
        title: 'A',
        primaryFileId: 1,
        formatPriority: null,
      },
    ];
    const { service } = makeService([rows, [{ name: 'Author' }], rows, [{ name: 'Author' }]]);

    await expect(service.getBookFiles(7)).resolves.toMatchObject({ absolutePath: '/books/a.epub', format: 'epub', readAlong: true });
    await expect(service.getBookFiles(7, 1)).resolves.toMatchObject({ absolutePath: '/books/a.m4b', readAlong: false });
  });

  it('applies text search inside smartScope when q is provided', async () => {
    const { service } = makeService([[{ id: 3, userId: 7, isPublic: false, filter: null }]]);
    const privateService = testable(service);
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');

    const where = await privateService.buildSmartScopeWhere(7, 3, [1], undefined, 'dune');

    expect(searchSpy).toHaveBeenCalledWith('dune');
    expect(collectValues(where)).toContain('%dune%');
  });

  it('omits text search clause inside smartScope when q is absent', async () => {
    const { service } = makeService([[{ id: 3, userId: 7, isPublic: false, filter: null }]]);
    const privateService = testable(service);
    const searchSpy = vi.spyOn(privateService, 'buildCatalogSearchClause');

    await expect(privateService.buildSmartScopeWhere(7, 3, [1])).resolves.not.toBeNull();

    expect(searchSpy).not.toHaveBeenCalled();
  });

  it('returns no smartScope books when smartScope is missing or private to another user', async () => {
    const { service } = makeService([[], [{ id: 5, userId: 99, isPublic: false, filter: null }]]);
    const privateService = testable(service);

    await expect(privateService.buildSmartScopeWhere(7, 5, [1])).resolves.toBeNull();
    await expect(privateService.buildSmartScopeWhere(7, 5, [1])).resolves.toBeNull();
  });

  it('builds smartScope filters and delegates smartScope pagination', async () => {
    const { service, queryBuilder } = makeService([[{ id: 9, userId: 7, isPublic: false, filter: { op: 'and' } }]], {
      buildWhere: vi.fn().mockReturnValue({ kind: 'where' }),
    });
    const privateService = testable(service);
    const paginatedSpy = vi.spyOn(privateService, 'paginatedBookQuery').mockResolvedValue({ entries: [{ id: 1 }], total: 1 });
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([1, 2]);

    await expect(service.getBooksPage(7, 'title_desc', 2, 10, { smartScopeId: 9 })).resolves.toEqual({ entries: [{ id: 1 }], total: 1 });
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
      [],
      [
        { id: 1, name: 'Dune', expectedCount: null, letter: 'D', bookCount: 6, readingCount: 0, finishedCount: 0 },
        { id: 2, name: 'World of Warcraft', expectedCount: null, letter: 'W', bookCount: 9, readingCount: 0, finishedCount: 0 },
      ],
      [{ key: 'D', index: 0, count: 2 }],
    ]);
    vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

    await expect(service.getDistinctSeriesPage(7, { q: 'war', limit: 1, offset: 0 })).resolves.toEqual({
      items: [
        {
          id: 1,
          name: 'Dune',
          expectedCount: null,
          letter: 'D',
          bookCount: 6,
          readingCount: 0,
          finishedCount: 0,
          authorNames: [],
          memberStates: [],
          previews: [],
        },
      ],
      hasNext: true,
      total: 2,
      buckets: [{ key: 'D', index: 0 }],
    });

    const chain = selectChains(db)[1]!;
    expect(chain.from).toHaveBeenCalledWith(bookSeries);
    expect(chain.innerJoin).toHaveBeenCalledWith(bookSeriesMemberships, expect.anything());
    expect(collectValues(chain.where.mock.calls[0]?.[0])).toEqual(expect.arrayContaining([1, '%war%']));
    expect(orderText(chain)).toBe('"book_series"."name" ASC, "book_series"."id" ASC');
  });

  describe('catalog list pages', () => {
    const at = new Date('2026-04-15T00:00:00.000Z');

    function authorPage(rows: unknown[], summary: unknown[] = [], previews: unknown[] = [], seriesNames: unknown[] = []) {
      return makeService([[], rows, summary, [], previews], {}, [seriesNames]);
    }

    it('orders authors by the sort name, falling back to the display name, then name and id so offsets are stable', async () => {
      const { service, db } = authorPage([]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      await service.getDistinctAuthorsPage(7, { limit: 12, offset: 24 });

      const page = selectChains(db)[1]!;
      expect(orderText(page)).toBe(
        'lower(public.bookorbit_unaccent(btrim(COALESCE(NULLIF(BTRIM("authors"."sort_name"), \'\'), "authors"."name")))) ASC, "authors"."name" ASC, "authors"."id" ASC',
      );
      expect(page.groupBy).toHaveBeenCalledWith(authors.id);
      expect(page.limit).toHaveBeenCalledWith(13);
      expect(page.offset).toHaveBeenCalledWith(24);
    });

    it.each([
      [
        'name_desc',
        'lower(public.bookorbit_unaccent(btrim(COALESCE(NULLIF(BTRIM("authors"."sort_name"), \'\'), "authors"."name")))) DESC, "authors"."name" DESC, "authors"."id" ASC',
      ],
      [
        'books',
        'count(DISTINCT "books"."id") DESC, lower(public.bookorbit_unaccent(btrim(COALESCE(NULLIF(BTRIM("authors"."sort_name"), \'\'), "authors"."name")))) ASC, "authors"."name" ASC, "authors"."id" ASC',
      ],
    ] as const)('orders authors for sort=%s', async (sort, expected) => {
      const { service, db } = authorPage([]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      await service.getDistinctAuthorsPage(7, { limit: 12, offset: 0, sort });

      expect(orderText(selectChains(db)[1]!)).toBe(expected);
    });

    it('numbers the jump buckets with the same order the page uses and keys them by the same letter as each row', async () => {
      const { service, db } = authorPage([]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      await service.getDistinctAuthorsPage(7, { limit: 12, offset: 0, sort: 'name_desc' });

      const ranked = selectFields(db, 0) as { letter: { getSQL(): SQL }; rn: { getSQL(): SQL } };
      const pageFields = selectFields(db, 1) as { letter: SQL };
      const pageOrder = orderText(selectChains(db)[1]!);
      expect(renderSql(ranked.rn).sql).toContain(`row_number() OVER (ORDER BY ${pageOrder})`);
      expect(renderSql(ranked.letter).sql).toBe(renderSql(pageFields.letter).sql);
      expect(renderSql(pageFields.letter).sql).toContain("~ '^[A-Z]$'");
      expect(renderSql(pageFields.letter).sql).toContain('public.bookorbit_unaccent');
    });

    it('limits the reading and finished filters to authors with a book in that bucket', async () => {
      for (const [filter, statuses] of [
        ['reading', ['reading', 'rereading', 'on_hold']],
        ['finished', ['read', 'skimmed', 'abandoned']],
      ] as const) {
        const { service, db } = authorPage([]);
        vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

        await service.getDistinctAuthorsPage(7, { limit: 12, offset: 0, filter });

        const having = renderSql(selectChains(db)[1]!.having.mock.calls[0]![0]);
        expect(having.sql).toMatch(/^count\(DISTINCT "books"."id"\) FILTER \(WHERE "user_book_status"."status" IN \(\$\d+, \$\d+, \$\d+\)\) > 0$/);
        expect(having.params).toEqual([...statuses]);
        // The count query numbers the same filtered rows.
        expect(selectChains(db)[0]!.having.mock.calls[0]![0]).toBe(selectChains(db)[1]!.having.mock.calls[0]![0]);
      }
    });

    it('attaches the top series and preview books to each author and sums the bucket counts into the total', async () => {
      const { service } = authorPage(
        [
          { id: 1, name: 'Frank Herbert', hasPhoto: true, letter: 'H', bookCount: 3, readingCount: 1, finishedCount: 1 },
          { id: 2, name: 'Iain Banks', hasPhoto: false, letter: 'B', bookCount: 1, readingCount: 0, finishedCount: 0 },
          { id: 3, name: 'next page', hasPhoto: false, letter: 'N', bookCount: 1, readingCount: 0, finishedCount: 0 },
        ],
        [
          { key: 'B', index: 0, count: 4 },
          { key: 'H', index: 4, count: 2 },
        ],
        [
          { groupId: 1, id: 10, title: 'Dune', folderPath: '/lib/dune', coverSource: 'extracted', seriesIndex: '1', addedAt: at, updatedAt: at },
          { groupId: 1, id: 11, title: null, folderPath: '/lib/Dune Messiah', coverSource: null, seriesIndex: null, addedAt: at, updatedAt: at },
        ],
        [{ authorId: 1, name: 'Dune' }],
      );
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      const result = await service.getDistinctAuthorsPage(7, { limit: 2, offset: 0 });

      expect(result.hasNext).toBe(true);
      expect(result.total).toBe(6);
      expect(result.buckets).toEqual([
        { key: 'B', index: 0 },
        { key: 'H', index: 4 },
      ]);
      expect(result.items).toEqual([
        expect.objectContaining({
          id: 1,
          seriesName: 'Dune',
          previews: [
            { id: 10, title: 'Dune', hasCover: true, seriesIndex: '1', addedAt: at, updatedAt: at },
            { id: 11, title: 'Dune Messiah', hasCover: false, seriesIndex: null, addedAt: at, updatedAt: at },
          ],
        }),
        expect.objectContaining({ id: 2, seriesName: null, previews: [] }),
      ]);
    });

    it('ranks author previews in progress first, then finished, then newest, three per author in one query', async () => {
      const { service, db } = authorPage([
        { id: 1, name: 'Frank Herbert', hasPhoto: false, letter: 'H', bookCount: 9, readingCount: 0, finishedCount: 0 },
      ]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      await service.getDistinctAuthorsPage(7, { limit: 12, offset: 0 });

      const ranked = selectFields(db, 3) as { rn: { getSQL(): SQL } };
      const rn = renderSql(ranked.rn).sql;
      expect(rn).toContain('PARTITION BY "book_authors"."author_id"');
      expect(rn).toMatch(
        /ORDER BY CASE WHEN .* THEN 0 WHEN .* THEN 1 ELSE 2 END, CASE[\s\S]*"reading_progress"[\s\S]*"books"."added_at"[\s\S]*END DESC NULLS LAST, "books"."id" DESC/,
      );
      const outer = renderSql(selectChains(db)[4]!.where.mock.calls[0]![0]);
      expect(outer.sql).toMatch(/ <= \$2$/);
      expect(outer.params[1]).toBe(3);
    });

    it('caps series member states at forty in series order and takes the first three as previews', async () => {
      const members = Array.from({ length: 5 }, (_, index) => ({
        seriesId: 31,
        id: 100 + index,
        seriesIndex: String(index + 1),
        status: ['read', 'reading', null, 'on_hold', 'want_to_read'][index],
        title: `Book ${index + 1}`,
        folderPath: `/lib/${index}`,
        coverSource: 'extracted',
        addedAt: at,
        updatedAt: at,
        firstAuthor: ['J.K. Rowling', 'J.K. Rowling', 'Jack Thorne', 'John Tiffany', null][index],
      }));
      const { service, db } = makeService([
        [],
        [{ id: 31, name: 'Harry Potter', expectedCount: 7, letter: 'H', bookCount: 5, readingCount: 2, finishedCount: 1 }],
        [{ key: 'H', index: 0, count: 1 }],
        [],
        members,
      ]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      const result = await service.getDistinctSeriesPage(7, { limit: 12, offset: 0 });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          expectedCount: 7,
          authorNames: ['J.K. Rowling', 'Jack Thorne'],
          memberStates: ['finished', 'reading', 'unread', 'reading', 'unread'],
          previews: [
            expect.objectContaining({ id: 100, seriesIndex: '1' }),
            expect.objectContaining({ id: 101, seriesIndex: '2' }),
            expect.objectContaining({ id: 102, seriesIndex: '3' }),
          ],
        }),
      );
      const ranked = selectFields(db, 3) as { rn: { getSQL(): SQL } };
      expect(renderSql(ranked.rn).sql).toContain(
        'PARTITION BY "book_series_memberships"."series_id" ORDER BY CASE WHEN "book_series_memberships"."series_index" IS NULL',
      );
      expect(renderSql(ranked.rn).sql).toContain('"book_metadata"."title" ASC NULLS LAST, "books"."id" ASC');
      const outer = renderSql(selectChains(db)[4]!.where.mock.calls[0]![0]);
      expect(outer.sql).toMatch(/ <= \$2$/);
      expect(outer.params[1]).toBe(40);
    });

    it.each([
      [
        'reading',
        /^\(count\(DISTINCT "books"."id"\) FILTER .* > 0 OR \(count\(DISTINCT "books"."id"\) FILTER .* > 0 AND count\(DISTINCT "books"."id"\) FILTER .* < count\(DISTINCT "books"."id"\)\)\)$/,
      ],
      ['finished', /^count\(DISTINCT "books"."id"\) FILTER .* = count\(DISTINCT "books"."id"\)$/],
    ] as const)('filters series to %s', async (filter, pattern) => {
      const { service, db } = makeService();
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      await service.getDistinctSeriesPage(7, { limit: 12, offset: 0, filter });

      expect(renderSql(selectChains(db)[1]!.having.mock.calls[0]![0]).sql).toMatch(pattern);
    });

    it('returns an empty page when the reader can reach no library', async () => {
      const { service, db } = makeService();
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValue([]);

      await expect(service.getDistinctAuthorsPage(7, { limit: 12, offset: 0 })).resolves.toEqual({
        items: [],
        hasNext: false,
        total: 0,
        buckets: [],
      });
      await expect(service.getDistinctSeriesPage(7, { limit: 12, offset: 0 })).resolves.toEqual({ items: [], hasNext: false, total: 0, buckets: [] });
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('book summaries and buckets', () => {
    it('counts a scope with reading and finished buckets and takes the newest books as previews', async () => {
      const at = new Date('2026-04-15T00:00:00.000Z');
      const { service, db } = makeService([
        [{ total: 12, reading: 3, finished: 4 }],
        [{ id: 9, title: 'Dune', folderPath: '/lib/dune', coverSource: null, seriesIndex: null, addedAt: at, updatedAt: at }],
      ]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      await expect(service.summarizeBooks(7, { libraryId: 1 }, 3)).resolves.toEqual({
        total: 12,
        reading: 3,
        finished: 4,
        previews: [{ id: 9, title: 'Dune', hasCover: false, seriesIndex: null, addedAt: at, updatedAt: at }],
      });
      const [counts, previews] = selectChains(db);
      expect(collectValues(counts!.where.mock.calls[0]![0])).toEqual(expect.arrayContaining([1, 'present']));
      expect(previews!.where.mock.calls[0]![0]).toBe(counts!.where.mock.calls[0]![0]);
      expect(orderText(previews!)).toBe('"books"."added_at" DESC, "books"."id" ASC');
      expect(previews!.limit).toHaveBeenCalledWith(3);
    });

    it('skips the preview query when no previews are wanted and returns zeros for an empty scope', async () => {
      const { service, db } = makeService([[{ total: 2, reading: 0, finished: 1 }]]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]).mockResolvedValueOnce([]);

      await expect(service.summarizeBooks(7, { seriesId: 4 }, 0)).resolves.toEqual({ total: 2, reading: 0, finished: 1, previews: [] });
      expect(db.select).toHaveBeenCalledTimes(1);
      await expect(service.summarizeBooks(7, { seriesId: 4 }, 3)).resolves.toEqual({ total: 0, reading: 0, finished: 0, previews: [] });
    });

    it.each([
      ['title_asc', '"book_metadata"."title"', '"book_metadata"."title" ASC NULLS LAST, "books"."id" ASC'],
      ['title_desc', '"book_metadata"."title"', '"book_metadata"."title" DESC NULLS LAST, "books"."id" ASC'],
      [
        'author_asc',
        '"books"."primary_author_sort_name"',
        '"books"."primary_author_sort_name" ASC NULLS LAST, "book_metadata"."title" ASC NULLS LAST, "books"."id" ASC',
      ],
      [
        'author_desc',
        '"books"."primary_author_sort_name"',
        '"books"."primary_author_sort_name" DESC NULLS LAST, "book_metadata"."title" ASC NULLS LAST, "books"."id" ASC',
      ],
    ] as const)('numbers %s book buckets with the page order', async (sortOrder, key, order) => {
      const { service, db } = makeService([
        [],
        [
          { key: 'A', index: 0, count: 2 },
          { key: 'B', index: 2, count: 1 },
        ],
      ]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]);

      await expect(service.getBookJumpBuckets(7, sortOrder, { libraryId: 1 })).resolves.toEqual([
        { key: 'A', index: 0 },
        { key: 'B', index: 2 },
      ]);
      const ranked = selectFields(db, 0) as { letter: { getSQL(): SQL }; rn: { getSQL(): SQL } };
      expect(renderSql(ranked.letter).sql).toContain(`btrim(${key})`);
      expect(renderSql(ranked.rn).sql).toBe(`(row_number() OVER (ORDER BY ${order}) - 1)::int`);
      expect(orderText(selectChains(db)[1]!)).toMatch(/^min\(/);
    });

    it('sorts books by author on the primary author sort key the web uses', async () => {
      const { service, db } = makeService([[], [{ total: 0 }]]);

      await testable(service).paginatedBookQuery({ kind: 'where' }, 'author_asc', 1, 25, 7);

      const page = selectChains(db)[0]!;
      expect(orderText(page)).toBe('"books"."primary_author_sort_name" ASC NULLS LAST, "book_metadata"."title" ASC NULLS LAST, "books"."id" ASC');
      expect(page.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('findVisibleAuthor', () => {
    it('finds an author only through a present book in a reachable library', async () => {
      const row = { id: 134, name: 'J.K. Rowling', description: null, birthYear: 1965, deathYear: null, hasPhoto: true };
      const { service, db } = makeService([[], [row]]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1, 2]);

      await expect(service.findVisibleAuthor(7, { id: 134 }, false, EMPTY_CONTENT_FILTER_RULES)).resolves.toEqual(row);

      const visibleBook = selectChains(db)[0]!;
      expect(collectValues(visibleBook.where.mock.calls[0]![0])).toEqual(expect.arrayContaining([1, 2, 'present']));
      const where = renderSql(selectChains(db)[1]!.where.mock.calls[0]![0]);
      expect(where.sql).toMatch(/^\("authors"."id" = \$1 and exists \(/);
      expect(where.params[0]).toBe(134);
    });

    it('looks an author up by exact name and returns null when nothing is visible', async () => {
      const { service, db } = makeService([[], []]);
      vi.spyOn(service, 'getAccessibleLibraryIds').mockResolvedValueOnce([1]).mockResolvedValueOnce([]);

      await expect(service.findVisibleAuthor(7, { name: 'Nobody' })).resolves.toBeNull();
      expect(renderSql(selectChains(db)[1]!.where.mock.calls[0]![0]).params[0]).toBe('Nobody');
      await expect(service.findVisibleAuthor(7, { id: 1 })).resolves.toBeNull();
      expect(db.select).toHaveBeenCalledTimes(2);
    });
  });

  it('maps read statuses onto the reading, finished and unread buckets the read-status filter uses', () => {
    expect(['reading', 'rereading', 'on_hold'].map(readStatusBucket)).toEqual(['reading', 'reading', 'reading']);
    expect(['read', 'skimmed', 'abandoned'].map(readStatusBucket)).toEqual(['finished', 'finished', 'finished']);
    expect(['unread', 'want_to_read', null, undefined].map(readStatusBucket)).toEqual(['unread', 'unread', 'unread', 'unread']);
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
      'last_read',
      'last_read_asc',
      'title_asc',
      'title_desc',
      'author_asc',
      'author_desc',
      'published_asc',
      'published_desc',
      'series_asc',
      'series_desc',
    ] as const;

    for (const sortOrder of sortOrders) {
      // last_read builds its aggregate subquery first.
      const { service, db } = makeService(sortOrder.startsWith('last_read') ? [[], [], [{ total: 0 }]] : [[], [{ total: 0 }]]);
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

  it('sorts last_read by when this reader last opened each book, joined as one aggregate', async () => {
    const { service, db } = makeService([[], [], [{ total: 0 }]]);
    await testable(service).paginatedBookQuery({ kind: 'where' }, 'last_read', 1, 25, 7);

    const [aggregate, ids] = selectChains(db);
    expect(Object.keys(selectFields(db, 0))).toEqual(['bookId', 'lastReadAt']);
    expect(aggregate.groupBy).toHaveBeenCalledTimes(1);
    expect(collectValues(aggregate.where.mock.calls[0])).toContain(7);
    // Metadata, the reader's status and the aggregate.
    expect(ids.leftJoin).toHaveBeenCalledTimes(3);
    expect(orderText(ids)).toMatch(/DESC NULLS LAST, "user_book_status"."updated_at" DESC NULLS LAST, "books"."id" ASC$/);
  });

  it.each([
    ['published_asc', 'ASC'],
    ['published_desc', 'DESC'],
  ] as const)('sorts %s by full date, then year fallback, with undated books last and stable ties', async (sortOrder, direction) => {
    const { service, db } = makeService([[], [{ total: 0 }]]);

    await testable(service).paginatedBookQuery({ kind: 'where' }, sortOrder, 1, 25, 7);

    expect(orderText(selectChains(db)[0]!)).toBe(
      `coalesce("book_metadata"."published_date", make_date("book_metadata"."published_year", 1, 1)) ${direction} NULLS LAST, "book_metadata"."title" ASC NULLS LAST, "books"."id" ASC`,
    );
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
          seriesIndex: '1',
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
        { bookId: 1, id: 10, format: 'epub', role: 'content', contentVersion: new Date('2026-01-01') },
        { bookId: 1, id: 11, format: 'mobi', role: 'content', contentVersion: new Date('2026-01-01') },
        { bookId: 1, id: 12, format: 'jpg', role: 'cover', contentVersion: new Date('2026-01-01') },
        { bookId: 2, id: 20, format: null, role: 'content', contentVersion: new Date('2026-01-01') },
      ],
    ]);

    await expect(testable(service).fetchBookEntries([1, 2])).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        title: 'First',
        seriesId: 42,
        hasCover: true,
        authors: ['Author One'],
        files: [expect.objectContaining({ id: 10, format: 'epub' }), expect.objectContaining({ id: 11, format: 'mobi' })],
      }),
      expect.objectContaining({
        id: 2,
        title: 'second',
        hasCover: false,
        authors: ['Author Two'],
        files: [expect.objectContaining({ id: 20, format: 'unknown' })],
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
          seriesIndex: '1',
          language: 'en',
          publisher: null,
          isbn13: null,
          coverSource: null,
        },
      ],
      [{ bookId: 1, name: 'Author One' }],
      [{ bookId: 1, id: 10, format: 'epub', role: 'content', contentVersion: new Date('2026-01-01') }],
      [{ bookId: 1, seriesId: 42, seriesName: 'Secondary Arc', seriesIndex: '3' }],
    ]);

    await expect(testable(service).fetchBookEntries([1], { contextSeries: { seriesId: 42 } })).resolves.toEqual([
      expect.objectContaining({
        id: 1,
        seriesId: 42,
        seriesName: 'Secondary Arc',
        seriesIndex: '3',
      }),
    ]);
  });
});
