import type { BookCard, BooksPage, JumpBucketsResponse, SortSpec, TemporalJumpBucketGranularity } from '@bookorbit/types';
import { eq } from 'drizzle-orm';

import { refreshPrimaryAuthorSortNamesForBooks } from '../src/db/book-author-sort-key';
import { authors, bookAuthors, bookFiles, bookMetadata, books, bookSeries, readingProgress, userBookStatus, users } from '../src/db/schema';
import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  createUserAndLogin,
  type MetadataWriteE2EContext,
} from './e2e/metadata-write/metadata-write-harness';

const SCENARIO_TIMEOUT_MS = 120_000;

type SeededBook = {
  id: number;
  title: string | null;
  authorSortName: string | null;
  publisher: string | null;
  language: string | null;
  format: string | null;
  readStatus: string;
  publishedYear: number | null;
  seriesName: string | null;
  addedAt: string;
  updatedAt: string;
  lastReadAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

// Mirrors the SQL letter bucket expression: empty -> null, A-Z -> letter, else '#'.
function letterOf(value: string | null): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed === '') return null;
  const first = trimmed[0]!.toUpperCase();
  const unaccented =
    first
      .normalize('NFKD')
      .replace(/\p{Mark}/gu, '')[0]
      ?.toUpperCase() ?? first;
  if (/^[A-Z]$/.test(unaccented)) return unaccented;
  return /^\p{Letter}$/u.test(first) ? first : '#';
}

function expectedBucketKey(
  book: SeededBook,
  field: 'title' | 'author' | 'series' | 'publisher' | 'publishedYear',
  collapsed: boolean,
  granularity: TemporalJumpBucketGranularity | null,
): string | null {
  if (field === 'publishedYear') {
    if (book.publishedYear === null) return '__unknown__';
    const step = granularity?.step ?? 1;
    return String(Math.floor(book.publishedYear / step) * step);
  }
  if (field === 'author') return letterOf(book.authorSortName);
  if (field === 'series') return letterOf(collapsed ? (book.seriesName ?? book.title) : book.seriesName);
  if (field === 'publisher') return letterOf(book.publisher);
  if (collapsed) return letterOf(book.seriesName ?? book.title);
  return letterOf(book.title);
}

function expectedCategoryBucketKey(book: SeededBook, field: 'language' | 'format' | 'readStatus'): string {
  if (field === 'readStatus') return book.readStatus;
  return book[field] ?? '__unknown__';
}

function expectedTemporalBucketKey(value: string | null, granularity: TemporalJumpBucketGranularity | null): string {
  if (value === null) return '__unknown__';
  if (!granularity || granularity.unit === 'day') return value;
  if (granularity.unit === 'month') return value.slice(0, 7);
  const year = Number(value.slice(0, 4));
  return String(Math.floor(year / granularity.step) * granularity.step);
}

