import { randomUUID } from 'crypto';

import { HttpException, HttpStatus } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import {
  BOOK_CHAPTERS_ERROR_CODES,
  Permission,
  type AudiobookChapter,
  type AudiobookChapterSource,
  type BookChaptersState,
  type ChapterHealthPage,
  type ChapterHealthSummary,
  type ChapterLookupQueueState,
  type ChapterLookupResult,
  type ChapterLookupReviewSummary,
  type EnqueueChapterLookupResult,
} from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { ChapterLookupService } from '../src/modules/chapter-editor/chapter-lookup.service';
import { ChapterHealthRepository } from '../src/modules/chapter-health/chapter-health.repository';
import { ChapterEditorService } from '../src/modules/chapter-editor/chapter-editor.service';
import { ChapterLookupWorker } from '../src/modules/chapter-health/chapter-lookup.worker';
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

interface SeedBook {
  title: string;
  files?: number;
  fileSeconds?: number;
  format?: string;
  chapters?: AudiobookChapter[] | null;
  source?: AudiobookChapterSource | null;
  chaptersUpdatedAt?: Date | null;
  audibleId?: string | null;
  lockedFields?: string[];
  status?: string;
  library?: CreatedLibrary;
}

function chapterList(titles: readonly string[], spacingMs = 60_000): AudiobookChapter[] {
  return titles.map((title, index) => ({ title, startMs: index * spacingMs }));
}

function range(count: number, title: (index: number) => string): string[] {
  return Array.from({ length: count }, (_, index) => title(index + 1));
}

const REVIEW_SUMMARY: ChapterLookupReviewSummary = {
  provider: 'audible',
  chapterCount: 3,
  runtimeMs: 1_215_000,
  totalDurationMs: 1_200_000,
  isAccurate: true,
};

