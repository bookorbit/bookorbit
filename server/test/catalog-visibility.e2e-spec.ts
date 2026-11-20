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
  let accessibleLibrary!: CreatedLibrary;
  let inaccessibleLibrary!: CreatedLibrary;
  let orphanGenreId!: number;

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

    accessibleLibrary = await createLibraryWithFolder(ctx, { name: `${queryToken} Accessible Library` });
    inaccessibleLibrary = await createLibraryWithFolder(ctx, { name: `${queryToken} Inaccessible Library` });

    visible = await seedCatalogBook(ctx, accessibleLibrary, queryToken, 'Visible');
    contentFiltered = await seedCatalogBook(ctx, accessibleLibrary, queryToken, 'Filtered');
    hiddenLibrary = await seedCatalogBook(ctx, inaccessibleLibrary, queryToken, 'Hidden');

    const [orphanGenre] = await ctx.db
      .insert(schema.genres)
      .values({ name: `${queryToken} Orphan Genre` })
      .returning({ id: schema.genres.id });
    orphanGenreId = orphanGenre!.id;
    await Promise.all([
      ctx.db.insert(schema.authors).values({ name: `${queryToken} Orphan Author` }),
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

  it('returns current visible book counts when creating and updating a smart scope', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/smart-scopes',
      headers: authHeader(scopedReader.accessToken),
      payload: {
        name: `${queryToken} Scope`,
        icon: 'Aperture',
        defaultSort: [],
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: queryToken }] },
      },
    });
    expect(created.statusCode).toBe(201);
    const scope = created.json() as { id: number; bookCount: number };
    expect(scope.bookCount).toBe(1);

    const updated = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/smart-scopes/${scope.id}`,
      headers: authHeader(scopedReader.accessToken),
      payload: {
        filter: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: `${queryToken} Filtered` }] },
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toEqual(expect.objectContaining({ id: scope.id, bookCount: 0 }));

    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/smart-scopes/${scope.id}`,
      headers: authHeader(scopedReader.accessToken),
      payload: { filter: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual(expect.objectContaining({ id: scope.id, filter: null, bookCount: 0 }));
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

  describe('genre and tag pages', () => {
    const KINDS = [
      ['genres', 'genreId'],
      ['tags', 'tagId'],
    ] as const;

    function get(url: string, token: string) {
      return ctx.app.inject({ method: 'GET', url, headers: authHeader(token) });
    }

    function queryBooks(segment: string, id: number, token: string, libraryId?: number) {
      return ctx.app.inject({
        method: 'POST',
        url: `/api/v1/${segment}/${id}/books/query${libraryId ? `?libraryId=${libraryId}` : ''}`,
        headers: authHeader(token),
        payload: { pagination: { page: 0, size: 50 } },
      });
    }

    async function indexNames(
      segment: string,
      token: string,
      q: string,
    ): Promise<{ total: number; items: Array<{ name: string; bookCount: number }> }> {
      const response = await get(`/api/v1/${segment}?q=${encodeURIComponent(q)}&sort=name&order=asc`, token);
      expect(response.statusCode).toBe(200);
      return response.json() as { total: number; items: Array<{ name: string; bookCount: number }> };
    }

    it.each(KINDS)('lists %s with books the reader can see, counted over those books', async (segment) => {
      const scoped = await indexNames(segment, scopedReader.accessToken, `${queryToken} Visible`);
      expect(scoped).toEqual(expect.objectContaining({ total: 1, items: [expect.objectContaining({ name: visible.names[segment], bookCount: 1 })] }));

      await expect(indexNames(segment, scopedReader.accessToken, `${queryToken} Filtered`)).resolves.toEqual(
        expect.objectContaining({ total: 0, items: [] }),
      );
      await expect(indexNames(segment, scopedReader.accessToken, `${queryToken} Hidden`)).resolves.toEqual(
        expect.objectContaining({ total: 0, items: [] }),
      );
      await expect(indexNames(segment, noLibraryReader.accessToken, queryToken)).resolves.toEqual(expect.objectContaining({ total: 0, items: [] }));

      const all = await indexNames(segment, superuser.accessToken, `${queryToken} Hidden`);
      expect(all.items.map(({ name }) => name)).toEqual([hiddenLibrary.names[segment]]);
    });

    it.each(KINDS)('opens a %s page only when a visible book carries the name', async (segment, idKey) => {
      const page = await get(`/api/v1/${segment}/${visible[idKey]}`, scopedReader.accessToken);
      expect(page.statusCode).toBe(200);
      expect(page.json()).toEqual({
        id: visible[idKey],
        kind: segment === 'genres' ? 'genre' : 'tag',
        name: visible.names[segment],
        bookCount: 1,
        libraries: [{ id: accessibleLibrary.libraryId, name: `${queryToken} Accessible Library`, bookCount: 1 }],
      });

      for (const hidden of [contentFiltered[idKey], hiddenLibrary[idKey]]) {
        expect((await get(`/api/v1/${segment}/${hidden}`, scopedReader.accessToken)).statusCode).toBe(404);
        expect((await get(`/api/v1/${segment}/${hidden}/similar`, scopedReader.accessToken)).statusCode).toBe(404);
      }
      expect((await get(`/api/v1/${segment}/${visible[idKey]}`, noLibraryReader.accessToken)).statusCode).toBe(404);
      expect((await get(`/api/v1/${segment}/${hiddenLibrary[idKey]}`, superuser.accessToken)).statusCode).toBe(200);
    });

    it('treats a genre no book carries as missing', async () => {
      expect((await get(`/api/v1/genres/${orphanGenreId}`, superuser.accessToken)).statusCode).toBe(404);
      expect((await get(`/api/v1/genres/${orphanGenreId}/similar`, superuser.accessToken)).statusCode).toBe(404);
    });

    it.each(KINDS)('lists only visible books on a %s page, narrowed to a library on request', async (segment, idKey) => {
      const scoped = await queryBooks(segment, visible[idKey], scopedReader.accessToken);
      expect(scoped.statusCode).toBe(201);
      expect((scoped.json() as { items: Array<{ id: number }> }).items.map(({ id }) => id)).toEqual([visible.bookId]);

      const narrowed = await queryBooks(segment, visible[idKey], scopedReader.accessToken, accessibleLibrary.libraryId);
      expect((narrowed.json() as { total: number }).total).toBe(1);

      for (const response of [
        await queryBooks(segment, visible[idKey], scopedReader.accessToken, inaccessibleLibrary.libraryId),
        await queryBooks(segment, contentFiltered[idKey], scopedReader.accessToken),
        await queryBooks(segment, hiddenLibrary[idKey], scopedReader.accessToken),
      ]) {
        expect(response.statusCode).toBe(201);
        expect(response.json()).toEqual(expect.objectContaining({ items: [], total: 0 }));
      }

      const superuserBooks = await queryBooks(segment, hiddenLibrary[idKey], superuser.accessToken);
      expect((superuserBooks.json() as { items: Array<{ id: number }> }).items.map(({ id }) => id)).toEqual([hiddenLibrary.bookId]);
    });

    it('sends genre and tag ids beside the names on book detail', async () => {
      const response = await get(`/api/v1/books/${visible.bookId}`, scopedReader.accessToken);
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        genres: string[];
        tags: string[];
        genreRefs: Array<{ id: number; name: string }>;
        tagRefs: Array<{ id: number; name: string }>;
      };

      expect(body.genreRefs).toContainEqual({ id: visible.genreId, name: visible.names.genres });
      expect(body.tagRefs).toContainEqual({ id: visible.tagId, name: visible.names.tags });
      expect(body.genreRefs.map(({ name }) => name)).toEqual(body.genres);
      expect(body.tagRefs.map(({ name }) => name)).toEqual(body.tags);
    });

    it('counts visible genres for the sidebar', async () => {
      const none = await get('/api/v1/browse-counts', noLibraryReader.accessToken);
      expect(none.statusCode).toBe(200);
      expect((none.json() as { genres?: number }).genres).toBe(0);

      const scoped = await get('/api/v1/browse-counts', scopedReader.accessToken);
      expect((scoped.json() as { genres?: number }).genres).toBeGreaterThanOrEqual(1);
    });

    it.each(['/api/v1/genres', '/api/v1/tags', `/api/v1/genres/1`])('requires authentication for %s', async (url) => {
      expect((await ctx.app.inject({ method: 'GET', url })).statusCode).toBe(401);
    });
  });

  it('still requires authentication', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/metadata/tags?q=${encodeURIComponent(queryToken)}`,
    });

    expect(response.statusCode).toBe(401);
  });
});
