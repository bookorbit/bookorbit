import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import type { AchievementHint, AchievementHintsResponse } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createReadingSession,
  createUserAndLogin,
  grantLibraryAccess,
  type AuthorizationMatrixE2EContext,
  type CreatedLibrary,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 60_000;
const DAY_MS = 86_400_000;

interface SeededBook {
  bookId: number;
  fileId: number;
}

let inoSequence = 950_000;

async function seedBook(
  ctx: AuthorizationMatrixE2EContext,
  library: CreatedLibrary,
  options: { title: string; year?: number; pages?: number; language?: string; authorId?: number },
): Promise<SeededBook> {
  const slug = `${options.title.toLowerCase().replaceAll(' ', '-')}-${randomUUID()}`;
  const [book] = await ctx.db
    .insert(schema.books)
    .values({ libraryId: library.libraryId, libraryFolderId: library.libraryFolderId, folderPath: `${library.folderPath}/${slug}` })
    .returning({ id: schema.books.id });
  const bookId = book!.id;

  await ctx.db.insert(schema.bookMetadata).values({
    bookId,
    title: options.title,
    publishedYear: options.year ?? null,
    pageCount: options.pages ?? null,
    language: options.language ?? null,
  });

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

  if (options.authorId) await ctx.db.insert(schema.bookAuthors).values({ bookId, authorId: options.authorId });
  return { bookId, fileId: file!.id };
}

async function createAuthor(ctx: AuthorizationMatrixE2EContext, name: string): Promise<number> {
  const [author] = await ctx.db
    .insert(schema.authors)
    .values({ name: `${name} ${randomUUID()}` })
    .returning({ id: schema.authors.id });
  return author!.id;
}

