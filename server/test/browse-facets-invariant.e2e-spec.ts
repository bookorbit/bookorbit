import { BOOK_FORMATS, type BookFormat, type BooksPage, type GroupRule, type LibraryBookFacets, type Rule } from '@bookorbit/types';
import { eq } from 'drizzle-orm';

import { bookFiles, bookMetadata, books, userBookStatus, users } from '../src/db/schema';
import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  type MetadataWriteE2EContext,
  type TestUserSession,
} from './e2e/metadata-write/metadata-write-harness';

const SCENARIO_TIMEOUT_MS = 120_000;

type SeededStatus = 'reading' | 'read' | 'want_to_read';

type SeedSpec = {
  title: string;
  status?: 'present' | 'missing' | 'processing';
  files: Array<{ format: string; role?: 'content' | 'cover' | 'metadata' }>;
  adminStatus?: SeededStatus;
  viewerStatus?: SeededStatus;
};

// Two-format books, a missing book, a processing book (the only fb2 holder), a book with no files,
// an audiobook with two files of one format and a book carrying cover and OPF sidecars.
const SEEDS: SeedSpec[] = [
  { title: 'Dune', files: [{ format: 'epub' }], adminStatus: 'read' },
  { title: 'Dune Messiah', files: [{ format: 'epub' }, { format: 'mobi' }], adminStatus: 'reading', viewerStatus: 'read' },
  { title: 'Children of Dune', files: [{ format: 'epub' }, { format: 'mobi' }] },
  { title: 'Foundation', files: [{ format: 'pdf' }], viewerStatus: 'reading' },
  { title: 'Foundation and Empire', files: [{ format: 'pdf' }, { format: 'epub' }], adminStatus: 'read' },
  { title: 'Second Foundation', files: [{ format: 'pdf' }], adminStatus: 'want_to_read' },
  { title: 'Watchmen', files: [{ format: 'cbz' }], viewerStatus: 'read' },
  { title: 'Saga Volume One', files: [{ format: 'cbz' }, { format: 'cbr' }], adminStatus: 'reading' },
  { title: 'Project Hail Mary', files: [{ format: 'm4b' }, { format: 'epub' }] },
  { title: 'The Martian', files: [{ format: 'm4b' }], adminStatus: 'read', viewerStatus: 'want_to_read' },
  { title: 'Dune Audio Drama', files: [{ format: 'mp3' }, { format: 'mp3' }] },
  {
    title: 'Hyperion',
    files: [{ format: 'azw3' }, { format: 'jpg', role: 'cover' }, { format: 'opf', role: 'metadata' }],
    adminStatus: 'reading',
  },
  { title: 'Lost Dune Notes', status: 'missing', files: [{ format: 'epub' }, { format: 'pdf' }] },
  { title: 'Missing Watchmen', status: 'missing', files: [{ format: 'cbz' }], adminStatus: 'read' },
  { title: 'Dune Processing', status: 'processing', files: [{ format: 'epub' }, { format: 'fb2' }], adminStatus: 'reading' },
  { title: 'Bookless', files: [] },
];

const VISIBLE_SEED_COUNT = SEEDS.filter((seed) => seed.status !== 'processing').length;

function formatRule(format: string): Rule {
  return { type: 'rule', field: 'format', operator: 'includesAny', value: [format] };
}

function readStatusRule(status: string): Rule {
  return { type: 'rule', field: 'readStatus', operator: 'includesAny', value: [status] };
}

type Scenario = {
  name: string;
  filter?: GroupRule;
  q?: string;
  /** The listing filter whose total must equal the facet count for `format`. */
  formatListingFilter: (format: BookFormat) => GroupRule;
};