describe('Chapter health (e2e)', { timeout: 60_000 }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let libraryA!: CreatedLibrary;
  let libraryB!: CreatedLibrary;
  let libraryAName!: string;
  let editor!: TestUserSession;
  let outsider!: TestUserSession;
  let plainUser!: TestUserSession;
  const ids: Record<string, number> = {};

  async function seedBook(input: SeedBook): Promise<number> {
    const library = input.library ?? libraryA;
    const slug = `chapter-health-${randomUUID()}`;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({
        libraryId: library.libraryId,
        libraryFolderId: library.libraryFolderId,
        folderPath: `${library.folderPath}/${slug}`,
        status: input.status ?? 'present',
      })
      .returning({ id: schema.books.id });
    const bookId = book!.id;
    const chapters = input.chapters ?? null;
    await ctx.db.insert(schema.bookMetadata).values({
      bookId,
      title: input.title,
      chapters,
      chaptersSource: input.source ?? (chapters ? 'embedded' : null),
      chaptersUpdatedAt: input.chaptersUpdatedAt ?? null,
      audibleId: input.audibleId ?? null,
      lockedFields: input.lockedFields ?? [],
    });
    const format = input.format ?? 'mp3';
    const parts = Array.from({ length: input.files ?? 1 }, (_, index) => index + 1);
    const files = await ctx.db
      .insert(schema.bookFiles)
      .values(
        parts.map((part) => ({
          bookId,
          libraryFolderId: library.libraryFolderId,
          absolutePath: `${library.folderPath}/${slug}/Part ${part}.${format}`,
          relPath: `${slug}/Part ${part}.${format}`,
          ino: BigInt(part),
          sizeBytes: 1_000 * part,
          format,
          role: 'content',
          sortOrder: part,
          durationSeconds: input.fileSeconds ?? 600,
        })),
      )
      .returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: files[0]!.id }).where(eq(schema.books.id, bookId));
    return bookId;
  }

  async function request<T>(
    user: TestUserSession | 'admin',
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<{ status: number; body: T }> {
    const token = user === 'admin' ? ctx.adminToken : user.accessToken;
    const response = await ctx.app.inject({ method, url: `/api/v1${url}`, headers: authHeader(token), ...(payload ? { payload } : {}) });
    return { status: response.statusCode, body: (response.body ? response.json() : null) as T };
  }

  async function summary(user: TestUserSession | 'admin', query = ''): Promise<ChapterHealthSummary> {
    const response = await request<ChapterHealthSummary>(user, 'GET', `/chapter-health/summary${query}`);
    expect(response.status).toBe(200);
    return response.body;
  }

  async function titlesIn(user: TestUserSession, category: string, query = ''): Promise<string[]> {
    const response = await request<ChapterHealthPage>(user, 'GET', `/chapter-health/books?category=${category}${query}`);
    expect(response.status).toBe(200);
    return response.body.items.map((item) => item.title ?? '');
  }

  async function queueRow(bookId: number) {
    const [row] = await ctx.db.select().from(schema.chapterLookupQueue).where(eq(schema.chapterLookupQueue.bookId, bookId));
    return row ?? null;
  }

  async function metadataRow(bookId: number) {
    const [row] = await ctx.db
      .select({
        chapters: schema.bookMetadata.chapters,
        chaptersSource: schema.bookMetadata.chaptersSource,
        chaptersUpdatedBy: schema.bookMetadata.chaptersUpdatedBy,
        lockedFields: schema.bookMetadata.lockedFields,
      })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, bookId));
    return row!;
  }

  async function versionsOf(bookId: number) {
    return ctx.db.select().from(schema.bookChapterVersions).where(eq(schema.bookChapterVersions.bookId, bookId));
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    libraryAName = `chapter-health-a-${randomUUID()}`;
    libraryA = await createLibraryWithFolder(ctx, { name: libraryAName });
    libraryB = await createLibraryWithFolder(ctx, { name: `chapter-health-b-${randomUUID()}` });
    editor = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    outsider = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    plainUser = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, editor.userId, libraryA.libraryId, 'editor');
    await grantLibraryAccess(ctx, outsider.userId, libraryB.libraryId, 'editor');
    await grantLibraryAccess(ctx, plainUser.userId, libraryA.libraryId);

    // Titles sort in seeding order, which is the order every list below is read in.
    ids.singleNone = await seedBook({ title: 'Alpha Single No Chapters', audibleId: ' B0SINGLE01 ' });
    ids.singleOne = await seedBook({ title: 'Bravo Single One Chapter', chapters: chapterList(['Whole Book']) });
    ids.threeNone = await seedBook({ title: 'Charlie Three Files', files: 3, audibleId: 'B0THREE001' });
    ids.threeOne = await seedBook({ title: 'Delta Three Files One Chapter', files: 3, chapters: chapterList(['Whole Book']) });
    ids.digits = await seedBook({
      title: 'Echo Numbered Digits',
      chapters: chapterList(range(10, (n) => String(n).padStart(3, '0'))),
      audibleId: 'B0DIGITS01',
    });
    ids.tracks = await seedBook({
      title: 'Foxtrot Track Titles',
      files: 2,
      chapters: chapterList(range(10, (n) => `Track ${String(n).padStart(2, '0')}`)),
    });
    ids.mostly = await seedBook({
      title: 'Golf Mostly Numbered',
      chapters: chapterList([...range(8, (n) => String(n).padStart(2, '0')), 'Epilogue', 'Afterword']),
    });
    ids.partly = await seedBook({
      title: 'Hotel Partly Numbered',
      chapters: chapterList([...range(7, (n) => String(n).padStart(2, '0')), 'Interlude', 'Epilogue', 'Afterword']),
    });
    ids.real = await seedBook({ title: 'India Real Chapters', chapters: chapterList(range(10, (n) => `Chapter ${n}`)), audibleId: 'B0REAL0001' });
    ids.manual = await seedBook({ title: 'Juliet Hand Edited', files: 2, chapters: chapterList(['Opening', 'Middle'], 300_000), source: 'manual' });
    ids.reviewOpen = await seedBook({
      title: 'Kilo Review Open',
      files: 2,
      chapters: chapterList(
        range(3, (n) => `Chapter ${n}`),
        300_000,
      ),
      chaptersUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
      audibleId: 'B0REVIEW01',
    });
    ids.reviewSettled = await seedBook({
      title: 'Lima Review Settled',
      files: 2,
      chapters: chapterList(
        range(3, (n) => `Chapter ${n}`),
        300_000,
      ),
      chaptersUpdatedAt: new Date('2026-09-03T00:00:00.000Z'),
      audibleId: 'B0REVIEW02',
    });
    ids.missing = await seedBook({ title: 'Mike Missing', status: 'missing', audibleId: 'B0MISSING1' });
    ids.ebook = await seedBook({ title: 'November Ebook Only', format: 'epub', audibleId: 'B0EBOOK001' });
    ids.otherLibrary = await seedBook({ title: 'Oscar Other Library', library: libraryB, audibleId: 'B0OTHER001' });

    const finishedAt = new Date('2026-09-02T00:00:00.000Z');
    await ctx.db.insert(schema.chapterLookupQueue).values(
      [ids.reviewOpen!, ids.reviewSettled!].map((bookId) => ({
        bookId,
        userId: editor.userId,
        status: 'review' as const,
        reason: 'runtime_mismatch',
        result: REVIEW_SUMMARY,
        attemptCount: 1,
        finishedAt,
      })),
    );
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('counts each category over the libraries the user can reach', async () => {
    const expected: ChapterHealthSummary = {
      counts: { no_chapters: 2, one_per_file: 1, numbered_tracks: 3, needs_review: 1, edited: 1 },
      withAsin: { no_chapters: 1, one_per_file: 1, numbered_tracks: 1, needs_review: 1, edited: 0 },
    };

    await expect(summary(editor)).resolves.toEqual(expected);
    await expect(summary(editor, `?libraryId=${libraryA.libraryId}`)).resolves.toEqual(expected);
    await expect(summary('admin', `?libraryId=${libraryA.libraryId}`)).resolves.toEqual(expected);
  });

  it('puts each book in the categories its files and chapters call for', async () => {
    await expect(titlesIn(editor, 'no_chapters')).resolves.toEqual(['Alpha Single No Chapters', 'Bravo Single One Chapter']);
    await expect(titlesIn(editor, 'one_per_file')).resolves.toEqual(['Charlie Three Files']);
    // "Chapter 1".."Chapter 10" are real chapters, and 7 numbered titles out of 10 fall short of 80%.
    await expect(titlesIn(editor, 'numbered_tracks')).resolves.toEqual(['Echo Numbered Digits', 'Foxtrot Track Titles', 'Golf Mostly Numbered']);
    // A later chapter save settles a review.
    await expect(titlesIn(editor, 'needs_review')).resolves.toEqual(['Kilo Review Open']);
    await expect(titlesIn(editor, 'edited')).resolves.toEqual(['Juliet Hand Edited']);
  });

  it('describes each listed book, attaching the review only where one waits', async () => {
    const numbered = await request<ChapterHealthPage>(editor, 'GET', '/chapter-health/books?category=numbered_tracks');
    expect(numbered.body.items[0]).toEqual({
      bookId: ids.digits,
      title: 'Echo Numbered Digits',
      authors: [],
      libraryName: libraryAName,
      audioFiles: 1,
      chapterCount: 10,
      source: 'embedded',
      audibleId: 'B0DIGITS01',
      review: null,
    });

    const single = await request<ChapterHealthPage>(editor, 'GET', '/chapter-health/books?category=no_chapters&pageSize=1');
    expect(single.body.items[0]).toMatchObject({ bookId: ids.singleNone, audibleId: 'B0SINGLE01', chapterCount: 0, source: null });

    const review = await request<ChapterHealthPage>(editor, 'GET', '/chapter-health/books?category=needs_review');
    expect(review.body).toEqual({
      total: 1,
      items: [
        expect.objectContaining({
          bookId: ids.reviewOpen,
          audioFiles: 2,
          chapterCount: 3,
          review: { reason: 'runtime_mismatch', summary: REVIEW_SUMMARY },
        }),
      ],
    });
  });

  it('pages through a category with a stable total', async () => {
    const page = (number: number) =>
      request<ChapterHealthPage>(editor, 'GET', `/chapter-health/books?category=no_chapters&pageSize=1&page=${number}`);

    const [first, second, third] = await Promise.all([page(1), page(2), page(3)]);

    expect([first.body.total, second.body.total, third.body.total]).toEqual([2, 2, 2]);
    expect(first.body.items.map((item) => item.bookId)).toEqual([ids.singleNone]);
    expect(second.body.items.map((item) => item.bookId)).toEqual([ids.singleOne]);
    expect(third.body.items).toEqual([]);
  });

  it('refuses a malformed listing', async () => {
    await expect(request(editor, 'GET', '/chapter-health/books?category=bogus')).resolves.toMatchObject({ status: 400 });
    await expect(request(editor, 'GET', '/chapter-health/books')).resolves.toMatchObject({ status: 400 });
    await expect(request(editor, 'GET', '/chapter-health/books?category=edited&pageSize=101')).resolves.toMatchObject({ status: 400 });
  });

  it('covers no library where the user is only a viewer, even with the metadata editing permission', async () => {
    const viewer = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    await grantLibraryAccess(ctx, viewer.userId, libraryA.libraryId, 'viewer');

    await expect(summary(viewer)).resolves.toEqual({
      counts: { no_chapters: 0, one_per_file: 0, numbered_tracks: 0, needs_review: 0, edited: 0 },
      withAsin: { no_chapters: 0, one_per_file: 0, numbered_tracks: 0, needs_review: 0, edited: 0 },
    });
    await expect(request(viewer, 'GET', `/chapter-health/summary?libraryId=${libraryA.libraryId}`)).resolves.toMatchObject({ status: 403 });
    await expect(request(viewer, 'POST', '/chapter-health/lookups', { bookIds: [ids.singleNone!] })).resolves.toMatchObject({
      status: 200,
      body: { queued: 0, skipped: 1 },
    });
  });

  it('shows a user only the libraries they can reach, and refuses one they cannot name', async () => {
    await expect(summary(outsider)).resolves.toEqual({
      counts: { no_chapters: 1, one_per_file: 0, numbered_tracks: 0, needs_review: 0, edited: 0 },
      withAsin: { no_chapters: 1, one_per_file: 0, numbered_tracks: 0, needs_review: 0, edited: 0 },
    });
    await expect(titlesIn(outsider, 'no_chapters')).resolves.toEqual(['Oscar Other Library']);
    await expect(titlesIn(outsider, 'needs_review')).resolves.toEqual([]);

    for (const url of [
      `/chapter-health/summary?libraryId=${libraryA.libraryId}`,
      `/chapter-health/books?category=no_chapters&libraryId=${libraryA.libraryId}`,
    ]) {
      await expect(request(outsider, 'GET', url)).resolves.toMatchObject({ status: 403 });
    }
    await expect(
      request(outsider, 'POST', '/chapter-health/lookups', { category: 'no_chapters', libraryId: libraryA.libraryId }),
    ).resolves.toMatchObject({
      status: 403,
    });
    await expect(request(editor, 'GET', `/chapter-health/books?category=no_chapters&libraryId=${libraryB.libraryId}`)).resolves.toMatchObject({
      status: 403,
    });

    // A superuser reaches every library.
    await expect(summary('admin', `?libraryId=${libraryB.libraryId}`)).resolves.toMatchObject({ counts: { no_chapters: 1 } });
  });

  it('refuses a user without the metadata editing permission', async () => {
    await expect(request(plainUser, 'GET', '/chapter-health/summary')).resolves.toMatchObject({ status: 403 });
    await expect(request(plainUser, 'POST', '/chapter-health/lookups', { bookIds: [ids.singleNone] })).resolves.toMatchObject({ status: 403 });
  });

  it('queues lookups by book or by category, leaving out books without an ASIN or out of reach', async () => {
    const byIds = await request<EnqueueChapterLookupResult>(editor, 'POST', '/chapter-health/lookups', {
      bookIds: [ids.singleNone, ids.singleOne, ids.otherLibrary, 999_999, ids.singleNone, ids.missing, ids.ebook],
    });
    // A missing book and an ebook have ASINs too, but nothing to put chapters on.
    expect(byIds).toEqual({ status: 200, body: { queued: 1, skipped: 5 } });

    const byCategory = await request<EnqueueChapterLookupResult>(editor, 'POST', '/chapter-health/lookups', { category: 'one_per_file' });
    expect(byCategory).toEqual({ status: 200, body: { queued: 1, skipped: 0 } });

    const scoped = await request<EnqueueChapterLookupResult>(editor, 'POST', '/chapter-health/lookups', {
      category: 'numbered_tracks',
      libraryId: libraryA.libraryId,
    });
    expect(scoped).toEqual({ status: 200, body: { queued: 1, skipped: 0 } });

    await expect(request(editor, 'POST', '/chapter-health/lookups', {})).resolves.toMatchObject({ status: 400 });
    await expect(request(editor, 'POST', '/chapter-health/lookups', { bookIds: [] })).resolves.toMatchObject({ status: 400 });
    await expect(request(editor, 'POST', '/chapter-health/lookups', { category: 'everything' })).resolves.toMatchObject({ status: 400 });

    const outside = await request<EnqueueChapterLookupResult>(outsider, 'POST', '/chapter-health/lookups', { bookIds: [ids.singleNone] });
    expect(outside).toEqual({ status: 200, body: { queued: 0, skipped: 1 } });

    const queued = await ctx.db
      .select({ bookId: schema.chapterLookupQueue.bookId, userId: schema.chapterLookupQueue.userId, status: schema.chapterLookupQueue.status })
      .from(schema.chapterLookupQueue)
      .where(eq(schema.chapterLookupQueue.status, 'queued'));
    expect(queued.sort((left, right) => left.bookId - right.bookId)).toEqual(
      [ids.singleNone!, ids.threeNone!, ids.digits!].map((bookId) => ({ bookId, userId: editor.userId, status: 'queued' })),
    );
  });

  it("reports and cancels only the user's own queue", async () => {
    await expect(request<ChapterLookupQueueState>(editor, 'GET', '/chapter-health/lookups/state')).resolves.toEqual({
      status: 200,
      body: { queued: 3, processing: null, finished: { applied: 0, review: 1, not_found: 0, failed: 0, skipped: 1 } },
    });
    await expect(request<ChapterLookupQueueState>(outsider, 'GET', '/chapter-health/lookups/state')).resolves.toMatchObject({
      body: { queued: 0, finished: { review: 0 } },
    });

    await expect(request(outsider, 'DELETE', '/chapter-health/lookups/queued')).resolves.toEqual({ status: 200, body: { removed: 0 } });
    await expect(request(editor, 'DELETE', '/chapter-health/lookups/queued')).resolves.toEqual({ status: 200, body: { removed: 3 } });
    await expect(request<ChapterLookupQueueState>(editor, 'GET', '/chapter-health/lookups/state')).resolves.toMatchObject({
      body: { queued: 0, finished: { review: 1, skipped: 1 } },
    });
  });

  it('applies confident lookups and leaves the rest for a person, without reaching Audible', async () => {
    const worker = ctx.app.get(ChapterLookupWorker);
    const lookupService = ctx.app.get(ChapterLookupService);
    const asin = (bookId: number) => `B0WORKER${String(bookId).padStart(2, '0')}`.slice(0, 20);

    // One hour of audio; Audible's runtime adds a 2 s lead-in and a 3 s sign-off.
    const confident = await seedBook({ title: 'Papa Confident', fileSeconds: 3_600 });
    const mismatched = await seedBook({ title: 'Quebec Mismatched', fileSeconds: 3_600 });
    const missing = await seedBook({ title: 'Romeo Not Found', fileSeconds: 3_600 });
    const lockedChapters = chapterList(['Mine', 'Also Mine'], 1_800_000);
    const locked = await seedBook({
      title: 'Sierra Locked',
      fileSeconds: 3_600,
      chapters: lockedChapters,
      source: 'manual',
      lockedFields: ['chapters'],
    });
    const flaky = await seedBook({ title: 'Tango Unreachable', fileSeconds: 3_600 });
    const lostAsin = await seedBook({ title: 'Uniform Lost ASIN', fileSeconds: 3_600 });
    const books = [confident, mismatched, missing, locked, flaky, lostAsin];
    for (const bookId of books) {
      await ctx.db
        .update(schema.bookMetadata)
        .set({ audibleId: asin(bookId) })
        .where(eq(schema.bookMetadata.bookId, bookId));
    }

    const found: ChapterLookupResult = {
      provider: 'audible',
      asin: asin(confident),
      region: 'us',
      chapters: [
        { title: 'Opening Credits', startMs: 0, lengthMs: 60_000, children: [] },
        { title: 'Chapter 1', startMs: 60_000, lengthMs: 1_740_000, children: [] },
        { title: 'Chapter 2', startMs: 1_800_000, lengthMs: 1_795_000, children: [] },
        { title: 'End Credits', startMs: 3_595_000, lengthMs: 10_000, children: [] },
      ],
      runtimeMs: 3_605_000,
      brandIntroMs: 2_000,
      brandOutroMs: 3_000,
      isAccurate: true,
    };
    const lookup = vi.spyOn(lookupService, 'lookup').mockImplementation((requested) => {
      if (requested === asin(confident) || requested === asin(locked)) return Promise.resolve(found);
      if (requested === asin(mismatched)) return Promise.resolve({ ...found, runtimeMs: 3_625_000 });
      if (requested === asin(missing)) {
        return Promise.reject(
          new HttpException(
            { message: 'No chapters were found for that ASIN', errorCode: BOOK_CHAPTERS_ERROR_CODES.lookupNotFound },
            HttpStatus.NOT_FOUND,
          ),
        );
      }
      if (requested === asin(flaky)) {
        return Promise.reject(new HttpException({ message: 'The chapter sources could not be reached' }, HttpStatus.BAD_GATEWAY));
      }
      return Promise.reject(new Error(`unexpected lookup ${requested}`));
    });

    try {
      const enqueued = await request<EnqueueChapterLookupResult>(editor, 'POST', '/chapter-health/lookups', { bookIds: books });
      expect(enqueued.body).toEqual({ queued: 6, skipped: 0 });
      // The ASIN was cleared after the book was queued.
      await ctx.db.update(schema.bookMetadata).set({ audibleId: null }).where(eq(schema.bookMetadata.bookId, lostAsin));
      // Tests drive the worker; nothing ticked on its own.
      expect((await queueRow(confident))!.status).toBe('queued');

      await worker.tick();
      // A failed lookup waits before its next try; check the wait, then bring each retry forward.
      for (let retry = 0; retry < 2; retry += 1) {
        const waiting = await queueRow(flaky);
        expect(waiting).toMatchObject({ status: 'queued' });
        expect(waiting!.availableAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
        await ctx.db
          .update(schema.chapterLookupQueue)
          .set({ availableAt: new Date(Date.now() - 1_000) })
          .where(eq(schema.chapterLookupQueue.bookId, flaky));
        await worker.tick();
      }

      expect(lookup.mock.calls.map(([requested, region]) => [requested, region])).toEqual([
        [asin(confident), 'us'],
        [asin(mismatched), 'us'],
        [asin(missing), 'us'],
        [asin(locked), 'us'],
        [asin(flaky), 'us'],
        [asin(flaky), 'us'],
        [asin(flaky), 'us'],
      ]);
    } finally {
      lookup.mockRestore();
    }

    const applied = [
      { title: 'Opening Credits', startMs: 0 },
      { title: 'Chapter 1', startMs: 58_000 },
      { title: 'Chapter 2', startMs: 1_798_000 },
      { title: 'End Credits', startMs: 3_593_000 },
    ];
    const summaryOf = (runtimeMs: number): ChapterLookupReviewSummary => ({
      provider: 'audible',
      chapterCount: 4,
      runtimeMs,
      totalDurationMs: 3_600_000,
      isAccurate: true,
    });

    expect(await queueRow(confident)).toMatchObject({
      status: 'applied',
      reason: null,
      result: summaryOf(3_605_000),
      attemptCount: 1,
      lastError: null,
      finishedAt: expect.any(Date),
    });
    expect(await metadataRow(confident)).toEqual({
      chapters: applied,
      chaptersSource: 'provider',
      chaptersUpdatedBy: null,
      lockedFields: ['chapters'],
    });
    expect((await versionsOf(confident)).map((row) => ({ source: row.source, chapterCount: row.chapterCount, createdBy: row.createdBy }))).toEqual([
      { source: 'provider', chapterCount: 4, createdBy: editor.userId },
    ]);
    const state = await request<BookChaptersState>(editor, 'GET', `/books/${confident}/chapters`);
    expect(state.body).toMatchObject({ chapters: applied, source: 'provider', locked: true, versionCount: 1 });

    expect(await queueRow(mismatched)).toMatchObject({ status: 'review', reason: 'runtime_mismatch', result: summaryOf(3_625_000) });
    expect(await metadataRow(mismatched)).toEqual({ chapters: null, chaptersSource: null, chaptersUpdatedBy: null, lockedFields: [] });
    expect(await versionsOf(mismatched)).toEqual([]);

    expect(await queueRow(missing)).toMatchObject({ status: 'not_found', reason: null, result: null });

    expect(await queueRow(locked)).toMatchObject({ status: 'review', reason: 'locked', result: summaryOf(3_605_000) });
    expect(await metadataRow(locked)).toMatchObject({ chapters: lockedChapters, chaptersSource: 'manual', lockedFields: ['chapters'] });
    expect(await versionsOf(locked)).toEqual([]);

    expect(await queueRow(flaky)).toMatchObject({
      status: 'failed',
      attemptCount: 3,
      lastError: 'The chapter sources could not be reached',
      finishedAt: expect.any(Date),
    });
    expect(await queueRow(lostAsin)).toMatchObject({ status: 'skipped', reason: 'no_asin', result: null });

    await expect(request<ChapterLookupQueueState>(editor, 'GET', '/chapter-health/lookups/state')).resolves.toEqual({
      status: 200,
      body: { queued: 0, processing: null, finished: { applied: 1, review: 3, not_found: 1, failed: 1, skipped: 2 } },
    });
    await expect(titlesIn(editor, 'needs_review')).resolves.toEqual(['Kilo Review Open', 'Quebec Mismatched', 'Sierra Locked']);
    await expect(titlesIn(editor, 'no_chapters')).resolves.not.toContain('Papa Confident');
  });

  it('settles a review once the chapters are saved after it', async () => {
    const [mismatched] = await ctx.db
      .select({ bookId: schema.bookMetadata.bookId })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.title, 'Quebec Mismatched'));
    const bookId = mismatched!.bookId;

    const state = await request<BookChaptersState>(editor, 'GET', `/books/${bookId}/chapters`);
    const saved = await request(editor, 'PUT', `/books/${bookId}/chapters`, {
      baseRevision: state.body.revision,
      chapters: [
        { title: 'Opening', startMs: 0 },
        { title: 'Second Half', startMs: 1_800_000 },
      ],
    });
    expect(saved.status).toBe(200);

    await expect(titlesIn(editor, 'needs_review')).resolves.toEqual(['Kilo Review Open', 'Sierra Locked']);
    await expect(titlesIn(editor, 'edited')).resolves.toEqual(['Juliet Hand Edited', 'Quebec Mismatched', 'Sierra Locked']);
    // The outcome stays queued for the person; only the category drops it.
    expect((await queueRow(bookId))!.status).toBe('review');
  });

  it('clears finished outcomes but keeps the reviews still waiting', async () => {
    await expect(request(outsider, 'DELETE', '/chapter-health/lookups/finished')).resolves.toEqual({ status: 200, body: { removed: 0 } });
    await expect(request(editor, 'DELETE', '/chapter-health/lookups/finished')).resolves.toEqual({ status: 200, body: { removed: 6 } });

    const left = await ctx.db.select({ status: schema.chapterLookupQueue.status }).from(schema.chapterLookupQueue);
    expect(left.map((row) => row.status)).toEqual(['review', 'review']);
  });

  it('dismisses a waiting review only for a user who can reach the book', async () => {
    await expect(request(outsider, 'DELETE', `/chapter-health/lookups/${ids.reviewOpen}`)).resolves.toMatchObject({ status: 404 });
    await expect(request(editor, 'DELETE', `/chapter-health/lookups/${ids.singleNone}`)).resolves.toMatchObject({ status: 404 });

    await expect(request(editor, 'DELETE', `/chapter-health/lookups/${ids.reviewOpen}`)).resolves.toEqual({ status: 204, body: null });
    await expect(request(editor, 'DELETE', `/chapter-health/lookups/${ids.reviewOpen}`)).resolves.toMatchObject({ status: 404 });

    await expect(titlesIn(editor, 'needs_review')).resolves.toEqual(['Sierra Locked']);
    const remaining = await ctx.db
      .select({ bookId: schema.chapterLookupQueue.bookId })
      .from(schema.chapterLookupQueue)
      .where(inArray(schema.chapterLookupQueue.bookId, [ids.reviewOpen!, ids.reviewSettled!]));
    expect(remaining).toEqual([]);
  });
  it('hides content-filtered books from health reads, queue status, enqueue, dismissal and execution', async () => {
    const restricted = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
    const isolated = await createLibraryWithFolder(ctx, { name: `health-filter-${randomUUID()}` });
    await grantLibraryAccess(ctx, restricted.userId, isolated.libraryId, 'editor');
    const hidden = await seedBook({ title: 'Hidden chapters', audibleId: 'B0HIDDEN', library: isolated });
    const [tag] = await ctx.db
      .insert(schema.tags)
      .values({ name: `hidden-${randomUUID()}` })
      .returning();
    await ctx.db.insert(schema.bookTags).values({ bookId: hidden, tagId: tag.id });
    await ctx.db.insert(schema.userContentFilterTags).values({ userId: restricted.userId, filterType: 'exclude', tagId: tag.id });
    expect((await request<ChapterHealthSummary>(restricted, 'GET', '/chapter-health/summary')).body.counts.no_chapters).toBe(0);
    expect((await request<ChapterHealthPage>(restricted, 'GET', '/chapter-health/books?category=no_chapters')).body.items).toEqual([]);
    expect((await request<EnqueueChapterLookupResult>(restricted, 'POST', '/chapter-health/lookups', { bookIds: [hidden] })).body).toEqual({
      queued: 0,
      skipped: 1,
    });
    await ctx.db.insert(schema.chapterLookupQueue).values({ bookId: hidden, userId: restricted.userId, status: 'review', finishedAt: new Date() });
    expect((await request<ChapterLookupQueueState>(restricted, 'GET', '/chapter-health/lookups/state')).body.finished.review).toBe(0);
    expect((await request(restricted, 'DELETE', `/chapter-health/lookups/${hidden}`)).status).toBe(404);
    expect(await ctx.app.get(ChapterEditorService).bulkLookup(hidden, restricted.userId)).toMatchObject({
      status: 'skipped',
      reason: 'access_changed',
    });
  });

  it('does not reset a processing claim and ignores late finishes from an older claim', async () => {
    const repo = ctx.app.get(ChapterHealthRepository);
    const book = await seedBook({ title: 'Claim safety', audibleId: 'B0CLAIM' });
    await repo.enqueue([book], editor.userId);
    const first = await repo.claimNext();
    expect(first?.bookId).toBe(book);
    expect(await repo.enqueue([book], outsider.userId)).toBe(0);
    await repo.requeueProcessing();
    const second = await repo.claimNext();
    expect(second?.claimToken).not.toBe(first?.claimToken);
    await repo.finish(book, { status: 'applied', reason: null, result: null }, first!.claimToken);
    const [waiting] = await ctx.db.select().from(schema.chapterLookupQueue).where(eq(schema.chapterLookupQueue.bookId, book));
    expect(waiting.status).toBe('processing');
    await repo.finish(book, { status: 'failed', reason: null, result: null }, second!.claimToken);
  });
  it('advances category batches past 5000 completed candidates in a large library', async () => {
    const large = await createLibraryWithFolder(ctx, { name: `large-health-${randomUUID()}` });
    const seededIds: number[] = [];
    for (let offset = 0; offset < 5100; offset += 500) {
      const count = Math.min(500, 5100 - offset);
      const books = await ctx.db
        .insert(schema.books)
        .values(
          Array.from({ length: count }, (_, index) => ({
            libraryId: large.libraryId,
            libraryFolderId: large.libraryFolderId,
            folderPath: `${large.folderPath}/book-${offset + index}`,
            status: 'present' as const,
          })),
        )
        .returning({ id: schema.books.id });
      seededIds.push(...books.map((book) => book.id));
      await ctx.db
        .insert(schema.bookMetadata)
        .values(books.map((book) => ({ bookId: book.id, title: `Book ${book.id}`, audibleId: `B${String(book.id).padStart(9, '0')}` })));
      await ctx.db.insert(schema.bookFiles).values(
        books.map((book) => ({
          bookId: book.id,
          libraryFolderId: large.libraryFolderId,
          absolutePath: `${large.folderPath}/book-${book.id}/audio.mp3`,
          relPath: `book-${book.id}/audio.mp3`,
          ino: BigInt(book.id),
          sizeBytes: 1000,
          format: 'mp3',
          role: 'content' as const,
          durationSeconds: 60,
        })),
      );
    }
    const payload = { category: 'no_chapters', libraryId: large.libraryId };
    expect((await request<EnqueueChapterLookupResult>('admin', 'POST', '/chapter-health/lookups', payload)).body.queued).toBe(5000);
    await ctx.db
      .update(schema.chapterLookupQueue)
      .set({ status: 'not_found', finishedAt: new Date() })
      .where(inArray(schema.chapterLookupQueue.bookId, seededIds));
    expect((await request<EnqueueChapterLookupResult>('admin', 'POST', '/chapter-health/lookups', payload)).body.queued).toBe(100);
    const listing = await request<ChapterHealthPage>(
      'admin',
      'GET',
      `/chapter-health/books?category=no_chapters&libraryId=${large.libraryId}&page=102`,
    );
    expect(listing.body.total).toBe(5100);
    expect(listing.body.items).toHaveLength(50);
  });
});
