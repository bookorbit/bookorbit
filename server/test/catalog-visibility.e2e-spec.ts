import { randomUUID } from 'crypto';

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

interface CatalogNames {
  authors: string;
  genres: string;
  tags: string;
  narrators: string;
  publishers: string;
  series: string;
  languages: string;
}

interface SeededCatalogBook {
  bookId: number;
  tagId: number;
  genreId: number;
  names: CatalogNames;
}

async function seedCatalogBook(
  ctx: AuthorizationMatrixE2EContext,
  library: CreatedLibrary,
  queryToken: string,
  label: string,
): Promise<SeededCatalogBook> {
  const names: CatalogNames = {
    authors: `${queryToken} ${label} Author`,
    genres: `${queryToken} ${label} Genre`,
    tags: `${queryToken} ${label} Tag`,
    narrators: `${queryToken} ${label} Narrator`,
    publishers: `${queryToken} ${label} Publisher`,
    series: `${queryToken} ${label} Series`,
    languages: `${queryToken} ${label} Language`,
  };
  const uniquePath = `${label.toLowerCase()}-${randomUUID()}`;

  const [book] = await ctx.db
    .insert(schema.books)
    .values({
      libraryId: library.libraryId,
      libraryFolderId: library.libraryFolderId,
      folderPath: `${library.folderPath}/${uniquePath}`,
      status: 'present',
    })
    .returning({ id: schema.books.id });
  const [author] = await ctx.db.insert(schema.authors).values({ name: names.authors }).returning({ id: schema.authors.id });
  const [genre] = await ctx.db.insert(schema.genres).values({ name: names.genres }).returning({ id: schema.genres.id });
  const [tag] = await ctx.db.insert(schema.tags).values({ name: names.tags }).returning({ id: schema.tags.id });
  const [narrator] = await ctx.db.insert(schema.narrators).values({ name: names.narrators }).returning({ id: schema.narrators.id });
  const [series] = await ctx.db
    .insert(schema.bookSeries)
    .values({ name: names.series, normalizedName: names.series.toLowerCase() })
    .returning({ id: schema.bookSeries.id });

  await ctx.db.insert(schema.bookMetadata).values({
    bookId: book!.id,
    title: `${queryToken} ${label} Book`,
    publisher: names.publishers,
    language: names.languages,
  });
  await Promise.all([
    ctx.db.insert(schema.bookAuthors).values({ bookId: book!.id, authorId: author!.id }),
    ctx.db.insert(schema.bookGenres).values({ bookId: book!.id, genreId: genre!.id }),
    ctx.db.insert(schema.bookTags).values({ bookId: book!.id, tagId: tag!.id }),
    ctx.db.insert(schema.bookNarrators).values({ bookId: book!.id, narratorId: narrator!.id }),
    ctx.db.insert(schema.bookSeriesMemberships).values({ bookId: book!.id, seriesId: series!.id }),
  ]);

  return { bookId: book!.id, tagId: tag!.id, genreId: genre!.id, names };
}