const SCENARIOS: Scenario[] = [
  {
    name: 'no filter',
    formatListingFilter: (format) => ({ type: 'group', join: 'AND', rules: [formatRule(format)] }),
  },
  {
    name: 'readStatus unread',
    filter: { type: 'group', join: 'AND', rules: [readStatusRule('unread')] },
    formatListingFilter: (format) => ({ type: 'group', join: 'AND', rules: [readStatusRule('unread'), formatRule(format)] }),
  },
  {
    name: 'quick search',
    q: 'dune',
    formatListingFilter: (format) => ({ type: 'group', join: 'AND', rules: [formatRule(format)] }),
  },
  {
    name: 'quick search with readStatus unread',
    q: 'dune',
    filter: { type: 'group', join: 'AND', rules: [readStatusRule('unread')] },
    formatListingFilter: (format) => ({ type: 'group', join: 'AND', rules: [readStatusRule('unread'), formatRule(format)] }),
  },
  {
    name: 'a selected format counted disjunctively',
    filter: { type: 'group', join: 'AND', rules: [formatRule('epub'), readStatusRule('unread')] },
    formatListingFilter: (format) => ({ type: 'group', join: 'AND', rules: [readStatusRule('unread'), formatRule(format)] }),
  },
  {
    name: 'an OR root, which strips nothing',
    filter: { type: 'group', join: 'OR', rules: [formatRule('pdf'), readStatusRule('read')] },
    formatListingFilter: (format) => ({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'group', join: 'OR', rules: [formatRule('pdf'), readStatusRule('read')] }, formatRule(format)],
    }),
  },
  {
    name: 'a nested format group, which stays',
    filter: { type: 'group', join: 'AND', rules: [{ type: 'group', join: 'OR', rules: [formatRule('epub'), formatRule('cbz')] }] },
    formatListingFilter: (format) => ({
      type: 'group',
      join: 'AND',
      rules: [{ type: 'group', join: 'OR', rules: [formatRule('epub'), formatRule('cbz')] }, formatRule(format)],
    }),
  },
];

