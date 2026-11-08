import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { and, eq, inArray } from 'drizzle-orm';
import { BOOK_MERGED_ERROR_CODE, Permission, type AudiobookManifest } from '@bookorbit/types';

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

const MERGED_AWAY_AUDIO = 'merged-away-audio';

/**
 * A merged-away book id keeps working for what released clients replay from their offline queues
 * (E1 to E5, E7, E19 to E22). The merge itself is simulated: the kept book takes the merged-away
 * book's files and rows, a `book_merges` row records the alias, and the merged-away book is deleted.
 */
describe('Book merge alias (e2e)', { timeout: 120_000 }, () => {
  let ctx!: ReaderStateIsolationE2EContext;
  let library!: CreatedLibrary;
  let reader!: TestUserSession;
  let outsider!: TestUserSession;

  let mergedEpub!: LocatedBookFile;
  let mergedAudio!: LocatedBookFile;
  let keptEpub!: LocatedBookFile;
  let mergedAwayId!: number;
  let keptId!: number;

  let manifestBeforeMerge!: AudiobookManifest;
  let annotationToEdit!: number;
  let annotationToDelete!: number;
  let bookmarkToEdit!: number;
  let audioBookmarkClientId!: string;
  let journalClientId!: string;
  let sessionToDelete!: number;

  const inject = (user: TestUserSession, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, payload?: object) =>
    ctx.app.inject({ method, url: `/api/v1${path}`, headers: authHeader(user.accessToken), ...(payload ? { payload } : {}) });

  async function expectStatus(
    user: TestUserSession,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    status: number,
    payload?: object,
  ) {
    const response = await inject(user, method, path, payload);
    expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(status);
    return response;
  }

  async function simulateMerge(sourceBookId: number, targetBookId: number): Promise<void> {
    await ctx.db.transaction(async (tx) => {
      await tx.update(schema.bookFiles).set({ bookId: targetBookId }).where(eq(schema.bookFiles.bookId, sourceBookId));
      for (const table of [
        schema.annotations,
        schema.bookmarks,
        schema.bookJournalEntries,
        schema.readingSessions,
        schema.readingAttempts,
        schema.audiobookProgress,
        schema.audiobookManifestRevisions,
      ]) {
        await tx.update(table).set({ bookId: targetBookId }).where(eq(table.bookId, sourceBookId));
      }
      await tx.insert(schema.bookMerges).values({
        sourceBookId,
        targetBookId,
        libraryId: library.libraryId,
        mergedByUserId: reader.userId,
        snapshot: {
          title: 'Merged Away',
          folderPath: 'merged-away',
          libraryFolderId: library.libraryFolderId,
          addedAt: null,
          metadata: null,
          lockedFields: [],
          authors: [],
          narrators: [],
          series: [],
          genreIds: [],
          tagIds: [],
          providerIds: {},
          coverSlots: [],
          files: [],
        },
      });
      await tx.delete(schema.books).where(eq(schema.books.id, sourceBookId));
    });
  }

  beforeAll(async () => {
    ctx = await createReaderStateIsolationE2EContext();
    library = await createLibraryWithFolder(ctx, { mode: 'book_per_folder', name: `merge-alias-library-${randomUUID()}` });

    const mergedEpubPath = await createEpubFixture(library.folderPath, 'merged-away/merged-away.epub', { title: 'Merged Away' });
    const mergedAudioPath = await writeFixtureFile(library.folderPath, 'merged-away/merged-away.mp3', MERGED_AWAY_AUDIO);
    const keptEpubPath = await createEpubFixture(library.folderPath, 'kept/kept.epub', { title: 'Kept' });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);

    mergedEpub = await locateBookByAbsolutePath(ctx, mergedEpubPath);
    mergedAudio = await locateBookByAbsolutePath(ctx, mergedAudioPath);
    keptEpub = await locateBookByAbsolutePath(ctx, keptEpubPath);
    mergedAwayId = mergedEpub.bookId;
    keptId = keptEpub.bookId;
    expect(mergedAudio.bookId).toBe(mergedAwayId);
    expect(keptId).not.toBe(mergedAwayId);
    await ctx.db.update(schema.bookFiles).set({ durationSeconds: 1_000 }).where(eq(schema.bookFiles.id, mergedAudio.bookFileId));

    reader = await createUserAndLogin(ctx, { permissions: [Permission.LibraryDownload] });
    outsider = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, reader.userId, library.libraryId, 'viewer');

    manifestBeforeMerge = (await expectStatus(reader, 'GET', `/audiobooks/${mergedAwayId}/manifest`, 200)).json<AudiobookManifest>();
    await expectStatus(reader, 'PUT', `/audiobooks/${mergedAwayId}/playback-state`, 200, {
      assetId: manifestBeforeMerge.assets[0]!.assetId,
      positionMs: 100_000,
      capturedAt: '2026-11-01T10:00:00.000Z',
      operationId: randomUUID(),
      baseRevision: 0,
      manifestRevision: manifestBeforeMerge.revision,
    });

    annotationToEdit = (
      await expectStatus(reader, 'POST', `/books/${mergedAwayId}/annotations`, 201, {
        cfi: 'epubcfi(/6/4!/2/2/1:0)',
        text: 'Highlight to edit',
        bookFileId: mergedEpub.bookFileId,
      })
    ).json<{ id: number }>().id;
    annotationToDelete = (
      await expectStatus(reader, 'POST', `/books/${mergedAwayId}/annotations`, 201, { cfi: 'epubcfi(/6/4!/2/2/1:5)', text: 'Highlight to delete' })
    ).json<{ id: number }>().id;
    bookmarkToEdit = (
      await expectStatus(reader, 'POST', `/books/${mergedAwayId}/bookmarks`, 201, { cfi: 'epubcfi(/6/2!/4/2/1:0)', title: 'Bookmark to edit' })
    ).json<{ id: number }>().id;

    audioBookmarkClientId = randomUUID();
    await expectStatus(reader, 'POST', `/audiobooks/${mergedAwayId}/bookmarks`, 201, {
      clientId: audioBookmarkClientId,
      positionMs: 30_000,
      title: 'Audio bookmark to edit',
    });

    journalClientId = randomUUID();
    await expectStatus(reader, 'POST', `/books/${mergedAwayId}/journal`, 201, { clientId: journalClientId, body: 'Journal entry to edit' });

    sessionToDelete = (
      await expectStatus(reader, 'POST', `/books/${mergedAwayId}/sessions`, 201, { startedAt: '2026-11-01T09:00:00.000Z', durationMinutes: 20 })
    ).json<{ id: number }>().id;

    await simulateMerge(mergedAwayId, keptId);
  }, 120_000);

  afterAll(async () => {
    if (ctx) await closeReaderStateIsolationE2EContext(ctx);
  });

  it('answers a merged-away book detail with a coded 404 naming the kept book, for a reader who can see it (E5, A20)', async () => {
    const response = await expectStatus(reader, 'GET', `/books/${mergedAwayId}`, 404);

    expect(response.json()).toMatchObject({ errorCode: BOOK_MERGED_ERROR_CODE, errorMeta: { targetBookId: keptId } });
  });

  it('answers the plain 404 to a user who cannot see the kept book, and never names it (A15)', async () => {
    const detail = await expectStatus(outsider, 'GET', `/books/${mergedAwayId}`, 404);
    expect(detail.json()).not.toHaveProperty('errorCode');
    expect(detail.json()).not.toHaveProperty('errorMeta');
    expect(detail.json().message).toBe(`Book ${mergedAwayId} not found`);

    const aliasedWrite = await expectStatus(outsider, 'PATCH', `/books/${mergedAwayId}/status`, 404, { status: 'reading' });
    expect(aliasedWrite.json()).not.toHaveProperty('errorCode');
    expect(aliasedWrite.json().message).toBe(`Book ${mergedAwayId} not found`);
  });

  it('lands queued annotation creates, edits and deletes on the kept book (E1, E19)', async () => {
    const created = await expectStatus(reader, 'POST', `/books/${mergedAwayId}/annotations`, 201, {
      cfi: 'epubcfi(/6/4!/2/2/1:9)',
      text: 'Queued highlight',
      bookFileId: mergedEpub.bookFileId,
    });
    await expectStatus(reader, 'PATCH', `/books/${mergedAwayId}/annotations/${annotationToEdit}`, 200, { note: 'Edited after the merge' });
    await expectStatus(reader, 'DELETE', `/books/${mergedAwayId}/annotations/${annotationToDelete}`, 204);

    const createdId = created.json<{ id: number }>().id;
    const rows = await ctx.db
      .select({
        id: schema.annotations.id,
        bookId: schema.annotations.bookId,
        note: schema.annotations.note,
        deletedAt: schema.annotations.deletedAt,
      })
      .from(schema.annotations)
      .where(inArray(schema.annotations.id, [createdId, annotationToEdit]));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.bookId === keptId && row.deletedAt === null)).toBe(true);
    expect(rows.find((row) => row.id === annotationToEdit)?.note).toBe('Edited after the merge');

    const listed = (await expectStatus(reader, 'GET', `/books/${mergedAwayId}/annotations`, 200)).json<Array<{ id: number }>>().map((row) => row.id);
    expect(listed).toEqual(expect.arrayContaining([createdId, annotationToEdit]));
    expect(listed).not.toContain(annotationToDelete);
  });

  it('lands bookmark creates, edits and deletes on the kept book (E2)', async () => {
    const created = await expectStatus(reader, 'POST', `/books/${mergedAwayId}/bookmarks`, 201, {
      cfi: 'epubcfi(/6/2!/4/2/1:7)',
      title: 'Queued bookmark',
    });
    await expectStatus(reader, 'PATCH', `/books/${mergedAwayId}/bookmarks/${bookmarkToEdit}`, 200, { title: 'Renamed after the merge' });

    const createdId = created.json<{ id: number }>().id;
    const rows = await ctx.db
      .select({ id: schema.bookmarks.id, bookId: schema.bookmarks.bookId, title: schema.bookmarks.title })
      .from(schema.bookmarks)
      .where(inArray(schema.bookmarks.id, [createdId, bookmarkToEdit]));
    expect(rows.map((row) => row.bookId)).toEqual([keptId, keptId]);
    expect(rows.find((row) => row.id === bookmarkToEdit)?.title).toBe('Renamed after the merge');

    await expectStatus(reader, 'DELETE', `/books/${mergedAwayId}/bookmarks/${createdId}`, 204);
    const listed = (await expectStatus(reader, 'GET', `/books/${mergedAwayId}/bookmarks`, 200)).json<Array<{ id: number }>>().map((row) => row.id);
    expect(listed).toContain(bookmarkToEdit);
    expect(listed).not.toContain(createdId);
  });

  it('lands audiobook bookmark creates, edits and deletes on the kept book (E19, E20)', async () => {
    const queuedClientId = randomUUID();
    await expectStatus(reader, 'POST', `/audiobooks/${mergedAwayId}/bookmarks`, 201, {
      clientId: queuedClientId,
      positionMs: 60_000,
      title: 'Queued audio',
    });
    await expectStatus(reader, 'PATCH', `/audiobooks/${mergedAwayId}/bookmarks/${audioBookmarkClientId}`, 200, { title: 'Audio renamed' });

    const rows = await ctx.db
      .select({ clientId: schema.bookmarks.clientId, bookId: schema.bookmarks.bookId, title: schema.bookmarks.title })
      .from(schema.bookmarks)
      .where(and(eq(schema.bookmarks.userId, reader.userId), inArray(schema.bookmarks.clientId, [queuedClientId, audioBookmarkClientId])));
    expect(rows.map((row) => row.bookId)).toEqual([keptId, keptId]);
    expect(rows.find((row) => row.clientId === audioBookmarkClientId)?.title).toBe('Audio renamed');

    const listed = (await expectStatus(reader, 'GET', `/audiobooks/${mergedAwayId}/bookmarks`, 200)).json<Array<{ id: string }>>();
    expect(listed.map((row) => row.id)).toEqual(expect.arrayContaining([queuedClientId, audioBookmarkClientId]));

    await expectStatus(reader, 'DELETE', `/audiobooks/${mergedAwayId}/bookmarks/${queuedClientId}`, 204);
  });

  it('lands journal creates, edits, trash and restore on the kept book without a conflict (E4)', async () => {
    const queuedClientId = randomUUID();
    await expectStatus(reader, 'POST', `/books/${mergedAwayId}/journal`, 201, { clientId: queuedClientId, body: 'Queued entry' });
    await expectStatus(reader, 'PATCH', `/books/${mergedAwayId}/journal/${journalClientId}`, 200, { body: 'Edited after the merge' });
    await expectStatus(reader, 'DELETE', `/books/${mergedAwayId}/journal/${journalClientId}`, 204);
    await expectStatus(reader, 'POST', `/books/${mergedAwayId}/journal/${journalClientId}/restore`, 200);

    const rows = await ctx.db
      .select({ clientId: schema.bookJournalEntries.clientId, bookId: schema.bookJournalEntries.bookId, body: schema.bookJournalEntries.body })
      .from(schema.bookJournalEntries)
      .where(inArray(schema.bookJournalEntries.clientId, [queuedClientId, journalClientId]));
    expect(rows.map((row) => row.bookId)).toEqual([keptId, keptId]);
    expect(rows.find((row) => row.clientId === journalClientId)?.body).toBe('Edited after the merge');
  });

  it('sets read status and the personal note on the kept book', async () => {
    await expectStatus(reader, 'PATCH', `/books/${mergedAwayId}/status`, 200, { status: 'reading' });
    await expectStatus(reader, 'PATCH', `/books/${mergedAwayId}/personal-note`, 200, { note: 'Note sent to the merged-away id' });

    const [status] = await ctx.db
      .select({ status: schema.userBookStatus.status })
      .from(schema.userBookStatus)
      .where(and(eq(schema.userBookStatus.userId, reader.userId), eq(schema.userBookStatus.bookId, keptId)));
    expect(status?.status).toBe('reading');
    const [note] = await ctx.db
      .select({ note: schema.userBookNotes.note })
      .from(schema.userBookNotes)
      .where(and(eq(schema.userBookNotes.userId, reader.userId), eq(schema.userBookNotes.bookId, keptId)));
    expect(note?.note).toBe('Note sent to the merged-away id');
  });

  it('creates and deletes reading sessions on the kept book (E22)', async () => {
    const created = await expectStatus(reader, 'POST', `/books/${mergedAwayId}/sessions`, 201, {
      startedAt: '2026-11-02T09:00:00.000Z',
      durationMinutes: 15,
    });
    await expectStatus(reader, 'DELETE', `/books/${mergedAwayId}/sessions/${sessionToDelete}`, 204);

    const rows = await ctx.db
      .select({ id: schema.readingSessions.id, bookId: schema.readingSessions.bookId })
      .from(schema.readingSessions)
      .where(inArray(schema.readingSessions.id, [created.json<{ id: number }>().id, sessionToDelete]));
    expect(rows).toEqual([{ id: created.json<{ id: number }>().id, bookId: keptId }]);
    await expectStatus(reader, 'GET', `/books/${mergedAwayId}/reading-attempts`, 200);
  });

  it('accepts audio playback state written against the merged-away book manifest revision (E3)', async () => {
    const manifest = (await expectStatus(reader, 'GET', `/audiobooks/${mergedAwayId}/manifest`, 200)).json<AudiobookManifest>();
    expect(manifest.assets.map((asset) => asset.assetId)).toEqual(manifestBeforeMerge.assets.map((asset) => asset.assetId));

    await expectStatus(reader, 'PUT', `/audiobooks/${mergedAwayId}/playback-state`, 200, {
      assetId: manifestBeforeMerge.assets[0]!.assetId,
      positionMs: 200_000,
      capturedAt: '2026-11-02T10:00:00.000Z',
      operationId: randomUUID(),
      baseRevision: 1,
      manifestRevision: manifestBeforeMerge.revision,
    });
    const state = (await expectStatus(reader, 'GET', `/audiobooks/${mergedAwayId}/playback-state`, 200)).json<{ positionMs: number }>();
    expect(state.positionMs).toBe(200_000);

    const [progress] = await ctx.db
      .select({ bookId: schema.audiobookProgress.bookId })
      .from(schema.audiobookProgress)
      .where(eq(schema.audiobookProgress.userId, reader.userId));
    expect(progress?.bookId).toBe(keptId);

    const content = await expectStatus(reader, 'GET', `/audiobooks/${mergedAwayId}/assets/${manifestBeforeMerge.assets[0]!.assetId}/content`, 200);
    expect(content.body).toBe(MERGED_AWAY_AUDIO);
  });

  it('issues a Watch download for the kept book when the body names the merged-away book (E21)', async () => {
    const response = await expectStatus(reader, 'POST', '/watch-downloads', 201, { bookId: mergedAwayId, fileIds: [mergedAudio.bookFileId] });

    const { token, files } = response.json<{ token: string; files: Array<{ fileId: number }> }>();
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as { bookId: number; fileIds: number[] };
    expect(claims).toMatchObject({ bookId: keptId, fileIds: [mergedAudio.bookFileId] });
    expect(files.map((file) => file.fileId)).toEqual([mergedAudio.bookFileId]);
  });

  it('stores per-book speech preferences on the kept book', async () => {
    const saved = await expectStatus(reader, 'PUT', `/tts/preferences/book/${mergedAwayId}`, 200, { speed: 1.5 });
    expect(saved.json()).toMatchObject({ bookId: keptId, speed: 1.5 });
    expect((await expectStatus(reader, 'GET', `/tts/preferences/book/${mergedAwayId}`, 200)).json()).toMatchObject({ speed: 1.5 });

    const rows = await ctx.db
      .select({ bookId: schema.ttsBookPreferences.bookId })
      .from(schema.ttsBookPreferences)
      .where(eq(schema.ttsBookPreferences.userId, reader.userId));
    expect(rows).toEqual([{ bookId: keptId }]);
  });

  it('serves an OPDS download link cached for the merged-away book from the kept book (E15)', async () => {
    const username = `opds-alias-${randomUUID().slice(0, 8)}`;
    const password = 'OpdsAliasPass123';
    await ctx.db
      .insert(schema.appSettings)
      .values({ key: 'opds_enabled', value: 'true' })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: 'true' } });
    await ctx.db.insert(schema.userPermissions).values({ userId: reader.userId, permissionName: Permission.OpdsAccess });
    await ctx.db.insert(schema.opdsUsers).values({ userId: reader.userId, username, passwordHash: await hash(password, 4), sortOrder: 'recent' });
    const headers = { authorization: `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}` };

    const viaAlias = await ctx.app.inject({ method: 'GET', url: `/api/v1/opds/${mergedAwayId}/download`, headers });
    const direct = await ctx.app.inject({ method: 'GET', url: `/api/v1/opds/${keptId}/download`, headers });

    expect(direct.statusCode, direct.body).toBe(200);
    expect(viaAlias.statusCode, viaAlias.body).toBe(200);
    expect(viaAlias.rawPayload.equals(direct.rawPayload)).toBe(true);
  });

  it('serves the cover and thumbnail routes from the kept book (E7)', async () => {
    for (const variant of ['cover', 'thumbnail']) {
      const viaAlias = await inject(reader, 'GET', `/books/${mergedAwayId}/${variant}`);
      const direct = await inject(reader, 'GET', `/books/${keptId}/${variant}`);

      expect(viaAlias.statusCode).toBe(direct.statusCode);
      if (direct.statusCode === 200) expect(viaAlias.rawPayload.equals(direct.rawPayload)).toBe(true);
      else expect(viaAlias.json().message).toBe(direct.json().message);
    }
  });
});