describe('Catalog visibility (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let scopedReader!: TestUserSession;
  let noLibraryReader!: TestUserSession;
  let superuser!: TestUserSession;
  let queryToken!: string;
  let visible!: SeededCatalogBook;
  let contentFiltered!: SeededCatalogBook;
  let hiddenLibrary!: SeededCatalogBook;

  async function search(endpoint: keyof CatalogNames, token: string, q = queryToken): Promise<Array<{ id?: number; name: string }>> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/metadata/${endpoint}?q=${encodeURIComponent(q)}`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    return response.json() as Array<{ id?: number; name: string }>;
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    queryToken = `CatalogScope${randomUUID().replaceAll('-', '').slice(0, 10)}`;

    const accessibleLibrary = await createLibraryWithFolder(ctx, { name: `${queryToken} Accessible Library` });
    const inaccessibleLibrary = await createLibraryWithFolder(ctx, { name: `${queryToken} Inaccessible Library` });

    visible = await seedCatalogBook(ctx, accessibleLibrary, queryToken, 'Visible');
    contentFiltered = await seedCatalogBook(ctx, accessibleLibrary, queryToken, 'Filtered');
    hiddenLibrary = await seedCatalogBook(ctx, inaccessibleLibrary, queryToken, 'Hidden');

    await Promise.all([
      ctx.db.insert(schema.authors).values({ name: `${queryToken} Orphan Author` }),
      ctx.db.insert(schema.genres).values({ name: `${queryToken} Orphan Genre` }),
      ctx.db.insert(schema.tags).values({ name: `${queryToken} Orphan Tag` }),
      ctx.db.insert(schema.narrators).values({ name: `${queryToken} Orphan Narrator` }),
      ctx.db.insert(schema.bookSeries).values({
        name: `${queryToken} Orphan Series`,
        normalizedName: `${queryToken} Orphan Series`.toLowerCase(),
      }),
    ]);

    scopedReader = await createUserAndLogin(ctx);
    noLibraryReader = await createUserAndLogin(ctx);
    superuser = await createUserAndLogin(ctx, { isSuperuser: true });
    await grantLibraryAccess(ctx, scopedReader.userId, accessibleLibrary.libraryId);

    await ctx.db.insert(schema.userContentFilterTags).values([
      { userId: scopedReader.userId, filterType: 'exclude', tagId: contentFiltered.tagId },
      { userId: superuser.userId, filterType: 'exclude', tagId: contentFiltered.tagId },
    ]);
  });

  afterAll(async () => {
    if (ctx) await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('returns only metadata attached to books the reader can access and that pass content filters', async () => {
    for (const endpoint of Object.keys(visible.names) as Array<keyof CatalogNames>) {
      const results = await search(endpoint, scopedReader.accessToken);
      expect(results.map(({ name }) => name)).toEqual([visible.names[endpoint]]);
    }
  });

  it('returns no suggestions when the reader cannot access a library', async () => {
    for (const endpoint of Object.keys(visible.names) as Array<keyof CatalogNames>) {
      await expect(search(endpoint, noLibraryReader.accessToken)).resolves.toEqual([]);
    }
  });

  it('lets superusers search every library while bypassing their content filters', async () => {
    for (const endpoint of Object.keys(visible.names) as Array<keyof CatalogNames>) {
      const results = await search(endpoint, superuser.accessToken);
      expect(results.map(({ name }) => name)).toEqual(
        [contentFiltered.names[endpoint], hiddenLibrary.names[endpoint], visible.names[endpoint]].sort(),
      );
    }
  });

  it.each([
    ['genres', 'Genre'],
    ['tags', 'Tag'],
  ] as const)('preserves normalized exact-match ordering for %s after visibility joins', async (endpoint, label) => {
    const exactName = `${queryToken} Exact ${label}`;
    const partialName = `A ${exactName}`;

    if (endpoint === 'genres') {
      const [exact, partial] = await ctx.db
        .insert(schema.genres)
        .values([{ name: exactName }, { name: partialName }])
        .returning({ id: schema.genres.id });
      await ctx.db.insert(schema.bookGenres).values([
        { bookId: visible.bookId, genreId: exact!.id },
        { bookId: visible.bookId, genreId: partial!.id },
      ]);
    } else {
      const [exact, partial] = await ctx.db
        .insert(schema.tags)
        .values([{ name: exactName }, { name: partialName }])
        .returning({ id: schema.tags.id });
      await ctx.db.insert(schema.bookTags).values([
        { bookId: visible.bookId, tagId: exact!.id },
        { bookId: visible.bookId, tagId: partial!.id },
      ]);
    }

    const results = await search(endpoint, scopedReader.accessToken, `  ${queryToken}\u00a0 Exact ${label}  `);
    expect(results.map(({ name }) => name)).toEqual([exactName, partialName]);
  });

  it('still requires authentication', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/metadata/tags?q=${encodeURIComponent(queryToken)}`,
    });

    expect(response.statusCode).toBe(401);
  });
});