describe('Browse facets invariant (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: MetadataWriteE2EContext;
  let libraryId!: number;
  let viewer!: TestUserSession;

  beforeAll(async () => {
    ctx = await createMetadataWriteE2EContext();
    const library = await createLibraryWithFolder(ctx, { name: 'browse-facets-invariant' });
    libraryId = library.libraryId;

    const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, 'metadata-write-e2e-admin')).limit(1);
    if (!admin) throw new Error('e2e admin user not found');
    viewer = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, viewer.userId, libraryId, 'viewer');

    let ino = 910_000;
    for (const [index, seed] of SEEDS.entries()) {
      const [book] = await ctx.db
        .insert(books)
        .values({
          libraryId,
          libraryFolderId: library.libraryFolderId,
          folderPath: `/seed/facets-${index}`,
          status: seed.status ?? 'present',
        })
        .returning({ id: books.id });
      const bookId = book!.id;
      await ctx.db.insert(bookMetadata).values({ bookId, title: seed.title });

      if (seed.files.length > 0) {
        const files = await ctx.db
          .insert(bookFiles)
          .values(
            seed.files.map((file, fileIndex) => ({
              bookId,
              libraryFolderId: library.libraryFolderId,
              absolutePath: `/seed/facets-${index}/file-${fileIndex}.${file.format}`,
              relPath: `facets-${index}/file-${fileIndex}.${file.format}`,
              ino: BigInt(ino++),
              format: file.format,
              role: file.role ?? 'content',
            })),
          )
          .returning({ id: bookFiles.id });
        await ctx.db.update(books).set({ primaryFileId: files[0]!.id }).where(eq(books.id, bookId));
      }

      const statusRows = [
        ...(seed.adminStatus ? [{ userId: admin.id, status: seed.adminStatus }] : []),
        ...(seed.viewerStatus ? [{ userId: viewer.userId, status: seed.viewerStatus }] : []),
      ];
      if (statusRows.length > 0) {
        await ctx.db.insert(userBookStatus).values(statusRows.map((row) => ({ ...row, bookId, source: 'manual' as const })));
      }
    }
  });

  afterAll(async () => {
    await closeMetadataWriteE2EContext(ctx);
  });

  async function fetchFacets(token: string, body: { filter?: GroupRule; q?: string }): Promise<LibraryBookFacets> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/libraries/${libraryId}/books/facets`,
      headers: authHeader(token),
      // Sort, paging, collapse and shuffle seed are accepted and must not change any count.
      payload: { ...body, sort: [{ field: 'title', dir: 'desc' }], pagination: { page: 2, size: 3 }, collapseSeries: true, randomSeed: 7 },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as LibraryBookFacets;
  }

  async function listingTotal(token: string, body: { filter?: GroupRule; q?: string }): Promise<number> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/libraries/${libraryId}/books`,
      headers: authHeader(token),
      payload: { ...body, sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 1 }, collapseSeries: false },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as BooksPage).total;
  }

  const personas = [
    { name: 'superuser admin', token: () => ctx.adminToken },
    { name: 'viewer', token: () => viewer.accessToken },
  ];

  for (const persona of personas) {
    for (const scenario of SCENARIOS) {
      it(`matches the listing for ${scenario.name} as the ${persona.name}`, async () => {
        const token = persona.token();
        const body = { ...(scenario.filter ? { filter: scenario.filter } : {}), ...(scenario.q !== undefined ? { q: scenario.q } : {}) };
        const [facets, total, libraryTotal] = await Promise.all([fetchFacets(token, body), listingTotal(token, body), listingTotal(token, {})]);

        expect(facets.total).toBe(total);
        expect(facets.libraryTotal).toBe(libraryTotal);
        expect(facets.libraryTotal).toBe(VISIBLE_SEED_COUNT);

        const formatTotals = await Promise.all(
          BOOK_FORMATS.map(async (format) => ({
            format,
            count: await listingTotal(token, {
              filter: scenario.formatListingFilter(format),
              ...(scenario.q !== undefined ? { q: scenario.q } : {}),
            }),
          })),
        );
        const expected = formatTotals.filter((facet) => facet.count > 0).sort((a, b) => b.count - a.count || a.format.localeCompare(b.format));

        expect(facets.formats).toEqual(expected);
      });
    }
  }

  it('counts every format a visible book holds, once per book, and nothing else', async () => {
    const facets = await fetchFacets(ctx.adminToken, {});
    const counts = Object.fromEntries(facets.formats.map((facet) => [facet.format, facet.count]));

    expect(counts).toEqual({ epub: 6, pdf: 4, cbz: 3, mobi: 2, m4b: 2, cbr: 1, mp3: 1, azw3: 1 });
    expect(facets.total).toBe(VISIBLE_SEED_COUNT);
    for (const facet of facets.formats) expect(BOOK_FORMATS).toContain(facet.format);
  });

  it('keeps the other formats visible while one is selected, but narrows the total', async () => {
    const filter: GroupRule = { type: 'group', join: 'AND', rules: [formatRule('epub')] };
    const [facets, epubTotal] = await Promise.all([fetchFacets(ctx.adminToken, { filter }), listingTotal(ctx.adminToken, { filter })]);

    expect(facets.total).toBe(epubTotal);
    expect(facets.total).toBe(6);
    expect(facets.formats.length).toBeGreaterThan(1);
    expect(facets.formats.find((facet) => facet.format === 'pdf')?.count).toBe(4);
  });

  it('denies a user without library access, matching the listing endpoint', async () => {
    const outsider = await createUserAndLogin(ctx);
    const payload = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } };

    const [facetsResponse, listingResponse] = await Promise.all([
      ctx.app.inject({ method: 'POST', url: `/api/v1/libraries/${libraryId}/books/facets`, headers: authHeader(outsider.accessToken), payload }),
      ctx.app.inject({ method: 'POST', url: `/api/v1/libraries/${libraryId}/books`, headers: authHeader(outsider.accessToken), payload }),
    ]);

    expect(facetsResponse.statusCode).toBe(403);
    expect(listingResponse.statusCode).toBe(403);
  });

  it('rejects a non-numeric library id with 400', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/libraries/not-a-number/books/facets',
      headers: authHeader(ctx.adminToken),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
