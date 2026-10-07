import { randomUUID } from 'crypto';
import { readFile, readdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import { and, eq, sql } from 'drizzle-orm';
import { Permission } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { deleteBookFilesWithHashInvalidation, deleteBooksWithHashInvalidation } from '../src/db/book-file-hash-history';
import { AudiolessEpubService } from '../src/modules/book/audioless-epub.service';
import { KoboSettingsService } from '../src/modules/kobo/services/kobo-settings.service';
import { KoboDownloadHashRegistrationService } from '../src/modules/kobo/services/kobo-download-hash-registration.service';
import { computeFileHash } from '../src/common/utils/file-hash.utils';
import { KoreaderRepository } from '../src/modules/koreader/koreader.repository';
import { AppSettingsService } from '../src/modules/app-settings/app-settings.service';
import { KoboDownloadRepository } from '../src/modules/kobo/kobo-download.repository';
import { KoboDownloadHashBackfillService } from '../src/modules/kobo/services/kobo-download-hash-backfill.service';
import { KepubConversionService } from '../src/modules/kobo/services/kepub-conversion.service';
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
  type ReaderStateIsolationE2EContext,
  type LocatedBookFile,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

describe('Kobo download identity in KOReader (e2e)', { timeout: 180_000 }, () => {
  let ctx: ReaderStateIsolationE2EContext;
  let source: LocatedBookFile;
  let other: LocatedBookFile;
  let user: TestUserSession;
  let outsider: TestUserSession;
  let deviceToken: string;
  let downloadPath: string;
  let deliveredHash: string;
  let originalHash: string;

  function koHeaders(session = user) {
    return { 'x-auth-user': session.username, 'x-auth-key': session.password };
  }

  async function match(hash: string, session = user, cachedFileId?: number) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/koreader/plugin/match-check',
      headers: koHeaders(session),
      payload: {
        deviceId: 'kobo-download-e2e',
        deviceModel: 'Kobo',
        pluginVersion: '1.5.5',
        hashes: [hash],
        ...(cachedFileId ? { books: [{ hash, source: 'current_file', bookFileId: cachedFileId, title: 'Cached KOReader title' }] } : {}),
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json() as { matches: { hash: string; bookId: number; bookFileId: number }[]; libraryVersion: string };
  }

  async function download() {
    return ctx.app.inject({ method: 'GET', url: `/api/v1/kobo/${deviceToken}/v1/books/${source.bookId}/download` });
  }

  async function withCurrentHashCollision(run: () => Promise<void>) {
    const [stored] = await ctx.db.select({ hash: schema.bookFiles.fileHash }).from(schema.bookFiles).where(eq(schema.bookFiles.id, other.bookFileId));
    await ctx.db.update(schema.bookFiles).set({ fileHash: deliveredHash }).where(eq(schema.bookFiles.id, other.bookFileId));
    try {
      await run();
    } finally {
      await ctx.db.update(schema.bookFiles).set({ fileHash: stored!.hash }).where(eq(schema.bookFiles.id, other.bookFileId));
      await ctx.db
        .delete(schema.koreaderBookHashLinks)
        .where(and(eq(schema.koreaderBookHashLinks.userId, user.userId), eq(schema.koreaderBookHashLinks.hash, deliveredHash)));
    }
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    const library = await createLibraryWithFolder(ctx);
    const sourcePath = await createEpubFixture(library.folderPath, 'source.epub', {
      title: 'Original download source',
      uid: `urn:uuid:${randomUUID()}`,
    });
    const otherPath = await createEpubFixture(library.folderPath, 'other.epub', { title: 'Independent book', uid: `urn:uuid:${randomUUID()}` });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    source = await locateBookByAbsolutePath(ctx, sourcePath);
    other = await locateBookByAbsolutePath(ctx, otherPath);
    originalHash = await computeFileHash(sourcePath);
    user = await createUserAndLogin(ctx, { permissions: [Permission.KoboSync, Permission.KoreaderSync] });
    outsider = await createUserAndLogin(ctx, { permissions: [Permission.KoreaderSync] });
    await grantLibraryAccess(ctx, user.userId, library.libraryId);
    for (const session of [user, outsider]) {
      const credentials = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/koreader/credentials',
        headers: authHeader(session.accessToken),
        payload: { username: session.username, password: session.password },
      });
      expect(credentials.statusCode).toBe(201);
    }
    const device = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/kobo/devices',
      headers: authHeader(user.accessToken),
      payload: { name: 'Kobo download regression' },
    });
    expect(device.statusCode).toBe(201);
    deviceToken = (device.json() as { token: string }).token;
    const collection = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/collections',
      headers: authHeader(user.accessToken),
      payload: { name: 'Kobo download regression', icon: 'book', syncToKobo: true },
    });
    expect(collection.statusCode).toBe(201);
    const add = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/collections/${(collection.json() as { id: number }).id}/books`,
      headers: authHeader(user.accessToken),
      payload: { bookIds: [source.bookId] },
    });
    expect(add.statusCode).toBe(201);
    const settings = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/v1/kobo/settings',
      headers: authHeader(user.accessToken),
      payload: { convertToKepub: true, storeSync: false },
    });
    expect(settings.statusCode).toBe(200);
    const sync = await ctx.app.inject({ method: 'GET', url: `/api/v1/kobo/${deviceToken}/v1/library/sync` });
    expect(sync.statusCode).toBe(200);
    // The external converter is substituted with a different valid EPUB. The download, hashing,
    // history persistence, matching, access checks and progress endpoints are the real app.
    downloadPath = await createEpubFixture(join(ctx.fixture.booksPath, '.kepub-cache', String(source.bookId)), `${originalHash}.kepub.epub`, {
      title: 'Delivered Kobo artifact',
      uid: `urn:uuid:${randomUUID()}`,
    });
    deliveredHash = await computeFileHash(downloadPath);
    expect(deliveredHash).not.toBe(originalHash);
    vi.spyOn(ctx.app.get(KepubConversionService), 'getKepubPath').mockResolvedValue(downloadPath);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('matches a converted download with the unchanged KOReader request and leaves the source hash intact', async () => {
    const before = await match(deliveredHash);
    const outsiderBefore = await match(deliveredHash, outsider);
    expect(before.matches).toEqual([]);
    const response = await download();
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload).toEqual(await readFile(downloadPath));
    const after = await match(deliveredHash);
    expect(after.matches).toEqual([{ hash: deliveredHash, bookId: source.bookId, bookFileId: source.bookFileId }]);
    expect(after.libraryVersion).not.toBe(before.libraryVersion);
    expect((await match(deliveredHash, outsider)).libraryVersion).toBe(outsiderBefore.libraryVersion);
    const [stored] = await ctx.db
      .select({ hash: schema.bookFiles.fileHash })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.id, source.bookFileId));
    expect(stored!.hash).toBe(originalHash);
    expect((await match(originalHash)).matches[0]!.bookFileId).toBe(source.bookFileId);
  });

  it('registers cached/repeated downloads idempotently', async () => {
    const version = (await match(deliveredHash)).libraryVersion;
    expect((await download()).statusCode).toBe(200);
    expect((await download()).statusCode).toBe(200);
    const history = await ctx.db
      .select()
      .from(schema.bookFileHashHistory)
      .where(and(eq(schema.bookFileHashHistory.bookFileId, source.bookFileId), eq(schema.bookFileHashHistory.fileHash, deliveredHash)));
    expect(history).toHaveLength(1);
    expect(history[0]!.reason).toBe('kobo_download');
    expect((await match(deliveredHash)).libraryVersion).toBe(version);
  });

  it('ships a download while its library is locked, rolls back registration, then replays its queued identity', async () => {
    const path = await createEpubFixture(ctx.fixture.rootPath, 'lock-wait.epub', { title: 'Lock wait regression', uid: `urn:uuid:${randomUUID()}` });
    const hash = await computeFileHash(path);
    const [book] = await ctx.db.select({ libraryId: schema.books.libraryId }).from(schema.books).where(eq(schema.books.id, source.bookId));
    const [before] = await ctx.db
      .select({ revision: schema.libraries.koreaderHashRevision })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, book!.libraryId));
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = ctx.db.transaction(async (tx) => {
      await tx.execute(sql`select id from libraries where id = ${book!.libraryId} for update`);
      ready();
      await hold;
    });
    // Surface a setup failure without waiting indefinitely for the ready signal.
    await Promise.race([locked, blocker]);
    try {
      const duplicateStart = Date.now();
      expect((await download()).statusCode).toBe(200);
      expect(Date.now() - duplicateStart).toBeLessThan(1000);
      vi.spyOn(ctx.app.get(KepubConversionService), 'getKepubPath').mockResolvedValue(path);
      const startedAt = Date.now();
      const response = await download();
      const durationMs = Date.now() - startedAt;
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(await readFile(path));
      expect(durationMs).toBeGreaterThanOrEqual(850);
      expect(durationMs).toBeLessThan(5000);
      expect((await match(hash)).matches).toEqual([]);
      expect(await readdir(join(ctx.fixture.booksPath, '.kobo-download-hashes'))).toContain(`${source.bookFileId}-${hash}`);
      const history = await ctx.db.select().from(schema.bookFileHashHistory).where(eq(schema.bookFileHashHistory.fileHash, hash));
      expect(history).toEqual([]);
      const [during] = await ctx.db
        .select({ revision: schema.libraries.koreaderHashRevision })
        .from(schema.libraries)
        .where(eq(schema.libraries.id, book!.libraryId));
      expect(during!.revision).toBe(before!.revision);
    } finally {
      release();
      await blocker;
      vi.spyOn(ctx.app.get(KepubConversionService), 'getKepubPath').mockResolvedValue(downloadPath);
    }
    await ctx.app.get(KoboDownloadHashRegistrationService).replay();
    expect((await match(hash)).matches).toEqual([{ hash, bookId: source.bookId, bookFileId: source.bookFileId }]);
    const [after] = await ctx.db
      .select({ revision: schema.libraries.koreaderHashRevision })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, book!.libraryId));
    expect(after!.revision).toBe(before!.revision + 1);
  });

  it('does not expose the generated identity to a user without access to the source library', async () => {
    expect((await match(deliveredHash, outsider)).matches).toEqual([]);
  });

  it('records KOReader progress on the source book file after a converted download', async () => {
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/koreader/syncs/progress',
      headers: koHeaders(),
      payload: { document: deliveredHash, percentage: 0.25, device: 'Kobo regression', device_id: 'kobo-download-e2e' },
    });
    expect(response.statusCode).toBe(200);
    const progress = await ctx.db
      .select()
      .from(schema.koreaderDeviceProgress)
      .where(and(eq(schema.koreaderDeviceProgress.userId, user.userId), eq(schema.koreaderDeviceProgress.bookFileId, source.bookFileId)));
    expect(progress).toHaveLength(1);
    expect(progress[0]!.percentage).toBeCloseTo(0.25);
    expect(progress[0]!.orphaned).toBe(false);
  });

  it('allows relink, unlink, automatic sync, list, and link again after intrinsic registration', async () => {
    await ctx.db.insert(schema.koreaderBookHashLinks).values({ userId: user.userId, hash: deliveredHash, bookFileId: source.bookFileId });
    try {
      const relinked = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/koreader/hash-links/${deliveredHash}`,
        headers: authHeader(user.accessToken),
        payload: { bookId: other.bookId },
      });
      expect(relinked.statusCode).toBe(200);
      expect((await match(deliveredHash)).matches[0]!.bookFileId).toBe(other.bookFileId);
      expect((await match(deliveredHash, user, source.bookFileId)).matches[0]!.bookFileId).toBe(other.bookFileId);
      const [preserved] = await ctx.db
        .select()
        .from(schema.koreaderBookHashLinks)
        .where(and(eq(schema.koreaderBookHashLinks.userId, user.userId), eq(schema.koreaderBookHashLinks.hash, deliveredHash)));
      expect(preserved!.bookFileId).toBe(other.bookFileId);
      const unlinked = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/koreader/hash-links/${deliveredHash}`,
        headers: authHeader(user.accessToken),
      });
      expect(unlinked.statusCode).toBe(200);
      // Background matching resumes intrinsic resolution without removing the user's correction queue.
      expect((await match(deliveredHash)).matches[0]!.bookFileId).toBe(source.bookFileId);
      await ctx.app
        .get(KoreaderRepository)
        .upsertUnmatchedBooks(user.userId, [
          { hash: deliveredHash, source: 'current_file', metadataAmbiguous: true, title: 'Ambiguous metadata from background sync' },
        ]);
      const pending = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/unmatched-books', headers: authHeader(user.accessToken) });
      expect(pending.statusCode).toBe(200);
      expect(pending.json()).toEqual(expect.arrayContaining([expect.objectContaining({ hash: deliveredHash })]));
      const linked = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/koreader/unmatched-books/${deliveredHash}/link`,
        headers: authHeader(user.accessToken),
        payload: { bookId: other.bookId },
      });
      expect(linked.statusCode).toBe(201);
      expect((await match(deliveredHash)).matches[0]!.bookFileId).toBe(other.bookFileId);
      const after = await ctx.app.inject({ method: 'GET', url: '/api/v1/koreader/unmatched-books', headers: authHeader(user.accessToken) });
      expect(after.json()).not.toEqual(expect.arrayContaining([expect.objectContaining({ hash: deliveredHash })]));
    } finally {
      await ctx.db
        .delete(schema.koreaderBookHashLinks)
        .where(and(eq(schema.koreaderBookHashLinks.userId, user.userId), eq(schema.koreaderBookHashLinks.hash, deliveredHash)));
      await ctx.db
        .delete(schema.koreaderUnmatchedBooks)
        .where(and(eq(schema.koreaderUnmatchedBooks.userId, user.userId), eq(schema.koreaderUnmatchedBooks.hash, deliveredHash)));
    }
  });

  it('does not allow another user to relink or unlink a manual override', async () => {
    await ctx.db.insert(schema.koreaderBookHashLinks).values({ userId: user.userId, hash: deliveredHash, bookFileId: source.bookFileId });
    try {
      for (const method of ['PATCH', 'DELETE'] as const) {
        const response = await ctx.app.inject({
          method,
          url: `/api/v1/koreader/hash-links/${deliveredHash}`,
          headers: authHeader(outsider.accessToken),
          ...(method === 'PATCH' ? { payload: { bookId: other.bookId } } : {}),
        });
        expect(response.statusCode).toBe(404);
      }
      expect((await match(deliveredHash)).matches[0]!.bookFileId).toBe(source.bookFileId);
    } finally {
      await ctx.db
        .delete(schema.koreaderBookHashLinks)
        .where(and(eq(schema.koreaderBookHashLinks.userId, user.userId), eq(schema.koreaderBookHashLinks.hash, deliveredHash)));
    }
  });

  it('delivers an uncached audioless EPUB during a database outage and recovers identity after temporary cleanup', async () => {
    const repository = ctx.app.get(KoboDownloadRepository);
    const settings = ctx.app.get(KoboSettingsService);
    const storedSettings = await settings.getSettings(user.userId);
    const settingsSpy = vi.spyOn(settings, 'getSettings').mockResolvedValue({ ...storedSettings, convertToKepub: false });
    const temporaryPaths: string[] = [];
    const stripSpy = vi.spyOn(ctx.app.get(AudiolessEpubService), 'writeArchive').mockImplementation(async (input, output) => {
      temporaryPaths.push(output);
      await writeFile(output, Buffer.concat([await readFile(input), Buffer.from('narration-free delivery regression')]));
      return { removedEntries: 1, sanitizedEntries: 1 };
    });
    await ctx.db.update(schema.bookFiles).set({ mediaOverlayAvailable: true }).where(eq(schema.bookFiles.id, source.bookFileId));
    const registrationSpy = vi.spyOn(repository, 'registerDeliveredHash').mockRejectedValue(new Error('Transient database outage'));
    let queuedHash: string;
    try {
      const response = await download();
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload.length).toBeGreaterThan(0);
      queuedHash = registrationSpy.mock.calls[0]![1];
      expect(queuedHash).not.toBe(originalHash);
      expect((await match(queuedHash)).matches).toEqual([]);
    } finally {
      registrationSpy.mockRestore();
      settingsSpy.mockRestore();
      stripSpy.mockRestore();
      await ctx.db.update(schema.bookFiles).set({ mediaOverlayAvailable: false }).where(eq(schema.bookFiles.id, source.bookFileId));
    }
    expect(temporaryPaths).toHaveLength(1);
    await expect(stat(temporaryPaths[0]!)).rejects.toMatchObject({ code: 'ENOENT' });
    await ctx.app.get(KoboDownloadHashRegistrationService).replay();
    expect((await match(queuedHash)).matches).toEqual([{ hash: queuedHash, bookId: source.bookId, bookFileId: source.bookFileId }]);
  });

  it('increments the scoped revision once for concurrent duplicate registrations and supports rollback', async () => {
    const repository = ctx.app.get(KoboDownloadRepository);
    const before = (await match(deliveredHash)).libraryVersion;
    const outsiderBefore = (await match(deliveredHash, outsider)).libraryVersion;
    const [sourceBook] = await ctx.db.select({ libraryId: schema.books.libraryId }).from(schema.books).where(eq(schema.books.id, source.bookId));
    const [beforeRevision] = await ctx.db
      .select({ revision: schema.libraries.koreaderHashRevision })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, sourceBook!.libraryId));
    const hash = 'd'.repeat(32);
    await Promise.all(Array.from({ length: 10 }, () => repository.registerDeliveredHash(source.bookFileId, hash)));
    const rows = await ctx.db
      .select()
      .from(schema.bookFileHashHistory)
      .where(and(eq(schema.bookFileHashHistory.bookFileId, source.bookFileId), eq(schema.bookFileHashHistory.fileHash, hash)));
    expect(rows).toHaveLength(1);
    const [afterRevision] = await ctx.db
      .select({ revision: schema.libraries.koreaderHashRevision })
      .from(schema.libraries)
      .where(eq(schema.libraries.id, sourceBook!.libraryId));
    expect(afterRevision!.revision).toBe(beforeRevision!.revision + 1);
    const after = (await match(deliveredHash)).libraryVersion;
    expect(after).not.toBe(before);
    expect((await match(deliveredHash, outsider)).libraryVersion).toBe(outsiderBefore);
    await repository.registerDeliveredHash(source.bookFileId, hash);
    expect((await match(deliveredHash)).libraryVersion).toBe(after);
    await expect(
      ctx.db.transaction(async (tx) => {
        await deleteBookFilesWithHashInvalidation(tx, eq(schema.bookFiles.id, source.bookFileId));
        throw new Error('Roll back deletion');
      }),
    ).rejects.toThrow('Roll back deletion');
    expect((await match(deliveredHash)).libraryVersion).toBe(after);
    expect((await match(deliveredHash)).matches[0]!.bookFileId).toBe(source.bookFileId);
  });

  it('uses the timestamp expression index for the bounded version lookup', async () => {
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const plan = await tx.execute(
        sql`explain (format json) select greatest(created_at, updated_at) from book_files order by greatest(created_at, updated_at) desc limit 1`,
      );
      const serialized = JSON.stringify(plan.rows);
      expect(serialized).toContain('book_files_change_timestamp_idx');
      expect(serialized).not.toContain('Seq Scan');
    });
  });

  it('preserves an existing explicit link even when a subsequent download registers a different intrinsic identity', async () => {
    await ctx.db.insert(schema.koreaderBookHashLinks).values({ userId: user.userId, hash: deliveredHash, bookFileId: other.bookFileId });
    try {
      expect((await download()).statusCode).toBe(200);
      expect((await match(deliveredHash)).matches).toEqual([{ hash: deliveredHash, bookId: other.bookId, bookFileId: other.bookFileId }]);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/koreader/syncs/progress',
        headers: koHeaders(),
        payload: { document: deliveredHash, percentage: 0.6, device: 'Kobo regression', device_id: 'explicit-prior-link' },
      });
      expect(response.statusCode).toBe(200);
      const progress = await ctx.db
        .select()
        .from(schema.koreaderDeviceProgress)
        .where(and(eq(schema.koreaderDeviceProgress.userId, user.userId), eq(schema.koreaderDeviceProgress.deviceId, 'explicit-prior-link')));
      expect(progress).toHaveLength(1);
      expect(progress[0]!.bookFileId).toBe(other.bookFileId);
    } finally {
      await ctx.db
        .delete(schema.koreaderBookHashLinks)
        .where(and(eq(schema.koreaderBookHashLinks.userId, user.userId), eq(schema.koreaderBookHashLinks.hash, deliveredHash)));
    }
  });

  it('rejects a delivered/current hash collision instead of assigning progress to the other book', async () => {
    await withCurrentHashCollision(async () => {
      expect((await match(deliveredHash)).matches).toEqual([]);
      const before = await ctx.db.select().from(schema.koreaderDeviceProgress).where(eq(schema.koreaderDeviceProgress.userId, user.userId));
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/koreader/syncs/progress',
        headers: koHeaders(),
        payload: { document: deliveredHash, percentage: 0.99, device: 'Kobo regression', device_id: 'cross-source-collision' },
      });
      expect(response.statusCode).toBe(404);
      const after = await ctx.db.select().from(schema.koreaderDeviceProgress).where(eq(schema.koreaderDeviceProgress.userId, user.userId));
      expect(after).toEqual(before);
    });
  });

  it('honors an explicit source-file link for a delivered/current collision on match and progress', async () => {
    await withCurrentHashCollision(async () => {
      await ctx.db.insert(schema.koreaderBookHashLinks).values({ userId: user.userId, hash: deliveredHash, bookFileId: source.bookFileId });
      expect((await download()).statusCode).toBe(200);
      expect((await match(deliveredHash)).matches).toEqual([{ hash: deliveredHash, bookId: source.bookId, bookFileId: source.bookFileId }]);
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/koreader/syncs/progress',
        headers: koHeaders(),
        payload: { document: deliveredHash, percentage: 0.5, device: 'Kobo regression', device_id: 'cross-source-linked' },
      });
      expect(response.statusCode).toBe(200);
      const progress = await ctx.db
        .select()
        .from(schema.koreaderDeviceProgress)
        .where(and(eq(schema.koreaderDeviceProgress.userId, user.userId), eq(schema.koreaderDeviceProgress.deviceId, 'cross-source-linked')));
      expect(progress).toHaveLength(1);
      expect(progress[0]!.bookFileId).toBe(source.bookFileId);
      expect(progress[0]!.percentage).toBeCloseTo(0.5);
    });
  });

  it('preserves ambiguity when two source books have the same delivered hash', async () => {
    const repository = ctx.app.get(KoboDownloadRepository);
    await repository.registerDeliveredHash(other.bookFileId, deliveredHash);
    expect((await match(deliveredHash)).matches).toEqual([]);
  });

  it('leaves explicit user disambiguation intact across subsequent downloads', async () => {
    await ctx.db.insert(schema.koreaderBookHashLinks).values({ userId: user.userId, hash: deliveredHash, bookFileId: source.bookFileId });
    expect((await download()).statusCode).toBe(200);
    expect((await match(deliveredHash)).matches[0]!.bookFileId).toBe(source.bookFileId);
    const [link] = await ctx.db
      .select()
      .from(schema.koreaderBookHashLinks)
      .where(and(eq(schema.koreaderBookHashLinks.userId, user.userId), eq(schema.koreaderBookHashLinks.hash, deliveredHash)));
    expect(link!.bookFileId).toBe(source.bookFileId);
  });

  it('recovers an already downloaded artifact from the retained cache without another download', async () => {
    await ctx.db.delete(schema.bookFileHashHistory).where(eq(schema.bookFileHashHistory.fileHash, deliveredHash));
    await ctx.db.delete(schema.koreaderBookHashLinks).where(eq(schema.koreaderBookHashLinks.hash, deliveredHash));
    expect((await match(deliveredHash)).matches).toEqual([]);
    await ctx.app.get(AppSettingsService).setValue('kobo_download_hash_backfill', '0');
    const recovered = await ctx.app.get(KoboDownloadHashBackfillService).run();
    expect(recovered.registered).toBeGreaterThanOrEqual(1);
    expect(recovered.failed).toBe(0);
    expect((await match(deliveredHash)).matches).toEqual([{ hash: deliveredHash, bookId: source.bookId, bookFileId: source.bookFileId }]);
  });

  it('does not retarget a retained conversion after its original source identity is lost', async () => {
    const repository = ctx.app.get(KoboDownloadRepository);
    await expect(repository.findCachedSourceFileId(source.bookId, originalHash)).resolves.toBe(source.bookFileId);
    await ctx.db
      .update(schema.bookFiles)
      .set({ fileHash: 'c'.repeat(32) })
      .where(eq(schema.bookFiles.id, source.bookFileId));
    await expect(repository.findCachedSourceFileId(source.bookId, originalHash)).resolves.toBeNull();
    await ctx.db.insert(schema.bookFileHashHistory).values({ bookFileId: source.bookFileId, fileHash: originalHash, reason: 'external_change' });
    await expect(repository.findCachedSourceFileId(source.bookId, originalHash)).resolves.toBe(source.bookFileId);
  });
  it('invalidates a cached token when a non-newest book and its historical identities are deleted', async () => {
    const library = await createLibraryWithFolder(ctx);
    const path = await createEpubFixture(library.folderPath, 'deleted.epub', { title: 'Deletion regression', uid: `urn:uuid:${randomUUID()}` });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const target = await locateBookByAbsolutePath(ctx, path);
    await grantLibraryAccess(ctx, user.userId, library.libraryId);
    const repository = ctx.app.get(KoboDownloadRepository);
    const hash = 'e'.repeat(32);
    await repository.registerDeliveredHash(target.bookFileId, hash);
    await ctx.db
      .update(schema.bookFiles)
      .set({ createdAt: new Date('2000-01-01'), updatedAt: new Date('2000-01-01') })
      .where(eq(schema.bookFiles.id, target.bookFileId));
    const before = (await match(hash)).libraryVersion;
    await deleteBooksWithHashInvalidation(ctx.db, eq(schema.books.id, target.bookId));
    const after = await match(hash);
    expect(after.libraryVersion).not.toBe(before);
    expect(after.matches).toEqual([]);
  });
});
