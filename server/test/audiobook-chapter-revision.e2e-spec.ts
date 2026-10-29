import { randomUUID } from 'crypto';

import { eq } from 'drizzle-orm';
import {
  BOOK_CHAPTERS_ERROR_CODES,
  type AudiobookManifest,
  type AudiobookPlaybackState,
  type BookChaptersState,
  type BookChapterVersion,
  type BookChapterVersionSummary,
  type BookDetail,
} from '@bookorbit/types';

import { computeAudiobookManifestRevision, orderAudiobookTracks, resolveStoredAudiobookChapters } from '../src/common/utils/audiobook-chapters.utils';
import { MigrationImportRepository } from '../src/modules/migration/executor/migration-import.repository';
import * as schema from '../src/db/schema';
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

const SEEDED_CHAPTERS = [
  { title: 'Part 1', startMs: 0 },
  { title: 'Part 2', startMs: 60_000 },
];

// Released iOS treats a 412 from playback-state as permanent: a download or a Watch transfer keeps
// sending the manifest revision it was made with. These cases pin which changes it survives.
describe('Audiobook chapter changes and manifest revisions (e2e)', { timeout: 60_000 }, () => {
  let ctx!: AuthorizationMatrixE2EContext;
  let library!: CreatedLibrary;
  let listener!: TestUserSession;
  let bookId!: number;
  let secondFileId!: number;

  async function getManifest(targetBookId = bookId): Promise<AudiobookManifest> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/audiobooks/${targetBookId}/manifest`,
      headers: authHeader(listener.accessToken),
    });
    expect(response.statusCode).toBe(200);
    return response.json<AudiobookManifest>();
  }

  async function putPlayback(manifest: AudiobookManifest, manifestRevision: string, targetBookId = bookId) {
    const current = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/audiobooks/${targetBookId}/playback-state`,
      headers: authHeader(listener.accessToken),
    });
    const baseRevision = current.statusCode === 200 && current.body ? (current.json<AudiobookPlaybackState | null>()?.revision ?? 0) : 0;
    return ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/audiobooks/${targetBookId}/playback-state`,
      headers: authHeader(listener.accessToken),
      payload: {
        assetId: manifest.assets[0]!.assetId,
        positionMs: 5_000,
        capturedAt: new Date().toISOString(),
        operationId: randomUUID(),
        baseRevision,
        manifestRevision,
      },
    });
  }

  async function patchChapters(chapters: Array<{ title: string; startMs: number }>) {
    return ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/metadata`,
      headers: authHeader(ctx.adminToken),
      payload: { audioMetadata: { chapters } },
    });
  }

  /** Two tracks of 60s and 120s whose stored chapters came from the files. */
  async function seedAudiobook(title: string): Promise<{ bookId: number; fileIds: number[]; filePaths: string[] }> {
    const slug = `chapter-revision-${randomUUID()}`;
    const [book] = await ctx.db
      .insert(schema.books)
      .values({
        libraryId: library.libraryId,
        libraryFolderId: library.libraryFolderId,
        folderPath: `${library.folderPath}/${slug}`,
        status: 'present',
      })
      .returning({ id: schema.books.id });
    const seededBookId = book!.id;
    await ctx.db.insert(schema.bookMetadata).values({ bookId: seededBookId, title, chapters: SEEDED_CHAPTERS, chaptersSource: 'embedded' });
    const filePaths = [1, 2].map((part) => `${library.folderPath}/${slug}/Part ${part}.mp3`);
    const files = await ctx.db
      .insert(schema.bookFiles)
      .values(
        [1, 2].map((part) => ({
          bookId: seededBookId,
          libraryFolderId: library.libraryFolderId,
          absolutePath: filePaths[part - 1]!,
          relPath: `${slug}/Part ${part}.mp3`,
          ino: BigInt(part),
          sizeBytes: 1_000 * part,
          format: 'mp3',
          role: 'content',
          sortOrder: part,
          durationSeconds: 60 * part,
        })),
      )
      .returning({ id: schema.bookFiles.id });
    await ctx.db.update(schema.books).set({ primaryFileId: files[0]!.id }).where(eq(schema.books.id, seededBookId));
    return { bookId: seededBookId, fileIds: files.map((file) => file.id), filePaths };
  }

  beforeAll(async () => {
    ctx = await createAuthorizationMatrixE2EContext();
    library = await createLibraryWithFolder(ctx, { name: `chapter-revision-${randomUUID()}` });
    listener = await createUserAndLogin(ctx);
    await grantLibraryAccess(ctx, listener.userId, library.libraryId);

    const seeded = await seedAudiobook('Chapter Revision Regression');
    bookId = seeded.bookId;
    secondFileId = seeded.fileIds[1]!;
  });

  afterAll(async () => {
    await closeAuthorizationMatrixE2EContext(ctx);
  });

  it('accepts exactly one concurrent editor save and records only accepted history', async () => {
    const seeded = await seedAudiobook('Concurrent edits');
    const loaded = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${seeded.bookId}/chapters`, headers: authHeader(ctx.adminToken) });
    const revision = loaded.json<BookChaptersState>().revision;
    const responses = await Promise.all(
      ['Edit A', 'Edit B'].map((title) =>
        ctx.app.inject({
          method: 'PUT',
          url: `/api/v1/books/${seeded.bookId}/chapters`,
          headers: authHeader(ctx.adminToken),
          payload: { chapters: [{ title, startMs: 0 }], baseRevision: revision },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const versions = await ctx.db.select().from(schema.bookChapterVersions).where(eq(schema.bookChapterVersions.bookId, seeded.bookId));
    expect(versions).toHaveLength(2);
    expect(versions.some((version) => version.source === 'embedded')).toBe(true);
  });

  it('invalidates editor drafts when track order changes', async () => {
    const seeded = await seedAudiobook('Reordered audio');
    const load = () => ctx.app.inject({ method: 'GET', url: `/api/v1/books/${seeded.bookId}/chapters`, headers: authHeader(ctx.adminToken) });
    const first = (await load()).json<BookChaptersState>();
    await ctx.db.update(schema.bookFiles).set({ sortOrder: 5 }).where(eq(schema.bookFiles.id, seeded.fileIds[0]));
    expect((await load()).json<BookChaptersState>().revision).not.toBe(first.revision);
    const save = await ctx.app.inject({
      method: 'PUT',
      url: `/api/v1/books/${seeded.bookId}/chapters`,
      headers: authHeader(ctx.adminToken),
      payload: { chapters: SEEDED_CHAPTERS, baseRevision: first.revision },
    });
    expect(save.statusCode).toBe(409);
  });

  it('keeps the first downloaded layout valid after more than 100 chapter edits', async () => {
    const seeded = await seedAudiobook('Long lived download');
    const before = await getManifest(seeded.bookId);
    for (let index = 0; index < 105; index += 1) {
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${seeded.bookId}/metadata`,
        headers: authHeader(ctx.adminToken),
        payload: { audioMetadata: { chapters: [{ title: `Edit ${index}`, startMs: 0 }] } },
      });
      expect(response.statusCode).toBe(200);
    }
    expect((await putPlayback(before, before.revision, seeded.bookId)).statusCode).toBe(200);
    expect(
      await ctx.db.select().from(schema.audiobookManifestRevisions).where(eq(schema.audiobookManifestRevisions.bookId, seeded.bookId)),
    ).toHaveLength(1);
  });

  it('preserves an unregistered pre-upgrade manifest before a migration replaces chapters', async () => {
    const seeded = await seedAudiobook('Legacy imported download');
    const files = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, seeded.bookId));
    const legacy = computeAudiobookManifestRevision(orderAudiobookTracks(files), resolveStoredAudiobookChapters(SEEDED_CHAPTERS, files) ?? []);
    const migration = ctx.app.get(MigrationImportRepository);
    await migration.upsertBookMetadata(seeded.bookId, { chapters: [{ title: 'Imported chapters', startMs: 0 }], chaptersSource: 'migration' });
    const manifest = await getManifest(seeded.bookId);
    expect((await putPlayback(manifest, legacy, seeded.bookId)).statusCode).toBe(200);
    const versions = await ctx.db.select().from(schema.bookChapterVersions).where(eq(schema.bookChapterVersions.bookId, seeded.bookId));
    expect(versions.map((version) => version.chapters)).toContainEqual(SEEDED_CHAPTERS);
  });

  it('keeps a client on the pre-edit manifest syncing after its chapters are edited', async () => {
    const before = await getManifest();
    expect((await putPlayback(before, before.revision)).statusCode).toBe(200);

    const edited = await patchChapters([
      { title: 'Two', startMs: 60_000 },
      { title: '', startMs: 0 },
    ]);
    expect(edited.statusCode).toBe(200);
    expect(edited.json<BookDetail>().audioMetadata).toMatchObject({
      chapters: [
        { title: 'Chapter 1', startMs: 0 },
        { title: 'Two', startMs: 60_000 },
      ],
      chaptersSource: 'manual',
    });

    const after = await getManifest();
    expect(after.revision).not.toBe(before.revision);
    expect(after.schemaVersion).toBe(2);

    const stale = await putPlayback(before, before.revision);
    expect(stale.statusCode).toBe(200);
    expect(stale.json<AudiobookPlaybackState>().manifestRevision).toBe(after.revision);
  });

  it('keeps a bookmark whose chapter id came from the previous manifest', async () => {
    const before = await getManifest();
    expect((await patchChapters([{ title: 'Only', startMs: 0 }])).statusCode).toBe(200);

    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/audiobooks/${bookId}/bookmarks`,
      headers: authHeader(listener.accessToken),
      payload: { clientId: randomUUID(), positionMs: 3_000, title: 'Stale chapter', chapterId: before.chapters[0]!.id },
    });

    expect(created.statusCode).toBeLessThan(300);
    expect(created.json<{ chapterId: string | null }>().chapterId).toBeNull();
  });

  it('refuses a manual chapter write once chapters are locked', async () => {
    const lock = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/metadata-locks`,
      headers: authHeader(ctx.adminToken),
      payload: { lockedFields: ['chapters'] },
    });
    expect(lock.statusCode).toBe(200);

    expect((await patchChapters([{ title: 'Blocked', startMs: 0 }])).statusCode).toBe(409);

    const unlock = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/metadata-locks`,
      headers: authHeader(ctx.adminToken),
      payload: { lockedFields: [] },
    });
    expect(unlock.statusCode).toBe(200);
  });

  it('still refuses a revision once a track itself changed length', async () => {
    const before = await getManifest();
    await ctx.db.update(schema.bookFiles).set({ durationSeconds: 125 }).where(eq(schema.bookFiles.id, secondFileId));

    const stale = await putPlayback(before, before.revision);

    expect(stale.statusCode).toBe(412);
  });

  describe('chapter editor', () => {
    let editorBookId!: number;
    let editorFilePaths!: string[];
    const readEmbeddedChapters = vi.fn();

    function editorRequest(method: 'GET' | 'PUT' | 'POST', path: string, token: string, payload?: Record<string, unknown>) {
      return ctx.app.inject({ method, url: `/api/v1/books/${editorBookId}/chapters${path}`, headers: authHeader(token), payload });
    }

    async function loadState(token = ctx.adminToken): Promise<BookChaptersState> {
      const response = await editorRequest('GET', '', token);
      expect(response.statusCode).toBe(200);
      return response.json<BookChaptersState>();
    }

    beforeAll(async () => {
      const seeded = await seedAudiobook('Chapter Editor');
      editorBookId = seeded.bookId;
      editorFilePaths = seeded.filePaths;
      // The harness replaces MetadataService wholesale, so reading the audio files is stubbed here.
      Object.assign(ctx.metadataMock, { readEmbeddedChapters });
    });

    it('lets a listener read the chapter state but not change it', async () => {
      const state = await loadState(listener.accessToken);
      expect(state).toMatchObject({
        chapters: SEEDED_CHAPTERS,
        source: 'embedded',
        derived: false,
        locked: false,
        updatedBy: null,
        totalDurationMs: 180_000,
        tracks: [
          { name: 'Part 1.mp3', startMs: 0, durationMs: 60_000 },
          { name: 'Part 2.mp3', startMs: 60_000, durationMs: 120_000 },
        ],
        versionCount: 0,
      });
      expect(state.revision).toMatch(/^[0-9a-f]{64}$/);

      const save = await editorRequest('PUT', '', listener.accessToken, { chapters: SEEDED_CHAPTERS, baseRevision: state.revision });
      expect(save.statusCode).toBe(403);
      expect((await editorRequest('GET', '/versions', listener.accessToken)).statusCode).toBe(403);
      expect((await editorRequest('POST', '/revert', listener.accessToken, { baseRevision: state.revision })).statusCode).toBe(403);
    });

    it('saves against the loaded revision, keeps the original as a version, and keeps older manifests syncing', async () => {
      const manifestBefore = await getManifest(editorBookId);
      const initial = await loadState();

      const saved = await editorRequest('PUT', '', ctx.adminToken, {
        chapters: [
          { title: ' Opening ', startMs: 0 },
          { title: 'Middle', startMs: 90_000 },
        ],
        baseRevision: initial.revision,
      });
      expect(saved.statusCode).toBe(200);
      const state = saved.json<BookChaptersState>();
      expect(state).toMatchObject({
        chapters: [
          { title: 'Opening', startMs: 0 },
          { title: 'Middle', startMs: 90_000 },
        ],
        source: 'manual',
        derived: false,
        locked: true,
        updatedBy: { id: expect.any(Number), name: expect.any(String) },
        versionCount: 2,
      });
      expect(state.revision).not.toBe(initial.revision);
      expect(await loadState()).toEqual(state);

      const stale = await editorRequest('PUT', '', ctx.adminToken, { chapters: SEEDED_CHAPTERS, baseRevision: initial.revision });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ errorCode: BOOK_CHAPTERS_ERROR_CODES.stale });

      const descending = await editorRequest('PUT', '', ctx.adminToken, {
        chapters: [
          { title: 'One', startMs: 0 },
          { title: 'Two', startMs: 50_000 },
          { title: 'Three', startMs: 40_000 },
        ],
        baseRevision: state.revision,
      });
      expect(descending.statusCode).toBe(400);
      expect(descending.json()).toMatchObject({ errorCode: BOOK_CHAPTERS_ERROR_CODES.notAscending, errorMeta: { index: 2 } });

      const versions = await editorRequest('GET', '/versions', ctx.adminToken);
      expect(versions.statusCode).toBe(200);
      const [edit, original] = versions.json<BookChapterVersionSummary[]>();
      expect(versions.json<BookChapterVersionSummary[]>()).toHaveLength(2);
      expect(edit).toMatchObject({ source: 'manual', chapterCount: 2, createdBy: state.updatedBy });
      expect(original).toMatchObject({ source: 'embedded', chapterCount: 2, createdBy: null });

      const originalVersion = await editorRequest('GET', `/versions/${original!.id}`, ctx.adminToken);
      expect(originalVersion.statusCode).toBe(200);
      expect(originalVersion.json<BookChapterVersion>().chapters).toEqual(SEEDED_CHAPTERS);
      expect((await editorRequest('GET', '/versions/999999999', ctx.adminToken)).statusCode).toBe(404);

      const playback = await putPlayback(manifestBefore, manifestBefore.revision, editorBookId);
      expect(playback.statusCode).toBe(200);
      expect(playback.json<AudiobookPlaybackState>().manifestRevision).toBe((await getManifest(editorBookId)).revision);
    });

    it('reverts to the chapters the files carry and unlocks, refusing when a file cannot be read', async () => {
      const before = await loadState();
      expect(before.locked).toBe(true);

      const stale = await editorRequest('POST', '/revert', ctx.adminToken, { baseRevision: '0'.repeat(64) });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ errorCode: BOOK_CHAPTERS_ERROR_CODES.stale });

      readEmbeddedChapters.mockResolvedValueOnce(null);
      const unreadable = await editorRequest('POST', '/revert', ctx.adminToken, { baseRevision: before.revision });
      expect(unreadable.statusCode).toBe(409);
      expect(unreadable.json()).toMatchObject({ errorCode: BOOK_CHAPTERS_ERROR_CODES.filesUnreadable });
      expect(await loadState()).toEqual(before);

      const fromFiles = [
        { title: 'File One', startMs: 0 },
        { title: 'File Two', startMs: 60_000 },
        { title: 'File Three', startMs: 120_000 },
      ];
      readEmbeddedChapters.mockResolvedValueOnce(fromFiles);
      const reverted = await editorRequest('POST', '/revert', ctx.adminToken, { baseRevision: before.revision });
      expect(reverted.statusCode).toBe(200);
      expect(readEmbeddedChapters).toHaveBeenLastCalledWith(editorFilePaths, editorBookId);
      expect(reverted.json<BookChaptersState>()).toMatchObject({
        chapters: fromFiles,
        source: 'embedded',
        locked: false,
        updatedBy: null,
        versionCount: 3,
      });
    });
  });
});
