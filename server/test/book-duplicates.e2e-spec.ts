/**
 * Duplicate books end-to-end suite: a real scan over real files, then resolutions that merge,
 * delete and link through the real engines while one library gate is held for the whole run.
 */

import { randomUUID } from 'crypto';
import { access, chmod, copyFile, mkdir, open } from 'fs/promises';
import { dirname, join } from 'path';

import { eq, inArray } from 'drizzle-orm';

import type { BookDuplicateGroup, BookDuplicateGroupsResponse, BookDuplicateResolutionJob, BookDuplicateScan } from '@bookorbit/types';
import { Permission } from '@bookorbit/types';

import { LibraryOperationGate } from '../src/common/services/library-operation-gate.service';
import * as schema from '../src/db/schema';
import { BookMergeService } from '../src/modules/book-merge/book-merge.service';
import { createEpubFixture, createM4bFixture } from './e2e/metadata-write/metadata-write-fixture-builder';
import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  createUserAndLogin,
  grantLibraryAccess,
  locateBookFileByRelPath,
  triggerAndWaitForLibraryScan,
  waitForCondition,
  type CreatedLibrary,
  type MetadataWriteE2EContext,
} from './e2e/metadata-write/metadata-write-harness';

const SCENARIO_TIMEOUT_MS = 240_000;

