import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { and, count, eq, isNull } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { ReadingAttemptBackfillService } from '../src/modules/user-book-status/reading-attempt-backfill.service';
import { ReadingAttemptService } from '../src/modules/user-book-status/reading-attempt.service';
import { UserBookStatusService } from '../src/modules/user-book-status/user-book-status.service';
import { KoboReadingStateService } from '../src/modules/kobo/services/kobo-reading-state.service';
import { DashboardWidgetRepository } from '../src/modules/dashboard/dashboard-widget.repository';
import { HardcoverRepository } from '../src/modules/hardcover/hardcover.repository';
import { closeE2EContext, createE2EContext, seedLibrary, type E2EContext } from './e2e/app-harness';

const TIMEOUT = 120_000;
const E2E_ROOT = `/tmp/bookorbit-reading-attempts-${randomUUID()}`;

type BookFixture = { bookId: number; fileId: number };

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

describe('Reading attempts main-flow simulation (docker e2e)', { timeout: TIMEOUT }, () => {
  let ctx: E2EContext;
  let adminUserId: number;
  let libraryId: number;
  let libraryFolderId: number;
  let bookSequence = 0;

  async function createBook(): Promise<BookFixture> {
    bookSequence++;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({
        libraryId,
        libraryFolderId,
        folderPath: `reading-attempt-${bookSequence}`,
      })
      .returning({ id: schema.books.id });
    const [file] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        bookId: book.id,
        libraryFolderId,
        absolutePath: `${E2E_ROOT}/reading-attempt-${bookSequence}.epub`,
        relPath: `reading-attempt-${bookSequence}.epub`,
        ino: BigInt(100_000 + bookSequence),
        sizeBytes: 1024,
        format: 'epub',
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: file.id }).where(eq(schema.books.id, book.id));
    return { bookId: book.id, fileId: file.id };
  }

  async function patchStatus(bookId: number, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/status`,
      headers: auth(ctx.adminToken),
      payload,
    });
  }

  async function listAttempts(bookId: number, token = ctx.adminToken, page = 1, pageSize = 100) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/${bookId}/reading-attempts?page=${page}&pageSize=${pageSize}`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { items: Array<typeof schema.readingAttempts.$inferSelect>; total: number };
  }

  beforeAll(async () => {
    ctx = await createE2EContext();
    const [admin] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, 'scanner-e2e-admin')).limit(1);
    adminUserId = admin.id;
    const library = await seedLibrary(ctx.db, { rootPath: E2E_ROOT, mode: 'book_per_file', watch: false });
    libraryId = library.libraryId;
    libraryFolderId = library.libraryFolderId;
    await ctx.db.insert(schema.userLibraryAccess).values({ userId: adminUserId, libraryId, accessLevel: 'owner' }).onConflictDoNothing();
  });

  afterAll(async () => {
    await closeE2EContext(ctx);
  });

  it('1. migrates legacy statuses once and preserves dates', async () => {
    const book = await createBook();
    await ctx.db.insert(schema.userBookStatus).values({
      userId: adminUserId,
      bookId: book.bookId,
      status: 'read',
      source: 'manual',
      startedAt: new Date('2024-01-01T00:00:00.000Z'),
      finishedAt: new Date('2024-01-10T00:00:00.000Z'),
    });
    const backfill = ctx.app.get(ReadingAttemptBackfillService);
    await backfill.onApplicationBootstrap();
    await backfill.onApplicationBootstrap();
    const history = await listAttempts(book.bookId);
    expect(history.total).toBe(1);
    expect(history.items[0]).toMatchObject({ startedOn: '2024-01-01', endedOn: '2024-01-10', outcome: 'completed', origin: 'migration' });
  });

  it('2. runs the first-reading, hold, resume, completion, and idempotency lifecycle', async () => {
    const book = await createBook();
    expect((await patchStatus(book.bookId, { status: 'reading' })).json()).toMatchObject({ status: 'reading' });
    expect((await patchStatus(book.bookId, { status: 'on_hold' })).json()).toMatchObject({ status: 'on_hold' });
    expect((await patchStatus(book.bookId, { status: 'reading' })).json()).toMatchObject({ status: 'reading' });
    expect((await patchStatus(book.bookId, { status: 'read' })).json()).toMatchObject({ status: 'read' });
    await patchStatus(book.bookId, { status: 'read' });
    const history = await listAttempts(book.bookId);
    expect(history.total).toBe(1);
    expect(history.items[0]?.outcome).toBe('completed');
  });

  it('3. starts a manual reread and resets progress without deleting history', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read', startedAt: '2024-01-01', finishedAt: '2024-01-10' });
    await ctx.db.insert(schema.readingProgress).values({ userId: adminUserId, bookFileId: book.fileId, percentage: 100 });
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/reading-attempts/start-reread`,
      headers: auth(ctx.adminToken),
      payload: { resetProgress: true },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ status: 'rereading' });
    expect(await ctx.db.select().from(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, book.fileId))).toHaveLength(0);
    const history = await listAttempts(book.bookId);
    expect(history.total).toBe(2);
    expect(history.items.filter((attempt) => attempt.outcome === null)).toHaveLength(1);
  });

  it('4. starts a reread without resetting existing progress', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read' });
    await ctx.db.insert(schema.readingProgress).values({ userId: adminUserId, bookFileId: book.fileId, percentage: 100 });
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/reading-attempts/start-reread`,
      headers: auth(ctx.adminToken),
      payload: { resetProgress: false },
    });
    expect(response.json()).toMatchObject({ status: 'rereading' });
    const [progress] = await ctx.db.select().from(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, book.fileId));
    expect(progress.percentage).toBe(100);
  });

  it('5. adds and edits partial historical attempts without duplicating them', async () => {
    const book = await createBook();
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/reading-attempts`,
      headers: auth(ctx.adminToken),
      payload: { startedOn: null, endedOn: '2023-04-05', outcome: 'completed' },
    });
    expect(created.statusCode).toBe(201);
    const attempt = created.json() as { id: number };
    const updated = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${book.bookId}/reading-attempts/${attempt.id}`,
      headers: auth(ctx.adminToken),
      payload: { startedOn: '2023-04-01' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ startedOn: '2023-04-01', endedOn: '2023-04-05' });
    expect((await listAttempts(book.bookId)).total).toBe(1);
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/reading-attempts`,
      headers: auth(ctx.adminToken),
      payload: { startedOn: '2023-05-10', endedOn: '2023-05-01', outcome: 'completed' },
    });
    expect(invalid.statusCode).toBe(400);
  });

  it('6. soft-deletes attempts and prevents external resurrection', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    await attempts.importExternalRead(adminUserId, book.bookId, {
      provider: 'hardcover',
      externalId: 'delete-77',
      startedOn: '2022-01-01',
      endedOn: '2022-01-10',
    });
    const history = await listAttempts(book.bookId);
    const attemptId = history.items[0]!.id;
    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${book.bookId}/reading-attempts/${attemptId}`,
      headers: auth(ctx.adminToken),
    });
    expect(deleted.statusCode).toBe(204);
    await attempts.importExternalRead(adminUserId, book.bookId, {
      provider: 'hardcover',
      externalId: 'delete-77',
      startedOn: '2022-01-01',
      endedOn: '2022-01-11',
    });
    expect((await listAttempts(book.bookId)).total).toBe(0);
  });

  it('7. closes active attempts as abandoned when moving to unread or want-to-read', async () => {
    for (const status of ['unread', 'want_to_read'] as const) {
      const book = await createBook();
      await patchStatus(book.bookId, { status: 'reading' });
      expect((await patchStatus(book.bookId, { status })).json()).toMatchObject({ status });
      const history = await listAttempts(book.bookId);
      expect(history.items[0]?.outcome).toBe('abandoned');
    }
  });

  it('8. explicitly resets attempts, sessions, progress, and status', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'reading' });
    await ctx.db.insert(schema.readingProgress).values({ userId: adminUserId, bookFileId: book.fileId, percentage: 25 });
    const reset = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/reset-reading-state`,
      headers: auth(ctx.adminToken),
    });
    expect(reset.statusCode).toBe(201);
    expect(reset.json()).toMatchObject({ readStatus: { status: 'unread' } });
    expect((await listAttempts(book.bookId)).total).toBe(0);
  });

  it('9. detects web rereads from a substantial progress rollback and completes the same attempt', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read', startedAt: '2024-01-01', finishedAt: '2024-01-10' });
    await ctx.db.insert(schema.readingProgress).values({ userId: adminUserId, bookFileId: book.fileId, percentage: 100 });
    const rollback = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${book.fileId}/progress`,
      headers: auth(ctx.adminToken),
      payload: { percentage: 20 },
    });
    expect(rollback.statusCode).toBe(201);
    expect((await ctx.db.select().from(schema.userBookStatus).where(eq(schema.userBookStatus.bookId, book.bookId)))[0]?.status).toBe('rereading');
    await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${book.fileId}/progress`,
      headers: auth(ctx.adminToken),
      payload: { percentage: 99 },
    });
    const history = await listAttempts(book.bookId);
    expect(history.items.filter((attempt) => attempt.outcome === 'completed')).toHaveLength(2);
  });

  it('10. simulates KOReader strong and repeated progress signals idempotently', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read' });
    const statuses = ctx.app.get(UserBookStatusService);
    await statuses.autoUpdate(adminUserId, book.bookId, 20, 1, 98, {
      origin: 'koreader',
      occurredOn: '2026-02-01',
      strongRereadEvidence: true,
    });
    await statuses.autoUpdate(adminUserId, book.bookId, 20, 1, 98, {
      origin: 'koreader',
      occurredOn: '2026-02-01',
      strongRereadEvidence: false,
    });
    const history = await listAttempts(book.bookId);
    expect(history.items.filter((attempt) => attempt.outcome === null)).toHaveLength(1);
    expect(history.items[0]?.origin).toBe('koreader');
  });

  it('11. simulates the Kobo issue payload and preserves the original completion', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read', startedAt: '2024-01-01', finishedAt: '2024-01-10' });
    const kobo = ctx.app.get(KoboReadingStateService);
    await kobo.upsertState(
      adminUserId,
      book.bookId,
      {
        LastModified: '2026-03-01T00:00:00.000Z',
        CurrentBookmark: { LastModified: '2026-03-01T00:00:00.000Z', ProgressPercent: 100 },
        StatusInfo: { LastModified: '2026-03-01T00:00:00.000Z', Status: 'ReadyToRead', TimesStartedReading: 1 },
      },
      1,
      98,
      false,
      1,
    );
    await kobo.upsertState(
      adminUserId,
      book.bookId,
      {
        LastModified: '2026-03-02T00:00:00.000Z',
        CurrentBookmark: { LastModified: '2026-03-02T00:00:00.000Z', ProgressPercent: 20 },
        StatusInfo: { LastModified: '2026-03-02T00:00:00.000Z', Status: 'Reading', TimesStartedReading: 2 },
      },
      1,
      98,
      false,
      1,
    );
    const history = await listAttempts(book.bookId);
    expect(history.total).toBe(2);
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ startedOn: '2024-01-01', endedOn: '2024-01-10', outcome: 'completed' }),
        expect.objectContaining({ startedOn: '2026-03-02', outcome: null, origin: 'kobo' }),
      ]),
    );
  });

  it('12. converges concurrent multi-device reread signals to one active attempt', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read' });
    const attempts = ctx.app.get(ReadingAttemptService);
    await Promise.all([
      attempts.recordActivity({
        userId: adminUserId,
        bookId: book.bookId,
        occurredOn: '2026-04-01',
        origin: 'kobo',
        progress: 10,
        finishThreshold: 98,
        strongRereadEvidence: true,
        meaningfulActivity: false,
      }),
      attempts.recordActivity({
        userId: adminUserId,
        bookId: book.bookId,
        occurredOn: '2026-04-01',
        origin: 'kobo',
        progress: 12,
        finishThreshold: 98,
        strongRereadEvidence: true,
        meaningfulActivity: false,
      }),
    ]);
    const [row] = await ctx.db
      .select({ value: count() })
      .from(schema.readingAttempts)
      .where(
        and(
          eq(schema.readingAttempts.userId, adminUserId),
          eq(schema.readingAttempts.bookId, book.bookId),
          isNull(schema.readingAttempts.outcome),
          isNull(schema.readingAttempts.deletedAt),
        ),
      );
    expect(row.value).toBe(1);
  });

  it('13. imports every Hardcover read idempotently', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    for (const read of [
      { externalId: 'hc-101', startedOn: '2020-01-01', endedOn: '2020-01-15' },
      { externalId: 'hc-102', startedOn: '2022-02-01', endedOn: '2022-02-10' },
    ]) {
      await attempts.importExternalRead(adminUserId, book.bookId, { provider: 'hardcover', ...read });
      await attempts.importExternalRead(adminUserId, book.bookId, { provider: 'hardcover', ...read });
    }
    const history = await listAttempts(book.bookId);
    expect(history.total).toBe(2);
    expect(new Set(history.items.map((attempt) => attempt.externalId))).toEqual(new Set(['hc-101', 'hc-102']));
  });

  it('14. links outbound Hardcover reads without replacing attempt identity', async () => {
    const book = await createBook();
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/reading-attempts`,
      headers: auth(ctx.adminToken),
      payload: { startedOn: '2021-01-01', endedOn: '2021-01-05', outcome: 'completed' },
    });
    const attemptId = (response.json() as { id: number }).id;
    const hardcover = ctx.app.get(HardcoverRepository);
    await hardcover.linkReadingAttempt(adminUserId, attemptId, 9001);
    await hardcover.linkReadingAttempt(adminUserId, attemptId, 9001);
    const [row] = await ctx.db.select().from(schema.readingAttempts).where(eq(schema.readingAttempts.id, attemptId));
    expect(row).toMatchObject({ externalProvider: 'hardcover', externalId: '9001' });
  });

  it('15. counts completed rereads in goals while excluding skimmed and undated attempts', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    const dashboard = ctx.app.get(DashboardWidgetRepository);
    const completedBefore = await dashboard.getCompletedBooksThisYear(adminUserId, [libraryId]);
    const year = new Date().getUTCFullYear();
    await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: `${year}-01-01`,
      endedOn: `${year}-01-10`,
      outcome: 'completed',
    });
    await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: `${year}-02-01`,
      endedOn: `${year}-02-10`,
      outcome: 'completed',
    });
    await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: `${year}-03-01`,
      endedOn: `${year}-03-10`,
      outcome: 'skimmed',
    });
    await attempts.createHistorical(adminUserId, book.bookId, { startedOn: null, endedOn: null, outcome: 'completed' });
    await expect(dashboard.getCompletedBooksThisYear(adminUserId, [libraryId])).resolves.toBe(completedBefore + 2);
  });

  it('16. isolates attempt history between users sharing a library', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read' });
    const username = `attempt-user-${randomUUID()}`;
    const password = 'AttemptUser123!';
    const [user] = await ctx.db
      .insert(schema.users)
      .values({
        username,
        name: 'Attempt User',
        passwordHash: await hash(password, 4),
        isDefaultPassword: false,
        provisioningMethod: 'local',
      })
      .returning({ id: schema.users.id });
    await ctx.db.insert(schema.userLibraryAccess).values({ userId: user.id, libraryId, accessLevel: 'viewer' });
    const login = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
    const token = (login.json() as { accessToken: string }).accessToken;
    const userHistory = await listAttempts(book.bookId, token);
    expect(userHistory.total).toBe(0);
    const adminHistory = await listAttempts(book.bookId);
    const forbiddenPatch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${book.bookId}/reading-attempts/${adminHistory.items[0]!.id}`,
      headers: auth(token),
      payload: { startedOn: '2020-01-01' },
    });
    expect(forbiddenPatch.statusCode).toBe(404);
  });

  it('17. paginates long histories newest-first without overlap', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    for (let index = 1; index <= 12; index++) {
      const day = String(index).padStart(2, '0');
      await attempts.createHistorical(adminUserId, book.bookId, {
        startedOn: `2020-01-${day}`,
        endedOn: `2020-01-${day}`,
        outcome: 'completed',
      });
    }
    const first = await listAttempts(book.bookId, ctx.adminToken, 1, 10);
    const second = await listAttempts(book.bookId, ctx.adminToken, 2, 10);
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((attempt) => attempt.id)).size).toBe(12);
    expect(first.items[0]!.id).toBeGreaterThan(first.items.at(-1)!.id);
  });

  it('18. preserves database invariants and associates sessions to the active attempt', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'reading' });
    const session = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/sessions`,
      headers: auth(ctx.adminToken),
      payload: {
        startedAt: '2026-05-01T10:00:00.000Z',
        durationMinutes: 10,
        endProgress: 15,
        format: 'epub',
      },
    });
    expect(session.statusCode).toBe(201);
    const [savedSession] = await ctx.db.select().from(schema.readingSessions).where(eq(schema.readingSessions.bookId, book.bookId));
    expect(savedSession.attemptId).not.toBeNull();
    const duplicates = await ctx.db
      .select({ value: count() })
      .from(schema.readingAttempts)
      .where(
        and(
          eq(schema.readingAttempts.userId, adminUserId),
          eq(schema.readingAttempts.bookId, book.bookId),
          isNull(schema.readingAttempts.outcome),
          isNull(schema.readingAttempts.deletedAt),
        ),
      );
    expect(duplicates[0]?.value).toBe(1);
    await expect(
      ctx.db.insert(schema.readingAttempts).values({
        userId: adminUserId,
        bookId: book.bookId,
        startedOn: '2026-05-02',
        endedOn: null,
        outcome: null,
        origin: 'manual',
      }),
    ).rejects.toThrow();
  });
  it('19. reports an ownership conflict instead of throwing when another attempt holds the read', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    const hardcover = ctx.app.get(HardcoverRepository);
    const owner = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2022-01-01',
      endedOn: '2022-01-05',
      outcome: 'completed',
    });
    const rival = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2022-03-01',
      endedOn: '2022-03-05',
      outcome: 'completed',
    });

    await expect(hardcover.linkReadingAttempt(adminUserId, owner.id, 9101)).resolves.toBe('linked');
    await expect(hardcover.linkReadingAttempt(adminUserId, rival.id, 9101)).resolves.toBe('conflict');

    const [rivalRow] = await ctx.db.select().from(schema.readingAttempts).where(eq(schema.readingAttempts.id, rival.id));
    expect(rivalRow?.externalId).toBeNull();
    const [ownerRow] = await ctx.db.select().from(schema.readingAttempts).where(eq(schema.readingAttempts.id, owner.id));
    expect(ownerRow).toMatchObject({ externalId: '9101', deletedAt: null });
  });

  it('20. keeps a soft-deleted attempt tombstone reserved against reuse', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    const hardcover = ctx.app.get(HardcoverRepository);
    const removed = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2022-06-01',
      endedOn: '2022-06-05',
      outcome: 'completed',
    });
    await hardcover.linkReadingAttempt(adminUserId, removed.id, 9202);
    await attempts.delete(adminUserId, book.bookId, removed.id);
    const survivor = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2022-09-01',
      endedOn: '2022-09-05',
      outcome: 'completed',
    });

    await expect(hardcover.linkReadingAttempt(adminUserId, survivor.id, 9202)).resolves.toBe('conflict');
    await expect(hardcover.findClaimedHardcoverReadIds(adminUserId, book.bookId)).resolves.toContain(9202);
  });

  it('21. lists claimed read ids across live and soft-deleted attempts', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    const hardcover = ctx.app.get(HardcoverRepository);
    const live = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2023-01-01',
      endedOn: '2023-01-05',
      outcome: 'completed',
    });
    const deleted = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2023-04-01',
      endedOn: '2023-04-05',
      outcome: 'completed',
    });
    await hardcover.linkReadingAttempt(adminUserId, live.id, 9301);
    await hardcover.linkReadingAttempt(adminUserId, deleted.id, 9302);
    await attempts.delete(adminUserId, book.bookId, deleted.id);

    const claimed = await hardcover.findClaimedHardcoverReadIds(adminUserId, book.bookId);

    expect(new Set(claimed)).toEqual(new Set([9301, 9302]));
  });

  it('22. lets an attempt restamp the same read but rejects reassignment', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    const hardcover = ctx.app.get(HardcoverRepository);
    const attempt = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2023-07-01',
      endedOn: '2023-07-05',
      outcome: 'completed',
    });

    await expect(hardcover.linkReadingAttempt(adminUserId, attempt.id, 9401)).resolves.toBe('linked');
    await expect(hardcover.linkReadingAttempt(adminUserId, attempt.id, 9401)).resolves.toBe('linked');
    await expect(hardcover.linkReadingAttempt(adminUserId, attempt.id, 9402)).resolves.toBe('conflict');

    await expect(hardcover.findClaimedHardcoverReadIds(adminUserId, book.bookId)).resolves.toEqual([9401]);
  });

  it('23. lets exactly one concurrent claim establish attempt ownership', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    const hardcover = ctx.app.get(HardcoverRepository);
    const attempt = await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2023-08-01',
      endedOn: '2023-08-05',
      outcome: 'completed',
    });

    const outcomes = await Promise.all([
      hardcover.linkReadingAttempt(adminUserId, attempt.id, 9501),
      hardcover.linkReadingAttempt(adminUserId, attempt.id, 9502),
    ]);

    expect(outcomes.sort()).toEqual(['conflict', 'linked']);
    const claimed = await hardcover.findClaimedHardcoverReadIds(adminUserId, book.bookId);
    expect(claimed).toHaveLength(1);
    expect([9501, 9502]).toContain(claimed[0]);
  });
  it('24. surfaces attempt timestamps as Dates so sync change detection can compare them', async () => {
    const book = await createBook();
    const attempts = ctx.app.get(ReadingAttemptService);
    const hardcover = ctx.app.get(HardcoverRepository);
    const before = new Date(Date.now() - 60_000);
    await attempts.createHistorical(adminUserId, book.bookId, {
      startedOn: '2024-02-01',
      endedOn: '2024-02-05',
      outcome: 'completed',
    });

    const sync = await hardcover.findBookSyncData(adminUserId, book.bookId);
    const updatedAt = sync?.attemptsUpdatedAt ?? null;

    // A raw driver timestamp string compares false against a Date, which silently disables the
    // attempt-history branch of hasChanges and stops attempt edits from ever re-triggering a sync.
    expect(updatedAt).toBeInstanceOf(Date);
    expect(updatedAt instanceof Date && updatedAt > before).toBe(true);
  });

  it('25. leaves the attempt timestamp null for a book with no attempts', async () => {
    const book = await createBook();
    const hardcover = ctx.app.get(HardcoverRepository);

    const sync = await hardcover.findBookSyncData(adminUserId, book.bookId);

    expect(sync?.attemptsUpdatedAt ?? null).toBeNull();
  });

  it('26. lets lifecycle dates create and complete attempts through the status API', async () => {
    const startedOnly = await createBook();
    const startResponse = await patchStatus(startedOnly.bookId, { startedAt: '2026-01-10' });
    expect(startResponse.statusCode).toBe(200);
    expect(startResponse.json()).toMatchObject({ status: 'reading', startedAt: '2026-01-10', finishedAt: null });
    expect((await listAttempts(startedOnly.bookId)).items).toEqual([
      expect.objectContaining({ startedOn: '2026-01-10', endedOn: null, outcome: null, origin: 'manual' }),
    ]);

    const bothDates = await createBook();
    const bothResponse = await patchStatus(bothDates.bookId, { startedAt: '2026-02-01', finishedAt: '2026-02-10' });
    expect(bothResponse.statusCode).toBe(200);
    expect(bothResponse.json()).toMatchObject({ status: 'read', startedAt: '2026-02-01', finishedAt: '2026-02-10' });
    expect((await listAttempts(bothDates.bookId)).items).toEqual([
      expect.objectContaining({ startedOn: '2026-02-01', endedOn: '2026-02-10', outcome: 'completed', origin: 'manual' }),
    ]);

    const sameDay = await createBook();
    const sameDayResponse = await patchStatus(sameDay.bookId, { startedAt: '2026-02-15', finishedAt: '2026-02-15' });
    expect(sameDayResponse.statusCode).toBe(200);
    expect(sameDayResponse.json()).toMatchObject({ status: 'read', startedAt: '2026-02-15', finishedAt: '2026-02-15' });
    expect((await listAttempts(sameDay.bookId)).items).toEqual([
      expect.objectContaining({ startedOn: '2026-02-15', endedOn: '2026-02-15', outcome: 'completed', origin: 'manual' }),
    ]);
  });

  it('27. closes active lifecycle states with a date-only finish patch', async () => {
    for (const status of ['reading', 'rereading', 'on_hold'] as const) {
      const book = await createBook();
      if (status === 'rereading') {
        await patchStatus(book.bookId, { status: 'read', startedAt: '2025-01-01', finishedAt: '2025-01-10' });
      }
      await patchStatus(book.bookId, { status, startedAt: '2026-03-01' });

      const response = await patchStatus(book.bookId, { finishedAt: '2026-03-10' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'read', startedAt: '2026-03-01', finishedAt: '2026-03-10' });
      const history = await listAttempts(book.bookId);
      expect(history.items[0]).toMatchObject({ startedOn: '2026-03-01', endedOn: '2026-03-10', outcome: 'completed' });
      expect(history.items.filter((attempt) => attempt.outcome === null)).toHaveLength(0);
    }
  });

  it('28. preserves completion when its finish date is cleared', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'read', startedAt: '2026-04-01', finishedAt: '2026-04-10' });

    const response = await patchStatus(book.bookId, { finishedAt: null });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'read', startedAt: '2026-04-01', finishedAt: null });
    expect((await listAttempts(book.bookId)).items).toEqual([
      expect.objectContaining({ startedOn: '2026-04-01', endedOn: null, outcome: 'completed' }),
    ]);
  });

  it('30. keeps a lifecycle-clearing status free of dates it cannot own', async () => {
    const book = await createBook();
    await patchStatus(book.bookId, { status: 'unread' });

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${book.bookId}/reading-attempts`,
      headers: auth(ctx.adminToken),
      payload: { startedOn: '2026-06-01', endedOn: '2026-06-10', outcome: 'completed' },
    });
    expect(created.statusCode).toBe(201);

    const [projected] = await ctx.db
      .select({ status: schema.userBookStatus.status, startedAt: schema.userBookStatus.startedAt, finishedAt: schema.userBookStatus.finishedAt })
      .from(schema.userBookStatus)
      .where(and(eq(schema.userBookStatus.userId, adminUserId), eq(schema.userBookStatus.bookId, book.bookId)))
      .limit(1);

    expect(projected).toMatchObject({ status: 'unread', startedAt: null, finishedAt: null });
    expect((await listAttempts(book.bookId)).items[0]).toMatchObject({ startedOn: '2026-06-01', endedOn: '2026-06-10', outcome: 'completed' });
  });

  it('29. rejects conflicting lifecycle dates without reaching a database constraint', async () => {
    const book = await createBook();
    const response = await patchStatus(book.bookId, { status: 'reading', startedAt: '2026-05-01', finishedAt: '2026-05-10' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ errorCode: 'READING_DATES_STATUS_CONFLICT' });
    expect((await listAttempts(book.bookId)).total).toBe(0);
  });

  it('31. counts completed attempts in completion analytics regardless of session end progress', async () => {
    const username = `attempt-stats-${randomUUID()}`;
    const password = 'AttemptStats123!';
    const [user] = await ctx.db
      .insert(schema.users)
      .values({
        username,
        name: 'Attempt Stats User',
        passwordHash: await hash(password, 4),
        isDefaultPassword: false,
        provisioningMethod: 'local',
      })
      .returning({ id: schema.users.id });
    await ctx.db.insert(schema.userLibraryAccess).values({ userId: user.id, libraryId, accessLevel: 'viewer' });

    const attempts = ctx.app.get(ReadingAttemptService);
    const endProgressValues = [99.7, 94.7, 86.8];
    for (const [index, endProgress] of endProgressValues.entries()) {
      const book = await createBook();
      const endedAt = new Date();
      endedAt.setUTCDate(endedAt.getUTCDate() - (index + 1) * 3);
      const startedAt = new Date(endedAt);
      startedAt.setUTCDate(startedAt.getUTCDate() - 2);
      const startedOn = startedAt.toISOString().slice(0, 10);
      const endedOn = endedAt.toISOString().slice(0, 10);
      const attempt = await attempts.createHistorical(user.id, book.bookId, { startedOn, endedOn, outcome: 'completed' });

      const sessionStartedAt = new Date(`${startedOn}T10:00:00.000Z`);
      const sessionEndedAt = new Date(sessionStartedAt.getTime() + 60 * 60 * 1000);
      await ctx.db.insert(schema.readingSessions).values({
        userId: user.id,
        bookFileId: book.fileId,
        bookId: book.bookId,
        attemptId: attempt.id,
        sessionId: `attempt-stats-${randomUUID()}`,
        source: 'koreader',
        startedAt: sessionStartedAt,
        endedAt: sessionEndedAt,
        durationSeconds: 3600,
        progressDelta: 10,
        endProgress,
      });
    }

    const excludedBook = await createBook();
    const excluded = await attempts.createHistorical(user.id, excludedBook.bookId, {
      startedOn: '2026-01-01',
      endedOn: '2026-01-02',
      outcome: 'completed',
    });
    await attempts.delete(user.id, excludedBook.bookId, excluded.id);
    await attempts.createHistorical(user.id, excludedBook.bookId, {
      startedOn: '2026-01-03',
      endedOn: '2026-01-04',
      outcome: 'skimmed',
    });
    await attempts.createHistorical(user.id, excludedBook.bookId, { startedOn: null, endedOn: null, outcome: 'completed' });

    const login = await ctx.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
    expect(login.statusCode).toBe(200);
    const token = (login.json() as { accessToken: string }).accessToken;

    const timelineResponse = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/user-statistics/completion-timeline?days=365',
      headers: auth(token),
    });
    expect(timelineResponse.statusCode).toBe(200);
    const timeline = timelineResponse.json() as Array<{ count: number }>;
    expect(timeline.reduce((sum, point) => sum + point.count, 0)).toBe(3);

    const goalResponse = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/user-statistics/goal-trajectory?days=365&goalBooks=12',
      headers: auth(token),
    });
    expect(goalResponse.statusCode).toBe(200);
    const goal = goalResponse.json() as { points: Array<{ actualCumulative: number }> };
    expect(goal.points.at(-1)?.actualCumulative).toBe(3);

    const latencyResponse = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/user-statistics/completion-latency?days=365',
      headers: auth(token),
    });
    expect(latencyResponse.statusCode).toBe(200);
    expect(latencyResponse.json()).toMatchObject({ totalCompletions: 3, medianDays: 2 });
  });
});