describe('Jump buckets invariant (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: MetadataWriteE2EContext;
  let libraryId!: number;
  const seededById = new Map<number, SeededBook>();

  async function seedBook(input: {
    title: string | null;
    publisher?: string | null;
    language?: string | null;
    publishedYear?: number | null;
    seriesId?: number | null;
    seriesName?: string | null;
    seriesIndex?: number | null;
    authorIds?: number[];
    addedAt: Date;
    libraryFolderId: number;
  }): Promise<number> {
    const [book] = await ctx.db
      .insert(books)
      .values({
        libraryId,
        libraryFolderId: input.libraryFolderId,
        folderPath: `/seed/${Math.random().toString(36).slice(2)}`,
        status: 'present',
        addedAt: input.addedAt,
        updatedAt: input.addedAt,
      })
      .returning({ id: books.id });

    await ctx.db.insert(bookMetadata).values({
      bookId: book!.id,
      title: input.title,
      publisher: input.publisher ?? null,
      language: input.language ?? null,
      publishedYear: input.publishedYear ?? null,
      seriesId: input.seriesId ?? null,
      seriesName: input.seriesName ?? null,
      seriesIndex: input.seriesIndex ?? null,
    });

    for (const [order, authorId] of (input.authorIds ?? []).entries()) {
      await ctx.db.insert(bookAuthors).values({ bookId: book!.id, authorId, displayOrder: order });
    }

    return book!.id;
  }

  beforeAll(async () => {
    ctx = await createMetadataWriteE2EContext();
    const library = await createLibraryWithFolder(ctx, { name: 'jump-buckets-invariant' });
    libraryId = library.libraryId;

    const [duneSaga] = await ctx.db.insert(bookSeries).values({ name: 'Dune Saga', normalizedName: 'dune saga' }).returning({ id: bookSeries.id });
    const [zetaSeries] = await ctx.db
      .insert(bookSeries)
      .values({ name: 'zeta chronicles', normalizedName: 'zeta chronicles' })
      .returning({ id: bookSeries.id });

    const authorRows = await ctx.db
      .insert(authors)
      .values([
        { name: 'Isaac Asimov', sortName: 'Asimov, Isaac' },
        { name: 'Roger Zelazny', sortName: 'Zelazny, Roger' },
        { name: 'banana namesort', sortName: null },
        { name: '99 Cent Press', sortName: '99 Cent Press' },
      ])
      .returning({ id: authors.id, name: authors.name, sortName: authors.sortName });
    const [asimov, zelazny, banana, cheap] = authorRows;

    const seedSpecs: Array<{
      title: string | null;
      publishedYear?: number | null;
      series?: { id: number; name: string; index: number };
      author?: { id: number; sortName: string | null; name: string };
      addedAt: string;
    }> = [
      {
        title: 'Alpha Centauri',
        publishedYear: 1991,
        author: { id: asimov!.id, sortName: 'Asimov, Isaac', name: 'Isaac Asimov' },
        addedAt: '2024-01-01',
      },
      { title: 'apple pie', publishedYear: 2005, author: { id: banana!.id, sortName: null, name: 'banana namesort' }, addedAt: '2024-01-02' },
      { title: '1984', publishedYear: 1949, author: { id: zelazny!.id, sortName: 'Zelazny, Roger', name: 'Roger Zelazny' }, addedAt: '2024-01-03' },
      { title: 'Émile of the North', publishedYear: 1949, addedAt: '2024-01-04' },
      {
        title: 'Same Title',
        publishedYear: 2001,
        author: { id: asimov!.id, sortName: 'Asimov, Isaac', name: 'Isaac Asimov' },
        addedAt: '2024-01-05',
      },
      {
        title: 'Same Title',
        publishedYear: 2002,
        author: { id: cheap!.id, sortName: '99 Cent Press', name: '99 Cent Press' },
        addedAt: '2024-01-06',
      },
      { title: 'Same Title', publishedYear: 2003, addedAt: '2024-01-07' },
      { title: 'Beta Waves', publishedYear: null, author: { id: banana!.id, sortName: null, name: 'banana namesort' }, addedAt: '2024-01-08' },
      { title: null, publishedYear: 1980, addedAt: '2024-01-09' },
      {
        title: 'zebra crossing',
        publishedYear: 2010,
        author: { id: zelazny!.id, sortName: 'Zelazny, Roger', name: 'Roger Zelazny' },
        addedAt: '2024-01-10',
      },
      {
        title: 'Dune',
        publishedYear: 1965,
        series: { id: duneSaga!.id, name: 'Dune Saga', index: 1 },
        author: { id: asimov!.id, sortName: 'Asimov, Isaac', name: 'Isaac Asimov' },
        addedAt: '2024-01-11',
      },
      {
        title: 'Dune Messiah',
        publishedYear: 1969,
        series: { id: duneSaga!.id, name: 'Dune Saga', index: 2 },
        author: { id: asimov!.id, sortName: 'Asimov, Isaac', name: 'Isaac Asimov' },
        addedAt: '2024-01-12',
      },
      {
        title: 'Children of Dune',
        publishedYear: 1976,
        series: { id: duneSaga!.id, name: 'Dune Saga', index: 3 },
        author: { id: zelazny!.id, sortName: 'Zelazny, Roger', name: 'Roger Zelazny' },
        addedAt: '2024-01-13',
      },
      {
        title: 'Awakening',
        publishedYear: 2015,
        series: { id: zetaSeries!.id, name: 'zeta chronicles', index: 1 },
        author: { id: zelazny!.id, sortName: 'Zelazny, Roger', name: 'Roger Zelazny' },
        addedAt: '2024-01-14',
      },
      {
        title: 'Burning',
        publishedYear: 2016,
        series: { id: zetaSeries!.id, name: 'zeta chronicles', index: 2 },
        author: { id: banana!.id, sortName: null, name: 'banana namesort' },
        addedAt: '2024-01-15',
      },
      {
        title: 'Quantum Garden',
        publishedYear: 2016,
        author: { id: cheap!.id, sortName: '99 Cent Press', name: '99 Cent Press' },
        addedAt: '2024-01-16',
      },
      { title: 'Дальний берег', publishedYear: 1991, addedAt: '2024-01-17' },
    ];

    const allIds: number[] = [];
    for (const [index, spec] of seedSpecs.entries()) {
      const publisher = index % 6 === 0 ? null : ['Orbit', 'Penguin', 'Éditions du Nord'][index % 3]!;
      const language = index % 7 === 0 ? null : ['en', 'de', 'pt'][index % 3]!;
      const id = await seedBook({
        title: spec.title,
        publisher,
        language,
        publishedYear: spec.publishedYear ?? null,
        seriesId: spec.series?.id ?? null,
        seriesName: spec.series?.name ?? null,
        seriesIndex: spec.series?.index ?? null,
        authorIds: spec.author ? [spec.author.id] : [],
        addedAt: new Date(`${spec.addedAt}T00:00:00.000Z`),
        libraryFolderId: library.libraryFolderId,
      });
      allIds.push(id);
      seededById.set(id, {
        id,
        title: spec.title,
        authorSortName: spec.author ? (spec.author.sortName ?? spec.author.name) : null,
        publisher,
        language,
        format: null,
        readStatus: 'unread',
        publishedYear: spec.publishedYear ?? null,
        seriesName: spec.series?.name ?? null,
        addedAt: spec.addedAt,
        updatedAt: spec.addedAt,
        lastReadAt: null,
        startedAt: null,
        finishedAt: null,
      });
    }

    await refreshPrimaryAuthorSortNamesForBooks(ctx.db, allIds);

    const [admin] = await ctx.db.select({ id: users.id }).from(users).where(eq(users.username, 'metadata-write-e2e-admin')).limit(1);
    if (!admin) throw new Error('e2e admin user not found');

    const seededStatuses = ['reading', 'read', 'want_to_read'] as const;
    const statusRows = allIds.flatMap((bookId, index) => {
      if (index % 5 === 0) return [];
      const day = String(index + 1).padStart(2, '0');
      const startedAt = `2025-03-${day}`;
      const finishedAt = `2025-04-${day}`;
      const seeded = seededById.get(bookId)!;
      seeded.startedAt = startedAt;
      seeded.finishedAt = finishedAt;
      seeded.readStatus = seededStatuses[index % seededStatuses.length]!;
      return [
        {
          userId: admin.id,
          bookId,
          status: seeded.readStatus as (typeof seededStatuses)[number],
          source: 'manual' as const,
          startedAt: new Date(`${startedAt}T12:00:00Z`),
          finishedAt: new Date(`${finishedAt}T12:00:00Z`),
        },
      ];
    });
    await ctx.db.insert(userBookStatus).values(statusRows);

    const seededFormats = ['epub', 'pdf', 'mobi'] as const;
    const insertedFiles = await ctx.db
      .insert(bookFiles)
      .values(
        allIds.map((bookId, index) => ({
          bookId,
          libraryFolderId: library.libraryFolderId,
          absolutePath: `/seed/progress-${bookId}.epub`,
          relPath: `progress-${bookId}.epub`,
          ino: BigInt(900_000 + index),
          format: seededFormats[index % seededFormats.length],
          role: 'content',
        })),
      )
      .returning({ id: bookFiles.id, bookId: bookFiles.bookId });
    for (const [index, file] of insertedFiles.entries()) {
      const seeded = seededById.get(file.bookId)!;
      await ctx.db
        .update(books)
        .set({ primaryFileId: file.id, updatedAt: new Date(`${seeded.updatedAt}T00:00:00.000Z`) })
        .where(eq(books.id, file.bookId));
      seeded.format = seededFormats[index % seededFormats.length]!;
    }
    await ctx.db.insert(readingProgress).values(
      insertedFiles
        .filter((_, index) => index % 5 !== 0)
        .map((file, index) => {
          const day = String(index + 1).padStart(2, '0');
          const lastReadAt = `2025-05-${day}`;
          seededById.get(file.bookId)!.lastReadAt = lastReadAt;
          return { bookFileId: file.id, userId: admin.id, percentage: 50, updatedAt: new Date(`${lastReadAt}T12:00:00Z`) };
        }),
    );
  });

  afterAll(async () => {
    await closeMetadataWriteE2EContext(ctx);
  });

  async function fetchBuckets(sort: SortSpec[], collapseSeries: boolean): Promise<JumpBucketsResponse> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/libraries/${libraryId}/books/jump-buckets`,
      headers: authHeader(ctx.adminToken),
      payload: { sort, pagination: { page: 0, size: 50 }, maxBuckets: 32, ...(collapseSeries ? { collapseSeries: true } : {}) },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as JumpBucketsResponse;
  }

  async function fetchListing(sort: SortSpec[], collapseSeries: boolean): Promise<BooksPage> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/libraries/${libraryId}/books`,
      headers: authHeader(ctx.adminToken),
      payload: { sort, pagination: { page: 0, size: 200 }, ...(collapseSeries ? { collapseSeries: true } : {}) },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as BooksPage;
  }

  const fields = ['title', 'author', 'series', 'publisher', 'publishedYear'] as const;
  const dirs = ['asc', 'desc'] as const;
  const collapseModes = [false, true] as const;

  for (const field of fields) {
    for (const dir of dirs) {
      for (const collapsed of collapseModes) {
        it(`anchors ${field} ${dir} collapse=${collapsed} buckets to the exact listing offsets`, async () => {
          const sort: SortSpec[] = [{ field, dir }];
          const [bucketsResponse, listing] = await Promise.all([fetchBuckets(sort, collapsed), fetchListing(sort, collapsed)]);

          expect(listing.items.length).toBe(listing.total);
          expect(bucketsResponse.total).toBe(listing.total);
          expect(bucketsResponse.buckets.length).toBeGreaterThan(1);
          expect(bucketsResponse.buckets.length).toBeLessThanOrEqual(32);

          let previousIndex = -1;
          for (const bucket of bucketsResponse.buckets) {
            expect(bucket.index).toBeGreaterThan(previousIndex);
            previousIndex = bucket.index;
            expect(bucket.index).toBeLessThan(listing.total);

            const itemAtAnchor = listing.items[bucket.index] as BookCard;
            const seeded = seededById.get(itemAtAnchor.id);
            expect(seeded, `listing item ${itemAtAnchor.id} at index ${bucket.index} must be a seeded book`).toBeDefined();
            expect(
              expectedBucketKey(seeded!, field, collapsed, bucketsResponse.granularity),
              `bucket ${bucket.key} -> book ${itemAtAnchor.id} (${seeded!.title})`,
            ).toBe(bucket.key);

            if (bucket.index > 0) {
              const itemBefore = listing.items[bucket.index - 1] as BookCard;
              const seededBefore = seededById.get(itemBefore.id);
              expect(seededBefore).toBeDefined();
              expect(
                expectedBucketKey(seededBefore!, field, collapsed, bucketsResponse.granularity),
                `item before bucket ${bucket.key} must belong to a different bucket`,
              ).not.toBe(bucket.key);
            }
          }
        });
      }
    }
  }

  it('preserves every populated year when sparse years fit the bounded capacity', async () => {
    const response = await fetchBuckets([{ field: 'publishedYear', dir: 'asc' }], false);
    const expectedYears = [...new Set([...seededById.values()].flatMap((book) => (book.publishedYear === null ? [] : [String(book.publishedYear)])))];
    const returnedKeys = new Set(response.buckets.map((bucket) => bucket.key));

    expect(response.granularity).toEqual({ unit: 'year', step: 1 });
    for (const year of expectedYears) expect(returnedKeys.has(year)).toBe(true);
  });

  const categoryFields = ['language', 'format', 'readStatus'] as const;
  for (const field of categoryFields) {
    for (const dir of dirs) {
      for (const collapsed of collapseModes) {
        it(`anchors ${field} ${dir} collapse=${collapsed} category buckets to exact listing offsets`, async () => {
          const sort: SortSpec[] = [{ field, dir }];
          const [bucketsResponse, listing] = await Promise.all([fetchBuckets(sort, collapsed), fetchListing(sort, collapsed)]);

          expect(bucketsResponse.kind).toBe('category');
          expect(bucketsResponse.buckets.length).toBeGreaterThan(1);
          expect(bucketsResponse.buckets.length).toBeLessThanOrEqual(32);
          expect(bucketsResponse.total).toBe(listing.total);

          let previousIndex = -1;
          for (const bucket of bucketsResponse.buckets) {
            expect(bucket.index).toBeGreaterThan(previousIndex);
            previousIndex = bucket.index;
            const itemAtAnchor = listing.items[bucket.index] as BookCard;
            const seeded = seededById.get(itemAtAnchor.id)!;
            expect(expectedCategoryBucketKey(seeded, field)).toBe(bucket.key);
            if (bucket.index > 0) {
              const itemBefore = listing.items[bucket.index - 1] as BookCard;
              const seededBefore = seededById.get(itemBefore.id)!;
              expect(expectedCategoryBucketKey(seededBefore, field)).not.toBe(bucket.key);
            }
          }
        });
      }
    }
  }

  const temporalFields = ['addedAt', 'updatedAt', 'lastReadAt', 'startedAt', 'finishedAt'] as const;
  for (const field of temporalFields) {
    for (const dir of dirs) {
      it(`anchors ${field} ${dir} temporal buckets to exact flat-listing offsets`, async () => {
        const sort: SortSpec[] = [{ field, dir }];
        const [bucketsResponse, listing] = await Promise.all([fetchBuckets(sort, false), fetchListing(sort, false)]);

        expect(bucketsResponse.kind).toBe('temporal');
        expect(bucketsResponse.buckets.length).toBeLessThanOrEqual(32);
        expect(bucketsResponse.total).toBe(listing.total);

        for (const bucket of bucketsResponse.buckets) {
          const itemAtAnchor = listing.items[bucket.index] as BookCard;
          const seeded = seededById.get(itemAtAnchor.id)!;
          expect(expectedTemporalBucketKey(seeded[field], bucketsResponse.granularity)).toBe(bucket.key);
          if (bucket.index > 0) {
            const itemBefore = listing.items[bucket.index - 1] as BookCard;
            const seededBefore = seededById.get(itemBefore.id)!;
            expect(expectedTemporalBucketKey(seededBefore[field], bucketsResponse.granularity)).not.toBe(bucket.key);
          }
        }
      });
    }
  }

  it('rejects ineligible sorts with 400', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/libraries/${libraryId}/books/jump-buckets`,
      headers: authHeader(ctx.adminToken),
      payload: { sort: [{ field: 'rating', dir: 'desc' }], pagination: { page: 0, size: 50 }, maxBuckets: 32 },
    });
    expect(response.statusCode).toBe(400);
  });

  it('denies access to users without library access, matching the listing endpoint', async () => {
    const limitedUser = await createUserAndLogin(ctx);
    const payload = { sort: [{ field: 'title', dir: 'asc' }], pagination: { page: 0, size: 50 } };

    const [bucketsResponse, listingResponse] = await Promise.all([
      ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${libraryId}/books/jump-buckets`,
        headers: authHeader(limitedUser.accessToken),
        payload,
      }),
      ctx.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${libraryId}/books`,
        headers: authHeader(limitedUser.accessToken),
        payload,
      }),
    ]);

    expect(bucketsResponse.statusCode).toBeGreaterThanOrEqual(403);
    expect(bucketsResponse.statusCode).toBe(listingResponse.statusCode);
  });
});
