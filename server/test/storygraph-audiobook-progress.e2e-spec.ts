import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

import { Permission, type AudiobookManifest, type AudiobookPlaybackState } from '@bookorbit/types';
import { and, eq } from 'drizzle-orm';

import * as schema from '../src/db/schema';
import { STORYGRAPH_BASE_URL } from '../src/modules/storygraph/storygraph.constants';
import { StorygraphRepository } from '../src/modules/storygraph/storygraph.repository';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  type AuthorizationMatrixE2EContext,
} from './e2e/authorization-matrix/authorization-matrix-harness';

describe('StoryGraph audiobook progress (e2e)', { timeout: 60_000 }, () => {
  let ctx: AuthorizationMatrixE2EContext | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (ctx) await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('sends audio-only progress on manual sync and on subsequent playback saves', async () => {
    const bookTitle = 'An Orbit Around the Moon';
    const editionId = randomUUID();
    let shelf: string | null = null;
    const progressUpdates: Array<{ type: string | null; percentage: number }> = [];
    const receiver = createServer((request, response) => {
      const url = new URL(request.url!, STORYGRAPH_BASE_URL);
      if (request.method === 'GET' && url.pathname === `/books/${editionId}`) {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<meta name="csrf-token" content="fixture-token"><span class="read-status-label">${shelf ?? ''}</span>`);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/update-status.js' && url.searchParams.get('book_id') === editionId) {
        shelf = url.searchParams.get('status');
        response.end();
        return;
      }
      if (request.method === 'POST' && url.pathname === '/update-progress') {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
        });
        request.on('end', () => {
          const form = new URLSearchParams(body);
          if (form.get('book_id') !== editionId) {
            response.writeHead(404).end();
            return;
          }
          progressUpdates.push({ type: form.get('read_status[progress_type]'), percentage: Number(form.get('read_status[progress_number]')) });
          response.end();
        });
        return;
      }
      response.writeHead(404).end();
    });
    receiver.listen(0, '127.0.0.1');
    await once(receiver, 'listening');

    try {
      const address = receiver.address();
      if (!address || typeof address === 'string') throw new Error('StoryGraph test receiver has no TCP address');
      const realFetch = globalThis.fetch;
      vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        if (typeof input !== 'string' || !input.startsWith(`${STORYGRAPH_BASE_URL}/`)) return realFetch(input, init);
        return realFetch(`http://127.0.0.1:${address.port}${input.slice(STORYGRAPH_BASE_URL.length)}`, init);
      });

      ctx = await createAuthorizationMatrixE2EContext();
      const library = await createLibraryWithFolder(ctx);
      const reader = await createUserAndLogin(ctx, { permissions: [Permission.StorygraphSync] });
      await grantLibraryAccess(ctx, reader.userId, library.libraryId);
      const absolutePath = `${library.folderPath}/fixture.m4b`;
      const [book] = await ctx.db
        .insert(schema.books)
        .values({ libraryId: library.libraryId, libraryFolderId: library.libraryFolderId, folderPath: absolutePath, status: 'present' })
        .returning({ id: schema.books.id });
      const bookId = book!.id;
      await ctx.db.insert(schema.bookMetadata).values({ bookId, title: bookTitle });
      const [file] = await ctx.db
        .insert(schema.bookFiles)
        .values({
          bookId,
          libraryFolderId: library.libraryFolderId,
          absolutePath,
          relPath: 'fixture.m4b',
          ino: BigInt(1),
          sizeBytes: 2048,
          format: 'm4b',
          role: 'content',
          durationSeconds: 600,
        })
        .returning({ id: schema.bookFiles.id });
      const fileId = file!.id;
      await ctx.db.update(schema.books).set({ primaryFileId: fileId }).where(eq(schema.books.id, bookId));
      const repo = ctx.app.get(StorygraphRepository);
      await repo.upsertBookState({ userId: reader.userId, bookId, storygraphBookId: editionId, matchMethod: 'manual' });

      await ctx.app.listen(0, '127.0.0.1');
      const origin = await ctx.app.getUrl();
      async function api<T>(path: string, expectedStatus: number, method = 'GET', body?: object): Promise<T> {
        const response = await fetch(`${origin}/api/v1${path}`, {
          method,
          headers: { ...authHeader(reader.accessToken), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        expect(response.status, `${method} ${path}`).toBe(expectedStatus);
        return (response.status === 204 ? undefined : await response.json()) as T;
      }

      const settings = {
        enabled: true,
        autoSyncOnStatusChange: false,
        autoSyncOnProgressUpdate: false,
      };
      await api('/storygraph/settings', 200, 'PATCH', { ...settings, sessionCookie: 'fixture-session', rememberToken: 'fixture-token' });
      const manifest = await api<AudiobookManifest>(`/audiobooks/${bookId}/manifest`, 200);
      const savePlayback = (positionMs: number, baseRevision: number) =>
        api<AudiobookPlaybackState>(`/audiobooks/${bookId}/playback-state`, 200, 'PUT', {
          assetId: manifest.assets[0]!.assetId,
          positionMs,
          capturedAt: new Date().toISOString(),
          operationId: randomUUID(),
          baseRevision,
          manifestRevision: manifest.revision,
        });

      const first = await savePlayback(150_000, 0);
      expect(first.percentage).toBe(25);
      const countPending = () => repo.countPendingSyncableBooks(reader.userId, undefined, { bookSyncMode: 'all_eligible' });
      expect(await countPending()).toBe(1);

      const manualSync = await api<{ result: string }>(`/storygraph/books/${bookId}/sync`, 201, 'POST');
      expect(manualSync.result).toBe('synced');
      expect(shelf).toBe('currently-reading');
      expect(progressUpdates).toEqual([{ type: 'percentage', percentage: 25 }]);
      expect((await repo.findBookState(reader.userId, bookId))?.lastSyncedProgress).toBe(25);

      await api('/storygraph/settings', 200, 'PATCH', { autoSyncOnProgressUpdate: true });
      const second = await savePlayback(300_000, first.revision);
      expect(second.percentage).toBe(50);
      expect(await countPending()).toBe(1);

      const waitForSyncedProgress = (percentage: number) =>
        vi.waitFor(async () => expect((await repo.findBookState(reader.userId, bookId))?.lastSyncedProgress).toBe(percentage), {
          timeout: 12_000,
          interval: 100,
        });
      await waitForSyncedProgress(50);
      expect(progressUpdates).toEqual([
        { type: 'percentage', percentage: 25 },
        { type: 'percentage', percentage: 50 },
      ]);

      await savePlayback(301_000, second.revision);
      expect(await countPending()).toBe(0);
      const unchangedSync = await api<{ result: string }>(`/storygraph/books/${bookId}/sync`, 201, 'POST');
      expect(unchangedSync.result).toBe('skipped');

      await api(`/books/${bookId}/audio-progress`, 204, 'PATCH', { currentFileId: fileId, positionSeconds: 360, percentage: 60 });
      await waitForSyncedProgress(60);
      expect(progressUpdates.map(({ percentage }) => percentage)).toEqual([25, 50, 60]);
      expect(await countPending()).toBe(0);
      expect(
        await ctx.db.query.readingProgress.findFirst({
          where: and(eq(schema.readingProgress.userId, reader.userId), eq(schema.readingProgress.bookFileId, fileId)),
        }),
      ).toBeUndefined();

      const [ebook] = await ctx.db
        .insert(schema.bookFiles)
        .values({
          bookId,
          libraryFolderId: library.libraryFolderId,
          absolutePath: `${library.folderPath}/fixture.epub`,
          relPath: 'fixture.epub',
          ino: BigInt(2),
          sizeBytes: 2048,
          format: 'epub',
          role: 'content',
        })
        .returning({ id: schema.bookFiles.id });
      await ctx.db.insert(schema.readingProgress).values({ userId: reader.userId, bookFileId: ebook!.id, percentage: 14.08 });
      await ctx.db.update(schema.books).set({ primaryFileId: ebook!.id }).where(eq(schema.books.id, bookId));
      expect((await repo.findBookSyncData(reader.userId, bookId))?.progress).toBe(14.08);
    } finally {
      await new Promise<void>((resolve, reject) => receiver.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
