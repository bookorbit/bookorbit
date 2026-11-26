import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';

import type { BooksPage, GroupRule, Rule, SeriesPage, SmartScope } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  type AuthorizationMatrixE2EContext,
  type CreatedLibrary,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 60_000;

const HAS_GAPS: Rule = { type: 'rule', field: 'seriesStatus', operator: 'hasGaps' };

function group(...rules: Rule[]): GroupRule {
  return { type: 'group', join: 'AND', rules };
}

/**
 * The `seriesStatus` `hasGaps` filter must keep exactly the books of the series the Series page
 * lists under Gaps, for whoever asks: a volume in a library the asker cannot see neither fills a
 * gap nor reveals one, and a library view judges a series on that library alone.
 */
describe('Series gaps book filter (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let shelf!: CreatedLibrary;
  let vault!: CreatedLibrary;
  let reader!: TestUserSession;
  let admin!: TestUserSession;

  const seriesIds = { gapped: 0, complete: 0, split: 0, shortOfTotal: 0, lone: 0 };
  const booksBySeries = new Map<number, number[]>();
  let gappedFirst = 0;
  let splitMiddle = 0;

  let inoSequence = 950_000;

  async function createSeries(name: string, expectedBookCount: number | null = null): Promise<number> {
    const [series] = await ctx.db
      .insert(schema.bookSeries)
      .values({ name, normalizedName: `${name.toLowerCase()} ${randomUUID()}`, expectedBookCount })
      .returning({ id: schema.bookSeries.id });
    booksBySeries.set(series!.id, []);
    return series!.id;
  }

  async function seedBook(library: CreatedLibrary, seriesId: number, title: string, seriesIndex: string | null): Promise<number> {
    const slug = `${title.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}`;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({
        libraryId: library.libraryId,
        libraryFolderId: library.libraryFolderId,
        folderPath: `${library.folderPath}/${slug}`,
        status: 'present',
      })
      .returning({ id: schema.books.id });
    const bookId = book!.id;

    await ctx.db.insert(schema.bookMetadata).values({ bookId, title });
    inoSequence += 1;
    const [file] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId,
        libraryFolderId: library.libraryFolderId,
        absolutePath: `${library.folderPath}/${slug}/${slug}.epub`,
        relPath: `${slug}/${slug}.epub`,
        ino: BigInt(inoSequence),
        sizeBytes: 2048,
        format: 'epub',
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: file!.id }).where(eq(schema.books.id, bookId));
    await ctx.db.insert(schema.bookSeriesMemberships).values({ bookId, seriesId, seriesIndex });

    booksBySeries.get(seriesId)!.push(bookId);
    return bookId;
  }

  async function post<T>(token: string, url: string, payload: Record<string, unknown>): Promise<T> {
    const response = await ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: authHeader(token), payload });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as T;
  }

  async function get<T>(token: string, url: string): Promise<T> {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: authHeader(token) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as T;
  }

  async function filteredBookIds(token: string, filter: GroupRule, libraryId?: number): Promise<number[]> {
    const url = libraryId === undefined ? '/books/query' : `/libraries/${libraryId}/books`;
    const page = await post<BooksPage>(token, url, { filter, pagination: { page: 0, size: 100 } });
    return page.items.map((item) => item.id).sort((a, b) => a - b);
  }

  async function gapsTabSeriesIds(token: string, libraryId?: number): Promise<number[]> {
    const library = libraryId === undefined ? '' : `&libraryId=${libraryId}`;
    const page = await get<SeriesPage>(token, `/series?completionStatus=has_gaps&size=100${library}`);
    return page.items.map((item) => item.id).sort((a, b) => a - b);
  }

  function booksOf(...ids: number[]): number[] {
    return ids.flatMap((id) => booksBySeries.get(id) ?? []).sort((a, b) => a - b);
  }

  /** Every series a matched book belongs to, in the same id order the Gaps tab is compared in. */
  function seriesOfBooks(bookIds: number[]): number[] {
    const matched = new Set(bookIds);
    return [...booksBySeries.entries()]
      .filter(([, members]) => members.some((bookId) => matched.has(bookId)))
      .map(([seriesId]) => seriesId)
      .sort((a, b) => a - b);
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    shelf = await createLibraryWithFolder(ctx, { name: `series-gaps-shelf-${randomUUID()}` });
    vault = await createLibraryWithFolder(ctx, { name: `series-gaps-vault-${randomUUID()}` });

    reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, shelf.libraryId);
    admin = await createUserAndLogin(ctx, { isSuperuser: true });

    seriesIds.gapped = await createSeries('Gapped');
    gappedFirst = await seedBook(shelf, seriesIds.gapped, 'Gapped 1', '1');
    await seedBook(shelf, seriesIds.gapped, 'Gapped 3', '3');

    seriesIds.complete = await createSeries('Complete');
    for (const index of ['1', '2', '3']) await seedBook(shelf, seriesIds.complete, `Complete ${index}`, index);

    seriesIds.split = await createSeries('Split');
    await seedBook(shelf, seriesIds.split, 'Split 1', '1');
    splitMiddle = await seedBook(vault, seriesIds.split, 'Split 2', '2');
    await seedBook(shelf, seriesIds.split, 'Split 3', '3');

    seriesIds.shortOfTotal = await createSeries('Short of total', 4);
    for (const index of ['1', '2', '3']) await seedBook(shelf, seriesIds.shortOfTotal, `Short ${index}`, index);

    seriesIds.lone = await createSeries('Lone');
    await seedBook(shelf, seriesIds.lone, 'Lone 2', '2');
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('keeps the books of the series the Gaps tab lists, judged on the libraries the reader can see', async () => {
    const bookIds = await filteredBookIds(reader.accessToken, group(HAS_GAPS));
    const expected = booksOf(seriesIds.gapped, seriesIds.split, seriesIds.shortOfTotal).filter((id) => id !== splitMiddle);

    expect(bookIds).toEqual(expected);
    expect(seriesOfBooks(bookIds)).toEqual(await gapsTabSeriesIds(reader.accessToken));
  });

  it('lets a volume the asker can see fill the gap', async () => {
    const bookIds = await filteredBookIds(admin.accessToken, group(HAS_GAPS));

    expect(bookIds).toEqual(booksOf(seriesIds.gapped, seriesIds.shortOfTotal));
    expect(seriesOfBooks(bookIds)).toEqual(await gapsTabSeriesIds(admin.accessToken));
  });

  it('judges a series on the library being browsed, as the Series page does for that library', async () => {
    const bookIds = await filteredBookIds(admin.accessToken, group(HAS_GAPS), shelf.libraryId);
    const expected = booksOf(seriesIds.gapped, seriesIds.split, seriesIds.shortOfTotal).filter((id) => id !== splitMiddle);

    expect(bookIds).toEqual(expected);
    expect(seriesOfBooks(bookIds)).toEqual(await gapsTabSeriesIds(admin.accessToken, shelf.libraryId));
  });

  it('judges the gap on the whole series, not on the books the rest of the filter keeps', async () => {
    const bookIds = await filteredBookIds(reader.accessToken, group({ type: 'rule', field: 'title', operator: 'eq', value: 'Gapped 1' }, HAS_GAPS));

    expect(bookIds).toEqual([gappedFirst]);
  });

  it('runs inside a saved smart scope and counts the same books', async () => {
    const scope = await post<SmartScope>(reader.accessToken, '/smart-scopes', {
      name: `Incomplete series ${randomUUID()}`,
      icon: 'library',
      filter: group(HAS_GAPS),
      defaultSort: [{ field: 'title', dir: 'asc' }],
    });
    const expected = await filteredBookIds(reader.accessToken, group(HAS_GAPS));

    const page = await post<BooksPage>(reader.accessToken, `/smart-scopes/${scope.id}/books/query`, { pagination: { page: 0, size: 100 } });
    expect(page.items.map((item) => item.id).sort((a, b) => a - b)).toEqual(expected);

    const scopes = await get<SmartScope[]>(reader.accessToken, '/smart-scopes');
    expect(scopes.find((item) => item.id === scope.id)?.bookCount).toBe(expected.length);
  });

  it('rejects hasGaps on a field that does not offer it', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/books/query',
      headers: authHeader(reader.accessToken),
      payload: { filter: group({ type: 'rule', field: 'lockStatus', operator: 'hasGaps' }), pagination: { page: 0, size: 10 } },
    });

    expect(response.statusCode).toBe(400);
  });
});
