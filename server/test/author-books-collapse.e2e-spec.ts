import { randomUUID } from 'crypto';

import type { BookCard } from '@bookorbit/types';

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

let inoSequence = 960_000;

type SeededSeries = { id: number; name: string };

async function createAuthor(ctx: AuthorizationMatrixE2EContext, name: string): Promise<number> {
  const [author] = await ctx.db
    .insert(schema.authors)
    .values({ name: `${name} ${randomUUID()}` })
    .returning({ id: schema.authors.id });
  return author!.id;
}

async function createSeries(ctx: AuthorizationMatrixE2EContext, name: string): Promise<SeededSeries> {
  const [series] = await ctx.db
    .insert(schema.bookSeries)
    .values({ name, normalizedName: `${name.toLowerCase()} ${randomUUID()}` })
    .returning({ id: schema.bookSeries.id });
  return { id: series!.id, name };
}

async function seedBook(
  ctx: AuthorizationMatrixE2EContext,
  library: CreatedLibrary,
  options: { title: string; authorIds: number[]; series?: SeededSeries; seriesIndex?: string },
): Promise<number> {
  const slug = `${options.title.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}`;

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

  await ctx.db.insert(schema.bookMetadata).values({
    bookId,
    title: options.title,
    seriesId: options.series?.id ?? null,
    seriesName: options.series?.name ?? null,
    seriesIndex: options.seriesIndex ?? null,
  });

  inoSequence += 1;
  await ctx.db.insert(schema.bookFiles).values({
    bookId,
    libraryFolderId: library.libraryFolderId,
    absolutePath: `${library.folderPath}/${slug}/${slug}.epub`,
    relPath: `${slug}/${slug}.epub`,
    ino: BigInt(inoSequence),
    sizeBytes: 2048,
    format: 'epub',
    role: 'content',
  });

  for (const [displayOrder, authorId] of options.authorIds.entries()) {
    await ctx.db.insert(schema.bookAuthors).values({ bookId, authorId, displayOrder });
  }

  if (options.series) {
    await ctx.db.insert(schema.bookSeriesMemberships).values({
      bookId,
      seriesId: options.series.id,
      seriesIndex: options.seriesIndex ?? null,
    });
  }

  return bookId;
}

/**
 * Exercises the collapsed author listing against a real database, which is the only place the
 * correlated EXISTS that carries authorship into the collapsed query actually runs.
 */
describe('Author books collapsed by series (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let reader!: TestUserSession;
  let prolificAuthorId!: number;
  let otherAuthorId!: number;
  let standaloneBookId!: number;

  async function listBooks(authorId: number, query = '') {
    return ctx.app.inject({
      method: 'GET',
      url: `/api/v1/authors/${authorId}/books${query}`,
      headers: authHeader(reader.accessToken),
    });
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();

    const library = await createLibraryWithFolder(ctx, { name: `author-collapse-${randomUUID()}` });
    reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);

    prolificAuthorId = await createAuthor(ctx, 'Prolific Writer');
    otherAuthorId = await createAuthor(ctx, 'Other Writer');

    const discworld = await createSeries(ctx, 'Discworld');
    const longEarth = await createSeries(ctx, 'The Long Earth');

    // Five books over two series plus one standalone: seven rows flat, three collapsed.
    await seedBook(ctx, library, { title: 'Guards Guards', authorIds: [prolificAuthorId], series: discworld, seriesIndex: '1' });
    await seedBook(ctx, library, { title: 'Men At Arms', authorIds: [prolificAuthorId], series: discworld, seriesIndex: '2' });
    await seedBook(ctx, library, { title: 'Feet Of Clay', authorIds: [prolificAuthorId], series: discworld, seriesIndex: '3' });
    await seedBook(ctx, library, { title: 'The Long Earth', authorIds: [prolificAuthorId], series: longEarth, seriesIndex: '1' });
    await seedBook(ctx, library, { title: 'The Long War', authorIds: [prolificAuthorId], series: longEarth, seriesIndex: '2' });
    standaloneBookId = await seedBook(ctx, library, { title: 'Nation', authorIds: [prolificAuthorId] });

    // Same series, a different author: it must not be counted into the prolific author's card.
    await seedBook(ctx, library, { title: 'Foreign Volume', authorIds: [otherAuthorId], series: discworld, seriesIndex: '4' });
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('lists every book when collapsing is off', async () => {
    const response = await listBooks(prolificAuthorId);

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: BookCard[]; total: number; bookTotal: number };
    expect(body.items).toHaveLength(6);
    expect(body.total).toBe(6);
    // Flat, so the two counts say the same thing.
    expect(body.bookTotal).toBe(6);
    expect(body.items.every((item) => item.collapsedSeries === undefined)).toBe(true);
  });

  it('folds each series into one card and leaves the standalone book alone', async () => {
    const response = await listBooks(prolificAuthorId, '?collapseSeries=true');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: BookCard[]; total: number; bookTotal: number };

    expect(body.items).toHaveLength(3);
    const collapsed = body.items.filter((item) => item.collapsedSeries);
    expect(collapsed).toHaveLength(2);
    expect(collapsed.map((item) => item.collapsedSeries!.bookCount).sort()).toEqual([2, 3]);

    const standalone = body.items.find((item) => item.id === standaloneBookId);
    expect(standalone).toBeDefined();
    expect(standalone!.collapsedSeries).toBeUndefined();
  });

  it('counts rows in total and books in bookTotal', async () => {
    const response = await listBooks(prolificAuthorId, '?collapseSeries=true');

    const body = response.json() as { total: number; bookTotal: number };
    expect(body.total).toBe(3);
    expect(body.bookTotal).toBe(6);
  });

  it('counts only this author in a series shared with another writer', async () => {
    const response = await listBooks(prolificAuthorId, '?collapseSeries=true');
    const body = response.json() as { items: BookCard[] };

    const discworld = body.items.find((item) => item.seriesName === 'Discworld');
    expect(discworld).toBeDefined();
    // The fourth Discworld volume belongs to the other writer, so it stays out of this count.
    expect(discworld!.collapsedSeries!.bookCount).toBe(3);
  });

  it('keeps another author to their own books', async () => {
    const response = await listBooks(otherAuthorId, '?collapseSeries=true');

    const body = response.json() as { items: BookCard[]; total: number; bookTotal: number };
    expect(body.total).toBe(1);
    expect(body.bookTotal).toBe(1);
    expect(body.items[0]!.collapsedSeries!.bookCount).toBe(1);
  });

  it('pages over rows, so a page holds collapsed cards rather than books', async () => {
    const first = await listBooks(prolificAuthorId, '?collapseSeries=true&size=2&page=0');
    const second = await listBooks(prolificAuthorId, '?collapseSeries=true&size=2&page=1');

    const firstBody = first.json() as { items: BookCard[]; total: number };
    const secondBody = second.json() as { items: BookCard[]; total: number };

    expect(firstBody.items).toHaveLength(2);
    expect(secondBody.items).toHaveLength(1);
    expect(firstBody.total).toBe(3);
    // Walking the pages must reach the end of the list rather than looping on a book count.
    expect(firstBody.items.length + secondBody.items.length).toBe(firstBody.total);
  });
});