describe('Achievement hints (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let reader!: TestUserSession;
  let stranger!: TestUserSession;
  let authorId!: number;

  const seeded: Record<string, SeededBook> = {};

  async function fetchHints(token: string): Promise<AchievementHint[]> {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/achievements/hints', headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    return (response.json() as AchievementHintsResponse).hints;
  }

  function hintFor(hints: AchievementHint[], key: string): AchievementHint | undefined {
    return hints.find((hint) => hint.key === key);
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();

    const shelf = await createLibraryWithFolder(ctx, { name: `hints-shelf-${randomUUID()}` });
    const hidden = await createLibraryWithFolder(ctx, { name: `hints-hidden-${randomUUID()}` });
    reader = await createUserAndLogin(ctx);
    stranger = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, shelf.libraryId);
    await grantLibraryAccess(ctx, stranger.userId, shelf.libraryId);

    authorId = await createAuthor(ctx, 'Hint Author');
    const otherAuthorId = await createAuthor(ctx, 'Other Author');

    seeded.finishedRated = await seedBook(ctx, shelf, { title: 'Finished Rated', year: 2015, pages: 250, language: 'English', authorId });
    seeded.finishedUnrated = await seedBook(ctx, shelf, {
      title: 'Finished Unrated',
      year: 2021,
      pages: 250,
      language: 'English',
      authorId: otherAuthorId,
    });
    seeded.stalled = await seedBook(ctx, shelf, { title: 'Stalled Saga', year: 2018, pages: 400, language: 'English' });
    seeded.nearly = await seedBook(ctx, shelf, { title: 'Nearly There', year: 2019, pages: 200, language: 'English' });
    seeded.ninetiesShort = await seedBook(ctx, shelf, { title: 'Nineties Novella', year: 1994, pages: 80, language: 'Spanish', authorId });
    seeded.ninetiesLong = await seedBook(ctx, shelf, { title: 'Nineties Epic', year: 1997, pages: 280, language: 'English' });
    seeded.variant = await seedBook(ctx, shelf, { title: 'Variant Spelling', year: 2016, pages: 220, language: 'en-US', authorId });
    seeded.sixties = await seedBook(ctx, shelf, { title: 'Sixties', year: 1965, pages: 220 });
    seeded.seventies = await seedBook(ctx, shelf, { title: 'Seventies', year: 1972, pages: 220 });
    seeded.eighties = await seedBook(ctx, shelf, { title: 'Eighties', year: 1988, pages: 220 });
    seeded.missing = await seedBook(ctx, shelf, { title: 'Gone Missing', year: 1994, pages: 60, language: 'Italian', authorId });
    await ctx.db.update(schema.books).set({ status: 'missing' }).where(eq(schema.books.id, seeded.missing.bookId));

    // Everything here would change an answer if it leaked past library access.
    seeded.hiddenOld = await seedBook(ctx, hidden, { title: 'Hidden Classic', year: 1850, pages: 1200, language: 'French', authorId });
    seeded.hiddenNineties = await seedBook(ctx, hidden, { title: 'Hidden Nineties', year: 1991, pages: 50, language: 'German', authorId });

    const now = Date.now();
    await ctx.db.insert(schema.userBookStatus).values([
      { userId: reader.userId, bookId: seeded.finishedRated.bookId, status: 'read', source: 'manual', finishedAt: new Date(now - 20 * DAY_MS) },
      { userId: reader.userId, bookId: seeded.finishedUnrated.bookId, status: 'read', source: 'manual', finishedAt: new Date(now - 2 * DAY_MS) },
      { userId: reader.userId, bookId: seeded.stalled.bookId, status: 'reading', startedAt: new Date(now - 120 * DAY_MS) },
      { userId: reader.userId, bookId: seeded.nearly.bookId, status: 'reading', startedAt: new Date(now - 10 * DAY_MS) },
    ]);
    await ctx.db.insert(schema.userBookRatings).values({ userId: reader.userId, bookId: seeded.finishedRated.bookId, rating: 4 });
    await ctx.db.insert(schema.readingProgress).values([
      { userId: reader.userId, bookFileId: seeded.stalled.fileId, percentage: 80.6 },
      { userId: reader.userId, bookFileId: seeded.nearly.fileId, percentage: 95 },
    ]);

    const sessionStart = new Date(now - 3 * DAY_MS);
    await createReadingSession(ctx, {
      userId: reader.userId,
      bookId: seeded.nearly.bookId,
      bookFileId: seeded.nearly.fileId,
      startedAt: sessionStart,
      endedAt: new Date(sessionStart.getTime() + 2 * 3600 * 1000),
    });
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('refuses an anonymous request', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/v1/achievements/hints' });
    expect(response.statusCode).toBe(401);
  });

  it('measures the reading pace toward the next hours tier', async () => {
    const hints = await fetchHints(reader.accessToken);
    expect(hintFor(hints, 'hours_read_1')).toEqual({
      key: 'hours_read_1',
      kind: 'reading_pace',
      values: { hours: 2, days: 30, remaining: 8, etaDays: 120 },
    });
  });

  it('names the stalled book, its progress and how to resume it', async () => {
    const hints = await fetchHints(reader.accessToken);
    const hint = hintFor(hints, 'slow_burn');
    expect(hint).toMatchObject({
      kind: 'stalled_book',
      count: 1,
      bookIds: [seeded.stalled.bookId],
      values: { title: 'Stalled Saga', percent: 80, resume: { bookId: seeded.stalled.bookId, fileId: seeded.stalled.fileId, format: 'epub' } },
    });
  });

  it('counts books past 90% and finished books without a rating', async () => {
    const hints = await fetchHints(reader.accessToken);
    expect(hintFor(hints, 'books_finished_1')).toMatchObject({ kind: 'nearly_finished', count: 1, bookIds: [seeded.nearly.bookId] });
    expect(hintFor(hints, 'critic_1')).toMatchObject({
      kind: 'unrated_finished',
      count: 1,
      bookIds: [seeded.finishedUnrated.bookId],
      bookTitles: ['Finished Unrated'],
    });
    expect(hintFor(hints, 'first_verdict')).toMatchObject({ kind: 'unrated_finished', count: 1 });
  });

  it('suggests the largest unfinished decade from the libraries the reader can open', async () => {
    const hints = await fetchHints(reader.accessToken);
    const hint = hintFor(hints, 'decade_sampler');
    expect(hint).toMatchObject({ kind: 'period_unread', count: 2, values: { period: 1990, years: 10 } });
    expect([...(hint?.bookIds ?? [])].sort()).toEqual([seeded.ninetiesShort.bookId, seeded.ninetiesLong.bookId].sort());
  });

  it('keeps hidden and missing books out of every count', async () => {
    const hints = await fetchHints(reader.accessToken);
    const hiddenIds = new Set([seeded.hiddenOld.bookId, seeded.hiddenNineties.bookId, seeded.missing.bookId]);
    for (const hint of hints) {
      for (const bookId of hint.bookIds ?? []) expect(hiddenIds.has(bookId)).toBe(false);
    }

    expect(hintFor(hints, 'old_soul')).toEqual({ key: 'old_soul', kind: 'unavailable', values: { reason: 'nothing_before_year', year: 1900 } });
    expect(hintFor(hints, 'century_span')).toEqual({
      key: 'century_span',
      kind: 'unavailable',
      values: { reason: 'too_few_periods', years: 100, reachable: 2 },
    });
    expect(hintFor(hints, 'long_book_1')).toMatchObject({
      kind: 'long_books',
      count: 1,
      bookIds: [seeded.stalled.bookId],
      values: { minPages: 300 },
    });
    expect(hintFor(hints, 'short_story_fan')).toMatchObject({
      kind: 'short_books',
      count: 1,
      bookIds: [seeded.ninetiesShort.bookId],
      values: { maxPages: 100, inProgress: 0 },
    });
  });

  it('names the author to read more of and a language not read yet', async () => {
    const hints = await fetchHints(reader.accessToken);
    const author = hintFor(hints, 'author_deep_dive');
    expect(author).toMatchObject({ kind: 'author_unread', count: 2, values: { authorId, finished: 1 } });
    expect([...(author?.bookIds ?? [])].sort()).toEqual([seeded.ninetiesShort.bookId, seeded.variant.bookId].sort());

    expect(hintFor(hints, 'polyglot_1')).toEqual({
      key: 'polyglot_1',
      kind: 'language_unread',
      count: 1,
      bookIds: [seeded.ninetiesShort.bookId],
      bookTitles: ['Nineties Novella'],
      values: { language: 'es' },
    });
  });

  it('answers the year-round reader from the calendar so far', async () => {
    const hints = await fetchHints(reader.accessToken);
    const now = new Date();
    const hint = hintFor(hints, 'year_round_reader');
    if (now.getUTCMonth() === 0) {
      expect(hint).toMatchObject({ kind: 'months_left', count: 12 });
    } else {
      expect(hint).toEqual({
        key: 'year_round_reader',
        kind: 'unavailable',
        values: { reason: 'missed_month', year: now.getUTCFullYear(), month: 1 },
      });
    }
  });

  it("never shows one reader's history to another", async () => {
    const hints = await fetchHints(stranger.accessToken);
    expect(hintFor(hints, 'slow_burn')).toBeUndefined();
    expect(hintFor(hints, 'critic_1')).toBeUndefined();
    expect(hintFor(hints, 'books_finished_1')).toBeUndefined();
    expect(hintFor(hints, 'hours_read_1')).toBeUndefined();
    expect(hintFor(hints, 'author_deep_dive')).toBeUndefined();
  });
});
