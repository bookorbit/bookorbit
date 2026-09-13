import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';

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

interface SeededBook {
  bookId: number;
  fileIdsByFormat: Map<string, number>;
}

let inoSequence = 900_000;

async function seedBook(
  ctx: AuthorizationMatrixE2EContext,
  library: CreatedLibrary,
  seriesId: number,
  options: {
    title: string;
    seriesIndex: string | null;
    formats: string[];
    status?: 'present' | 'missing';
    primaryFormat?: string;
  },
): Promise<SeededBook> {
  const slug = `${options.title.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}`;

  const [book] = await ctx.db
    .insert(schema.books)
    .values({
      libraryId: library.libraryId,
      libraryFolderId: library.libraryFolderId,
      folderPath: `${library.folderPath}/${slug}`,
      status: options.status ?? 'present',
    })
    .returning({ id: schema.books.id });

  const bookId = book!.id;

  await ctx.db.insert(schema.bookMetadata).values({ bookId, title: options.title });

  const fileIdsByFormat = new Map<string, number>();
  for (const format of options.formats) {
    inoSequence += 1;
    const [file] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId,
        libraryFolderId: library.libraryFolderId,
        absolutePath: `${library.folderPath}/${slug}/${slug}.${format}`,
        relPath: `${slug}/${slug}.${format}`,
        ino: BigInt(inoSequence),
        sizeBytes: 2048,
        format,
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });
    fileIdsByFormat.set(format, file!.id);
  }

  const primaryFormat = options.primaryFormat ?? options.formats[0];
  const primaryFileId = primaryFormat ? fileIdsByFormat.get(primaryFormat) : undefined;
  if (primaryFileId) {
    await ctx.db.update(schema.books).set({ primaryFileId }).where(eq(schema.books.id, bookId));
  }

  await ctx.db.insert(schema.bookSeriesMemberships).values({ bookId, seriesId, seriesIndex: options.seriesIndex });

  return { bookId, fileIdsByFormat };
}

describe('Series next readable book (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let reader!: TestUserSession;
  let seriesId!: number;
  let otherSeriesId!: number;

  let issue1!: SeededBook;
  let issue2Epub!: SeededBook;
  let issue9!: SeededBook;
  let issue10!: SeededBook;
  let unnumbered!: SeededBook;

  async function requestNext(bookId: number, options: { formatGroup?: string; series?: number; token?: string } = {}) {
    const query = options.formatGroup ? `?formatGroup=${options.formatGroup}` : '';
    return ctx.app.inject({
      method: 'GET',
      url: `/api/v1/series/${options.series ?? seriesId}/books/${bookId}/next${query}`,
      headers: authHeader(options.token ?? reader.accessToken),
    });
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();

    const library = await createLibraryWithFolder(ctx, { name: `series-next-${randomUUID()}` });
    const hiddenLibrary = await createLibraryWithFolder(ctx, { name: `series-next-hidden-${randomUUID()}` });
    reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);

    const [series] = await ctx.db
      .insert(schema.bookSeries)
      .values({ name: 'Orbit Patrol', normalizedName: `orbit patrol ${randomUUID()}` })
      .returning({ id: schema.bookSeries.id });
    seriesId = series!.id;

    const [otherSeries] = await ctx.db
      .insert(schema.bookSeries)
      .values({ name: 'Unrelated Run', normalizedName: `unrelated run ${randomUUID()}` })
      .returning({ id: schema.bookSeries.id });
    otherSeriesId = otherSeries!.id;

    issue1 = await seedBook(ctx, library, seriesId, { title: 'Issue 1', seriesIndex: '1', formats: ['cbz'] });
    issue2Epub = await seedBook(ctx, library, seriesId, { title: 'Issue 2', seriesIndex: '2', formats: ['epub'] });
    await seedBook(ctx, library, seriesId, { title: 'Issue 3', seriesIndex: '3', formats: ['cbz'], status: 'missing' });
    issue9 = await seedBook(ctx, library, seriesId, { title: 'Issue 9', seriesIndex: '9', formats: ['cbz'] });
    issue10 = await seedBook(ctx, library, seriesId, { title: 'Issue 10', seriesIndex: '10', formats: ['cbz', 'cbr'], primaryFormat: 'cbr' });
    unnumbered = await seedBook(ctx, library, seriesId, { title: 'Annual', seriesIndex: null, formats: ['cbz'] });

    await seedBook(ctx, hiddenLibrary, seriesId, { title: 'Issue 11', seriesIndex: '11', formats: ['cbz'] });
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('skips books with no file the same reader can open and books whose files are missing', async () => {
    const response = await requestNext(issue1.bookId, { formatGroup: 'cbx' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      next: {
        bookId: issue9.bookId,
        fileId: issue9.fileIdsByFormat.get('cbz'),
        format: 'cbz',
        title: 'Issue 9',
        seriesIndex: '9',
      },
    });
  });

  it('orders issues numerically and hands back the primary file of the next book', async () => {
    const response = await requestNext(issue9.bookId, { formatGroup: 'cbx' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      next: {
        bookId: issue10.bookId,
        fileId: issue10.fileIdsByFormat.get('cbr'),
        format: 'cbr',
        title: 'Issue 10',
        seriesIndex: '10',
      },
    });
  });

  it('places unnumbered books after every numbered one', async () => {
    const response = await requestNext(issue10.bookId, { formatGroup: 'cbx' });

    expect(response.json()).toEqual({
      next: expect.objectContaining({ bookId: unnumbered.bookId, seriesIndex: null }),
    });
  });

  it('returns no next book at the end of the series, including books in libraries the user cannot see', async () => {
    const response = await requestNext(unnumbered.bookId, { formatGroup: 'cbx' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ next: null });
  });

  it('follows the requested reader format group rather than the current book format', async () => {
    const response = await requestNext(issue1.bookId, { formatGroup: 'epub' });

    expect(response.json()).toEqual({
      next: expect.objectContaining({ bookId: issue2Epub.bookId, fileId: issue2Epub.fileIdsByFormat.get('epub'), format: 'epub' }),
    });
  });

  it('returns no next book when the book is not in the requested series', async () => {
    const response = await requestNext(issue1.bookId, { formatGroup: 'cbx', series: otherSeriesId });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ next: null });
  });

  it('rejects an unknown format group', async () => {
    const response = await requestNext(issue1.bookId, { formatGroup: 'comics' });

    expect(response.statusCode).toBe(400);
  });

  it('requires authentication', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/series/${seriesId}/books/${issue1.bookId}/next`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('does not leak a series book from a library the user cannot access', async () => {
    const outsider = await createUserAndLogin(ctx);

    const response = await requestNext(issue1.bookId, { formatGroup: 'cbx', token: outsider.accessToken });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ next: null });
  });
});
