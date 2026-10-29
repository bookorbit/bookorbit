import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import type { ReadingHistoryItem, ReadingHistoryMarks, ReadingHistoryPage, ReadingHistorySummary } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { BookRepository } from '../src/modules/book/book.repository';
import { DashboardWidgetRepository } from '../src/modules/dashboard/dashboard-widget.repository';
import { closeE2EContext, createE2EContext, seedLibrary, type E2EContext } from './e2e/app-harness';

const TIMEOUT = 120_000;
const E2E_ROOT = `/tmp/bookorbit-reading-history-${randomUUID()}`;

type Outcome = 'completed' | 'skimmed' | 'abandoned';

describe('Reading history (docker e2e)', { timeout: TIMEOUT }, () => {
  let ctx: E2EContext;
  let libraryId: number;
  let libraryFolderId: number;
  let sequence = 0;
  let reader: { id: number; token: string };
  let stranger: { id: number; token: string };

  async function createUser(withAccess: boolean) {
    const username = `history-${randomUUID()}`;
    const password = 'HistoryUser123!';
    const [user] = await ctx.db
      .insert(schema.users)
      .values({ username, name: 'History Reader', passwordHash: await hash(password, 4), isDefaultPassword: false, provisioningMethod: 'local' })
      .returning({ id: schema.users.id });
    if (withAccess) await ctx.db.insert(schema.userLibraryAccess).values({ userId: user.id, libraryId, accessLevel: 'viewer' });
    const login = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
    return { id: user.id, token: (login.json() as { accessToken: string }).accessToken };
  }

  async function createBook(title: string, authorNames: string[] = [], pageCount: number | null = null) {
    sequence++;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({ libraryId, libraryFolderId, folderPath: `history-${sequence}` })
      .returning({ id: schema.books.id });
    const [file] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId: book.id,
        libraryFolderId,
        absolutePath: `${E2E_ROOT}/history-${sequence}.epub`,
        relPath: `history-${sequence}.epub`,
        ino: BigInt(200_000 + sequence),
        sizeBytes: 1024,
        format: 'epub',
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: file.id }).where(eq(schema.books.id, book.id));
    await ctx.db.insert(schema.bookMetadata).values({ bookId: book.id, title, pageCount });
    for (const [index, name] of authorNames.entries()) {
      const [author] = await ctx.db
        .insert(schema.authors)
        .values({ name: `${name} ${randomUUID().slice(0, 6)}` })
        .returning({ id: schema.authors.id, name: schema.authors.name });
      await ctx.db.insert(schema.bookAuthors).values({ bookId: book.id, authorId: author.id, displayOrder: index });
    }
    return book.id;
  }

  async function addRead(userId: number, bookId: number, startedOn: string | null, endedOn: string | null, outcome: Outcome = 'completed') {
    const [row] = await ctx.db
      .insert(schema.readingAttempts)
      .values({ userId, bookId, startedOn, endedOn, outcome, origin: 'manual' })
      .returning({ id: schema.readingAttempts.id });
    return row.id;
  }

  async function get<T>(token: string, url: string) {
    const response = await ctx.app.inject({ method: 'GET', url: `/api/v1${url}`, headers: { authorization: `Bearer ${token}` } });
    return { status: response.statusCode, body: response.json() as T };
  }

  async function rate(token: string, attemptId: number, rating: number | null) {
    return ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/reading-history/${attemptId}/rating`,
      headers: { authorization: `Bearer ${token}` },
      payload: { rating },
    });
  }

  let comfort: number;
  let comfortReads: number[];
  let novel: number;
  let novelRead: number;
  let dropped: number;

  beforeAll(async () => {
    ctx = await createE2EContext({ isolateAppData: true });
    const library = await seedLibrary(ctx.db, { rootPath: E2E_ROOT, mode: 'book_per_file', watch: false });
    libraryId = library.libraryId;
    libraryFolderId = library.libraryFolderId;
    reader = await createUser(true);
    stranger = await createUser(true);

    comfort = await createBook('Comfort Read', ['Ada Example'], 200);
    novel = await createBook('A Novel, Unabridged', ['Vaillant, John'], 500);
    dropped = await createBook('Dropped Book', [], 300);
    comfortReads = [
      await addRead(reader.id, comfort, null, null),
      await addRead(reader.id, comfort, '2025-12-20', '2026-01-04'),
      await addRead(reader.id, comfort, '2026-05-01', '2026-05-02'),
    ];
    novelRead = await addRead(reader.id, novel, '2026-04-10', '2026-04-30');
    await addRead(reader.id, dropped, '2026-05-05', '2026-05-06', 'abandoned');
    await addRead(stranger.id, novel, '2026-03-01', '2026-03-02');
  });

  afterAll(async () => {
    await closeE2EContext(ctx);
  });

  it('lists every finish newest first, counting each reread of a book', async () => {
    const { status, body } = await get<ReadingHistoryPage>(reader.token, '/reading-history?year=2026');
    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.items.map((item) => [item.title, item.endedOn, item.readNumber, item.completedReads])).toEqual([
      ['Comfort Read', '2026-05-02', 3, 3],
      ['A Novel, Unabridged', '2026-04-30', 1, 1],
      ['Comfort Read', '2026-01-04', 2, 3],
    ]);
    expect(body.items[1].authors[0]).toMatch(/^Vaillant, John /);
    expect(body.months?.map((month) => [month.month, month.reads, month.rereads, month.pages])).toEqual([
      ['2026-05', 1, 1, 200],
      ['2026-04', 1, 0, 500],
      ['2026-01', 1, 1, 200],
    ]);
  });

  it('keeps undated finishes for All time, last, and counts them first among a book’s reads', async () => {
    const { body } = await get<ReadingHistoryPage>(reader.token, '/reading-history');
    expect(body.total).toBe(4);
    const last = body.items.at(-1) as ReadingHistoryItem;
    expect([last.id, last.endedOn, last.readNumber]).toEqual([comfortReads[0], null, 1]);
    expect(body.months?.at(-1)).toMatchObject({ month: 'undated', reads: 1 });
  });

  it('filters by outcome, quarter, search and book', async () => {
    expect(
      (await get<ReadingHistoryPage>(reader.token, '/reading-history?year=2026&outcomes=abandoned')).body.items.map((item) => item.title),
    ).toEqual(['Dropped Book']);
    expect((await get<ReadingHistoryPage>(reader.token, '/reading-history?year=2026&quarter=2')).body.total).toBe(2);
    expect((await get<ReadingHistoryPage>(reader.token, '/reading-history?search=vaillant')).body.items.map((item) => item.id)).toEqual([novelRead]);
    expect((await get<ReadingHistoryPage>(reader.token, '/reading-history?search=%25')).body.total).toBe(0);
    expect((await get<ReadingHistoryPage>(reader.token, `/reading-history?bookId=${comfort}`)).body.total).toBe(3);
  });

  it('summarises the year: reads, books, rereads, pages, and what was left out', async () => {
    const { body } = await get<ReadingHistorySummary>(reader.token, '/reading-history/summary?year=2026');
    expect(body).toMatchObject({ reads: 3, books: 2, rereads: 2, pages: 900, notCounted: 1, undatedReads: 1 });
    expect(body.years).toEqual([{ year: 2026, reads: 3 }]);
    expect(body.months).toHaveLength(12);
    expect(body.records.mostReread).toMatchObject({ item: { bookId: comfort }, value: 2 });
    expect(body.records.longestBook).toMatchObject({ item: { bookId: novel }, value: 500 });
  });

  it('rates a read, and the latest finish carries the book rating both ways', async () => {
    expect((await rate(reader.token, comfortReads[1], 3)).json()).toEqual({ rating: 3, bookRatingChanged: false });
    expect((await rate(reader.token, comfortReads[2], 5)).json()).toEqual({ rating: 5, bookRatingChanged: true });
    const [bookRating] = await ctx.db
      .select({ rating: schema.userBookRatings.rating })
      .from(schema.userBookRatings)
      .where(and(eq(schema.userBookRatings.userId, reader.id), eq(schema.userBookRatings.bookId, comfort)));
    expect(bookRating.rating).toBe(5);

    await ctx.app.get(BookRepository).bulkSetRating([comfort], 4, reader.id);
    const ratings = await ctx.db
      .select({ id: schema.readingAttempts.id, rating: schema.readingAttempts.rating })
      .from(schema.readingAttempts)
      .where(eq(schema.readingAttempts.bookId, comfort));
    expect(Object.fromEntries(ratings.map((row) => [row.id, row.rating]))).toMatchObject({ [comfortReads[1]]: 3, [comfortReads[2]]: 4 });
    expect((await rate(reader.token, comfortReads[1], 9)).statusCode).toBe(400);
  });

  it('shows only the reader own reads, and only in libraries they can open', async () => {
    const mine = await get<ReadingHistoryPage>(stranger.token, '/reading-history');
    expect(mine.body.items.map((item) => item.bookId)).toEqual([novel]);
    expect((await rate(stranger.token, novelRead, 1)).statusCode).toBe(404);
    expect((await get(stranger.token, `/reading-history/${novelRead}/marks`)).status).toBe(404);

    await ctx.db
      .delete(schema.userLibraryAccess)
      .where(and(eq(schema.userLibraryAccess.userId, stranger.id), eq(schema.userLibraryAccess.libraryId, libraryId)));
    expect((await get<ReadingHistoryPage>(stranger.token, '/reading-history')).body.total).toBe(0);
  });

  it('returns the highlights and journal entries made during a read, in the reader’s days', async () => {
    const at = (iso: string) => new Date(iso);
    await ctx.db.insert(schema.annotations).values([
      { userId: reader.id, bookId: novel, text: 'Inside the read', createdAt: at('2026-04-15T12:00:00Z'), note: 'kept' },
      { userId: reader.id, bookId: novel, text: 'Before it began', createdAt: at('2026-04-01T12:00:00Z') },
      { userId: reader.id, bookId: novel, text: 'Late on the last day', createdAt: at('2026-04-30T22:00:00Z') },
    ]);
    await ctx.db
      .insert(schema.bookJournalEntries)
      .values({ clientId: randomUUID(), userId: reader.id, bookId: novel, body: 'A thought', createdAt: at('2026-04-20T08:00:00Z') });
    const { body } = await get<ReadingHistoryMarks>(reader.token, `/reading-history/${novelRead}/marks`);
    expect(body.highlightCount).toBe(2);
    expect(body.highlights[0]).toMatchObject({ text: 'Inside the read', note: 'kept' });
    expect(body.journalCount).toBe(1);
    const list = await get<ReadingHistoryPage>(reader.token, `/reading-history?bookId=${novel}`);
    expect(list.body.items[0]).toMatchObject({ highlightCount: 2, journalCount: 1 });
  });

  it('keeps a finished read when its book is deleted, named by its snapshot and still counted toward the goal', async () => {
    const goalBefore = await ctx.app.get(DashboardWidgetRepository).countCompletedBooks(reader.id, [libraryId], '2026-01-01', '2027-01-01');
    await ctx.app.get(BookRepository).deleteByIdsAndInvalidateScanState([novel]);

    const { body } = await get<ReadingHistoryPage>(reader.token, '/reading-history?year=2026');
    const kept = body.items.find((item) => item.id === novelRead);
    expect(kept).toMatchObject({ bookId: null, title: 'A Novel, Unabridged', format: 'epub', pageCount: 500, highlightCount: 0 });
    expect(kept?.authors[0]).toMatch(/^Vaillant, John /);
    expect(kept?.removedAt).toEqual(expect.any(String));
    await expect(ctx.app.get(DashboardWidgetRepository).countCompletedBooks(reader.id, [libraryId], '2026-01-01', '2027-01-01')).resolves.toBe(
      goalBefore,
    );

    const strangerReads = await ctx.db.select().from(schema.readingAttempts).where(eq(schema.readingAttempts.userId, stranger.id));
    expect(strangerReads).toHaveLength(1);
    expect(strangerReads[0]).toMatchObject({ bookId: null, bookTitleSnapshot: 'A Novel, Unabridged' });
  });
});
