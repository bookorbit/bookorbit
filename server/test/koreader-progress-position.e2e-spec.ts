import { randomUUID } from 'crypto';
import { rename } from 'fs/promises';
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

  async function syncFromDevice(hash: string, percentage: number, progress?: string | number, timestamp?: number) {
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
        ...(timestamp === undefined ? {} : { timestamp }),
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

  it.each(['web', 'narration'])('restores the complete %s reader position and retains its text offset on device upload', async (source) => {
    await ctx.db
      .update(schema.koreaderDeviceProgress)
      .set({ updatedAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(schema.koreaderDeviceProgress.bookFileId, epub.bookFileId));
    const cfi = 'epubcfi(/6/2!/4/2/1:3)';
    // Narration only advances a position; begin behind the position being restored.
    await saveFromWebReader(epub.bookFileId, { percentage: 10, cfi: 'epubcfi(/6/2!/4/2/1:0)' });
    await saveFromWebReader(epub.bookFileId, { percentage: 55, cfi, ...(source === 'narration' ? { source } : {}) });

    const pull = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/syncs/progress/${epubHash}`,
      headers: deviceHeaders(),
    });
    expect(pull.statusCode).toBe(200);
    const remote = pull.json() as { percentage: number; progress: string; device: string };
    expect(remote).toEqual(expect.objectContaining({ percentage: 0.55, progress: '/body/DocFragment[1]/body/p/text().3', device: 'web' }));

    // Readers paginate differently, but the text point must survive the lifecycle upload.
    await syncFromDevice(epubHash, 0.52, remote.progress);
    await expect(readerProgress(epub.bookFileId)).resolves.toEqual(expect.objectContaining({ cfi, percentage: 52 }));
    expect((await storedProgress(epub.bookFileId))?.koreaderProgress).toBe(remote.progress);
  });

  it('preserves positions through repeated web and native-engine handoffs', async () => {
    for (let offset = 1; offset <= 4; offset += 1) {
      const cfi = `epubcfi(/6/2!/4/2/1:${offset})`;
      await saveFromWebReader(epub.bookFileId, { percentage: 20 + offset, cfi });
      const pull = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${epubHash}`, headers: deviceHeaders() });
      expect(pull.statusCode).toBe(200);
      expect(pull.json().progress).toBe(`/body/DocFragment[1]/body/p/text().${offset}`);
      const nextOffset = offset + 1;
      await syncFromDevice(epubHash, (25 + offset) / 100, `/body[1]/DocFragment[1]/body[1]/p[1]/text()[1].${nextOffset}`);
      await expect(readerProgress(epub.bookFileId)).resolves.toEqual(expect.objectContaining({ cfi: `epubcfi(/6/2!/4/2/1:${nextOffset})` }));
    }
  });

  it('does not let a delayed single update overwrite newer web progress or the next device pull', async () => {
    const cfi = 'epubcfi(/6/2!/4/2/1:3)';
    await saveFromWebReader(epub.bookFileId, { percentage: 62, cfi, source: 'text' });

    await syncFromDevice(epubHash, 0.05, '/body/DocFragment[1]/body', Math.floor(Date.now() / 1000) - 3600);

    await expect(readerProgress(epub.bookFileId)).resolves.toEqual(expect.objectContaining({ percentage: 62, cfi }));
    const pull = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${epubHash}`, headers: deviceHeaders() });
    expect(pull.statusCode).toBe(200);
    expect(pull.json()).toEqual(expect.objectContaining({ percentage: 0.62, progress: '/body/DocFragment[1]/body/p/text().3', device: 'web' }));
  });

  it('retains the newest device position when an older single update arrives afterwards', async () => {
    const now = Math.floor(Date.now() / 1000);
    const recent = '/body/DocFragment[1]/body/p/text().4';
    await syncFromDevice(epubHash, 0.75, recent, now);
    await syncFromDevice(epubHash, 0.2, '/body/DocFragment[1]/body/p/text().1', now - 60);

    await expect(readerProgress(epub.bookFileId)).resolves.toEqual(expect.objectContaining({ percentage: 75, cfi: 'epubcfi(/6/2!/4/2/1:4)' }));
    const pull = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${epubHash}`, headers: deviceHeaders() });
    expect(pull.statusCode).toBe(200);
    expect(pull.json()).toEqual(expect.objectContaining({ percentage: 0.75, progress: recent }));
  });

  it('accepts deliberate backward updates with the same second timestamp', async () => {
    const now = Math.floor(Date.now() / 1000);
    await syncFromDevice(epubHash, 0.75, '/body/DocFragment[1]/body/p/text().4', now);
    await syncFromDevice(epubHash, 0.2, '/body/DocFragment[1]/body/p/text().1', now);

    await expect(readerProgress(epub.bookFileId)).resolves.toEqual(expect.objectContaining({ percentage: 20, cfi: 'epubcfi(/6/2!/4/2/1:1)' }));
  });

  it('recovers from a future device clock after the clock is corrected', async () => {
    const now = Math.floor(Date.now() / 1000);
    await syncFromDevice(epubHash, 0.75, '/body/DocFragment[1]/body/p/text().4', now + 86400);
    await syncFromDevice(epubHash, 0.2, '/body/DocFragment[1]/body/p/text().1', Math.floor(Date.now() / 1000));

    await expect(readerProgress(epub.bookFileId)).resolves.toEqual(expect.objectContaining({ percentage: 20 }));
    const pull = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${epubHash}`, headers: deviceHeaders() });
    expect(pull.json()).toEqual(expect.objectContaining({ percentage: 0.2 }));
    expect(pull.json().timestamp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });

  it('preserves the newest pull position after duplicate and delayed bulk updates', async () => {
    const now = Math.floor(Date.now() / 1000);
    const send = (items: { hash: string; percentage: number; progress: string; timestamp: number }[]) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/v1/koreader/plugin/progress',
        headers: deviceHeaders(),
        payload: { deviceId: DEVICE_ID, deviceModel: 'Regression device', pluginVersion: '1.7.0', items },
      });
    const newest = { hash: epubHash, percentage: 0.6, progress: '/body/DocFragment[1]/body/p/text().3', timestamp: now };
    const delayed = { ...newest, percentage: 0.1, progress: '/body/DocFragment[1]/body/p/text().1', timestamp: now - 60 };
    expect((await send([newest, delayed, { ...delayed, timestamp: now - 30 }])).statusCode).toBe(201);
    expect((await send([delayed])).statusCode).toBe(201);

    await expect(readerProgress(epub.bookFileId)).resolves.toEqual(expect.objectContaining({ percentage: 60 }));
    const pull = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${epubHash}`, headers: deviceHeaders() });
    expect(pull.json()).toEqual(expect.objectContaining({ percentage: 0.6, progress: newest.progress }));
  });

  it('serves percentage fallback for an unresolvable reader position', async () => {
    await ctx.db
      .update(schema.koreaderDeviceProgress)
      .set({ updatedAt: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(schema.koreaderDeviceProgress.bookFileId, epub.bookFileId));
    await saveFromWebReader(epub.bookFileId, { percentage: 30, cfi: 'epubcfi(/6/2!/4/999/1:3)' });
    const pull = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/koreader/syncs/progress/${epubHash}`,
      headers: deviceHeaders(),
    });
    expect(pull.statusCode).toBe(200);
    expect(pull.json()).toEqual(expect.objectContaining({ progress: null, percentage: 0.3, device: 'web' }));
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

  it('uses a user-scoped link when the same book has two files with the same document hash', async () => {
    const [sourceFile] = await ctx.db
      .select({
        bookId: schema.bookFiles.bookId,
        libraryFolderId: schema.bookFiles.libraryFolderId,
        absolutePath: schema.bookFiles.absolutePath,
        relPath: schema.bookFiles.relPath,
        ino: schema.bookFiles.ino,
        sizeBytes: schema.bookFiles.sizeBytes,
        mtime: schema.bookFiles.mtime,
        format: schema.bookFiles.format,
      })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, epub.bookFileId));
    const [koreaderUser] = await ctx.db
      .select({ userId: schema.koreaderUsers.userId })
      .from(schema.koreaderUsers)
      .where(eq(schema.koreaderUsers.username, KOREADER_USERNAME));
    expect(sourceFile).toBeDefined();
    expect(koreaderUser).toBeDefined();

    const suffix = randomUUID();
    const [linkedFile] = await ctx.db
      .insert(schema.bookFiles)
      .values({
        ...sourceFile!,
        absolutePath: `${sourceFile!.absolutePath}.same-hash-${suffix}`,
        relPath: sourceFile!.relPath ? `${sourceFile!.relPath}.same-hash-${suffix}` : null,
        fileHash: epubHash,
        role: 'content',
      })
      .returning({ id: schema.bookFiles.id });

    try {
      await ctx.db.insert(schema.koreaderBookHashLinks).values({
        userId: koreaderUser!.userId,
        hash: epubHash,
        bookFileId: linkedFile!.id,
      });

      await syncFromDevice(epubHash, 0.61, XPOINTER);

      const [deviceProgress] = await ctx.db
        .select({ bookFileId: schema.koreaderDeviceProgress.bookFileId, percentage: schema.koreaderDeviceProgress.percentage })
        .from(schema.koreaderDeviceProgress)
        .where(
          and(
            eq(schema.koreaderDeviceProgress.bookFileId, linkedFile!.id),
            eq(schema.koreaderDeviceProgress.userId, koreaderUser!.userId),
            eq(schema.koreaderDeviceProgress.deviceId, DEVICE_ID),
          ),
        );
      expect(deviceProgress).toEqual({ bookFileId: linkedFile!.id, percentage: 0.61 });
    } finally {
      await ctx.db.delete(schema.bookFiles).where(eq(schema.bookFiles.id, linkedFile!.id));
    }
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
  it('falls back safely for replaced sources and their historical deliveries after rescan', async () => {
    const path = await createEpubFixture(library.folderPath, 'replacement/Source.epub', { title: 'Before replacement' });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const file = await locateBookByAbsolutePath(ctx, path);
    const oldHash = await fileHashFor(file.bookFileId);
    const derivativeHash = 'd'.repeat(32);
    const point = '/body/DocFragment[1]/body/p/text().3';
    await ctx.db.insert(schema.bookFileHashHistory).values([
      { bookFileId: file.bookFileId, fileHash: oldHash, reason: 'kobo_download' },
      { bookFileId: file.bookFileId, fileHash: derivativeHash, reason: 'kobo_download' },
    ]);
    await syncFromDevice(oldHash, 0.4, point);
    expect((await storedProgress(file.bookFileId))?.cfi).toBeTruthy();

    const replacement = await createEpubFixture(library.folderPath, 'replacement/Replacement.epub', {
      title: 'Replacement with different content identity',
    });
    await rename(replacement, path);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const newHash = await fileHashFor(file.bookFileId);
    expect(newHash).not.toBe(oldHash);
    expect(await storedProgress(file.bookFileId)).toEqual(expect.objectContaining({ percentage: 40, cfi: null, koreaderProgress: null }));

    for (const hash of [oldHash, derivativeHash]) {
      await syncFromDevice(hash, 0.5, point);
      expect(await storedProgress(file.bookFileId)).toEqual(expect.objectContaining({ percentage: 50, cfi: null, koreaderProgress: null }));
    }
    const bulk = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/progress',
      headers: deviceHeaders(),
      payload: {
        deviceId: DEVICE_ID,
        deviceModel: 'Regression device',
        pluginVersion: '1.7.0',
        items: [{ hash: derivativeHash, percentage: 0.6, progress: point }],
      },
    });
    expect(bulk.statusCode).toBe(201);
    expect(await storedProgress(file.bookFileId)).toEqual(expect.objectContaining({ percentage: 60, cfi: null, koreaderProgress: null }));

    await syncFromDevice(newHash, 0.7, point);
    expect((await storedProgress(file.bookFileId))?.cfi).toBeTruthy();
    for (const hash of [oldHash, derivativeHash]) {
      const pull = await ctx.app.inject({ method: 'GET', url: `/api/v1/koreader/syncs/progress/${hash}`, headers: deviceHeaders() });
      expect(pull.statusCode).toBe(200);
      expect(pull.json()).toEqual(expect.objectContaining({ percentage: 0.7, progress: null }));
    }
  });

  // Regression: a sweep pushes the device's whole shelf at once, and every book in it was ranked
  // as read the moment it arrived, so sorting by last read came out in processing order.
  it('ranks swept books by when the device read them, and never below a newer read elsewhere', async () => {
    const [olderPath, newerPath] = await Promise.all([
      createEpubFixture(library.folderPath, 'last-read/Older.epub', { title: `Last Read Older ${randomUUID()}`, uid: `urn:uuid:${randomUUID()}` }),
      createEpubFixture(library.folderPath, 'last-read/Newer.epub', { title: `Last Read Newer ${randomUUID()}`, uid: `urn:uuid:${randomUUID()}` }),
    ]);
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const older = await locateBookByAbsolutePath(ctx, olderPath);
    const newer = await locateBookByAbsolutePath(ctx, newerPath);
    const lastReadAt = async (bookFileId: number) => {
      const [row] = await ctx.db
        .select({ lastReadAt: schema.readingProgress.lastReadAt })
        .from(schema.readingProgress)
        .where(eq(schema.readingProgress.bookFileId, bookFileId));
      return row?.lastReadAt.getTime();
    };
    const now = Math.floor(Date.now() / 1000);
    const olderReadAt = now - 30 * 86400;
    const newerReadAt = now - 2 * 86400;

    const sweep = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/progress',
      headers: deviceHeaders(),
      payload: {
        deviceId: DEVICE_ID,
        deviceModel: 'Regression device',
        pluginVersion: '1.7.0',
        items: [
          { hash: await fileHashFor(older.bookFileId), percentage: 0.4, timestamp: olderReadAt },
          { hash: await fileHashFor(newer.bookFileId), percentage: 0.3, timestamp: newerReadAt },
        ],
      },
    });
    expect(sweep.statusCode).toBe(201);
    expect(await lastReadAt(older.bookFileId)).toBe(olderReadAt * 1000);
    expect(await lastReadAt(newer.bookFileId)).toBe(newerReadAt * 1000);

    await saveFromWebReader(older.bookFileId, { percentage: 45 });
    const webReadAt = await lastReadAt(older.bookFileId);
    expect(webReadAt).toBeGreaterThanOrEqual(now * 1000);

    // Read further offline an hour ago and pushed late: the page is taken, the newer web read stays the last one.
    await syncFromDevice(await fileHashFor(older.bookFileId), 0.7, undefined, now - 3600);
    expect((await storedProgress(older.bookFileId))?.percentage).toBeCloseTo(70, 5);
    expect(await lastReadAt(older.bookFileId)).toBe(webReadAt);
  });
});
