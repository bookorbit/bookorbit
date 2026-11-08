/**
 * Book merge end-to-end suite: the real endpoints, a real Postgres and real files.
 *
 * Unit tests mock the database, so they cannot see the constraint order a merge depends on (the
 * composite `book_files (book_id, library_folder_id)` key, the global path index, the reading
 * attempt indexes) or that every table referencing a merged-away book is handled. This suite does.
 */

import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { BookMergeJob, BookMergeJobEvent, BookMergePreviewResponse } from '@bookorbit/types';
import { BOOK_LINK_MAX_MEMBERS, Permission } from '@bookorbit/types';

import * as schema from '../src/db/schema';
import { BookConsolidationService } from '../src/modules/book-consolidation/book-consolidation.service';
import { BookMergeRecoveryService } from '../src/modules/book-merge/book-merge-recovery.service';
import { ScanGateway } from '../src/modules/scanner/scan.gateway';
import { UserStatisticsService } from '../src/modules/user-statistics/user-statistics.service';
import { createEpubFixture, createPdfFixture, writeFixtureFile } from './e2e/metadata-write/metadata-write-fixture-builder';
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

const SCENARIO_TIMEOUT_MS = 120_000;
/** A writable folder on a filesystem other than the fixture's, for the cross-device merge. Skipped when unset. */
const SECOND_DEVICE_PATH = process.env.E2E_SECOND_DEVICE_PATH;
const GIB = 1024 ** 3;

