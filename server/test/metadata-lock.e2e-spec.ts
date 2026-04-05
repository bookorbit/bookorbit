import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildMetadataLockCandidates } from './e2e/metadata-lock/metadata-lock-test-providers';
import {
  BLUE_PNG_BYTES,
  COVER_CUSTOM_FILE_PREFIX,
  GREEN_PNG_BYTES,
  RED_PNG_BYTES,
  authHeader,
  closeMetadataLockE2EContext,
  createLibraryWithFolder,
  createMetadataLockE2EContext,
  findCoverFilePath,
  locateBookFileByRelPath,
  readBookMutationState,
  triggerAndWaitForLibraryScan,
  uploadBookCover,
  waitForCondition,
  waitForMetadataFetchIdle,
  type MetadataLockE2EContext,
} from './e2e/metadata-lock/metadata-lock-harness';
import { createCbzFixture, createEpubFixture, createEpubWithCoverFixture } from './e2e/metadata-lock/metadata-lock-fixture-builder';

describe('metadata-lock e2e', { timeout: 30_000 }, () => {
  let ctx: MetadataLockE2EContext;

  beforeAll(async () => {
    ctx = await createMetadataLockE2EContext();
  }, 120_000);

  afterAll(async () => {
    await closeMetadataLockE2EContext(ctx);
  });

  it('normalizes and persists lock updates and rejects duplicate lock fields', async () => {
    const scanned = await scanSingleEpub('lock-contract', { title: 'Lock Contract Base' });

    const success = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${scanned.bookId}/metadata-locks`,
      headers: authHeader(ctx.adminToken),
      payload: { lockedFields: ['cover', 'authors', 'title'] },
    });

    expect(success.statusCode).toBe(200);
    expect(success.json()).toMatchObject({
      lockedFields: ['title', 'authors', 'cover'],
    });

    const stateAfterSuccess = await readBookMutationState(ctx, scanned.bookId);
    expect(stateAfterSuccess.metadata?.lockedFields).toEqual(['title', 'authors', 'cover']);

    const duplicate = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${scanned.bookId}/metadata-locks`,
      headers: authHeader(ctx.adminToken),
      payload: { lockedFields: ['title', 'cover', 'title'] },
    });

    expect(duplicate.statusCode).toBe(400);

    const stateAfterFailure = await readBookMutationState(ctx, scanned.bookId);
    expect(stateAfterFailure.metadata?.lockedFields).toEqual(['title', 'authors', 'cover']);
  });

  it('unlocks all fields when an empty array is patched', async () => {
    const scanned = await scanSingleEpub('unlock-all', { title: 'Unlock All Base' });

    const lock = await patchLocks(scanned.bookId, ['title', 'cover']);
    expect(lock.statusCode).toBe(200);

    const stateAfterLock = await readBookMutationState(ctx, scanned.bookId);
    expect(stateAfterLock.metadata?.lockedFields).toEqual(['title', 'cover']);

    const unlock = await patchLocks(scanned.bookId, []);
    expect(unlock.statusCode).toBe(200);
    expect(unlock.json()).toMatchObject({ lockedFields: [] });

    const stateAfterUnlock = await readBookMutationState(ctx, scanned.bookId);
    expect(stateAfterUnlock.metadata?.lockedFields).toEqual([]);
  });

  it('rejects manual metadata writes atomically when any targeted field is locked', async () => {
    const scanned = await scanSingleEpub('manual-atomic', { title: 'Manual Atomic Base' });

    const seed = await patchMetadata(scanned.bookId, {
      title: 'Manual Atomic Base',
      publisher: 'Seed Publisher',
    });
    expect(seed.statusCode).toBe(200);

    const lock = await patchLocks(scanned.bookId, ['title']);
    expect(lock.statusCode).toBe(200);

    const blocked = await patchMetadata(scanned.bookId, {
      title: 'Blocked Manual Title',
      publisher: 'Blocked Publisher',
    });
    expect(blocked.statusCode).toBe(409);

    const stateAfterBlocked = await readBookMutationState(ctx, scanned.bookId);
    expect(stateAfterBlocked.metadata).toMatchObject({
      title: 'Manual Atomic Base',
      publisher: 'Seed Publisher',
    });

    const allowed = await patchMetadata(scanned.bookId, { publisher: 'Allowed Publisher' });
    expect(allowed.statusCode).toBe(200);

    const stateAfterAllowed = await readBookMutationState(ctx, scanned.bookId);
    expect(stateAfterAllowed.metadata).toMatchObject({
      title: 'Manual Atomic Base',
      publisher: 'Allowed Publisher',
      lockedFields: ['title'],
    });
  });

  it('returns preview metadata without mutating the book or downloading covers', async () => {
    const scanned = await scanSingleEpub('refresh-preview', { title: 'Preview Base' });
    const seed = await patchMetadata(scanned.bookId, { title: 'Preview Base' });
    expect(seed.statusCode).toBe(200);
    const expected = buildMetadataLockCandidates('Preview Base', ctx.coverServer.urlFor);
    const before = await readBookMutationState(ctx, scanned.bookId);

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${scanned.bookId}/refresh-metadata?preview=true`,
      headers: authHeader(ctx.adminToken),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      subtitle: expected.goodreads.subtitle,
      description: expected.goodreads.description,
      publisher: expected.goodreads.publisher,
      language: expected.goodreads.language,
      pageCount: expected.goodreads.pageCount,
      goodreadsId: expected.goodreads.providerId,
      openLibraryId: expected.openLibrary.providerId,
      coverUrl: expected.goodreads.coverUrl,
      audioMetadata: {
        narrators: expected.goodreads.narrators,
        durationSeconds: expected.goodreads.durationSeconds,
        abridged: expected.goodreads.abridged,
        chapters: expected.goodreads.chapters,
      },
      comicMetadata: {
        issueNumber: expected.goodreads.comicMetadata?.issueNumber,
        volumeName: expected.goodreads.comicMetadata?.volumeName,
        storyArcs: expected.goodreads.comicMetadata?.storyArcs,
      },
    });

    const after = await readBookMutationState(ctx, scanned.bookId);
    expect(after).toEqual(before);
    await expect(findCoverFilePath(ctx, scanned.bookId)).resolves.toBeNull();
  });

  it('refreshes unlocked fields while preserving locked fields from the API through the database', async () => {
    const scanned = await scanSingleEpub('refresh-persist', { title: 'Refresh Base' });
    const expected = buildMetadataLockCandidates('Refresh Base', ctx.coverServer.urlFor);

    const seed = await patchMetadata(scanned.bookId, {
      title: 'Refresh Base',
      subtitle: 'Locked subtitle',
      description: 'Seed description',
      publisher: 'Seed publisher',
      language: 'en',
      pageCount: 111,
      audioMetadata: {
        narrators: ['Locked Narrator'],
        durationSeconds: 1111,
        abridged: false,
        chapters: [{ title: 'Seed Chapter', startMs: 0, durationMs: 60_000 }],
      },
      comicMetadata: {
        issueNumber: 'LOCK-1',
        volumeName: 'Seed Volume',
        storyArcs: ['Seed Arc'],
      },
    });
    expect(seed.statusCode).toBe(200);

    const lock = await patchLocks(scanned.bookId, ['subtitle', 'narrators', 'comicIssueNumber', 'cover', 'openLibraryId']);
    expect(lock.statusCode).toBe(200);

    const refresh = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/books/${scanned.bookId}/refresh-metadata`,
      headers: authHeader(ctx.adminToken),
    });

    expect(refresh.statusCode).toBe(201);

    const state = await readBookMutationState(ctx, scanned.bookId);
    expect(state.metadata).toMatchObject({
      subtitle: 'Locked subtitle',
      description: expected.goodreads.description,
      publisher: expected.goodreads.publisher,
      language: expected.goodreads.language,
      pageCount: expected.goodreads.pageCount,
      goodreadsId: expected.goodreads.providerId,
      openLibraryId: null,
      durationSeconds: expected.goodreads.durationSeconds,
      abridged: expected.goodreads.abridged,
      chapters: expected.goodreads.chapters,
      coverSource: null,
    });
    expect(state.narrators).toEqual(['Locked Narrator']);
    expect(state.comicMetadata).toEqual({
      issueNumber: 'LOCK-1',
      volumeName: expected.goodreads.comicMetadata?.volumeName ?? null,
      storyArcs: [...(expected.goodreads.comicMetadata?.storyArcs ?? [])].sort(),
    });
    expect(state.metadata?.lastMetadataFetchAt).not.toBeNull();
    await expect(findCoverFilePath(ctx, scanned.bookId)).resolves.toBeNull();
  });

  it('keeps locked fields untouched during bulk metadata fetch while persisting unlocked fields', async () => {
    const scanned = await scanSingleEpub('bulk-fetch', { title: 'Bulk Base' });
    const expected = buildMetadataLockCandidates('Bulk Base', ctx.coverServer.urlFor);

    const seed = await patchMetadata(scanned.bookId, {
      title: 'Bulk Base',
      description: 'Locked bulk description',
      publisher: 'Seed bulk publisher',
      audioMetadata: {
        narrators: ['Locked Bulk Narrator'],
        durationSeconds: 777,
      },
      comicMetadata: {
        volumeName: 'Seed Bulk Volume',
      },
    });
    expect(seed.statusCode).toBe(200);

    const lock = await patchLocks(scanned.bookId, ['description', 'cover', 'openLibraryId', 'narrators']);
    expect(lock.statusCode).toBe(200);

    const config = await ctx.app.inject({
      method: 'PUT',
      url: '/api/v1/book-metadata-fetch/config',
      headers: authHeader(ctx.adminToken),
      payload: {
        enabled: true,
        triggerOnImport: false,
        conditions: {
          scoreThreshold: { enabled: false, threshold: 60 },
          missingFields: { enabled: false, fields: [] },
          neverFetched: { enabled: true },
        },
      },
    });
    expect(config.statusCode).toBe(200);

    const run = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/book-metadata-fetch/run/${scanned.libraryId}`,
      headers: authHeader(ctx.adminToken),
    });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({ queued: 1 });

    await waitForMetadataFetchIdle(ctx);

    const state = await readBookMutationState(ctx, scanned.bookId);
    expect(state.metadata).toMatchObject({
      description: 'Locked bulk description',
      publisher: expected.goodreads.publisher,
      language: expected.goodreads.language,
      pageCount: expected.goodreads.pageCount,
      goodreadsId: expected.goodreads.providerId,
      openLibraryId: null,
      durationSeconds: expected.goodreads.durationSeconds,
      coverSource: null,
    });
    expect(state.narrators).toEqual(['Locked Bulk Narrator']);
    expect(state.comicMetadata).toEqual({
      issueNumber: expected.goodreads.comicMetadata?.issueNumber ?? null,
      volumeName: expected.goodreads.comicMetadata?.volumeName ?? null,
      storyArcs: [...(expected.goodreads.comicMetadata?.storyArcs ?? [])].sort(),
    });
    expect(state.metadata?.lastMetadataFetchAt).not.toBeNull();
    await expect(findCoverFilePath(ctx, scanned.bookId)).resolves.toBeNull();
  });

  it('blocks locked custom cover mutations after a successful unlocked upload', async () => {
    const scanned = await scanSingleEpub('custom-cover', { title: 'Custom Cover Base' });

    const upload = await uploadBookCover(ctx, scanned.bookId, RED_PNG_BYTES);
    expect(upload.statusCode).toBe(204);

    const customPath = await findCoverFilePath(ctx, scanned.bookId, COVER_CUSTOM_FILE_PREFIX);
    expect(customPath).not.toBeNull();
    await expect(readFile(customPath!)).resolves.toEqual(RED_PNG_BYTES);

    const lock = await patchLocks(scanned.bookId, ['cover']);
    expect(lock.statusCode).toBe(200);

    const uploadBlocked = await uploadBookCover(ctx, scanned.bookId, BLUE_PNG_BYTES, 'blocked-cover.png');
    expect(uploadBlocked.statusCode).toBe(409);

    const deleteBlocked = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/v1/books/${scanned.bookId}/cover`,
      headers: authHeader(ctx.adminToken),
    });
    expect(deleteBlocked.statusCode).toBe(409);

    const state = await readBookMutationState(ctx, scanned.bookId);
    expect(state.metadata).toMatchObject({
      coverSource: 'custom',
      lockedFields: ['cover'],
    });
    await expect(readFile(customPath!)).resolves.toEqual(RED_PNG_BYTES);
  });

  it('preserves locked scanner metadata while still updating unlocked extracted fields on rescan', async () => {
    const cbzRelPath = uniqueRelPath('scanner-rescan', 'book.cbz');
    const epubRelPath = cbzRelPath.replace(/\.cbz$/, '.epub');
    const library = await createLibraryWithFolder(ctx, {
      mode: 'book_per_folder',
      allowedFormats: ['cbz', 'epub'],
      name: `metadata-lock-scanner-${randomUUID()}`,
    });

    await createCbzFixture(library.folderPath, cbzRelPath, {
      title: 'Scanner Original Title',
      publisher: 'Original Publisher',
    });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);

    const initial = await locateBookFileByRelPath(ctx, library.libraryId, cbzRelPath);

    const seed = await patchMetadata(initial.bookId, {
      title: 'Scanner Locked Title',
      publisher: 'Original Publisher',
    });
    expect(seed.statusCode).toBe(200);

    const lock = await patchLocks(initial.bookId, ['title']);
    expect(lock.statusCode).toBe(200);

    // Filesystem timestamp resolution is 1s on many OSes; wait so the new file gets a newer mtime.
    await pause(1_100);
    await createEpubWithCoverFixture(library.folderPath, epubRelPath, {
      title: 'Scanner EPUB Winner',
      coverBytes: BLUE_PNG_BYTES,
    });
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);

    const rescanned = await locateBookFileByRelPath(ctx, library.libraryId, epubRelPath);
    expect(rescanned.bookId).toBe(initial.bookId);

    const state = await readBookMutationState(ctx, rescanned.bookId);
    expect(state.metadata).toMatchObject({
      title: 'Scanner Locked Title',
      coverSource: 'extracted',
      lockedFields: ['title'],
    });

    const extractedCoverPath = await findCoverFilePath(ctx, rescanned.bookId);
    expect(extractedCoverPath).not.toBeNull();
    await expect(readFile(extractedCoverPath!)).resolves.toEqual(BLUE_PNG_BYTES);
  }, 60_000);

  it('refreshes extracted covers only for unlocked books during scanner cover refresh', async () => {
    const library = await createLibraryWithFolder(ctx, {
      mode: 'book_per_file',
      allowedFormats: ['epub'],
      name: `metadata-lock-cover-refresh-${randomUUID()}`,
    });

    const unlockedRelPath = uniqueRelPath('cover-refresh', 'unlocked.epub');
    const lockedRelPath = uniqueRelPath('cover-refresh', 'locked.epub');

    await createEpubWithCoverFixture(library.folderPath, unlockedRelPath, {
      title: 'Unlocked Cover Book',
      coverBytes: RED_PNG_BYTES,
    });
    await createEpubWithCoverFixture(library.folderPath, lockedRelPath, {
      title: 'Locked Cover Book',
      coverBytes: GREEN_PNG_BYTES,
    });

    await triggerAndWaitForLibraryScan(ctx, library.libraryId);

    const unlocked = await locateBookFileByRelPath(ctx, library.libraryId, unlockedRelPath);
    const locked = await locateBookFileByRelPath(ctx, library.libraryId, lockedRelPath);

    const unlockedCoverBefore = await findCoverFilePath(ctx, unlocked.bookId);
    const lockedCoverBefore = await findCoverFilePath(ctx, locked.bookId);
    await expect(readFile(unlockedCoverBefore!)).resolves.toEqual(RED_PNG_BYTES);
    await expect(readFile(lockedCoverBefore!)).resolves.toEqual(GREEN_PNG_BYTES);

    const lockResponse = await patchLocks(locked.bookId, ['cover']);
    expect(lockResponse.statusCode).toBe(200);

    await createEpubWithCoverFixture(library.folderPath, unlockedRelPath, {
      title: 'Unlocked Cover Book',
      coverBytes: BLUE_PNG_BYTES,
    });
    await createEpubWithCoverFixture(library.folderPath, lockedRelPath, {
      title: 'Locked Cover Book',
      coverBytes: RED_PNG_BYTES,
    });

    const refresh = await ctx.app.inject({
      method: 'POST',
      url: `/api/v1/scanner/libraries/${library.libraryId}/refresh-covers`,
      headers: authHeader(ctx.adminToken),
    });

    expect(refresh.statusCode).toBe(202);
    expect(refresh.json()).toMatchObject({ queued: 2 });

    await waitForCondition(async () => {
      const path = await findCoverFilePath(ctx, unlocked.bookId);
      if (!path) throw new Error('Unlocked extracted cover path missing');
      const bytes = await readFile(path);
      expect(bytes).toEqual(BLUE_PNG_BYTES);
    }, 15_000);

    await waitForCondition(async () => {
      const path = await findCoverFilePath(ctx, locked.bookId);
      if (!path) throw new Error('Locked extracted cover path missing');
      const bytes = await readFile(path);
      expect(bytes).toEqual(GREEN_PNG_BYTES);
    }, 15_000);
  });

  async function patchLocks(bookId: number, lockedFields: string[]) {
    return ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/metadata-locks`,
      headers: authHeader(ctx.adminToken),
      payload: { lockedFields },
    });
  }

  async function patchMetadata(bookId: number, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: 'PATCH',
      url: `/api/v1/books/${bookId}/metadata`,
      headers: authHeader(ctx.adminToken),
      payload,
    });
  }

  async function scanSingleEpub(prefix: string, input: { title: string; language?: string }) {
    const library = await createLibraryWithFolder(ctx, {
      mode: 'book_per_file',
      allowedFormats: ['epub'],
      name: `metadata-lock-${prefix}-${randomUUID()}`,
    });

    const relPath = uniqueRelPath(prefix, 'book.epub');
    await createEpubFixture(library.folderPath, relPath, {
      title: input.title,
      language: input.language ?? 'en',
    });

    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const located = await locateBookFileByRelPath(ctx, library.libraryId, relPath);

    return {
      ...library,
      relPath,
      bookId: located.bookId,
      absolutePath: located.absolutePath,
    };
  }

  function uniqueRelPath(prefix: string, fileName: string): string {
    return `${prefix}-${randomUUID()}/${fileName}`;
  }

  function pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
});