function isbn13(n: number): string {
  const base = `978${String(n).padStart(9, '0')}`;
  let sum = 0;
  for (let index = 0; index < 12; index++) sum += Number(base[index]) * (index % 2 === 0 ? 1 : 3);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

describe('Duplicate books (e2e)', () => {
  let ctx: MetadataWriteE2EContext;

  beforeAll(async () => {
    ctx = await createMetadataWriteE2EContext();
  }, SCENARIO_TIMEOUT_MS);

  afterAll(async () => {
    await closeMetadataWriteE2EContext(ctx);
  });

  async function exists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  async function scan(token: string, libraryId: number): Promise<BookDuplicateScan> {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/v1/book-duplicates/scans',
      headers: authHeader(token),
      payload: { libraryId, similarityPercent: 95 },
    });
    expect(created.statusCode).toBe(201);
    const scanId = (created.json() as BookDuplicateScan).id;
    let done: BookDuplicateScan | null = null;
    await waitForCondition(async () => {
      const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/book-duplicates/scans/${scanId}`, headers: authHeader(token) });
      done = response.json() as BookDuplicateScan;
      expect(done.status).toBe('completed');
    }, 60_000);
    return done!;
  }

  async function groups(token: string, scanId: number, kind: 'duplicate' | 'other_format'): Promise<BookDuplicateGroup[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/v1/book-duplicates/scans/${scanId}/groups?kind=${kind}&pageSize=50`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as BookDuplicateGroupsResponse).groups;
  }

  async function resolve(token: string, body: Record<string, unknown>) {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/book-duplicates/resolutions', headers: authHeader(token), payload: body });
    return { status: response.statusCode, body: response.json() as { jobId?: number; total?: number; errorCode?: string } };
  }

  async function waitForResolution(token: string, jobId: number): Promise<BookDuplicateResolutionJob> {
    let job: BookDuplicateResolutionJob | null = null;
    await waitForCondition(async () => {
      const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/book-duplicates/resolutions/${jobId}`, headers: authHeader(token) });
      expect(response.statusCode).toBe(200);
      job = response.json() as BookDuplicateResolutionJob;
      expect(job.status).not.toBe('running');
    }, 180_000);
    return job!;
  }

  async function setIsbn(bookIds: number[], isbn: string): Promise<void> {
    await ctx.db.update(schema.bookMetadata).set({ isbn13: isbn }).where(inArray(schema.bookMetadata.bookId, bookIds));
  }

  async function bookIdsStillPresent(bookIds: number[]): Promise<number[]> {
    const rows = await ctx.db.select({ id: schema.books.id }).from(schema.books).where(inArray(schema.books.id, bookIds));
    return rows.map((row) => row.id).sort((a, b) => a - b);
  }

  it(
    'resolves fifty groups of mixed actions under one gate, skipping a stale group and reporting a failing one',
    async () => {
      const library = await createLibraryWithFolder(ctx, { name: `dupes-${randomUUID()}`, mode: 'book_per_folder' });
      const pairs: Array<{ a: string; b: string }> = [];
      for (let index = 0; index < 50; index++) {
        const title = `Resolve ${randomUUID()}`;
        const a = join(`pair-${index}-a`, 'book.epub');
        const b = join(`pair-${index}-b`, 'book.epub');
        await createEpubFixture(library.folderPath, a, { title });
        await createEpubFixture(library.folderPath, b, { title });
        pairs.push({ a, b });
      }
      await triggerAndWaitForLibraryScan(ctx, library.libraryId);
      const isbnBase = Math.floor(Math.random() * 1e8);
      const books: Array<{ keeperId: number; loserId: number; loserPath: string }> = [];
      for (const [index, pair] of pairs.entries()) {
        const keeper = await locateBookFileByRelPath(ctx, library.libraryId, pair.a);
        const loser = await locateBookFileByRelPath(ctx, library.libraryId, pair.b);
        await setIsbn([keeper.bookId, loser.bookId], isbn13(isbnBase + index));
        books.push({ keeperId: keeper.bookId, loserId: loser.bookId, loserPath: loser.absolutePath });
      }

      const completed = await scan(ctx.adminToken, library.libraryId);
      const found = await groups(ctx.adminToken, completed.id, 'duplicate');
      expect(found).toHaveLength(50);

      const actions = ['merge', 'delete', 'link'] as const;
      const requests = books.map((book, index) => {
        const group = found.find((candidate) => candidate.books.some((member) => member.id === book.keeperId))!;
        expect(group.reasons).toContain('isbn');
        return { groupId: group.id, keeperId: book.keeperId, action: actions[index % 3]! };
      });

      // Stale (H1): the keeper of one group is deleted after the scan.
      const staleIndex = 9;
      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/books',
        headers: authHeader(ctx.adminToken),
        payload: { bookIds: [books[staleIndex]!.keeperId] },
      });
      expect(deleted.statusCode).toBeLessThan(300);
      // Failing: a copy whose folder cannot be written cannot be deleted.
      const failingIndex = 4;
      const lockedFolder = dirname(books[failingIndex]!.loserPath);
      await chmod(lockedFolder, 0o555);

      const gate = ctx.app.get(LibraryOperationGate);
      const merges = ctx.app.get(BookMergeService);
      const leaseCalls = vi.spyOn(gate, 'tryAcquireLease');
      const heldDuringMerges: boolean[] = [];
      const mergeSpy = vi.spyOn(merges, 'mergeWithinLease').mockImplementation(function (this: BookMergeService, ...args) {
        heldDuringMerges.push(gate.isHeld(library.libraryId) && gate.tryAcquire(library.libraryId, 'scan') === null);
        return BookMergeService.prototype.mergeWithinLease.apply(merges, args);
      });

      try {
        const started = await resolve(ctx.adminToken, { scanId: completed.id, groups: requests });
        expect(started.status).toBe(202);
        expect(started.body.total).toBe(50);
        const job = await waitForResolution(ctx.adminToken, started.body.jobId!);

        expect(job.status).toBe('completed');
        expect(job.processed).toBe(50);
        expect(leaseCalls).toHaveBeenCalledTimes(1);
        expect(heldDuringMerges.length).toBeGreaterThan(0);
        expect(heldDuringMerges.every(Boolean)).toBe(true);
        expect(gate.isHeld(library.libraryId)).toBe(false);

        const outcomeFor = (index: number) => job.outcomes.find((outcome) => outcome.groupId === requests[index]!.groupId)!;
        // The group goes with its root book, so a deleted keeper reads as a vanished group or a missing keeper.
        expect(outcomeFor(staleIndex)).toEqual(
          expect.objectContaining({ status: 'skipped', reason: expect.stringMatching(/^(STALE|KEEPER_MISSING)$/), books: [] }),
        );
        expect(await bookIdsStillPresent([books[staleIndex]!.loserId])).toEqual([books[staleIndex]!.loserId]);
        expect(outcomeFor(failingIndex)).toEqual(expect.objectContaining({ status: 'failed', reason: 'DELETE_FAILED' }));
        for (const [index, book] of books.entries()) {
          if (index === staleIndex || index === failingIndex) continue;
          const outcome = outcomeFor(index);
          expect(outcome.status).toBe('done');
          const action = actions[index % 3]!;
          expect(outcome.books).toEqual([
            { bookId: book.loserId, action, status: action === 'merge' ? 'merged' : action === 'delete' ? 'deleted' : 'linked', reason: null },
          ]);
        }

        const merged = books.filter((_, index) => index % 3 === 0 && index !== staleIndex);
        expect(await bookIdsStillPresent(merged.map((book) => book.loserId))).toEqual([]);
        const keeperFiles = await ctx.db
          .select({ bookId: schema.bookFiles.bookId })
          .from(schema.bookFiles)
          .where(
            inArray(
              schema.bookFiles.bookId,
              merged.map((book) => book.keeperId),
            ),
          );
        expect(keeperFiles).toHaveLength(merged.length * 2);

        const deletedCopies = books.filter((_, index) => index % 3 === 1 && index !== failingIndex);
        expect(await bookIdsStillPresent(deletedCopies.map((book) => book.loserId))).toEqual([]);
        expect(await exists(books[failingIndex]!.loserPath)).toBe(true);

        const linked = books.filter((_, index) => index % 3 === 2);
        const links = await ctx.db
          .select({ bookId: schema.bookLinks.bookId, groupId: schema.bookLinks.groupId })
          .from(schema.bookLinks)
          .where(
            inArray(
              schema.bookLinks.bookId,
              linked.flatMap((book) => [book.keeperId, book.loserId]),
            ),
          );
        expect(links).toHaveLength(linked.length * 2);
        for (const book of linked) {
          const pair = links.filter((link) => link.bookId === book.keeperId || link.bookId === book.loserId);
          expect(new Set(pair.map((link) => link.groupId)).size).toBe(1);
        }
      } finally {
        await chmod(lockedFolder, 0o755);
        mergeSpy.mockRestore();
        leaseCalls.mockRestore();
      }
    },
    SCENARIO_TIMEOUT_MS,
  );

  describe('other formats, dismissals and permissions', () => {
    let library: CreatedLibrary;
    let ebookId: number;
    let audioId: number;
    let copyIds: number[];
    let mergeOnly: { userId: number; accessToken: string };
    let deleteOnly: { userId: number; accessToken: string };
    let scanId: number;

    beforeAll(async () => {
      library = await createLibraryWithFolder(ctx, { name: `dupes-of-${randomUUID()}`, mode: 'book_per_folder' });
      const title = `Dune ${randomUUID()}`;
      await createEpubFixture(library.folderPath, join('dune-ebook', 'Dune.epub'), { title });
      await createM4bFixture(library.folderPath, join('dune-audio', 'Dune.m4b'), { title: `${title} (Unabridged)` });
      const copyTitle = `Copy ${randomUUID()}`;
      await createEpubFixture(library.folderPath, join('copy-a', 'book.epub'), { title: copyTitle });
      await createEpubFixture(library.folderPath, join('copy-b', 'book.epub'), { title: copyTitle });
      await triggerAndWaitForLibraryScan(ctx, library.libraryId);
      ebookId = (await locateBookFileByRelPath(ctx, library.libraryId, join('dune-ebook', 'Dune.epub'))).bookId;
      audioId = (await locateBookFileByRelPath(ctx, library.libraryId, join('dune-audio', 'Dune.m4b'))).bookId;
      copyIds = [
        (await locateBookFileByRelPath(ctx, library.libraryId, join('copy-a', 'book.epub'))).bookId,
        (await locateBookFileByRelPath(ctx, library.libraryId, join('copy-b', 'book.epub'))).bookId,
      ];
      const hardcoverId = `hc-${randomUUID()}`;
      await ctx.db
        .update(schema.bookMetadata)
        .set({ hardcoverId })
        .where(inArray(schema.bookMetadata.bookId, [ebookId, audioId]));
      await setIsbn(copyIds, isbn13(Math.floor(Math.random() * 1e8)));

      mergeOnly = await createUserAndLogin(ctx, { permissions: [Permission.LibraryMergeBooks] });
      deleteOnly = await createUserAndLogin(ctx, { permissions: [Permission.LibraryDeleteBooks] });
      await grantLibraryAccess(ctx, mergeOnly.userId, library.libraryId, 'editor');
      await grantLibraryAccess(ctx, deleteOnly.userId, library.libraryId, 'editor');
      scanId = (await scan(mergeOnly.accessToken, library.libraryId)).id;
    }, SCENARIO_TIMEOUT_MS);

    it('pairs an ebook with its audiobook in a separate set, never in a duplicate group', async () => {
      const otherFormat = await groups(mergeOnly.accessToken, scanId, 'other_format');
      expect(otherFormat).toHaveLength(1);
      expect(otherFormat[0]!.kind).toBe('other_format');
      expect(otherFormat[0]!.reasons).toContain('same_work');
      expect(otherFormat[0]!.books.map((book) => book.id).sort((a, b) => a - b)).toEqual([ebookId, audioId].sort((a, b) => a - b));

      const duplicates = await groups(mergeOnly.accessToken, scanId, 'duplicate');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]!.books.map((book) => book.id).sort((a, b) => a - b)).toEqual([...copyIds].sort((a, b) => a - b));
    });

    it('lets a merge-only user find duplicates but never delete them (H11)', async () => {
      const [duplicate] = await groups(mergeOnly.accessToken, scanId, 'duplicate');
      const deleteResolution = await resolve(mergeOnly.accessToken, {
        scanId,
        groups: [{ groupId: duplicate!.id, keeperId: copyIds[0], action: 'delete' }],
      });
      expect(deleteResolution.status).toBe(403);
      const identical = await resolve(mergeOnly.accessToken, {
        scanId,
        groups: [{ groupId: duplicate!.id, keeperId: copyIds[0], action: 'merge' }],
        removeIdenticalCopies: true,
      });
      expect(identical.status).toBe(403);
      const plainDelete = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/v1/books',
        headers: authHeader(mergeOnly.accessToken),
        payload: { bookIds: [copyIds[1]] },
      });
      expect(plainDelete.statusCode).toBe(403);
    });

    it('lets a delete-only user find duplicates but never merge or link them (H11)', async () => {
      const ownScan = await scan(deleteOnly.accessToken, library.libraryId);
      const [duplicate] = await groups(deleteOnly.accessToken, ownScan.id, 'duplicate');
      for (const action of ['merge', 'link']) {
        const response = await resolve(deleteOnly.accessToken, {
          scanId: ownScan.id,
          groups: [{ groupId: duplicate!.id, keeperId: copyIds[0], action }],
        });
        expect(response.status).toBe(403);
      }
    });

    it('never deletes a book of another format', async () => {
      const [pair] = await groups(mergeOnly.accessToken, scanId, 'other_format');
      const response = await resolve(mergeOnly.accessToken, { scanId, groups: [{ groupId: pair!.id, keeperId: ebookId, action: 'delete' }] });
      expect(response.status).toBe(400);
    });

    it('refuses to start while another operation holds the library (H12)', async () => {
      const [pair] = await groups(mergeOnly.accessToken, scanId, 'other_format');
      const release = ctx.app.get(LibraryOperationGate).tryAcquire(library.libraryId, 'scan');
      try {
        const response = await resolve(mergeOnly.accessToken, { scanId, groups: [{ groupId: pair!.id, keeperId: ebookId, action: 'link' }] });
        expect(response.status).toBe(409);
        expect(response.body.errorCode).toBe('LIBRARY_BUSY');
      } finally {
        release?.();
      }
    });

    it('keeps dismissals per kind', async () => {
      const [pair] = await groups(mergeOnly.accessToken, scanId, 'other_format');
      const dismissed = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/book-duplicates/dismissals',
        headers: authHeader(mergeOnly.accessToken),
        payload: { scanId, groupId: pair!.id },
      });
      expect(dismissed.statusCode).toBe(204);
      const listed = await ctx.app.inject({ method: 'GET', url: '/api/v1/book-duplicates/dismissals', headers: authHeader(mergeOnly.accessToken) });
      expect(listed.json()).toEqual([expect.objectContaining({ kind: 'other_format' })]);

      const [low, high] = [ebookId, audioId].sort((a, b) => a - b);
      const wrongKind = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/book-duplicates/dismissals/${low}/${high}`,
        headers: authHeader(mergeOnly.accessToken),
      });
      expect(wrongKind.statusCode).toBe(404);
      const restored = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/v1/book-duplicates/dismissals/${low}/${high}?kind=other_format`,
        headers: authHeader(mergeOnly.accessToken),
      });
      expect(restored.statusCode).toBe(204);
    });

    it('links an ebook and its audiobook for a merge-only user', async () => {
      const [pair] = await groups(mergeOnly.accessToken, scanId, 'other_format');
      const started = await resolve(mergeOnly.accessToken, { scanId, groups: [{ groupId: pair!.id, keeperId: ebookId, action: 'link' }] });
      expect(started.status).toBe(202);
      const job = await waitForResolution(mergeOnly.accessToken, started.body.jobId!);

      expect(job.outcomes).toEqual([expect.objectContaining({ status: 'done', keeperId: ebookId })]);
      const links = await ctx.db
        .select()
        .from(schema.bookLinks)
        .where(inArray(schema.bookLinks.bookId, [ebookId, audioId]));
      expect(new Set(links.map((link) => link.groupId)).size).toBe(1);
      expect(links).toHaveLength(2);

      const other = await ctx.app.inject({
        method: 'GET',
        url: `/api/v1/book-duplicates/resolutions/${started.body.jobId}`,
        headers: authHeader(deleteOnly.accessToken),
      });
      expect(other.statusCode).toBe(404);
    });
  });

  it(
    'removes only a byte-identical copy when merging, and keeps one whose sampled hash matches but bytes differ (H13)',
    async () => {
      const library = await createLibraryWithFolder(ctx, { name: `dupes-h13-${randomUUID()}`, mode: 'book_per_folder' });
      const original = await createEpubFixture(library.folderPath, join('kept', 'book.epub'), {
        title: `Twin ${randomUUID()}`,
        paddingBytes: 100_000,
      });
      const identical = join(library.folderPath, 'identical', 'book.epub');
      const altered = join(library.folderPath, 'altered', 'book.epub');
      for (const target of [identical, altered]) {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(original, target);
      }
      // Offset 30000 lies between two sampled blocks (16 KiB and 64 KiB), inside the stored padding.
      const handle = await open(altered, 'r+');
      try {
        await handle.write(Buffer.from([0x7f]), 0, 1, 30_000);
      } finally {
        await handle.close();
      }
      await triggerAndWaitForLibraryScan(ctx, library.libraryId);
      const kept = await locateBookFileByRelPath(ctx, library.libraryId, join('kept', 'book.epub'));
      const twin = await locateBookFileByRelPath(ctx, library.libraryId, join('identical', 'book.epub'));
      const near = await locateBookFileByRelPath(ctx, library.libraryId, join('altered', 'book.epub'));

      const completed = await scan(ctx.adminToken, library.libraryId);
      const [group] = await groups(ctx.adminToken, completed.id, 'duplicate');
      expect(group!.reasons).toContain('file_hash');
      expect(group!.books).toHaveLength(3);

      const started = await resolve(ctx.adminToken, {
        scanId: completed.id,
        groups: [{ groupId: group!.id, keeperId: kept.bookId, action: 'merge' }],
        removeIdenticalCopies: true,
      });
      expect(started.status).toBe(202);
      const job = await waitForResolution(ctx.adminToken, started.body.jobId!);
      expect(job.outcomes[0]).toEqual(expect.objectContaining({ status: 'done' }));

      const files = await ctx.db
        .select({ id: schema.bookFiles.id, absolutePath: schema.bookFiles.absolutePath })
        .from(schema.bookFiles)
        .where(eq(schema.bookFiles.bookId, kept.bookId));
      expect(files.map((file) => file.id).sort((a, b) => a - b)).toEqual([kept.bookFileId, near.bookFileId].sort((a, b) => a - b));
      expect(files.some((file) => file.id === twin.bookFileId)).toBe(false);
      expect(await exists(twin.absolutePath)).toBe(false);
    },
    SCENARIO_TIMEOUT_MS,
  );
});
