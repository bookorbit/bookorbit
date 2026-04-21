import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { and, eq, inArray } from 'drizzle-orm';
import { EPUB_READER_DEFAULTS } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { createEpubFixture, writeFixtureFile } from './e2e/reader-state-isolation/reader-state-isolation-fixture-builder';
import {
  authHeader,
  closeReaderStateIsolationE2EContext,
  createLibraryWithFolder,
  createReaderStateIsolationE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookByAbsolutePath,
  triggerAndWaitForLibraryScan,
  type CreatedLibrary,
  type LocatedBookFile,
  type ReaderStateIsolationE2EContext,
  type TestUserSession,
} from './e2e/reader-state-isolation/reader-state-isolation-harness';

interface ScenarioRunResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'reader-state-isolation-e2e-scenarios.json');
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((result) => result.status === 'passed').length,
        failed: results.filter((result) => result.status === 'failed').length,
        results,
      },
      null,
      2,
    ),
  );
}

describe('Reader state isolation (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  const scenarioResults: ScenarioRunResult[] = [];
  let scenarioStartedAt = 0;

  let sharedLibrary!: CreatedLibrary;
  let hiddenLibrary!: CreatedLibrary;

  let sharedEpub!: LocatedBookFile;
  let sharedAudioA!: LocatedBookFile;
  let sharedAudioB!: LocatedBookFile;
  let hiddenAudio!: LocatedBookFile;

  let userA!: TestUserSession;
  let userB!: TestUserSession;
  let outsider!: TestUserSession;

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();

    sharedLibrary = await createLibraryWithFolder(ctx, { name: `reader-shared-library-${randomUUID()}` });
    hiddenLibrary = await createLibraryWithFolder(ctx, { name: `reader-hidden-library-${randomUUID()}` });

    const sharedEpubPath = await createEpubFixture(sharedLibrary.folderPath, 'shared-reader.epub', { title: 'Reader Shared EPUB' });
    const sharedAudioAPath = await writeFixtureFile(sharedLibrary.folderPath, 'shared-audio-a.mp3', 'audio-a');
    const sharedAudioBPath = await writeFixtureFile(sharedLibrary.folderPath, 'shared-audio-b.mp3', 'audio-b');
    const hiddenAudioPath = await writeFixtureFile(hiddenLibrary.folderPath, 'hidden-audio.mp3', 'hidden-audio');

    await triggerAndWaitForLibraryScan(ctx, sharedLibrary.libraryId);
    await triggerAndWaitForLibraryScan(ctx, hiddenLibrary.libraryId);

    sharedEpub = await locateBookByAbsolutePath(ctx, sharedEpubPath);
    sharedAudioA = await locateBookByAbsolutePath(ctx, sharedAudioAPath);
    sharedAudioB = await locateBookByAbsolutePath(ctx, sharedAudioBPath);
    hiddenAudio = await locateBookByAbsolutePath(ctx, hiddenAudioPath);

    userA = await createUserAndLogin(ctx);
    userB = await createUserAndLogin(ctx);
    outsider = await createUserAndLogin(ctx);

    await grantLibraryAccess(ctx, userA.userId, sharedLibrary.libraryId, 'viewer');
    await grantLibraryAccess(ctx, userB.userId, sharedLibrary.libraryId, 'viewer');
  }, 120_000);

  beforeEach(async () => {
    scenarioStartedAt = Date.now();
    await resetReaderState(ctx);
  });

  afterEach((taskContext) => {
    const result = taskContext.task.result;
    if (!result) return;

    const state = result.state === 'pass' ? 'passed' : 'failed';
    const error = result.errors?.[0]?.message;
    scenarioResults.push({
      id: taskContext.task.name,
      status: state,
      durationMs: Math.max(0, Date.now() - scenarioStartedAt),
      ...(error ? { error } : {}),
    });
  });

  afterAll(async () => {
    await writeScenarioReport(scenarioResults);
    if (ctx) {
      await closeReaderStateIsolationE2EContext(ctx);
    }
  });

  describe('bookmarks and annotations ownership', () => {
    it('isolates bookmark and annotation data per user and blocks cross-user mutations with 404', async () => {
      const bookmarkAResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${sharedEpub.bookId}/bookmarks`,
        headers: authHeader(userA.accessToken),
        payload: {
          cfi: 'epubcfi(/6/2!/4/2/1:0)',
          title: 'A Bookmark',
        },
      });
      expect(bookmarkAResponse.statusCode).toBe(201);
      const bookmarkA = bookmarkAResponse.json() as { id: number };

      const bookmarkBResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${sharedEpub.bookId}/bookmarks`,
        headers: authHeader(userB.accessToken),
        payload: {
          cfi: 'epubcfi(/6/2!/4/2/1:1)',
          title: 'B Bookmark',
        },
      });
      expect(bookmarkBResponse.statusCode).toBe(201);
      const bookmarkB = bookmarkBResponse.json() as { id: number };

      const userABookmarksResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedEpub.bookId}/bookmarks`,
        headers: authHeader(userA.accessToken),
      });
      expect(userABookmarksResponse.statusCode).toBe(200);
      expect(userABookmarksResponse.json()).toMatchObject([{ id: bookmarkA.id }]);

      const userBBookmarksResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedEpub.bookId}/bookmarks`,
        headers: authHeader(userB.accessToken),
      });
      expect(userBBookmarksResponse.statusCode).toBe(200);
      expect(userBBookmarksResponse.json()).toMatchObject([{ id: bookmarkB.id }]);

      const userADeleteUserBBookmark = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/books/${sharedEpub.bookId}/bookmarks/${bookmarkB.id}`,
        headers: authHeader(userA.accessToken),
      });
      expect(userADeleteUserBBookmark.statusCode).toBe(404);

      const annotationAResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations`,
        headers: authHeader(userA.accessToken),
        payload: {
          cfi: 'epubcfi(/6/4!/2/2/1:0)',
          text: 'A Highlight',
          note: 'A Note',
        },
      });
      expect(annotationAResponse.statusCode).toBe(201);
      const annotationA = annotationAResponse.json() as { id: number };

      const annotationBResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations`,
        headers: authHeader(userB.accessToken),
        payload: {
          cfi: 'epubcfi(/6/4!/2/2/1:1)',
          text: 'B Highlight',
          note: 'B Note',
        },
      });
      expect(annotationBResponse.statusCode).toBe(201);
      const annotationB = annotationBResponse.json() as { id: number };

      const userAUpdateUserBAnnotation = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations/${annotationB.id}`,
        headers: authHeader(userA.accessToken),
        payload: {
          note: 'attempted overwrite',
        },
      });
      expect(userAUpdateUserBAnnotation.statusCode).toBe(404);

      const userADeleteUserBAnnotation = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations/${annotationB.id}`,
        headers: authHeader(userA.accessToken),
      });
      expect(userADeleteUserBAnnotation.statusCode).toBe(404);

      const userAAnnotationsResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations`,
        headers: authHeader(userA.accessToken),
      });
      expect(userAAnnotationsResponse.statusCode).toBe(200);
      expect(userAAnnotationsResponse.json()).toMatchObject([{ id: annotationA.id, note: 'A Note' }]);

      const userBAnnotationsResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations`,
        headers: authHeader(userB.accessToken),
      });
      expect(userBAnnotationsResponse.statusCode).toBe(200);
      expect(userBAnnotationsResponse.json()).toMatchObject([{ id: annotationB.id, note: 'B Note' }]);
    });
  });

  describe('reader preferences ownership', () => {
    it('isolates per-book and default reader preferences per user', async () => {
      const preCustomizationResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/reader/preferences/${sharedEpub.bookFileId}`,
        headers: authHeader(userA.accessToken),
      });
      expect(preCustomizationResponse.statusCode).toBe(200);
      expect(preCustomizationResponse.json()).toEqual({
        settings: null,
        isCustomized: false,
      });

      const userASettings = {
        themeName: 'dark',
        fontSize: 20,
      };
      const userBSettings = {
        themeName: 'sepia',
        fontSize: 14,
      };

      const userAUpsertPreference = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/reader/preferences/${sharedEpub.bookFileId}`,
        headers: authHeader(userA.accessToken),
        payload: {
          settings: userASettings,
        },
      });
      expect(userAUpsertPreference.statusCode).toBe(204);

      const userBUpsertPreference = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/reader/preferences/${sharedEpub.bookFileId}`,
        headers: authHeader(userB.accessToken),
        payload: {
          settings: userBSettings,
        },
      });
      expect(userBUpsertPreference.statusCode).toBe(204);

      const userAGetPreference = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/reader/preferences/${sharedEpub.bookFileId}`,
        headers: authHeader(userA.accessToken),
      });
      expect(userAGetPreference.statusCode).toBe(200);
      expect(userAGetPreference.json()).toEqual({
        settings: userASettings,
        isCustomized: true,
      });

      const userBGetPreference = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/reader/preferences/${sharedEpub.bookFileId}`,
        headers: authHeader(userB.accessToken),
      });
      expect(userBGetPreference.statusCode).toBe(200);
      expect(userBGetPreference.json()).toEqual({
        settings: userBSettings,
        isCustomized: true,
      });

      const userADefaults = {
        ...EPUB_READER_DEFAULTS,
        themeName: 'custom-a',
        fontSize: 18,
      };
      const userBDefaults = {
        ...EPUB_READER_DEFAULTS,
        themeName: 'custom-b',
        fontSize: 15,
      };

      const userAUpsertDefaults = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/reader/defaults/epub',
        headers: authHeader(userA.accessToken),
        payload: {
          settings: userADefaults,
        },
      });
      expect(userAUpsertDefaults.statusCode).toBe(204);

      const userBUpsertDefaults = await ctx.app.inject({
        method: 'PUT',
        url: '/api/v1/reader/defaults/epub',
        headers: authHeader(userB.accessToken),
        payload: {
          settings: userBDefaults,
        },
      });
      expect(userBUpsertDefaults.statusCode).toBe(204);

      const userAGetDefaults = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reader/defaults',
        headers: authHeader(userA.accessToken),
      });
      expect(userAGetDefaults.statusCode).toBe(200);
      expect(userAGetDefaults.json()).toMatchObject({
        epub: userADefaults,
      });

      const userBGetDefaults = await ctx.app.inject({
        method: 'GET',
        url: '/api/v1/reader/defaults',
        headers: authHeader(userB.accessToken),
      });
      expect(userBGetDefaults.statusCode).toBe(200);
      expect(userBGetDefaults.json()).toMatchObject({
        epub: userBDefaults,
      });
    });
  });

  describe('progress and audio-progress ownership', () => {
    it('keeps file progress and audio progress isolated per user', async () => {
      const userASaveFileProgress = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/progress`,
        headers: authHeader(userA.accessToken),
        payload: {
          cfi: 'epubcfi(/6/8!/4/2/1:0)',
          percentage: 31.25,
        },
      });
      expect(userASaveFileProgress.statusCode).toBe(201);

      const userBSaveFileProgress = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/progress`,
        headers: authHeader(userB.accessToken),
        payload: {
          cfi: 'epubcfi(/6/8!/4/2/1:1)',
          percentage: 75.5,
        },
      });
      expect(userBSaveFileProgress.statusCode).toBe(201);

      const userAGetFileProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/progress`,
        headers: authHeader(userA.accessToken),
      });
      expect(userAGetFileProgress.statusCode).toBe(200);
      expect(userAGetFileProgress.json()).toMatchObject({
        cfi: 'epubcfi(/6/8!/4/2/1:0)',
        percentage: 31.25,
      });

      const userBGetFileProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/progress`,
        headers: authHeader(userB.accessToken),
      });
      expect(userBGetFileProgress.statusCode).toBe(200);
      expect(userBGetFileProgress.json()).toMatchObject({
        cfi: 'epubcfi(/6/8!/4/2/1:1)',
        percentage: 75.5,
      });

      const userASaveAudioProgress = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(userA.accessToken),
        payload: {
          percentage: 22.5,
          currentFileId: sharedAudioA.bookFileId,
          positionSeconds: 135,
        },
      });
      expect(userASaveAudioProgress.statusCode).toBe(204);

      const userBSaveAudioProgress = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(userB.accessToken),
        payload: {
          percentage: 44.4,
          currentFileId: sharedAudioA.bookFileId,
          positionSeconds: 274,
        },
      });
      expect(userBSaveAudioProgress.statusCode).toBe(204);

      const userAGetAudioProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(userA.accessToken),
      });
      expect(userAGetAudioProgress.statusCode).toBe(200);
      expect(userAGetAudioProgress.json()).toMatchObject({
        userId: userA.userId,
        bookId: sharedAudioA.bookId,
        currentFileId: sharedAudioA.bookFileId,
        percentage: 22.5,
        positionSeconds: 135,
      });

      const userBGetAudioProgress = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(userB.accessToken),
      });
      expect(userBGetAudioProgress.statusCode).toBe(200);
      expect(userBGetAudioProgress.json()).toMatchObject({
        userId: userB.userId,
        bookId: sharedAudioA.bookId,
        currentFileId: sharedAudioA.bookFileId,
        percentage: 44.4,
        positionSeconds: 274,
      });
    });

    it('rejects invalid currentFileId bindings for audio progress', async () => {
      const crossBookResponse = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(userA.accessToken),
        payload: {
          percentage: 50,
          currentFileId: sharedAudioB.bookFileId,
          positionSeconds: 33,
        },
      });
      expect(crossBookResponse.statusCode).toBe(400);

      const inaccessibleFileResponse = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(userA.accessToken),
        payload: {
          percentage: 50,
          currentFileId: hiddenAudio.bookFileId,
          positionSeconds: 33,
        },
      });
      expect(inaccessibleFileResponse.statusCode).toBe(403);
    });
  });

  describe('reading sessions and inaccessible-library denial', () => {
    it('scopes reading session idempotency by user and preserves per-user aggregation', async () => {
      const sessionId = `reader-session-${randomUUID()}`;
      const payload = {
        sessionId,
        startedAt: '2026-01-10T10:00:00.000Z',
        endedAt: '2026-01-10T10:02:00.000Z',
        durationSeconds: 120,
        progressDelta: 12.5,
        endProgress: 28,
      };

      const userASessionResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/sessions`,
        headers: authHeader(userA.accessToken),
        payload,
      });
      expect(userASessionResponse.statusCode).toBe(204);

      const userBSessionResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/sessions`,
        headers: authHeader(userB.accessToken),
        payload,
      });
      expect(userBSessionResponse.statusCode).toBe(204);

      const duplicateUserASessionResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/sessions`,
        headers: authHeader(userA.accessToken),
        payload,
      });
      expect(duplicateUserASessionResponse.statusCode).toBe(204);

      const sessions = await ctx.db
        .select({
          userId: schema.readingSessions.userId,
          sessionId: schema.readingSessions.sessionId,
        })
        .from(schema.readingSessions)
        .where(eq(schema.readingSessions.sessionId, sessionId));

      expect(sessions).toHaveLength(2);
      expect(sessions.map((row) => row.userId).sort((a, b) => a - b)).toEqual([userA.userId, userB.userId].sort((a, b) => a - b));

      const dailyStats = await ctx.db
        .select({
          userId: schema.userReadingDailyStats.userId,
          sessionsCount: schema.userReadingDailyStats.sessionsCount,
          readingSeconds: schema.userReadingDailyStats.readingSeconds,
        })
        .from(schema.userReadingDailyStats)
        .where(
          and(
            eq(schema.userReadingDailyStats.libraryId, sharedLibrary.libraryId),
            inArray(schema.userReadingDailyStats.userId, [userA.userId, userB.userId]),
          ),
        );

      expect(dailyStats).toHaveLength(2);
      expect(dailyStats).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ userId: userA.userId, sessionsCount: 1, readingSeconds: 120 }),
          expect.objectContaining({ userId: userB.userId, sessionsCount: 1, readingSeconds: 120 }),
        ]),
      );
    });

    it('returns 403 for reader-state operations against inaccessible libraries', async () => {
      const bookmarkResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedEpub.bookId}/bookmarks`,
        headers: authHeader(outsider.accessToken),
      });
      expect(bookmarkResponse.statusCode).toBe(403);

      const annotationResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations`,
        headers: authHeader(outsider.accessToken),
      });
      expect(annotationResponse.statusCode).toBe(403);

      const preferenceResponse = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/reader/preferences/${sharedEpub.bookFileId}`,
        headers: authHeader(outsider.accessToken),
      });
      expect(preferenceResponse.statusCode).toBe(403);

      const progressResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/progress`,
        headers: authHeader(outsider.accessToken),
        payload: {
          cfi: 'epubcfi(/6/8!/4/2/1:0)',
          percentage: 12,
        },
      });
      expect(progressResponse.statusCode).toBe(403);

      const sessionResponse = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/sessions`,
        headers: authHeader(outsider.accessToken),
        payload: {
          sessionId: `outsider-${randomUUID()}`,
          startedAt: '2026-02-01T12:00:00.000Z',
          endedAt: '2026-02-01T12:01:00.000Z',
          durationSeconds: 60,
          progressDelta: 2,
          endProgress: 10,
        },
      });
      expect(sessionResponse.statusCode).toBe(403);

      const audioProgressResponse = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(outsider.accessToken),
        payload: {
          percentage: 55,
          currentFileId: sharedAudioA.bookFileId,
          positionSeconds: 50,
        },
      });
      expect(audioProgressResponse.statusCode).toBe(403);
    });
  });

  describe('representative validation contract', () => {
    it('rejects invalid payloads across reader-state endpoint families with 400', async () => {
      const invalidBookmark = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${sharedEpub.bookId}/bookmarks`,
        headers: authHeader(userA.accessToken),
        payload: {
          title: 'Missing location',
        },
      });
      expect(invalidBookmark.statusCode).toBe(400);

      const invalidAnnotation = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/${sharedEpub.bookId}/annotations`,
        headers: authHeader(userA.accessToken),
        payload: {
          cfi: 'epubcfi(/6/2!/4)',
          text: 'Invalid style payload',
          style: 'invalid-style',
        },
      });
      expect(invalidAnnotation.statusCode).toBe(400);

      const invalidPreference = await ctx.app.inject({
        method: 'PUT',
        url: `/api/v1/reader/preferences/${sharedEpub.bookFileId}`,
        headers: authHeader(userA.accessToken),
        payload: {
          settings: {
            unknownKey: true,
          },
        },
      });
      expect(invalidPreference.statusCode).toBe(400);

      const invalidProgress = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/progress`,
        headers: authHeader(userA.accessToken),
        payload: {
          cfi: 'epubcfi(/6/2!/4)',
          percentage: 120,
        },
      });
      expect(invalidProgress.statusCode).toBe(400);

      const invalidAudioProgress = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${sharedAudioA.bookId}/audio-progress`,
        headers: authHeader(userA.accessToken),
        payload: {
          percentage: 15,
          currentFileId: 0,
          positionSeconds: 30,
        },
      });
      expect(invalidAudioProgress.statusCode).toBe(400);

      const invalidSession = await ctx.app.inject({
        method: 'POST',
        url: `/api/v1/books/files/${sharedEpub.bookFileId}/sessions`,
        headers: authHeader(userA.accessToken),
        payload: {
          sessionId: `invalid-${randomUUID()}`,
          startedAt: '2026-01-10T10:02:00.000Z',
          endedAt: '2026-01-10T10:00:00.000Z',
          durationSeconds: 120,
          progressDelta: 4,
          endProgress: 10,
        },
      });
      expect(invalidSession.statusCode).toBe(400);
    });
  });
});

async function resetReaderState(ctx: ReaderStateIsolationE2EContext): Promise<void> {
  await Promise.all([
    ctx.db.delete(schema.readingSessions),
    ctx.db.delete(schema.userReadingDailyStats),
    ctx.db.delete(schema.readingProgress),
    ctx.db.delete(schema.audiobookProgress),
    ctx.db.delete(schema.bookmarks),
    ctx.db.delete(schema.annotations),
    ctx.db.delete(schema.readerPreferences),
    ctx.db.delete(schema.readerDefaultPreferences),
    ctx.db.delete(schema.userBookStatus),
  ]);
}
