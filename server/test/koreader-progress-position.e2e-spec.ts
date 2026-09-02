import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { ReadingSessionService } from '../src/modules/reading-session/reading-session.service';
import { createCbzFixture, createEpubFixture } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type LocatedBookFile,
  type ReaderStateIsolationE2EContext,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

const KOREADER_USERNAME = `progress-position-device-${randomUUID().slice(0, 8)}`;
const KOREADER_PASSWORD = 'ProgressPositionPass123';
const XPOINTER = '/body/DocFragment[8]/body/p[12]/text().0';
const DEVICE_ID = 'progress-regression-device';

/**
 * KOReader reports a paged document's position as a page number and a reflowable one's as an
 * xpointer. Both arrive on the same endpoint, so these cases assert the position lands in the
 * column the web reader actually resumes from for that format, against a real database.
 */
describe('KOReader progress position routing (e2e)', { timeout: 180_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let comic!: LocatedBookFile;
  let epub!: LocatedBookFile;
  let comicHash!: string;
  let epubHash!: string;

  function deviceHeaders(): Record<string, string> {
    return { 'x-auth-user': KOREADER_USERNAME, 'x-auth-key': KOREADER_PASSWORD };
  }

  async function fileHashFor(bookFileId: number): Promise<string> {
    const [row] = await ctx.db.select({ fileHash: schema.bookFiles.fileHash }).from(schema.bookFiles).where(eq(schema.bookFiles.id, bookFileId));
    expect(row?.fileHash).toBeTruthy();
    return row!.fileHash!;
  }

  async function syncFromDevice(hash: string, percentage: number, progress?: string | number) {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/syncs/progress',
      headers: deviceHeaders(),
      payload: {
        document: hash,
        percentage,
        device: 'Regression device',
        device_id: DEVICE_ID,
        ...(progress === undefined ? {} : { progress }),
      },
    });
    expect(response.statusCode).toBe(200);
  }

  async function storedProgress(bookFileId: number) {
    const [row] = await ctx.db
      .select({
        percentage: schema.readingProgress.percentage,
        cfi: schema.readingProgress.cfi,
        pageNumber: schema.readingProgress.pageNumber,
        koreaderProgress: schema.readingProgress.koreaderProgress,
      })
      .from(schema.readingProgress)
      .where(eq(schema.readingProgress.bookFileId, bookFileId));
    return row;
  }

  /** What the web reader loads when it opens the book. */
  async function readerProgress(bookFileId: number) {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/books/files/${bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { percentage: number; cfi: string | null; pageNumber: number | null };
  }

  async function saveFromWebReader(bookFileId: number, payload: Record<string, unknown>) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/files/${bookFileId}/progress`,
      headers: authHeader(ctx.adminToken),
      payload,
    });
    expect([200, 201, 204]).toContain(response.statusCode);
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `koreader-progress-position-${randomUUID()}` });

    const comicPath = await createCbzFixture(library.folderPath, 'progress-position-comic.cbz', {
      title: `Progress Position Comic ${randomUUID()}`,
    });
    const epubPath = await createEpubFixture(library.folderPath, 'progress-position-book.epub', {
      title: `Progress Position Book ${randomUUID()}`,
      uid: `urn:uuid:${randomUUID()}`,
    });

    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    comic = await locateBookByAbsolutePath(ctx, comicPath);
    epub = await locateBookByAbsolutePath(ctx, epubPath);
    comicHash = await fileHashFor(comic.bookFileId);
    epubHash = await fileHashFor(epub.bookFileId);

    const credentials = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/credentials',
      headers: authHeader(ctx.adminToken),
      payload: { username: KOREADER_USERNAME, password: KOREADER_PASSWORD },
    });
    expect([200, 201]).toContain(credentials.statusCode);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('stores a paged position as a page number the web reader can resume from', async () => {
    await syncFromDevice(comicHash, 0.4, '117');

    const stored = await storedProgress(comic.bookFileId);
    expect(stored?.pageNumber).toBe(117);
    expect(stored?.cfi).toBeNull();
    expect(stored?.koreaderProgress).toBe('117');
    expect(stored?.percentage).toBeCloseTo(40, 5);

    await expect(readerProgress(comic.bookFileId)).resolves.toEqual(expect.objectContaining({ pageNumber: 117, cfi: null }));
  });

  it('accepts the numeric page KOReader serializes for a paged document', async () => {
    await syncFromDevice(comicHash, 0.5, 208);

    expect((await storedProgress(comic.bookFileId))?.pageNumber).toBe(208);
  });

  it('advances the stored page on the next sync of the same book', async () => {
    await syncFromDevice(comicHash, 0.6, '242');

    expect((await storedProgress(comic.bookFileId))?.pageNumber).toBe(242);
  });

  it('leaves the page column empty for a reflowable document', async () => {
    await syncFromDevice(epubHash, 0.3, XPOINTER);

    const stored = await storedProgress(epub.bookFileId);
    expect(stored?.pageNumber).toBeNull();
    expect(stored?.koreaderProgress).toBe(XPOINTER);
    expect((await readerProgress(epub.bookFileId)).pageNumber).toBeNull();
  });

  it('accepts document metadata on progress sync requests', async () => {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/syncs/progress',
      headers: deviceHeaders(),
      payload: {
        document: epubHash,
        percentage: 0.35,
        progress: XPOINTER,
        device: 'Regression device',
        device_id: DEVICE_ID,
        metadata: { filename: 'progress-position-book.epub', title: 'Progress Position Book', authors: 'Test Author' },
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it('replaces a page saved by the web reader instead of discarding it', async () => {
    await saveFromWebReader(comic.bookFileId, { percentage: 12, pageNumber: 34 });
    expect((await storedProgress(comic.bookFileId))?.pageNumber).toBe(34);

    await syncFromDevice(comicHash, 0.55, '221');

    expect((await storedProgress(comic.bookFileId))?.pageNumber).toBe(221);
  });

  it('clears a stale page when the device sends a position it cannot supply', async () => {
    await syncFromDevice(comicHash, 0.7, '300');
    expect((await storedProgress(comic.bookFileId))?.pageNumber).toBe(300);

    await syncFromDevice(comicHash, 0.75);

    const stored = await storedProgress(comic.bookFileId);
    expect(stored?.pageNumber).toBeNull();
    expect(stored?.percentage).toBeCloseTo(75, 5);
  });

  it('rejects a page that would overflow the column rather than failing the sync', async () => {
    await syncFromDevice(comicHash, 0.8, '99999999999999');

    const stored = await storedProgress(comic.bookFileId);
    expect(stored?.pageNumber).toBeNull();
    expect(stored?.percentage).toBeCloseTo(80, 5);
  });

  it('never turns KOSync progress pushes into reading sessions', async () => {
    await syncFromDevice(epubHash, 0.4, XPOINTER);
    await ctx.db
      .update(schema.koreaderDeviceProgress)
      .set({ updatedAt: new Date(Date.now() - 12 * 60 * 1000) })
      .where(and(eq(schema.koreaderDeviceProgress.bookFileId, epub.bookFileId), eq(schema.koreaderDeviceProgress.deviceId, DEVICE_ID)));

    await syncFromDevice(epubHash, 0.5, XPOINTER);

    const sessions = await ctx.db
      .select({ id: schema.readingSessions.id })
      .from(schema.readingSessions)
      .where(and(eq(schema.readingSessions.bookFileId, epub.bookFileId), eq(schema.readingSessions.source, 'koreader')));
    expect(sessions).toEqual([]);
  });

  it('removes only historical KOSync estimates during repair', async () => {
    const [koreaderUser] = await ctx.db
      .select({ userId: schema.koreaderUsers.userId })
      .from(schema.koreaderUsers)
      .where(eq(schema.koreaderUsers.username, KOREADER_USERNAME));
    expect(koreaderUser).toBeDefined();

    const legacySessionId = `ks-${'a'.repeat(12)}-${'b'.repeat(32)}`;
    const measuredSessionId = 'kor:cleanup-supported';
    const webSessionId = 'web-cleanup-supported';
    const startedAt = new Date('2026-08-31T10:00:00.000Z');
    const endedAt = new Date('2026-08-31T10:10:00.000Z');
    await ctx.db.insert(schema.readingSessions).values(
      [
        { sessionId: legacySessionId, source: 'koreader' as const },
        { sessionId: measuredSessionId, source: 'koreader' as const },
        { sessionId: webSessionId, source: 'web' as const },
      ].map((session) => ({
        ...session,
        userId: koreaderUser!.userId,
        bookId: epub.bookId,
        bookFileId: epub.bookFileId,
        startedAt,
        endedAt,
        durationSeconds: 600,
        progressDelta: 2,
        endProgress: 50,
      })),
    );

    await expect(ctx.app.get(ReadingSessionService).deleteLegacyKoreaderSyncEstimatesBatch(500)).resolves.toEqual({ deleted: 1 });

    const remaining = await ctx.db
      .select({ sessionId: schema.readingSessions.sessionId })
      .from(schema.readingSessions)
      .where(and(eq(schema.readingSessions.userId, koreaderUser!.userId), eq(schema.readingSessions.bookFileId, epub.bookFileId)));
    expect(remaining.map((row) => row.sessionId).sort()).toEqual([measuredSessionId, webSessionId].sort());
  });

  it('does not route progress when the document hash matches different books', async () => {
    const comicProgressBefore = await storedProgress(comic.bookFileId);
    const epubProgressBefore = await storedProgress(epub.bookFileId);

    await ctx.db.update(schema.bookFiles).set({ fileHash: comicHash }).where(eq(schema.bookFiles.id, epub.bookFileId));

    try {
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/koreader/syncs/progress',
        headers: deviceHeaders(),
        payload: { document: comicHash, percentage: 0.99, progress: '999' },
      });

      expect(response.statusCode).toBe(404);
      await expect(storedProgress(comic.bookFileId)).resolves.toEqual(comicProgressBefore);
      await expect(storedProgress(epub.bookFileId)).resolves.toEqual(epubProgressBefore);
    } finally {
      await ctx.db.update(schema.bookFiles).set({ fileHash: epubHash }).where(eq(schema.bookFiles.id, epub.bookFileId));
    }
  });
});
