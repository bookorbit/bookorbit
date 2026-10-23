import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';

import type {
  NotebookBooksResponse,
  NotebookEntriesResponse,
  NotebookEntry,
  NotebookOnThisDayResponse,
  NotebookOverview,
  NotebookReviewResponse,
  NotebookTrashResponse,
} from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type LocatedBookFile,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

/** Two entries of different kinds, and two of the same kind, written in the same microsecond. */
const TIE = '2026-03-03T12:00:00.500000Z';

function at(iso: string) {
  return sql`${iso}::timestamptz`;
}

describe('Notebook hub (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let bookA!: LocatedBookFile;
  let bookB!: LocatedBookFile;
  let bookC!: LocatedBookFile;
  let owner!: TestUserSession;
  let outsider!: TestUserSession;
  const ids: Record<string, string> = {};

  async function highlight(
    name: string,
    book: LocatedBookFile,
    values: {
      text: string;
      color?: string;
      origin?: 'web' | 'koreader' | 'kobo';
      note?: string;
      createdAt: string;
      sourceCreatedAt?: string;
      starred?: boolean;
      deletedAt?: string;
      cfiStatus?: 'exact' | 'repaired';
    },
  ) {
    const [row] = await ctx.db
      .insert(schema.annotations)
      .values({
        userId: owner.userId,
        bookId: book.bookId,
        text: values.text,
        color: values.color ?? '#FACC15',
        style: 'highlight',
        origin: values.origin ?? 'web',
        note: values.note ?? null,
        createdAt: at(values.createdAt),
        updatedAt: at(values.createdAt),
        sourceCreatedAt: values.sourceCreatedAt ? at(values.sourceCreatedAt) : null,
        starredAt: values.starred ? at(values.createdAt) : null,
        deletedAt: values.deletedAt ? at(values.deletedAt) : null,
      })
      .returning({ id: schema.annotations.id });
    if (values.cfiStatus) {
      await ctx.db.insert(schema.annotationPositions).values({
        annotationId: row.id,
        userId: owner.userId,
        bookFileId: book.bookFileId,
        format: 'cfi',
        pos0: 'epubcfi(/6/2!/4/2/1:0)',
        status: values.cfiStatus,
      });
    }
    ids[name] = `highlight:${row.id}`;
  }

  async function journal(name: string, book: LocatedBookFile, body: string, createdAt: string, deletedAt?: string) {
    const [row] = await ctx.db
      .insert(schema.bookJournalEntries)
      .values({
        clientId: randomUUID(),
        userId: owner.userId,
        bookId: book.bookId,
        body,
        createdAt: at(createdAt),
        updatedAt: at(createdAt),
        deletedAt: deletedAt ? at(deletedAt) : null,
      })
      .returning({ id: schema.bookJournalEntries.id });
    ids[name] = `journal:${row.id}`;
  }

  async function bookmark(
    name: string,
    book: LocatedBookFile,
    values: { title: string; note?: string; origin?: 'web' | 'koreader'; createdAt: string; positionSeconds?: number },
  ) {
    const [row] = await ctx.db
      .insert(schema.bookmarks)
      .values({
        userId: owner.userId,
        bookId: book.bookId,
        title: values.title,
        note: values.note ?? null,
        origin: values.origin ?? 'web',
        cfi: values.positionSeconds === undefined ? `epubcfi(/6/4!/4/2/${Object.keys(ids).length})` : null,
        positionSeconds: values.positionSeconds ?? null,
        createdAt: at(values.createdAt),
        updatedAt: at(values.createdAt),
      })
      .returning({ id: schema.bookmarks.id });
    ids[name] = `bookmark:${row.id}`;
  }

  async function nameBook(book: LocatedBookFile, title: string, author: string) {
    await ctx.db
      .insert(schema.bookMetadata)
      .values({ bookId: book.bookId, title })
      .onConflictDoUpdate({ target: schema.bookMetadata.bookId, set: { title } });
    const [created] = await ctx.db
      .insert(schema.authors)
      // A digits-only suffix keeps the name unique across reruns without ever matching a text search below.
      .values({ name: `${author} ${Date.now()}${Math.floor(Math.random() * 1000)}` })
      .returning({ id: schema.authors.id });
    await ctx.db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, book.bookId));
    await ctx.db.insert(schema.bookAuthors).values({ bookId: book.bookId, authorId: created.id, displayOrder: 0 });
  }

  function get<T>(user: TestUserSession, url: string) {
    return ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: authHeader(user.accessToken) }).then((response) => ({
      status: response.statusCode,
      body: response.json() as T,
    }));
  }

  function names(items: NotebookEntry[]): string[] {
    const byRef = new Map(Object.entries(ids).map(([name, ref]) => [ref, name]));
    return items.map((item) => byRef.get(`${item.kind}:${item.id}`) ?? `${item.kind}:${item.id}`);
  }

  async function walk(url: string, limit: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page++) {
      const separator = url.includes('?') ? '&' : '?';
      const { status, body } = await get<NotebookEntriesResponse>(
        owner,
        `${url}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(status).toBe(200);
      expect(body.items.length).toBeLessThanOrEqual(limit);
      seen.push(...names(body.items));
      cursor = body.nextCursor;
      if (!cursor) return seen;
    }
    throw new Error('Paging did not terminate');
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    const library = await createLibraryWithFolder(ctx, { name: `notebook-hub-${randomUUID()}` });
    const hidden = await createLibraryWithFolder(ctx, { name: `notebook-hub-hidden-${randomUUID()}` });
    const pathA = await createEpubFixture(library.folderPath, 'hub-a.epub', { title: `Hub A ${randomUUID()}`, uid: `urn:uuid:${randomUUID()}` });
    const pathB = await createEpubFixture(library.folderPath, 'hub-b.epub', { title: `Hub B ${randomUUID()}`, uid: `urn:uuid:${randomUUID()}` });
    const pathC = await createEpubFixture(hidden.folderPath, 'hub-c.epub', { title: `Hub C ${randomUUID()}`, uid: `urn:uuid:${randomUUID()}` });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    await triggerAndWaitForLibraryScan(ctx, hidden.libraryId);
    bookA = await locateBookByAbsolutePath(ctx, pathA);
    bookB = await locateBookByAbsolutePath(ctx, pathB);
    bookC = await locateBookByAbsolutePath(ctx, pathC);

    owner = await createUserAndLogin(ctx);
    outsider = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, owner.userId, library.libraryId, 'viewer');

    await nameBook(bookA, 'Dune Messiah', 'Frank Herbert');
    await nameBook(bookB, 'Café Notes', 'Zoë Writer');

    await highlight('hA1', bookA, { text: 'The spice must flow', createdAt: '2026-03-01T10:00:00.000001Z', cfiStatus: 'exact' });
    await highlight('hA2', bookA, {
      text: 'Fear is the mind-killer, 100% of the time',
      color: '#38BDF8',
      origin: 'kobo',
      note: 'remember',
      createdAt: '2026-03-05T00:00:00.000000Z',
      sourceCreatedAt: '2026-03-02T09:00:00.000002Z',
      starred: true,
      cfiStatus: 'repaired',
    });
    await highlight('hB1', bookB, { text: 'Plain 1000 words', origin: 'koreader', createdAt: TIE });
    await highlight('hB2', bookB, { text: 'Second at the same instant', color: '#4ADE80', createdAt: TIE, cfiStatus: 'exact' });
    await journal('jB1', bookB, 'Journal thought', TIE);
    await bookmark('bmB1', bookB, { title: 'At 2:00', note: 'listen again', origin: 'koreader', createdAt: TIE, positionSeconds: 120 });
    await bookmark('bmA1', bookA, { title: 'Chapter 2', note: '   ', createdAt: '2026-03-04T08:00:00.000003Z' });
    await ctx.db
      .insert(schema.userBookNotes)
      .values({ userId: owner.userId, bookId: bookA.bookId, note: 'A classic.', updatedAt: at('2026-03-06T00:00:00.000000Z') });
    await ctx.db.insert(schema.userBookRatings).values({ userId: owner.userId, bookId: bookA.bookId, rating: 5 });
    await ctx.db
      .insert(schema.userBookNotes)
      .values({ userId: owner.userId, bookId: bookB.bookId, note: ' \n ', updatedAt: at('2026-03-09T00:00:00.000000Z') });
    ids.rA = `review:${bookA.bookId}`;

    // 2025-10-04 01:30 in Berlin, and 2025-10-05 00:30 in Berlin.
    await highlight('hA4', bookA, { text: 'Berlin morning', createdAt: '2025-10-03T23:30:00.000000Z', cfiStatus: 'exact' });
    await highlight('hA5', bookA, { text: 'UTC evening', createdAt: '2025-10-04T22:30:00.000000Z', cfiStatus: 'exact' });
    await journal('jA3', bookA, 'Two years ago', '2024-10-04T12:00:00.000000Z');

    await highlight('hA3', bookA, { text: 'Trashed highlight', createdAt: '2026-02-01T00:00:00.000000Z', deletedAt: '2026-03-07T00:00:00.000000Z' });
    await journal('jA2', bookA, 'Trashed thought', '2026-02-02T00:00:00.000000Z', '2026-03-08T00:00:00.000000Z');

    const [hidden1] = await ctx.db
      .insert(schema.annotations)
      .values({ userId: owner.userId, bookId: bookC.bookId, text: 'Out of reach', createdAt: at('2026-03-10T00:00:00.000000Z') })
      .returning({ id: schema.annotations.id });
    ids.hC1 = `highlight:${hidden1.id}`;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  const NEWEST = ['rA', 'bmA1', 'bmB1', 'jB1', 'hB2', 'hB1', 'hA2', 'hA1', 'hA5', 'hA4', 'jA3'];

  it('advertises notebook-hub on app-info', async () => {
    const { body } = await get<{ features: string[] }>(owner, '/app-info');
    expect(body.features).toContain('notebook-hub');
  });

  describe('GET /notebook/entries', () => {
    it('merges every kind newest first, breaking ties on kind and then id, and only from libraries the reader can open', async () => {
      const { status, body } = await get<NotebookEntriesResponse>(owner, '/notebook/entries');
      expect(status).toBe(200);
      expect(names(body.items)).toEqual(NEWEST);
      expect(body.nextCursor).toBeNull();
      expect(Object.keys(body.books).sort()).toEqual([String(bookA.bookId), String(bookB.bookId)].sort());
    });

    it('returns the contract shape for each kind and the book labels', async () => {
      const { body } = await get<NotebookEntriesResponse>(owner, '/notebook/entries');
      const byName = new Map(names(body.items).map((name, index) => [name, body.items[index]!]));
      expect(byName.get('hA2')).toEqual({
        kind: 'highlight',
        id: expect.any(Number),
        bookId: bookA.bookId,
        clientId: null,
        createdAt: '2026-03-02T09:00:00.000Z',
        updatedAt: '2026-03-05T00:00:00.000Z',
        text: 'Fear is the mind-killer, 100% of the time',
        color: '#38BDF8',
        style: 'highlight',
        note: 'remember',
        chapterTitle: null,
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        positionStatus: 'repaired',
        origin: 'kobo',
        starredAt: '2026-03-05T00:00:00.000Z',
      });
      expect(byName.get('hB1')).toMatchObject({ cfi: null, positionStatus: null });
      expect(byName.get('jB1')).toMatchObject({ kind: 'journal', clientId: expect.any(String), body: 'Journal thought', positionPercent: null });
      expect(byName.get('bmB1')).toMatchObject({ kind: 'bookmark', title: 'At 2:00', cfi: null, positionSeconds: 120, origin: 'koreader' });
      expect(byName.get('rA')).toEqual({
        kind: 'review',
        id: bookA.bookId,
        bookId: bookA.bookId,
        clientId: null,
        createdAt: '2026-03-06T00:00:00.000Z',
        updatedAt: '2026-03-06T00:00:00.000Z',
        body: 'A classic.',
        rating: 5,
      });
      for (const item of body.items) expect(item).not.toHaveProperty('deletedAt');

      expect(body.books[String(bookA.bookId)]).toEqual({
        id: bookA.bookId,
        title: 'Dune Messiah',
        author: expect.stringMatching(/^Frank Herbert /),
        hasCover: expect.any(Boolean),
        coverVersion: expect.any(String),
        coverAspectRatio: '2/3',
        readFileId: bookA.bookFileId,
        readFileFormat: 'epub',
        hasAudio: false,
      });
    });

    it.each([1, 2, 3, 4])('pages with limit %i to exactly the unpaged list', async (limit) => {
      expect(await walk('/notebook/entries', limit)).toEqual(NEWEST);
      expect(await walk('/notebook/entries?sort=oldest', limit)).toEqual([...NEWEST].reverse());
    });

    it('rejects a cursor from another sort and a malformed one', async () => {
      const { body } = await get<NotebookEntriesResponse>(owner, '/notebook/entries?limit=2');
      expect((await get(owner, `/notebook/entries?sort=oldest&cursor=${body.nextCursor}`)).status).toBe(400);
      expect((await get(owner, '/notebook/entries?cursor=not-a-cursor')).status).toBe(400);
      expect((await get(owner, '/notebook/entries?kinds=highlight,podcast')).status).toBe(400);
      expect((await get(owner, '/notebook/entries?limit=101')).status).toBe(400);
    });

    it.each([
      ['starred=true', ['hA2']],
      ['starred=false', NEWEST],
      ['colors=%2338BDF8,%234ADE80', ['hB2', 'hA2']],
      ['approximate=true', ['hB1', 'hA2']],
      ['hasNote=true', ['rA', 'bmB1', 'jB1', 'hA2', 'jA3']],
      ['origins=kobo', ['hA2']],
      ['origins=koreader', ['bmB1', 'hB1']],
      ['origins=web', ['rA', 'bmA1', 'jB1', 'hB2', 'hA1', 'hA5', 'hA4', 'jA3']],
      ['kinds=journal,review', ['rA', 'jB1', 'jA3']],
      ['kinds=journal&starred=true', []],
      ['q=100%25', ['hA2']],
      ['q=%25', ['hA2']],
      ['q=MIND-killer', ['hA2']],
      ['q=herbert', ['rA', 'bmA1', 'hA2', 'hA1', 'hA5', 'hA4', 'jA3']],
      ['q=cafe', ['bmB1', 'jB1', 'hB2', 'hB1']],
      ['q=zoe', ['bmB1', 'jB1', 'hB2', 'hB1']],
    ])('filters %s', async (query, expected) => {
      const { status, body } = await get<NotebookEntriesResponse>(owner, `/notebook/entries?${query}`);
      expect(status).toBe(200);
      expect(names(body.items)).toEqual(expected);
    });

    it('filters by book and sorts by edit time', async () => {
      const { body } = await get<NotebookEntriesResponse>(owner, `/notebook/entries?bookId=${bookB.bookId}`);
      expect(names(body.items)).toEqual(['bmB1', 'jB1', 'hB2', 'hB1']);
      const edited = await get<NotebookEntriesResponse>(owner, '/notebook/entries?sort=edited&kinds=highlight&limit=2');
      expect(names(edited.body.items)).toEqual(['hA2', 'hB2']);
    });

    it('is empty for a reader with no library access', async () => {
      const { status, body } = await get<NotebookEntriesResponse>(outsider, '/notebook/entries');
      expect(status).toBe(200);
      expect(body).toEqual({ items: [], books: {}, nextCursor: null });
    });
  });

  describe('GET /notebook/overview', () => {
    it('counts every kind under the same scope', async () => {
      const { status, body } = await get<NotebookOverview>(owner, '/notebook/overview');
      expect(status).toBe(200);
      expect(body).toEqual({
        total: 11,
        highlights: 6,
        journal: 2,
        bookmarks: 2,
        reviews: 1,
        starred: 1,
        withNotes: 5,
        approximate: 2,
        books: 2,
        colors: [
          { color: '#FACC15', count: 4 },
          { color: '#38BDF8', count: 1 },
          { color: '#4ADE80', count: 1 },
        ],
        origins: [
          { origin: 'web', count: 4 },
          { origin: 'kobo', count: 1 },
          { origin: 'koreader', count: 1 },
        ],
      });
    });

    it('honours the filters and rejects kinds', async () => {
      const starred = await get<NotebookOverview>(owner, '/notebook/overview?starred=true');
      expect(starred.body).toMatchObject({ total: 1, highlights: 1, journal: 0, bookmarks: 0, reviews: 0, books: 1 });
      expect((await get(owner, '/notebook/overview?kinds=highlight')).status).toBe(400);
    });

    it('is all zeros for a reader with no library access', async () => {
      const { body } = await get<NotebookOverview>(outsider, '/notebook/overview');
      expect(body).toMatchObject({ total: 0, books: 0, colors: [], origins: [] });
    });
  });

  describe('GET /notebook/books', () => {
    it('lists books by last activity with counts, colours and the latest entry, paged by cursor', async () => {
      const first = await get<NotebookBooksResponse>(owner, '/notebook/books?limit=1');
      expect(first.status).toBe(200);
      expect(first.body.items).toHaveLength(1);
      expect(first.body.items[0]).toMatchObject({
        book: { id: bookA.bookId, title: 'Dune Messiah' },
        highlights: 4,
        journal: 1,
        bookmarks: 1,
        hasReview: true,
        colors: [
          { color: '#FACC15', count: 3 },
          { color: '#38BDF8', count: 1 },
        ],
        lastActivityAt: '2026-03-06T00:00:00.000Z',
        latest: { kind: 'review', id: bookA.bookId },
      });

      const second = await get<NotebookBooksResponse>(owner, `/notebook/books?limit=1&cursor=${first.body.nextCursor}`);
      expect(second.body.items[0]).toMatchObject({
        book: { id: bookB.bookId, title: 'Café Notes' },
        highlights: 2,
        journal: 1,
        bookmarks: 1,
        hasReview: false,
        lastActivityAt: '2026-03-03T12:00:00.500Z',
        latest: { kind: 'bookmark' },
      });
      expect(second.body.nextCursor).toBeNull();
    });

    it('matches title or author and is empty without access', async () => {
      const byAuthor = await get<NotebookBooksResponse>(owner, '/notebook/books?q=zoe');
      expect(byAuthor.body.items.map((row) => row.book.id)).toEqual([bookB.bookId]);
      const outside = await get<NotebookBooksResponse>(outsider, '/notebook/books');
      expect(outside.body).toEqual({ items: [], nextCursor: null });
    });
  });

  describe('GET /notebook/review', () => {
    it('builds a daily deck, one highlight per book with starred first, the same all day', async () => {
      const first = await get<NotebookReviewResponse>(owner, '/notebook/review?date=2026-10-04');
      const again = await get<NotebookReviewResponse>(owner, '/notebook/review?date=2026-10-04');
      expect(first.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(first.body.items).toHaveLength(2);
      expect(names(first.body.items)[0]).toBe('hA2');
      expect(new Set(first.body.items.map((item) => item.bookId)).size).toBe(2);
      expect(Object.keys(first.body.books).sort()).toEqual([String(bookA.bookId), String(bookB.bookId)].sort());
    });

    it('shuffles the filtered highlights the same way for the same seed', async () => {
      const first = await get<NotebookReviewResponse>(owner, '/notebook/review?seed=7');
      const again = await get<NotebookReviewResponse>(owner, '/notebook/review?seed=7');
      expect(names(again.body.items)).toEqual(names(first.body.items));
      expect([...names(first.body.items)].sort()).toEqual(['hA1', 'hA2', 'hA4', 'hA5', 'hB1', 'hB2']);
      const starred = await get<NotebookReviewResponse>(owner, '/notebook/review?seed=7&starred=true');
      expect(names(starred.body.items)).toEqual(['hA2']);
    });

    it('requires exactly one of date and seed', async () => {
      expect((await get(owner, '/notebook/review')).status).toBe(400);
      expect((await get(owner, '/notebook/review?date=2026-10-04&seed=1')).status).toBe(400);
      expect((await get(owner, '/notebook/review?date=2026-02-30')).status).toBe(400);
    });
  });

  describe('GET /notebook/on-this-day', () => {
    it('finds earlier years on the local day in the requested zone', async () => {
      const berlin = await get<NotebookOnThisDayResponse>(owner, '/notebook/on-this-day?date=2026-10-04&tz=Europe/Berlin');
      expect(berlin.status).toBe(200);
      expect(berlin.body.date).toBe('2026-10-04');
      expect(berlin.body.years.map((year) => [year.year, names(year.items)])).toEqual([
        [2025, ['hA4']],
        [2024, ['jA3']],
      ]);
      expect(Object.keys(berlin.body.books)).toEqual([String(bookA.bookId)]);

      const utc = await get<NotebookOnThisDayResponse>(owner, '/notebook/on-this-day?date=2026-10-04&tz=UTC');
      expect(utc.body.years.map((year) => [year.year, names(year.items)])).toEqual([
        [2025, ['hA5']],
        [2024, ['jA3']],
      ]);
    });

    it("defaults to the reader's timezone setting", async () => {
      await ctx.db
        .update(schema.users)
        .set({ settings: { timezone: 'Europe/Berlin' } })
        .where(eq(schema.users.id, owner.userId));
      const { body } = await get<NotebookOnThisDayResponse>(owner, '/notebook/on-this-day?date=2026-10-04');
      expect(body.years.map((year) => [year.year, names(year.items)])).toEqual([
        [2025, ['hA4']],
        [2024, ['jA3']],
      ]);
    });

    it('validates the date and zone', async () => {
      expect((await get(owner, '/notebook/on-this-day')).status).toBe(400);
      expect((await get(owner, '/notebook/on-this-day?date=2026-10-04&tz=Mars/Olympus')).status).toBe(400);
    });
  });

  describe('GET /notebook/trash', () => {
    it('lists deleted highlights and journal entries by deletion time, with deletedAt', async () => {
      const first = await get<NotebookTrashResponse>(owner, '/notebook/trash?limit=1');
      expect(first.status).toBe(200);
      expect(names(first.body.items)).toEqual(['jA2']);
      expect(first.body.items[0]).toMatchObject({ kind: 'journal', deletedAt: '2026-03-08T00:00:00.000Z' });
      const second = await get<NotebookTrashResponse>(owner, `/notebook/trash?limit=1&cursor=${first.body.nextCursor}`);
      expect(names(second.body.items)).toEqual(['hA3']);
      expect(second.body.items[0]).toMatchObject({ kind: 'highlight', deletedAt: '2026-03-07T00:00:00.000Z' });
      expect(second.body.nextCursor).toBeNull();
      expect((await get<NotebookTrashResponse>(outsider, '/notebook/trash')).body).toEqual({ items: [], books: {}, nextCursor: null });
    });
  });
});