describe('Book merge (e2e)', () => {
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

  async function adminUserId(): Promise<number> {
    const [row] = await ctx.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isSuperuser, true)).limit(1);
    return row.id;
  }

  /** A library with one folder book per entry, scanned. Returns each book's id in order. */
  async function libraryWithBooks(entries: Array<{ folder: string; file: string; kind: 'epub' | 'pdf'; title: string }>) {
    const library = await createLibraryWithFolder(ctx, { name: `merge-${randomUUID()}`, mode: 'book_per_folder' });
    for (const entry of entries) {
      const rel = join(entry.folder, entry.file);
      if (entry.kind === 'epub') await createEpubFixture(library.folderPath, rel, { title: entry.title });
      else await createPdfFixture(library.folderPath, rel, entry.title);
    }
    await triggerAndWaitForLibraryScan(ctx, library.libraryId);
    const ids: number[] = [];
    for (const entry of entries) ids.push((await locateBookFileByRelPath(ctx, library.libraryId, join(entry.folder, entry.file))).bookId);
    return { library, ids };
  }

  async function preview(token: string, body: Record<string, unknown>) {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/books/merge/preview', headers: authHeader(token), payload: body });
    return { status: response.statusCode, body: response.json() as BookMergePreviewResponse & { errorCode?: string } };
  }

  async function merge(token: string, body: Record<string, unknown>) {
    const response = await ctx.app.inject({ method: 'POST', url: '/api/v1/books/merge', headers: authHeader(token), payload: body });
    return { status: response.statusCode, body: response.json() as { jobId?: number; errorCode?: string; errorMeta?: unknown } };
  }

  async function waitForJob(token: string, jobId: number): Promise<BookMergeJob> {
    let job: BookMergeJob | null = null;
    await waitForCondition(async () => {
      const response = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/merge/jobs/${jobId}`, headers: authHeader(token) });
      expect(response.statusCode).toBe(200);
      job = response.json() as BookMergeJob;
      expect(['done', 'failed', 'rolled_back']).toContain(job.status);
    }, 60_000);
    return job!;
  }

  async function previewAndMerge(token: string, request: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const previewed = await preview(token, request);
    expect(previewed.status).toBe(200);
    expect(previewed.body.blockers).toEqual([]);
    const started = await merge(token, { ...request, ...extra, previewToken: previewed.body.previewToken });
    expect(started.status).toBe(202);
    return { preview: previewed.body, job: await waitForJob(token, started.body.jobId!) };
  }

  it(
    'moves the files and every reader’s data onto the kept book, and leaves an alias',
    async () => {
      const { library, ids } = await libraryWithBooks([
        { folder: 'Dune', file: 'Dune.epub', kind: 'epub', title: 'Dune' },
        { folder: 'Dune Scan', file: 'Dune.pdf', kind: 'pdf', title: 'Dune (scan)' },
      ]);
      const [keptId, sourceId] = ids;
      const adminId = await adminUserId();
      const reader = await createUserAndLogin(ctx, { permissions: [] });
      await grantLibraryAccess(ctx, reader.userId, library.libraryId, 'viewer');

      // Admin: finished the PDF, highlighted it, shelved it. Reader: an open read and a bookmark on it.
      await ctx.db.insert(schema.readingAttempts).values({
        userId: adminId,
        bookId: sourceId,
        startedOn: '2024-01-01',
        endedOn: '2024-02-01',
        outcome: 'completed',
        origin: 'manual',
      });
      await ctx.db.insert(schema.userBookStatus).values({ userId: adminId, bookId: sourceId, status: 'read', source: 'manual' });
      await ctx.db.insert(schema.annotations).values({ userId: adminId, bookId: sourceId, text: 'The spice must flow' });
      const [shelf] = await ctx.db
        .insert(schema.collections)
        .values({ userId: adminId, name: `merge-${randomUUID()}` })
        .returning();
      await ctx.db.insert(schema.collectionBooks).values({ collectionId: shelf.id, bookId: sourceId });
      await ctx.db.insert(schema.readingAttempts).values({ userId: reader.userId, bookId: sourceId, startedOn: '2024-05-01', origin: 'manual' });
      await ctx.db.insert(schema.userBookStatus).values({ userId: reader.userId, bookId: sourceId, status: 'reading', source: 'auto' });
      await ctx.db.insert(schema.bookmarks).values({ clientId: randomUUID(), userId: reader.userId, bookId: sourceId, title: 'Chapter 2' });

      // Story corrections: one id on both books (the source's edit is newer), one on each book alone.
      const [shared, sourceOnly, keptOnly] = [randomUUID(), randomUUID(), randomUUID()];
      const correction = (bookId: number, id: string, name: string, at: string) => ({
        userId: adminId,
        bookId,
        id,
        kind: 'rename',
        data: { name },
        clientUpdatedAt: new Date(at),
      });
      const before = await ctx.db
        .insert(schema.storyEdits)
        .values([
          correction(keptId, shared, 'Paul', '2024-01-01T00:00:00.000Z'),
          correction(sourceId, shared, 'Muad Dib', '2024-03-01T00:00:00.000Z'),
          correction(sourceId, sourceOnly, 'Chani', '2024-02-01T00:00:00.000Z'),
          correction(keptId, keptOnly, 'Stilgar', '2024-02-01T00:00:00.000Z'),
        ])
        .returning({ revision: schema.storyEdits.revision });
      const highestBefore = Math.max(...before.map((row) => row.revision));

      const { preview: previewed, job } = await previewAndMerge(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId] });
      expect(previewed.userData.own.map((count) => count.category)).toEqual(expect.arrayContaining(['readingHistory', 'annotations', 'collections']));
      expect(previewed.userData.otherReadersAffected).toBe(true);
      expect(job.status).toBe('done');
      expect(job.outcomes).toEqual([{ sourceBookId: sourceId, status: 'merged', errorCode: null }]);

      const remaining = await ctx.db
        .select({ id: schema.books.id })
        .from(schema.books)
        .where(inArray(schema.books.id, [keptId, sourceId]));
      expect(remaining.map((row) => row.id)).toEqual([keptId]);
      const [alias] = await ctx.db.select().from(schema.bookMerges).where(eq(schema.bookMerges.sourceBookId, sourceId));
      expect(alias.targetBookId).toBe(keptId);
      expect(alias.snapshot.files.map((file) => file.relPath)).toContain('Dune Scan/Dune.pdf');

      const files = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, keptId));
      const pdf = files.find((file) => file.format === 'pdf')!;
      expect(pdf.absolutePath).toBe(join(library.folderPath, 'Dune', 'Dune.pdf'));
      expect(pdf.relPath).toBe(join('Dune', 'Dune.pdf'));
      expect(await exists(pdf.absolutePath)).toBe(true);
      expect(await exists(join(library.folderPath, 'Dune Scan'))).toBe(false);

      const [adminStatus] = await ctx.db
        .select()
        .from(schema.userBookStatus)
        .where(and(eq(schema.userBookStatus.userId, adminId), eq(schema.userBookStatus.bookId, keptId)));
      expect(adminStatus.status).toBe('read');
      const [readerStatus] = await ctx.db
        .select()
        .from(schema.userBookStatus)
        .where(and(eq(schema.userBookStatus.userId, reader.userId), eq(schema.userBookStatus.bookId, keptId)));
      expect(readerStatus.status).toBe('reading');
      const attempts = await ctx.db.select().from(schema.readingAttempts).where(eq(schema.readingAttempts.bookId, keptId));
      expect(attempts.filter((attempt) => attempt.deletedAt === null)).toHaveLength(2);
      expect(await ctx.db.select().from(schema.annotations).where(eq(schema.annotations.bookId, keptId))).toHaveLength(1);
      expect(await ctx.db.select().from(schema.bookmarks).where(eq(schema.bookmarks.bookId, keptId))).toHaveLength(1);
      const corrections = await ctx.db.select().from(schema.storyEdits).where(eq(schema.storyEdits.bookId, keptId));
      expect(Object.fromEntries(corrections.map((row) => [row.id, row.data]))).toEqual({
        [shared]: { name: 'Muad Dib' },
        [sourceOnly]: { name: 'Chani' },
        [keptOnly]: { name: 'Stilgar' },
      });
      expect(corrections.every((row) => row.revision > highestBefore)).toBe(true);
      const shelved = await ctx.db.select().from(schema.collectionBooks).where(eq(schema.collectionBooks.collectionId, shelf.id));
      expect(shelved.map((row) => row.bookId)).toEqual([keptId]);

      const merged = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${sourceId}`, headers: authHeader(ctx.adminToken) });
      expect(merged.statusCode).toBe(404);
      expect(merged.json()).toMatchObject({ errorCode: 'BOOK_MERGED', errorMeta: { targetBookId: keptId } });
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'wraps the kept book into a new folder when every book is a single file at the library root',
    async () => {
      const { library, ids } = await libraryWithBooks([
        { folder: '', file: 'Kindred.epub', kind: 'epub', title: 'Kindred' },
        { folder: '', file: 'Kindred Scan.pdf', kind: 'pdf', title: 'Kindred (scan)' },
      ]);
      const [keptId, sourceId] = ids;
      await ctx.db.insert(schema.userBookStatus).values({ userId: await adminUserId(), bookId: sourceId, status: 'read', source: 'manual' });

      const { preview: previewed, job } = await previewAndMerge(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId] });
      expect(previewed.destinationCandidates).toEqual([]);
      expect(previewed.newFolderRelPath).toBe('Kindred');
      expect(job.status).toBe('done');

      const folder = join(library.folderPath, 'Kindred');
      const [kept] = await ctx.db.select().from(schema.books).where(eq(schema.books.id, keptId));
      expect(kept.folderPath).toBe(folder);
      const files = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, keptId));
      expect(files.map((file) => file.absolutePath).sort()).toEqual([join(folder, 'Kindred Scan.pdf'), join(folder, 'Kindred.epub')]);
      for (const file of files) expect(await exists(file.absolutePath)).toBe(true);
      expect(await exists(join(library.folderPath, 'Kindred.epub'))).toBe(false);

      // A full rescan keeps one book in the new folder, with the reader's status.
      await triggerAndWaitForLibraryScan(ctx, library.libraryId);
      const books = await ctx.db.select({ id: schema.books.id }).from(schema.books).where(eq(schema.books.libraryId, library.libraryId));
      expect(books.map((row) => row.id)).toEqual([keptId]);
      const [status] = await ctx.db.select().from(schema.userBookStatus).where(eq(schema.userBookStatus.bookId, keptId));
      expect(status.status).toBe('read');
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'renames a colliding file, and with two open reads keeps the earlier one',
    async () => {
      const { ids } = await libraryWithBooks([
        { folder: 'Emma', file: 'Emma.epub', kind: 'epub', title: 'Emma' },
        { folder: 'Emma Other', file: 'Emma.epub', kind: 'epub', title: 'Emma (other edition)' },
      ]);
      const [keptId, sourceId] = ids;
      const adminId = await adminUserId();
      await ctx.db.insert(schema.readingAttempts).values([
        { userId: adminId, bookId: keptId, startedOn: '2024-03-01', origin: 'manual' },
        { userId: adminId, bookId: sourceId, startedOn: '2024-01-15', origin: 'manual' },
      ]);

      const { preview: previewed, job } = await previewAndMerge(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId] });
      const moved = previewed.files.find((file) => file.bookId === sourceId && file.action === 'move')!;
      expect(moved.renamed).toBe(true);
      expect(moved.toRelPath).toBe(join('Emma', 'Emma (2).epub'));
      expect(previewed.warnings.map((warning) => warning.code)).toContain('RENAMED_ON_COLLISION');
      expect(job.status).toBe('done');

      const live = await ctx.db
        .select()
        .from(schema.readingAttempts)
        .where(and(eq(schema.readingAttempts.bookId, keptId), eq(schema.readingAttempts.userId, adminId), isNull(schema.readingAttempts.deletedAt)));
      expect(live).toHaveLength(1);
      expect(live[0].startedOn).toBe('2024-01-15');
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'can use the source’s folder as the destination: the kept book moves in and takes that folder',
    async () => {
      const { library, ids } = await libraryWithBooks([
        { folder: 'Persuasion', file: 'Persuasion.epub', kind: 'epub', title: 'Persuasion' },
        { folder: 'Persuasion Annotated', file: 'Persuasion.pdf', kind: 'pdf', title: 'Persuasion annotated' },
      ]);
      const [keptId, sourceId] = ids;
      const { job } = await previewAndMerge(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: sourceId });
      expect(job.status).toBe('done');

      const [kept] = await ctx.db.select().from(schema.books).where(eq(schema.books.id, keptId));
      expect(kept.folderPath).toBe(join(library.folderPath, 'Persuasion Annotated'));
      const files = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, keptId));
      expect(files.map((file) => dirname(file.absolutePath))).toEqual(files.map(() => join(library.folderPath, 'Persuasion Annotated')));
      expect(await exists(join(library.folderPath, 'Persuasion'))).toBe(false);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'into the source’s folder hides the source’s metadata.opf and moves the kept book’s own one in (B28)',
    async () => {
      const opf = (title: string) =>
        `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">` +
        `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></metadata></package>\n`;
      const library = await createLibraryWithFolder(ctx, { name: `merge-opf-${randomUUID()}`, mode: 'book_per_folder' });
      await createEpubFixture(library.folderPath, join('Sanditon', 'Sanditon.epub'), { title: 'Sanditon' });
      await writeFixtureFile(library.folderPath, join('Sanditon', 'metadata.opf'), opf('Sanditon (kept)'));
      await createPdfFixture(library.folderPath, join('Sanditon Scan', 'Sanditon.pdf'), 'Sanditon');
      await writeFixtureFile(library.folderPath, join('Sanditon Scan', 'metadata.opf'), opf('Sanditon (source)'));
      await triggerAndWaitForLibraryScan(ctx, library.libraryId);
      const keptId = (await locateBookFileByRelPath(ctx, library.libraryId, join('Sanditon', 'Sanditon.epub'))).bookId;
      const sourceId = (await locateBookFileByRelPath(ctx, library.libraryId, join('Sanditon Scan', 'Sanditon.pdf'))).bookId;
      const keptOpf = await locateBookFileByRelPath(ctx, library.libraryId, join('Sanditon', 'metadata.opf'));
      const sourceOpf = await locateBookFileByRelPath(ctx, library.libraryId, join('Sanditon Scan', 'metadata.opf'));

      const request = { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: sourceId };
      const { preview: previewed, job } = await previewAndMerge(ctx.adminToken, request);
      expect(previewed.files.find((file) => file.fileId === sourceOpf.bookFileId)).toMatchObject({ action: 'hide', reason: 'metadata_hidden' });
      expect(previewed.files.find((file) => file.fileId === keptOpf.bookFileId)).toMatchObject({ action: 'move' });
      expect(job.status).toBe('done');

      const folder = join(library.folderPath, 'Sanditon Scan');
      const [row] = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.id, keptOpf.bookFileId));
      expect(row).toMatchObject({ bookId: keptId, absolutePath: join(folder, 'metadata.opf') });
      expect(await readFile(join(folder, 'metadata.opf'), 'utf8')).toContain('Sanditon (kept)');
      expect(await readFile(join(folder, `.merged-${sourceId}-metadata.opf`), 'utf8')).toContain('Sanditon (source)');
      expect(await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.id, sourceOpf.bookFileId))).toHaveLength(0);
      expect(await exists(join(library.folderPath, 'Sanditon'))).toBe(false);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'never folds two link groups past the member cap: the source’s other members keep their own group',
    async () => {
      const entries = Array.from({ length: 12 }, (_, index) => ({
        folder: `Linked ${index}`,
        file: `Linked ${index}.pdf`,
        kind: 'pdf' as const,
        title: `Linked ${index}`,
      }));
      const { ids } = await libraryWithBooks(entries);
      const [keptId, ...rest] = ids;
      const keptMembers = [keptId, ...rest.slice(0, 5)];
      const sourceMembers = rest.slice(5);
      const sourceId = sourceMembers[0];
      expect(keptMembers.length + sourceMembers.length - 1).toBeGreaterThan(BOOK_LINK_MAX_MEMBERS);

      const [keptGroup] = await ctx.db.insert(schema.bookLinkGroups).values({ leadBookId: keptId }).returning();
      const [sourceGroup] = await ctx.db.insert(schema.bookLinkGroups).values({ leadBookId: sourceId }).returning();
      await ctx.db
        .insert(schema.bookLinks)
        .values([
          ...keptMembers.map((bookId) => ({ bookId, groupId: keptGroup.id })),
          ...sourceMembers.map((bookId) => ({ bookId, groupId: sourceGroup.id })),
        ]);

      await ctx.db.transaction((tx) =>
        ctx.app
          .get(BookConsolidationService)
          .consolidate(tx, { targetBookId: keptId, sourceBookId: sourceId, destination: null, mergedByUserId: null }),
      );

      const links = await ctx.db
        .select()
        .from(schema.bookLinks)
        .where(inArray(schema.bookLinks.groupId, [keptGroup.id, sourceGroup.id]));
      const membersOf = (groupId: number) =>
        links
          .filter((link) => link.groupId === groupId)
          .map((link) => link.bookId)
          .sort((a, b) => a - b);
      expect(membersOf(keptGroup.id)).toEqual([...keptMembers].sort((a, b) => a - b));
      expect(membersOf(sourceGroup.id)).toEqual(sourceMembers.slice(1).sort((a, b) => a - b));
      const groups = await ctx.db
        .select()
        .from(schema.bookLinkGroups)
        .where(inArray(schema.bookLinkGroups.id, [keptGroup.id, sourceGroup.id]));
      expect(groups.find((group) => group.id === keptGroup.id)?.leadBookId).toBe(keptId);
      // The source led its group; the kept book is not a member, so the group falls back to its lowest id.
      expect(groups.find((group) => group.id === sourceGroup.id)?.leadBookId).toBeNull();
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'refuses a stale preview, a viewer and a user without the permission, but not a second library',
    async () => {
      const { library, ids } = await libraryWithBooks([
        { folder: 'Middlemarch', file: 'Middlemarch.epub', kind: 'epub', title: 'Middlemarch' },
        { folder: 'Middlemarch PDF', file: 'Middlemarch.pdf', kind: 'pdf', title: 'Middlemarch' },
      ]);
      const [keptId, sourceId] = ids;
      const stale = await merge(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId], previewToken: 'not-the-token' });
      expect(stale.status).toBe(409);
      expect(stale.body.errorCode).toBe('MERGE_PREVIEW_STALE');

      const other = await libraryWithBooks([{ folder: 'Elsewhere', file: 'Elsewhere.epub', kind: 'epub', title: 'Elsewhere' }]);
      const crossLibrary = await preview(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [other.ids[0]] });
      expect(crossLibrary.status).toBe(200);
      expect(crossLibrary.body.blockers).toEqual([]);
      expect(crossLibrary.body.destinationLibraryId).toBe(library.libraryId);

      const noPermission = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata] });
      await grantLibraryAccess(ctx, noPermission.userId, library.libraryId, 'editor');
      expect((await preview(noPermission.accessToken, { targetBookId: keptId, sourceBookIds: [sourceId] })).status).toBe(403);

      const viewer = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata, Permission.LibraryMergeBooks] });
      await grantLibraryAccess(ctx, viewer.userId, library.libraryId, 'viewer');
      expect((await preview(viewer.accessToken, { targetBookId: keptId, sourceBookIds: [sourceId] })).status).toBe(403);

      const stranger = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata, Permission.LibraryMergeBooks] });
      expect((await preview(stranger.accessToken, { targetBookId: keptId, sourceBookIds: [sourceId] })).status).toBe(404);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'merges a book from another library in one step, sparing readers who cannot open the other library',
    async () => {
      const books = await libraryWithBooks([{ folder: 'Persuasion', file: 'Persuasion.epub', kind: 'epub', title: 'Persuasion' }]);
      const scans = await libraryWithBooks([{ folder: 'Persuasion Scan', file: 'Persuasion.pdf', kind: 'pdf', title: 'Persuasion' }]);
      const [keptId] = books.ids;
      const [sourceId] = scans.ids;
      // A reader of the second library only, part way through its copy.
      const reader = await createUserAndLogin(ctx, { permissions: [] });
      await grantLibraryAccess(ctx, reader.userId, scans.library.libraryId, 'viewer');
      await ctx.db.insert(schema.userBookStatus).values({ userId: reader.userId, bookId: sourceId, status: 'reading', source: 'manual' });
      const request = { targetBookId: keptId, sourceBookIds: [sourceId] };

      // By default the merged book lives where that reader can still open it.
      const chosen = await preview(ctx.adminToken, request);
      expect(chosen.body.blockers).toEqual([]);
      expect(chosen.body.destinationBookId).toBe(sourceId);
      expect(chosen.body.destinationLibraryId).toBe(scans.library.libraryId);
      expect(chosen.body.warnings).toContainEqual({ code: 'TARGET_CHANGES_LIBRARY', bookId: keptId, libraryId: scans.library.libraryId });
      expect(chosen.body.warnings.map((warning) => warning.code)).not.toContain('LIBRARY_ACCESS_NARROWS');

      // Into the first library instead, the reader would lose it: a user manager must confirm, an editor may not.
      const intoBooks = { ...request, destinationBookId: keptId };
      const narrowing = await preview(ctx.adminToken, intoBooks);
      expect(narrowing.body.warnings).toContainEqual({ code: 'LIBRARY_ACCESS_NARROWS', libraryId: books.library.libraryId, count: 1 });
      const unconfirmed = await merge(ctx.adminToken, { ...intoBooks, previewToken: narrowing.body.previewToken });
      expect(unconfirmed.status).toBe(409);
      expect(unconfirmed.body.errorCode).toBe('ACCESS_LOSS_NOT_ACKNOWLEDGED');
      const editor = await createUserAndLogin(ctx, { permissions: [Permission.LibraryEditMetadata, Permission.LibraryMergeBooks] });
      await grantLibraryAccess(ctx, editor.userId, books.library.libraryId, 'editor');
      await grantLibraryAccess(ctx, editor.userId, scans.library.libraryId, 'editor');
      const blocked = await preview(editor.accessToken, intoBooks);
      expect(blocked.body.blockers).toEqual([{ code: 'READERS_LOSE_ACCESS', libraryId: books.library.libraryId }]);

      const libraryIds = [books.library.libraryId, scans.library.libraryId];
      const revisions = async () =>
        new Map(
          (
            await ctx.db
              .select({ id: schema.libraries.id, revision: schema.libraries.koreaderHashRevision })
              .from(schema.libraries)
              .where(inArray(schema.libraries.id, libraryIds))
          ).map((row) => [row.id, row.revision]),
        );
      const revisionsBefore = await revisions();

      const { job } = await previewAndMerge(ctx.adminToken, request);
      expect(job.status).toBe('done');

      // KOReader re-reads the hash lists of both libraries.
      const revisionsAfter = await revisions();
      for (const id of libraryIds) expect(revisionsAfter.get(id)).toBeGreaterThan(revisionsBefore.get(id) ?? 0);

      const [kept] = await ctx.db.select().from(schema.books).where(eq(schema.books.id, keptId));
      expect(kept.libraryId).toBe(scans.library.libraryId);
      expect(kept.libraryFolderId).toBe(scans.library.libraryFolderId);
      const files = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, keptId));
      const contentPaths = files
        .filter((file) => file.role === 'content')
        .map((file) => file.absolutePath)
        .sort();
      expect(contentPaths).toEqual([
        join(scans.library.folderPath, 'Persuasion Scan', 'Persuasion.epub'),
        join(scans.library.folderPath, 'Persuasion Scan', 'Persuasion.pdf'),
      ]);
      // No row of the kept book points into the library it left.
      expect(files.every((file) => file.libraryFolderId === scans.library.libraryFolderId)).toBe(true);
      expect(await exists(join(scans.library.folderPath, 'Persuasion Scan', 'Persuasion.epub'))).toBe(true);
      expect(await exists(join(books.library.folderPath, 'Persuasion', 'Persuasion.epub'))).toBe(false);
      expect(await exists(join(books.library.folderPath, 'Persuasion'))).toBe(false);

      expect(await ctx.db.select().from(schema.books).where(eq(schema.books.id, sourceId))).toEqual([]);
      const [alias] = await ctx.db.select().from(schema.bookMerges).where(eq(schema.bookMerges.sourceBookId, sourceId));
      expect(alias).toMatchObject({ targetBookId: keptId, libraryId: scans.library.libraryId });
      const [jobRow] = await ctx.db.select().from(schema.bookMergeJobs).where(eq(schema.bookMergeJobs.id, job.id));
      expect(jobRow.libraryIds).toEqual([books.library.libraryId, scans.library.libraryId].sort((a, b) => a - b));

      // The reader keeps their status and can open the merged book.
      const [status] = await ctx.db
        .select()
        .from(schema.userBookStatus)
        .where(and(eq(schema.userBookStatus.userId, reader.userId), eq(schema.userBookStatus.bookId, keptId)));
      expect(status?.status).toBe('reading');
      const detail = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${keptId}`, headers: authHeader(reader.accessToken) });
      expect(detail.statusCode).toBe(200);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'records the library a merged-away book came from, and merges into the kept book in its own library with confirmation',
    async () => {
      const books = await libraryWithBooks([{ folder: 'Emma', file: 'Emma.epub', kind: 'epub', title: 'Emma' }]);
      const scans = await libraryWithBooks([{ folder: 'Emma Scan', file: 'Emma.pdf', kind: 'pdf', title: 'Emma' }]);
      const [keptId] = books.ids;
      const [sourceId] = scans.ids;
      const reader = await createUserAndLogin(ctx, { permissions: [] });
      await grantLibraryAccess(ctx, reader.userId, scans.library.libraryId, 'viewer');
      await ctx.db.insert(schema.userBookStatus).values({ userId: reader.userId, bookId: sourceId, status: 'reading', source: 'manual' });
      const request = { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: keptId };

      const { job, preview: reviewed } = await previewAndMerge(ctx.adminToken, request, { acknowledgeAccessLoss: true });

      expect(reviewed.files.find((entry) => entry.bookId === sourceId && entry.action === 'move')).toMatchObject({
        fromLibraryId: scans.library.libraryId,
        toLibraryId: books.library.libraryId,
      });
      expect(job.status).toBe('done');
      expect(await exists(join(books.library.folderPath, 'Emma', 'Emma.pdf'))).toBe(true);
      const [alias] = await ctx.db.select().from(schema.bookMerges).where(eq(schema.bookMerges.sourceBookId, sourceId));
      expect(alias.libraryId).toBe(scans.library.libraryId);
      // The reader's data is kept, out of their sight until they get access to the first library.
      const [status] = await ctx.db
        .select()
        .from(schema.userBookStatus)
        .where(and(eq(schema.userBookStatus.userId, reader.userId), eq(schema.userBookStatus.bookId, keptId)));
      expect(status?.status).toBe('reading');
      const detail = await ctx.app.inject({ method: 'GET', url: `/api/v1/books/${keptId}`, headers: authHeader(reader.accessToken) });
      expect(detail.statusCode).toBe(404);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'refuses a format the destination library does not allow, before anything moves',
    async () => {
      const books = await libraryWithBooks([{ folder: 'Sanditon', file: 'Sanditon.epub', kind: 'epub', title: 'Sanditon' }]);
      const scans = await libraryWithBooks([{ folder: 'Sanditon Scan', file: 'Sanditon.pdf', kind: 'pdf', title: 'Sanditon' }]);
      await ctx.db
        .update(schema.libraries)
        .set({ allowedFormats: ['epub'] })
        .where(eq(schema.libraries.id, books.library.libraryId));

      const result = await preview(ctx.adminToken, { targetBookId: books.ids[0], sourceBookIds: [scans.ids[0]], destinationBookId: books.ids[0] });

      expect(result.body.blockers).toEqual([{ code: 'FORMAT_NOT_ALLOWED', bookId: scans.ids[0], libraryId: books.library.libraryId, format: 'pdf' }]);
      expect(result.body.previewToken).toBeNull();
      expect(await exists(join(scans.library.folderPath, 'Sanditon Scan', 'Sanditon.pdf'))).toBe(true);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'blocks a library that keeps one book per file',
    async () => {
      const library: CreatedLibrary = await createLibraryWithFolder(ctx, { name: `merge-files-${randomUUID()}`, mode: 'book_per_file' });
      await createEpubFixture(library.folderPath, 'Walden.epub', { title: 'Walden' });
      await createPdfFixture(library.folderPath, 'Walden.pdf', 'Walden');
      await triggerAndWaitForLibraryScan(ctx, library.libraryId);
      const epub = await locateBookFileByRelPath(ctx, library.libraryId, 'Walden.epub');
      const pdf = await locateBookFileByRelPath(ctx, library.libraryId, 'Walden.pdf');
      const result = await preview(ctx.adminToken, { targetBookId: epub.bookId, sourceBookIds: [pdf.bookId] });
      expect(result.body.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining(['FILE_PER_BOOK_LIBRARY']));
      expect(result.body.previewToken).toBeNull();
    },
    SCENARIO_TIMEOUT_MS,
  );

  /** One book in each of two new libraries: the kept epub first, the source pdf second. */
  async function oneBookInEachLibrary(title: string) {
    const books = await libraryWithBooks([{ folder: title, file: `${title}.epub`, kind: 'epub', title }]);
    const scans = await libraryWithBooks([{ folder: `${title} Scan`, file: `${title}.pdf`, kind: 'pdf', title }]);
    return { books, scans, keptId: books.ids[0], sourceId: scans.ids[0] };
  }

  it(
    'refuses a user who edits one library but only views or cannot see the other (X12, X13)',
    async () => {
      const { books, scans, keptId, sourceId } = await oneBookInEachLibrary('Emma');
      const request = { targetBookId: keptId, sourceBookIds: [sourceId] };
      const permissions = [Permission.LibraryEditMetadata, Permission.LibraryMergeBooks];

      const viewerThere = await createUserAndLogin(ctx, { permissions });
      await grantLibraryAccess(ctx, viewerThere.userId, books.library.libraryId, 'editor');
      await grantLibraryAccess(ctx, viewerThere.userId, scans.library.libraryId, 'viewer');
      expect((await preview(viewerThere.accessToken, request)).status).toBe(403);

      const blindThere = await createUserAndLogin(ctx, { permissions });
      await grantLibraryAccess(ctx, blindThere.userId, books.library.libraryId, 'editor');
      expect((await preview(blindThere.accessToken, request)).status).toBe(404);

      const editorOfBoth = await createUserAndLogin(ctx, { permissions });
      await grantLibraryAccess(ctx, editorOfBoth.userId, books.library.libraryId, 'editor');
      await grantLibraryAccess(ctx, editorOfBoth.userId, scans.library.libraryId, 'editor');
      const allowed = await preview(editorOfBoth.accessToken, request);
      expect(allowed.status).toBe(200);
      expect(allowed.body.blockers).toEqual([]);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'merging two linked books from different libraries dissolves their link (X33)',
    async () => {
      const { keptId, sourceId } = await oneBookInEachLibrary('Mansfield Park');
      const linked = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/books/links',
        headers: authHeader(ctx.adminToken),
        payload: { bookIds: [keptId, sourceId] },
      });
      expect(linked.statusCode).toBe(201);
      const groupId = (linked.json() as { groupId: number }).groupId;

      const { job } = await previewAndMerge(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: keptId });
      expect(job.status).toBe('done');

      expect(
        await ctx.db
          .select()
          .from(schema.bookLinks)
          .where(inArray(schema.bookLinks.bookId, [keptId, sourceId])),
      ).toEqual([]);
      expect(await ctx.db.select().from(schema.bookLinkGroups).where(eq(schema.bookLinkGroups.id, groupId))).toEqual([]);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'moves a reader’s daily reading stats to the library the merged book lives in, totals unchanged (X29)',
    async () => {
      const { books, scans, keptId, sourceId } = await oneBookInEachLibrary('Northanger Abbey');
      const reader = await createUserAndLogin(ctx, { permissions: [] });
      await grantLibraryAccess(ctx, reader.userId, books.library.libraryId, 'viewer');
      await grantLibraryAccess(ctx, reader.userId, scans.library.libraryId, 'viewer');
      const [sourceFile] = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, sourceId));
      await ctx.db.insert(schema.readingSessions).values([
        {
          userId: reader.userId,
          bookId: sourceId,
          bookFileId: sourceFile.id,
          sessionId: randomUUID(),
          startedAt: new Date('2026-10-01T09:00:00Z'),
          endedAt: new Date('2026-10-01T09:10:00Z'),
          durationSeconds: 600,
        },
        {
          userId: reader.userId,
          bookId: sourceId,
          bookFileId: sourceFile.id,
          sessionId: randomUUID(),
          startedAt: new Date('2026-10-02T20:00:00Z'),
          endedAt: new Date('2026-10-02T20:05:00Z'),
          durationSeconds: 300,
        },
      ]);
      const statistics = ctx.app.get(UserStatisticsService);
      await statistics.rebuildDailyStatsForUser(reader.userId, await statistics.getUserTimeZone(reader.userId));
      const statsOf = () =>
        ctx.db
          .select({
            libraryId: schema.userReadingDailyStats.libraryId,
            day: schema.userReadingDailyStats.day,
            seconds: schema.userReadingDailyStats.readingSeconds,
            sessions: schema.userReadingDailyStats.sessionsCount,
          })
          .from(schema.userReadingDailyStats)
          .where(eq(schema.userReadingDailyStats.userId, reader.userId))
          .orderBy(schema.userReadingDailyStats.day);
      expect(await statsOf()).toEqual([
        { libraryId: scans.library.libraryId, day: '2026-10-01', seconds: 600, sessions: 1 },
        { libraryId: scans.library.libraryId, day: '2026-10-02', seconds: 300, sessions: 1 },
      ]);

      const { job } = await previewAndMerge(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: keptId });
      expect(job.status).toBe('done');

      await waitForCondition(async () => {
        expect(await statsOf()).toEqual([
          { libraryId: books.library.libraryId, day: '2026-10-01', seconds: 600, sessions: 1 },
          { libraryId: books.library.libraryId, day: '2026-10-02', seconds: 300, sessions: 1 },
        ]);
      }, 30_000);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'says when a requested other format will land in the library the book leaves (X35)',
    async () => {
      const { scans, keptId, sourceId } = await oneBookInEachLibrary('Lady Susan');
      const requester = await createUserAndLogin(ctx, { permissions: [] });
      const request = (mediaKind: 'ebook' | 'audiobook', status: string) => ({
        userId: requester.userId,
        mediaKind,
        status,
        title: 'Lady Susan',
        dedupeKey: randomUUID(),
        targetLibraryId: scans.library.libraryId,
      });
      const [landed] = await ctx.db
        .insert(schema.bookRequests)
        .values({ ...request('ebook', 'available'), matchedBookId: sourceId })
        .returning({ id: schema.bookRequests.id });
      const [pending] = await ctx.db
        .insert(schema.bookRequests)
        .values({ ...request('audiobook', 'approved'), companionRequestId: landed.id })
        .returning({ id: schema.bookRequests.id });
      await ctx.db.update(schema.bookRequests).set({ companionRequestId: pending.id }).where(eq(schema.bookRequests.id, landed.id));

      const away = await preview(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: keptId });
      expect(away.body.warnings).toContainEqual({ code: 'COMPANION_REQUEST_STAYS', libraryId: scans.library.libraryId, count: 1 });

      const staying = await preview(ctx.adminToken, { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: sourceId });
      expect(staying.body.warnings.map((warning) => warning.code)).not.toContain('COMPANION_REQUEST_STAYS');
    },
    SCENARIO_TIMEOUT_MS,
  );

  it.skipIf(!SECOND_DEVICE_PATH)(
    'copies a large file onto another filesystem with verified bytes and progress, and refuses one that does not fit (X2, X4)',
    async () => {
      const here = await libraryWithBooks([{ folder: 'Middlemarch Audio', file: 'Middlemarch.pdf', kind: 'pdf', title: 'Middlemarch' }]);
      const there = await createLibraryWithFolder(ctx, { name: `merge-xdev-${randomUUID()}`, mode: 'book_per_folder', basePath: SECOND_DEVICE_PATH });
      // The fixture cleans up only its own folder; this one is on the other filesystem.
      onTestFinished(() => rm(there.folderPath, { recursive: true, force: true }));
      await createEpubFixture(there.folderPath, join('Middlemarch', 'Middlemarch.epub'), { title: 'Middlemarch' });
      await triggerAndWaitForLibraryScan(ctx, there.libraryId);
      const keptId = (await locateBookFileByRelPath(ctx, there.libraryId, join('Middlemarch', 'Middlemarch.epub'))).bookId;
      const sourceId = here.ids[0];
      const from = join(here.library.folderPath, 'Middlemarch Audio', 'Middlemarch.pdf');
      const request = { targetBookId: keptId, sourceBookIds: [sourceId], destinationBookId: keptId };

      // The scanned file grown in place (sparse, so it costs no disk here), its row kept in step.
      const resize = async (bytes: number) => {
        const handle = await open(from, 'r+');
        await handle.truncate(bytes);
        await handle.write(Buffer.from(`end of a ${bytes} byte file`), 0, undefined, bytes - 64);
        await handle.close();
        const info = await stat(from);
        await ctx.db.update(schema.bookFiles).set({ sizeBytes: info.size, mtime: info.mtime }).where(eq(schema.bookFiles.bookId, sourceId));
      };
      const sha256 = async (path: string) => {
        const hash = createHash('sha256');
        await pipeline(createReadStream(path), hash);
        return hash.digest('hex');
      };

      await resize(3 * GIB);
      const tooBig = await preview(ctx.adminToken, request);
      expect(tooBig.body.blockers).toEqual([{ code: 'INSUFFICIENT_SPACE', bytes: 3 * GIB }]);

      await resize(GIB);
      const expectedHash = await sha256(from);
      const events: BookMergeJobEvent[] = [];
      const gateway = ctx.app.get(ScanGateway);
      const emit = vi.spyOn(gateway, 'emitBookMergeJob').mockImplementation((_userId, _phase, event) => void events.push(event));
      try {
        const { preview: reviewed, job } = await previewAndMerge(ctx.adminToken, request);
        expect(reviewed.warnings).toContainEqual({ code: 'CROSS_DEVICE_COPY', bytes: GIB });
        expect(job.status).toBe('done');
        expect(job.result).toMatchObject({ crossDevice: true, movedFileCount: 1 });
      } finally {
        emit.mockRestore();
      }

      const to = join(there.folderPath, 'Middlemarch', 'Middlemarch.pdf');
      expect((await stat(to)).size).toBe(GIB);
      expect(await sha256(to)).toBe(expectedHash);
      expect(await exists(from)).toBe(false);
      expect(await exists(dirname(from))).toBe(false);

      const bytes = events.filter((event) => event.bytesTotal !== undefined);
      expect(bytes[0]).toMatchObject({ bytesDone: 0, bytesTotal: GIB });
      expect(bytes.at(-1)).toMatchObject({ bytesDone: GIB, bytesTotal: GIB });
      const done = bytes.map((event) => event.bytesDone ?? 0);
      expect(done).toEqual([...done].sort((a, b) => a - b));
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'consolidation applies the conditional rules: audio owner, Kobo entitlement, comic fill, author pick, remote ids, file retire',
    async () => {
      const { library, ids } = await libraryWithBooks([
        { folder: 'Beowulf', file: 'Beowulf.epub', kind: 'epub', title: 'Beowulf' },
        { folder: 'Beowulf Audio', file: 'Beowulf.pdf', kind: 'pdf', title: 'Beowulf read aloud' },
      ]);
      const [keptId, sourceId] = ids;
      const adminId = await adminUserId();
      const [sourceBook] = await ctx.db.select().from(schema.books).where(eq(schema.books.id, sourceId));

      // The source owns the audio: a track row is enough for the rules, which read rows, not disks.
      const [track] = await ctx.db
        .insert(schema.bookFiles)
        .values({
          bookId: sourceId,
          libraryFolderId: sourceBook.libraryFolderId,
          absolutePath: join(library.folderPath, 'Beowulf Audio', 'Beowulf.m4b'),
          relPath: join('Beowulf Audio', 'Beowulf.m4b'),
          ino: 0n,
          format: 'm4b',
          role: 'content',
          sizeBytes: 10,
        })
        .returning();
      await ctx.db.update(schema.bookMetadata).set({ durationSeconds: 3600 }).where(eq(schema.bookMetadata.bookId, sourceId));
      await ctx.db.insert(schema.audiobookProgress).values({
        userId: adminId,
        bookId: sourceId,
        percentage: 0.5,
        currentFileId: track.id,
        positionSeconds: 1800,
        revision: 3,
        capturedAt: new Date(),
      });

      // The kept book has no authors, so the source's list is taken whole.
      await ctx.db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, keptId));
      const sourceAuthors = await ctx.db.select().from(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, sourceId));

      await ctx.db.insert(schema.comicMetadata).values([
        { bookId: keptId, issueNumber: '1' },
        { bookId: sourceId, issueNumber: '9', volumeName: 'Old English' },
      ]);

      const [device] = await ctx.db.insert(schema.koboDevices).values({ userId: adminId, name: 'Clara', token: randomUUID() }).returning();
      const [entitlement] = await ctx.db.insert(schema.koboBookEntitlements).values({ userId: adminId, bookId: sourceId }).returning();
      await ctx.db.insert(schema.koboReadingStates).values({ userId: adminId, bookId: sourceId, entitlementId: entitlement.entitlementId });
      const [snapshot] = await ctx.db.insert(schema.koboLibrarySnapshots).values({ userId: adminId, deviceId: device.id }).returning();
      await ctx.db.insert(schema.koboSnapshotBooks).values({ snapshotId: snapshot.id, bookId: sourceId });

      await ctx.db.insert(schema.hardcoverBookState).values([
        { userId: adminId, bookId: keptId, hardcoverBookId: 100 },
        { userId: adminId, bookId: sourceId, hardcoverBookId: 200 },
      ]);
      await ctx.db.insert(schema.readingAttempts).values({
        userId: adminId,
        bookId: sourceId,
        startedOn: '2023-01-01',
        endedOn: '2023-02-01',
        outcome: 'completed',
        origin: 'hardcover',
        externalProvider: 'hardcover',
        externalId: `read-${randomUUID()}`,
      });

      const consolidation = ctx.app.get(BookConsolidationService);
      const result = await ctx.db.transaction((tx) =>
        consolidation.consolidate(tx, {
          targetBookId: keptId,
          sourceBookId: sourceId,
          destination: null,
          excludeGenreIds: [2147483000],
          excludeTagIds: [2147483000],
          hiddenRequestIds: [2147483000],
          mergedByUserId: adminId,
        }),
      );
      expect(result.koboEntitlementMovedUserIds).toEqual([adminId]);

      const authors = await ctx.db.select().from(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, keptId));
      expect(authors.map((row) => row.authorId).sort()).toEqual(sourceAuthors.map((row) => row.authorId).sort());
      const [comic] = await ctx.db.select().from(schema.comicMetadata).where(eq(schema.comicMetadata.bookId, keptId));
      expect(comic).toMatchObject({ issueNumber: '1', volumeName: 'Old English' });
      const [progress] = await ctx.db.select().from(schema.audiobookProgress).where(eq(schema.audiobookProgress.bookId, keptId));
      expect(progress).toMatchObject({ userId: adminId, currentFileId: track.id });
      const [moved] = await ctx.db.select().from(schema.koboBookEntitlements).where(eq(schema.koboBookEntitlements.id, entitlement.id));
      expect(moved.bookId).toBe(keptId);
      expect(await ctx.db.select().from(schema.koboSnapshotBooks).where(eq(schema.koboSnapshotBooks.bookId, keptId))).toHaveLength(1);
      const released = await ctx.db
        .select()
        .from(schema.readingAttempts)
        .where(and(eq(schema.readingAttempts.bookId, keptId), eq(schema.readingAttempts.origin, 'hardcover')));
      expect(released[0].externalId).toBeNull();
      const [metadata] = await ctx.db.select().from(schema.bookMetadata).where(eq(schema.bookMetadata.bookId, keptId));
      expect(metadata.durationSeconds).toBe(3600);

      // Retiring a copy moves its readers' progress to the copy that stays.
      const files = await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.bookId, keptId));
      const epub = files.find((file) => file.format === 'epub')!;
      const pdf = files.find((file) => file.format === 'pdf')!;
      await ctx.db.insert(schema.readingProgress).values([
        { bookFileId: pdf.id, userId: adminId, percentage: 0.9, updatedAt: new Date(Date.now() + 1000), lastReadAt: new Date() },
        { bookFileId: epub.id, userId: adminId, percentage: 0.1, updatedAt: new Date(Date.now() - 1000), lastReadAt: new Date() },
      ]);
      await ctx.db.transaction((tx) => consolidation.retireFile(tx, { bookId: keptId, loserFileId: pdf.id, survivorFileId: epub.id }));
      const [kept] = await ctx.db.select().from(schema.readingProgress).where(eq(schema.readingProgress.bookFileId, epub.id));
      expect(kept.percentage).toBeCloseTo(0.9);
      expect(await ctx.db.select().from(schema.bookFiles).where(eq(schema.bookFiles.id, pdf.id))).toHaveLength(0);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'recovery moves a half-merged file back and closes the job',
    async () => {
      const { library, ids } = await libraryWithBooks([
        { folder: 'Ivanhoe', file: 'Ivanhoe.epub', kind: 'epub', title: 'Ivanhoe' },
        { folder: 'Ivanhoe Scan', file: 'Ivanhoe.pdf', kind: 'pdf', title: 'Ivanhoe' },
      ]);
      const [keptId, sourceId] = ids;
      const from = join(library.folderPath, 'Ivanhoe Scan', 'Ivanhoe.pdf');
      const to = join(library.folderPath, 'Ivanhoe', 'Ivanhoe.pdf');
      const bytes = await readFile(from);
      // The crash: the file reached the kept book's folder, the transaction never committed.
      await mkdir(dirname(to), { recursive: true });
      await rename(from, to);
      const [job] = await ctx.db
        .insert(schema.bookMergeJobs)
        .values({
          libraryId: library.libraryId,
          targetBookId: keptId,
          destinationBookId: keptId,
          sourceBookIds: [sourceId],
          status: 'moving',
          currentSourceBookId: sourceId,
          plan: { steps: [{ sourceBookId: sourceId }], targetBookId: keptId, libraryId: library.libraryId },
          moves: [{ fileId: null, from, to, phase: 'done', expectedSize: bytes.length, expectedMtimeMs: null, movedSize: bytes.length }],
          outcomes: [{ sourceBookId: sourceId, status: 'pending', errorCode: null }],
          total: 1,
        })
        .returning();

      await ctx.app.get(BookMergeRecoveryService).recover(job);

      expect(await exists(from)).toBe(true);
      expect(await exists(to)).toBe(false);
      const [recovered] = await ctx.db.select().from(schema.bookMergeJobs).where(eq(schema.bookMergeJobs.id, job.id));
      expect(recovered.status).toBe('rolled_back');
      expect(await ctx.db.select().from(schema.books).where(eq(schema.books.id, sourceId))).toHaveLength(1);
    },
    SCENARIO_TIMEOUT_MS,
  );

  it(
    'a started copy whose source is intact is removed, never moved back over the source',
    async () => {
      const { library, ids } = await libraryWithBooks([
        { folder: 'Kim', file: 'Kim.epub', kind: 'epub', title: 'Kim' },
        { folder: 'Kim Scan', file: 'Kim.pdf', kind: 'pdf', title: 'Kim' },
      ]);
      const [keptId, sourceId] = ids;
      const from = join(library.folderPath, 'Kim Scan', 'Kim.pdf');
      const to = join(library.folderPath, 'Kim', 'Kim.pdf');
      const bytes = await readFile(from);
      await writeFile(to, bytes.subarray(0, Math.floor(bytes.length / 2)));
      const [job] = await ctx.db
        .insert(schema.bookMergeJobs)
        .values({
          libraryId: library.libraryId,
          targetBookId: keptId,
          sourceBookIds: [sourceId],
          status: 'moving',
          currentSourceBookId: sourceId,
          plan: { steps: [{ sourceBookId: sourceId }], targetBookId: keptId, libraryId: library.libraryId },
          moves: [{ fileId: null, from, to, phase: 'started', expectedSize: bytes.length, expectedMtimeMs: null }],
          outcomes: [{ sourceBookId: sourceId, status: 'pending', errorCode: null }],
          total: 1,
        })
        .returning();

      await ctx.app.get(BookMergeRecoveryService).recover(job);

      expect((await readFile(from)).equals(bytes)).toBe(true);
      expect(await exists(to)).toBe(false);
    },
    SCENARIO_TIMEOUT_MS,
  );
});
