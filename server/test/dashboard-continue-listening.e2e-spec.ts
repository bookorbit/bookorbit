import { randomUUID } from 'crypto';

import { and, eq } from 'drizzle-orm';
import type { AudiobookManifest, AudiobookPlaybackState } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import {
  authHeader,
  closeAuthorizationMatrixE2EContext,
  createAuthorizationMatrixE2EContext,
  createLibraryWithFolder,
  createUserAndLogin,
  grantLibraryAccess,
  type AuthorizationMatrixE2EContext,
  type TestUserSession,
} from './e2e/authorization-matrix/authorization-matrix-harness';

const SCENARIO_TIMEOUT_MS = 60_000;

describe('Dashboard continue-listening scroller (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let reader!: TestUserSession;
  let bookId!: number;
  let assetId!: string;
  let manifestRevision!: string;
  let playbackRevision = 0;

  async function saveAudioProgress(percentage: number) {
    return ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/audiobooks/${bookId}/playback-state`,
      headers: authHeader(reader.accessToken),
      payload: {
        assetId,
        positionMs: percentage * 100_000,
        capturedAt: new Date().toISOString(),
        operationId: randomUUID(),
        baseRevision: playbackRevision,
        manifestRevision,
      },
    });
  }

  async function getContinueListeningIds(): Promise<number[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/v1/dashboard/scrollers/continue-listening?limit=20',
      headers: authHeader(reader.accessToken),
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as Array<{ id: number }>).map((book) => book.id);
  }

  async function getReadStatus(): Promise<string | null> {
    const [row] = await ctx.db
      .select({ status: schema.userBookStatus.status })
      .from(schema.userBookStatus)
      .where(and(eq(schema.userBookStatus.userId, reader.userId), eq(schema.userBookStatus.bookId, bookId)));
    return row?.status ?? null;
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    const library = await createLibraryWithFolder(ctx, { name: `dashboard-listening-${randomUUID()}` });
    reader = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, library.libraryId);
    await ctx.db.update(schema.libraries).set({ markAsFinishedPercentComplete: 95 }).where(eq(schema.libraries.id, library.libraryId));

    const slug = `dashboard-listening-${randomUUID()}`;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({
        libraryId: library.libraryId,
        libraryFolderId: library.libraryFolderId,
        folderPath: `${library.folderPath}/${slug}`,
        status: 'present',
      })
      .returning({ id: schema.books.id });
    bookId = book!.id;

    await ctx.db.insert(schema.bookMetadata).values({ bookId, title: 'Continue Listening Regression' });
    const files = await ctx.db
      .insert(schema.bookFiles)
      .values([
        {
          bookId,
          libraryFolderId: library.libraryFolderId,
          absolutePath: `${library.folderPath}/${slug}/${slug}.epub`,
          relPath: `${slug}/${slug}.epub`,
          ino: BigInt(1),
          sizeBytes: 2048,
          format: 'epub',
          role: 'content',
        },
        {
          bookId,
          libraryFolderId: library.libraryFolderId,
          absolutePath: `${library.folderPath}/${slug}/${slug}.m4b`,
          relPath: `${slug}/${slug}.m4b`,
          ino: BigInt(2),
          sizeBytes: 4096,
          format: 'm4b',
          role: 'content',
          durationSeconds: 10_000,
        },
      ])
      .returning({ id: schema.bookFiles.id, format: schema.bookFiles.format });
    const epubFileId = files.find((file) => file.format === 'epub')!.id;
    await ctx.db.update(schema.books).set({ primaryFileId: epubFileId }).where(eq(schema.books.id, bookId));

    const manifestResponse = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/audiobooks/${bookId}/manifest`,
      headers: authHeader(reader.accessToken),
    });
    expect(manifestResponse.statusCode).toBe(200);
    const manifest = manifestResponse.json<AudiobookManifest>();
    assetId = manifest.assets[0]!.assetId;
    manifestRevision = manifest.revision;
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('removes a multi-format audiobook when progress crosses its configured finish threshold', async () => {
    const started = await saveAudioProgress(50);

    expect(started.statusCode).toBe(200);
    playbackRevision = started.json<AudiobookPlaybackState>().revision;
    await expect(getReadStatus()).resolves.toBe('reading');
    await expect(getContinueListeningIds()).resolves.toContain(bookId);

    const finished = await saveAudioProgress(99);

    expect(finished.statusCode).toBe(200);
    await expect(getReadStatus()).resolves.toBe('read');
    await expect(getContinueListeningIds()).resolves.not.toContain(bookId);
  });
});
