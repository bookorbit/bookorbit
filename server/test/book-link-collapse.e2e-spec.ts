/**
 * Linked books in listings (07-phase-3-link.md 3.4 and 3.5): card badges, the opt-in
 * `collapseLinked` fold, its book total, and jump buckets that agree with the folded listing.
 * Covers G1, G2, G3, G4, G5, G7, G8, G9, G18, G20 and G21 against a real database.
 */
import { randomUUID } from 'crypto';

import { and, eq, inArray } from 'drizzle-orm';

import type { BookCard, BooksPage, GroupRule, JumpBucketsResponse, LibraryBookFacets, SortSpec } from '@bookorbit/types';

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

const SCENARIO_TIMEOUT_MS = 90_000;

type SeededBook = { id: number; libraryId: number; title: string; addedAt: string };

let inoSequence = 970_000;

describe('Linked books in listings (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let ebooks!: CreatedLibrary;
  let audiobooks!: CreatedLibrary;
  let reader!: TestUserSession;
  let ebooksOnly!: TestUserSession;

  const seeded = new Map<number, SeededBook>();
  const groupOfBook = new Map<number, number>();
  const ids = {} as Record<
    | 'alpha'
    | 'duneEbook'
    | 'zeta'
    | 'duneAudio'
    | 'mid'
    | 'hyperionEpub'
    | 'hyperionPdf'
    | 'solarisAudio'
    | 'solarisEbook'
    | 'leviathanEpub'
    | 'leviathanPdf'
    | 'caliban',
    number
  >;
  let duneGroupId!: number;

  async function seedBook(
    library: CreatedLibrary,
    options: {
      title: string;
      format: string;
      addedAt: string;
      status?: 'present' | 'missing';
      series?: { id: number; name: string; index: string };
    },
  ): Promise<number> {
    const slug = `${options.title.toLowerCase().replace(/[^a-z]+/g, '-')}-${randomUUID()}`;
    const addedAt = new Date(`${options.addedAt}T12:00:00.000Z`);
    const [book] = await ctx.db
      .insert(schema.books)
      .values({
        libraryId: library.libraryId,
        libraryFolderId: library.libraryFolderId,
        folderPath: `${library.folderPath}/${slug}`,
        status: options.status ?? 'present',
        addedAt,
        updatedAt: addedAt,
      })
      .returning({ id: schema.books.id });
    const bookId = book!.id;

    await ctx.db.insert(schema.bookMetadata).values({
      bookId,
      title: options.title,
      seriesId: options.series?.id ?? null,
      seriesName: options.series?.name ?? null,
      seriesIndex: options.series?.index ?? null,
    });
    if (options.series) {
      await ctx.db.insert(schema.bookSeriesMemberships).values({ bookId, seriesId: options.series.id, seriesIndex: options.series.index });
    }

    inoSequence += 1;
    const [file] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId,
        libraryFolderId: library.libraryFolderId,
        absolutePath: `${library.folderPath}/${slug}/${slug}.${options.format}`,
        relPath: `${slug}/${slug}.${options.format}`,
        ino: BigInt(inoSequence),
        sizeBytes: 2048,
        format: options.format,
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: file!.id }).where(eq(schema.books.id, bookId));

    seeded.set(bookId, { id: bookId, libraryId: library.libraryId, title: options.title, addedAt: options.addedAt });
    return bookId;
  }

  async function link(bookIds: number[], leadBookId: number | null = null): Promise<number> {
    const [group] = await ctx.db.insert(schema.bookLinkGroups).values({ leadBookId }).returning({ id: schema.bookLinkGroups.id });
    await ctx.db.insert(schema.bookLinks).values(bookIds.map((bookId) => ({ bookId, groupId: group!.id })));
    for (const bookId of bookIds) groupOfBook.set(bookId, group!.id);
    return group!.id;
  }

  async function post<T>(token: string, url: string, payload: Record<string, unknown>): Promise<T> {
    const response = await ctx.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: authHeader(token), payload });
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as T;
  }

  function listLibrary(token: string, libraryId: number, query: Record<string, unknown> = {}): Promise<BooksPage> {
    return post<BooksPage>(token, `/libraries/${libraryId}/books`, { pagination: { page: 0, size: 100 }, ...query });
  }

  function listAll(token: string, query: Record<string, unknown> = {}): Promise<BooksPage> {
    return post<BooksPage>(token, '/books/query', { pagination: { page: 0, size: 100 }, ...query });
  }

  function jumpBuckets(token: string, libraryId: number, query: Record<string, unknown>): Promise<JumpBucketsResponse> {
    return post<JumpBucketsResponse>(token, `/libraries/${libraryId}/books/jump-buckets`, {
      pagination: { page: 0, size: 100 },
      maxBuckets: 32,
      ...query,
    });
  }

  function card(page: BooksPage, bookId: number): BookCard {
    const found = page.items.find((item) => item.id === bookId);
    expect(found, `card ${bookId}`).toBeDefined();
    return found!;
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    ebooks = await createLibraryWithFolder(ctx, { name: `link-collapse-ebooks-${randomUUID()}` });
    audiobooks = await createLibraryWithFolder(ctx, { name: `link-collapse-audiobooks-${randomUUID()}` });

    reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, ebooks.libraryId);
    await grantLibraryAccess(ctx, reader.userId, audiobooks.libraryId);
    ebooksOnly = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, ebooksOnly.userId, ebooks.libraryId);

    const [expanse] = await ctx.db
      .insert(schema.bookSeries)
      .values({ name: 'Expanse', normalizedName: `expanse ${randomUUID()}` })
      .returning({ id: schema.bookSeries.id });

    ids.alpha = await seedBook(ebooks, { title: 'Alpha', format: 'epub', addedAt: '2024-01-01' });
    ids.duneEbook = await seedBook(ebooks, { title: 'Dune', format: 'epub', addedAt: '2024-01-02' });
    ids.zeta = await seedBook(ebooks, { title: 'Zeta', format: 'epub', addedAt: '2024-01-05' });
    ids.duneAudio = await seedBook(audiobooks, { title: 'Dune', format: 'm4b', addedAt: '2024-01-09' });
    ids.mid = await seedBook(audiobooks, { title: 'Mid', format: 'm4b', addedAt: '2024-01-07' });
    ids.hyperionEpub = await seedBook(ebooks, { title: 'Hyperion', format: 'epub', addedAt: '2024-01-03' });
    ids.hyperionPdf = await seedBook(ebooks, { title: 'Hyperion', format: 'pdf', addedAt: '2024-01-04' });
    // The missing copy is created first, so it has the lower id and is also the lead: only being
    // present can make the other copy the representative.
    ids.solarisAudio = await seedBook(audiobooks, { title: 'Solaris', format: 'm4b', addedAt: '2024-01-06', status: 'missing' });
    ids.solarisEbook = await seedBook(ebooks, { title: 'Solaris', format: 'epub', addedAt: '2024-01-08' });
    const series = { id: expanse!.id, name: 'Expanse' };
    ids.leviathanEpub = await seedBook(ebooks, {
      title: 'Leviathan Wakes',
      format: 'epub',
      addedAt: '2024-01-10',
      series: { ...series, index: '1' },
    });
    ids.leviathanPdf = await seedBook(ebooks, { title: 'Leviathan Wakes', format: 'pdf', addedAt: '2024-01-11', series: { ...series, index: '1' } });
    ids.caliban = await seedBook(ebooks, { title: "Caliban's War", format: 'epub', addedAt: '2024-01-12', series: { ...series, index: '2' } });

    duneGroupId = await link([ids.duneEbook, ids.duneAudio]);
    await link([ids.hyperionEpub, ids.hyperionPdf], ids.hyperionPdf);
    await link([ids.solarisAudio, ids.solarisEbook], ids.solarisAudio);
    await link([ids.leviathanEpub, ids.leviathanPdf]);
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('G1: a library grid keeps its own card and badges the linked audiobook from the other library', async () => {
    const page = await listLibrary(reader.accessToken, ebooks.libraryId);

    expect(page.total).toBe(9);
    expect(page).not.toHaveProperty('bookTotal');
    expect(card(page, ids.duneEbook).linked).toEqual({
      groupId: duneGroupId,
      books: [{ bookId: ids.duneAudio, libraryId: audiobooks.libraryId, formats: ['m4b'], mediaKind: 'audiobook' }],
      memberCount: 2,
    });
    expect(card(page, ids.hyperionEpub).linked?.books.map((book) => [book.bookId, book.formats])).toEqual([[ids.hyperionPdf, ['pdf']]]);
    expect(card(page, ids.alpha)).not.toHaveProperty('linked');
  });

  it('G1, G15, G16: a cross-library view shows one card only when the client asks for it', async () => {
    const flat = await listAll(reader.accessToken);
    expect(flat.total).toBe(12);
    expect(flat.items.map((item) => item.id)).toEqual(expect.arrayContaining([ids.duneEbook, ids.duneAudio]));

    const folded = await listAll(reader.accessToken, { collapseLinked: true });
    expect(folded.total).toBe(8);
    expect(folded.bookTotal).toBe(12);
    expect(folded.items).toHaveLength(8);
    const dune = folded.items.filter((item) => item.title === 'Dune');
    expect(dune.map((item) => item.id)).toEqual([ids.duneEbook]);
    expect(dune[0]!.linked).toMatchObject({ memberCount: 2, books: [{ bookId: ids.duneAudio }] });
  });

  it('G2: a user who sees one library gets no badge, no count and no trace of the other member', async () => {
    const grid = await listLibrary(ebooksOnly.accessToken, ebooks.libraryId);
    expect(card(grid, ids.duneEbook)).not.toHaveProperty('linked');
    expect(card(grid, ids.solarisEbook)).not.toHaveProperty('linked');

    const folded = await listAll(ebooksOnly.accessToken, { collapseLinked: true });
    expect(folded.total).toBe(7);
    expect(folded.bookTotal).toBe(9);
    expect(card(folded, ids.duneEbook)).not.toHaveProperty('linked');
    for (const page of [grid, folded]) {
      expect(page.items.map((item) => item.id)).not.toContain(ids.duneAudio);
      expect(page.items.flatMap((item) => item.linked?.books.map((book) => book.bookId) ?? [])).not.toContain(ids.duneAudio);
    }
  });

  it('G3: filtering happens first, so the only matching member represents its group', async () => {
    const audioOnly: GroupRule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['m4b'] }] };
    const folded = await listAll(reader.accessToken, { collapseLinked: true, filter: audioOnly, sort: [{ field: 'title', dir: 'asc' }] });

    expect(folded.items.map((item) => item.id)).toEqual([ids.duneAudio, ids.mid, ids.solarisAudio]);
    expect(folded.total).toBe(3);
    expect(folded.bookTotal).toBe(3);

    const epubOnly: GroupRule = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['epub'] }] };
    const hyperion = await listAll(reader.accessToken, { collapseLinked: true, filter: epubOnly, q: 'Hyperion' });
    // The lead is the PDF, which does not match, so the matching EPUB stands for the group.
    expect(hyperion.items.map((item) => item.id)).toEqual([ids.hyperionEpub]);
  });

  it('G4: the card sits at the group best position and keeps the same representative whatever the sort', async () => {
    const desc = await listAll(reader.accessToken, { collapseLinked: true, sort: [{ field: 'addedAt', dir: 'desc' }] });
    const asc = await listAll(reader.accessToken, { collapseLinked: true, sort: [{ field: 'addedAt', dir: 'asc' }] });

    expect(desc.items.map((item) => item.id)).toEqual([
      ids.caliban,
      ids.leviathanEpub,
      ids.duneEbook,
      ids.solarisEbook,
      ids.mid,
      ids.zeta,
      ids.hyperionPdf,
      ids.alpha,
    ]);
    expect(asc.items.map((item) => item.id)).toEqual([
      ids.alpha,
      ids.duneEbook,
      ids.hyperionPdf,
      ids.zeta,
      ids.solarisEbook,
      ids.mid,
      ids.leviathanEpub,
      ids.caliban,
    ]);
  });

  it('G4: paging walks the folded cards without repeating or skipping one', async () => {
    const sort: SortSpec[] = [{ field: 'addedAt', dir: 'desc' }];
    const whole = await listAll(reader.accessToken, { collapseLinked: true, sort });
    const pages: number[] = [];
    for (let page = 0; page < 3; page += 1) {
      const slice = await listAll(reader.accessToken, { collapseLinked: true, sort, pagination: { page, size: 3 } });
      expect(slice.total).toBe(8);
      expect(slice.bookTotal).toBe(12);
      pages.push(...slice.items.map((item) => item.id));
    }
    expect(pages).toEqual(whole.items.map((item) => item.id));

    const beyond = await listAll(reader.accessToken, { collapseLinked: true, sort, pagination: { page: 9, size: 3 } });
    expect(beyond.items).toEqual([]);
    expect(beyond.total).toBe(8);
    expect(beyond.bookTotal).toBe(12);
  });

  it('G5: a present member represents the group over a missing lead, and missing members carry no badge', async () => {
    const folded = await listAll(reader.accessToken, { collapseLinked: true });
    expect(folded.items.filter((item) => item.title === 'Solaris').map((item) => item.id)).toEqual([ids.solarisEbook]);

    const ebookGrid = await listLibrary(reader.accessToken, ebooks.libraryId);
    expect(card(ebookGrid, ids.solarisEbook)).not.toHaveProperty('linked');

    const audioGrid = await listLibrary(reader.accessToken, audiobooks.libraryId);
    expect(card(audioGrid, ids.solarisAudio).linked).toMatchObject({
      memberCount: 2,
      books: [{ bookId: ids.solarisEbook, libraryId: ebooks.libraryId, formats: ['epub'], mediaKind: 'ebook' }],
    });
  });

  it('G7: selecting every match reaches every member, matching the book total', async () => {
    const folded = await listAll(reader.accessToken, { collapseLinked: true, q: 'Dune' });
    expect(folded.total).toBe(1);
    expect(folded.bookTotal).toBe(2);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/books/bulk-set-status',
      headers: authHeader(reader.accessToken),
      payload: { query: { q: 'Dune' }, status: 'reading' },
    });
    expect(response.statusCode, response.body).toBe(204);

    const rows = await ctx.db
      .select({ bookId: schema.userBookStatus.bookId })
      .from(schema.userBookStatus)
      .where(and(eq(schema.userBookStatus.userId, reader.userId), inArray(schema.userBookStatus.bookId, [ids.duneEbook, ids.duneAudio])));
    expect(rows.map((row) => row.bookId).sort((a, b) => a - b)).toEqual([ids.duneEbook, ids.duneAudio].sort((a, b) => a - b));
    expect(rows).toHaveLength(folded.bookTotal!);
  });

  it('G8: links fold before series, so a series stack does not count one book twice', async () => {
    const page = await listLibrary(reader.accessToken, ebooks.libraryId, { collapseSeries: true, collapseLinked: true });

    const expanse = page.items.find((item) => item.seriesName === 'Expanse');
    expect(expanse?.collapsedSeries?.bookCount).toBe(2);
    expect(page.items.filter((item) => item.title === 'Hyperion').map((item) => item.id)).toEqual([ids.hyperionPdf]);
    expect(page.total).toBe(6);
    expect(page.bookTotal).toBe(9);
  });

  it('G9: letter buckets anchor to the folded listing offsets', async () => {
    for (const collapseSeries of [false, true]) {
      const query = { sort: [{ field: 'title', dir: 'asc' }], collapseLinked: true, ...(collapseSeries ? { collapseSeries: true } : {}) };
      const [buckets, listing] = await Promise.all([
        jumpBuckets(reader.accessToken, ebooks.libraryId, query),
        listLibrary(reader.accessToken, ebooks.libraryId, query),
      ]);

      expect(buckets.total).toBe(listing.total);
      expect(listing.items).toHaveLength(listing.total);
      for (const bucket of buckets.buckets) {
        const item = listing.items[bucket.index]!;
        const label = (item.collapsedSeries ? item.seriesName : item.title) ?? '';
        expect(label[0]?.toUpperCase(), `bucket ${bucket.key} at ${bucket.index}`).toBe(bucket.key);
        if (bucket.index > 0) {
          const before = listing.items[bucket.index - 1]!;
          const beforeLabel = (before.collapsedSeries ? before.seriesName : before.title) ?? '';
          expect(beforeLabel[0]?.toUpperCase()).not.toBe(bucket.key);
        }
      }
    }
  });

  it('G9: date buckets place each folded group by the member the sort puts first', async () => {
    const query = { sort: [{ field: 'addedAt', dir: 'desc' }], collapseLinked: true };
    const [buckets, listing] = await Promise.all([
      jumpBuckets(reader.accessToken, ebooks.libraryId, query),
      listLibrary(reader.accessToken, ebooks.libraryId, query),
    ]);

    // In a grid sorted newest first, a folded group is placed by its newest member in this library.
    const placedAt = (cardId: number): string => {
      const groupId = groupOfBook.get(cardId);
      const members = [...seeded.values()].filter(
        (book) => book.libraryId === ebooks.libraryId && (book.id === cardId || (groupId !== undefined && groupOfBook.get(book.id) === groupId)),
      );
      return members
        .map((book) => book.addedAt)
        .sort()
        .at(-1)!;
    };

    expect(buckets.kind).toBe('temporal');
    expect(buckets.total).toBe(listing.total);
    expect(buckets.granularity?.unit).toBe('day');
    for (const bucket of buckets.buckets) {
      expect(placedAt(listing.items[bucket.index]!.id), `bucket ${bucket.key}`).toBe(bucket.key);
      if (bucket.index > 0) expect(placedAt(listing.items[bucket.index - 1]!.id)).not.toBe(bucket.key);
    }
    expect(listing.items.find((item) => item.title === 'Hyperion')?.id).toBe(ids.hyperionPdf);
  });

  it('G18: facet counts stay book counts when the listing folds links', async () => {
    const facets = await post<LibraryBookFacets>(reader.accessToken, `/libraries/${ebooks.libraryId}/books/facets`, { collapseLinked: true });

    expect(facets.total).toBe(9);
    expect(Object.fromEntries(facets.formats.map((facet) => [facet.format, facet.count]))).toEqual({ epub: 7, pdf: 2 });
  });

  it('G20: where no group has two members in scope, the plain listing runs and bookTotal equals total', async () => {
    const page = await listLibrary(reader.accessToken, audiobooks.libraryId, { collapseLinked: true });

    expect(page.total).toBe(3);
    expect(page.bookTotal).toBe(3);
    expect(page.items.map((item) => item.id).sort((a, b) => a - b)).toEqual([ids.duneAudio, ids.mid, ids.solarisAudio].sort((a, b) => a - b));
  });

  it('G21: a series-collapsed page reports its book total too', async () => {
    const page = await listLibrary(reader.accessToken, ebooks.libraryId, { collapseSeries: true });

    expect(page.total).toBe(7);
    expect(page.bookTotal).toBe(9);
    expect(page.items.find((item) => item.seriesName === 'Expanse')?.collapsedSeries?.bookCount).toBe(3);
  });
});
