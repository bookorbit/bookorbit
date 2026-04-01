import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { eq } from 'drizzle-orm';
import { Permission, type LibraryFileSyncProgressEvent } from '@projectx/types';

import * as schema from '../src/db/schema';
import { extractCb7Metadata, extractCbzMetadata } from '../src/modules/metadata/lib/cbz-metadata';
import { extractEpubMetadata } from '../src/modules/metadata/lib/epub';
import { parsePdfFile } from '../src/modules/metadata/lib/pdf-parser';
import {
  authHeader,
  closeMetadataWriteE2EContext,
  createLibraryWithFolder,
  createMetadataWriteE2EContext,
  createUserAndLogin,
  getLatestWriteLogEntry,
  grantLibraryAccess,
  locateBookFileByRelPath,
  setFileWriteSettings,
  triggerAndWaitForLibraryScan,
  waitForWriteLogEntry,
  type LocatedBookFile,
  type MetadataWriteE2EContext,
} from './e2e/metadata-write/metadata-write-harness';
import {
  createCb7Fixture,
  createCbzFixture,
  createEpubFixture,
  createPdfFixture,
  writeFixtureFile,
} from './e2e/metadata-write/metadata-write-fixture-builder';

type SupportedFormat = 'pdf' | 'epub' | 'cbz' | 'cb7';
const SCENARIO_TIMEOUT_MS = 120_000;

interface ScenarioRunResult {
  id: string;
  status: 'passed' | 'failed';
  durationMs: number;
  error?: string;
}

interface PreparedLibraryResult {
  libraryId: number;
  books: Record<SupportedFormat, LocatedBookFile>;
}

async function writeScenarioReport(results: ScenarioRunResult[]): Promise<void> {
  const reportDir = process.env.JUNIT_OUTPUT ? dirname(process.env.JUNIT_OUTPUT) : join(process.cwd(), '..', 'test-results', 'server');
  await mkdir(reportDir, { recursive: true });
  const reportPath = join(reportDir, 'metadata-write-e2e-scenarios.json');
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

describe('Metadata write operations (e2e)', { timeout: SCENARIO_TIMEOUT_MS }, () => {
  let context!: MetadataWriteE2EContext;
  const scenarioResults: ScenarioRunResult[] = [];
  let scenarioStartedAt = 0;

  beforeAll(async () => {
    context = await createMetadataWriteE2EContext();
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
    if (context) {
      await closeMetadataWriteE2EContext(context);
    }
  });

  beforeEach(async () => {
    scenarioStartedAt = Date.now();
    await setFileWriteSettings(context.db, {
      enabled: true,
      writeCover: false,
      epub: { enabled: true },
      pdf: { enabled: true },
      cbx: { enabled: true, formats: ['cbz', 'cb7'] },
    });
  });

  describe('database metadata writes', () => {
    it('persists scalar and relational metadata through PATCH /books/:id/metadata', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'db-write/book.pdf');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'db-write/book.pdf');

      const response = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: {
          title: 'DB Write Title',
          subtitle: 'DB Write Subtitle',
          description: 'DB Write Description',
          publisher: 'DB Write Publisher',
          publishedYear: 2005,
          language: 'en',
          seriesName: 'DB Series',
          seriesIndex: 2,
          isbn13: '9781234567890',
          rating: 4,
          authors: ['DB Author A', 'DB Author B'],
          genres: ['DB Genre'],
          tags: ['DB Tag'],
        },
      });

      expect(response.statusCode).toBe(200);

      const [metadata] = await context.db
        .select({
          title: schema.bookMetadata.title,
          subtitle: schema.bookMetadata.subtitle,
          description: schema.bookMetadata.description,
          publisher: schema.bookMetadata.publisher,
          publishedYear: schema.bookMetadata.publishedYear,
          language: schema.bookMetadata.language,
          seriesName: schema.bookMetadata.seriesName,
          seriesIndex: schema.bookMetadata.seriesIndex,
          isbn13: schema.bookMetadata.isbn13,
          rating: schema.bookMetadata.rating,
        })
        .from(schema.bookMetadata)
        .where(eq(schema.bookMetadata.bookId, book.bookId))
        .limit(1);

      expect(metadata).toMatchObject({
        title: 'DB Write Title',
        subtitle: 'DB Write Subtitle',
        description: 'DB Write Description',
        publisher: 'DB Write Publisher',
        publishedYear: 2005,
        language: 'en',
        seriesName: 'DB Series',
        seriesIndex: 2,
        isbn13: '9781234567890',
        rating: 4,
      });

      const [authorRows, genreRows, tagRows] = await Promise.all([
        context.db
          .select({ name: schema.authors.name })
          .from(schema.bookAuthors)
          .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
          .where(eq(schema.bookAuthors.bookId, book.bookId))
          .orderBy(schema.bookAuthors.displayOrder),
        context.db
          .select({ name: schema.genres.name })
          .from(schema.bookGenres)
          .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
          .where(eq(schema.bookGenres.bookId, book.bookId)),
        context.db
          .select({ name: schema.tags.name })
          .from(schema.bookTags)
          .innerJoin(schema.tags, eq(schema.tags.id, schema.bookTags.tagId))
          .where(eq(schema.bookTags.bookId, book.bookId)),
      ]);

      expect(authorRows.map((row) => row.name)).toEqual(['DB Author A', 'DB Author B']);
      expect(genreRows.map((row) => row.name)).toEqual(['DB Genre']);
      expect(tagRows.map((row) => row.name)).toEqual(['DB Tag']);
    });
  });

  describe('auto-write on metadata patch', () => {
    it('writes PDF metadata to disk and records auto write-log entry', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'auto-write/book.pdf', 'Auto Seed PDF');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'auto-write/book.pdf');

      const response = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: {
          title: 'Auto PDF Title',
          authors: ['Auto PDF Author'],
          description: 'Auto PDF Description',
          publisher: 'Auto PDF Publisher',
          tags: ['AutoTag'],
        },
      });
      expect(response.statusCode).toBe(200);

      const logEntry = await waitForWriteLogEntry(context.db, book.bookId, {
        triggeredBy: 'auto',
        status: 'success',
      });
      expect(logEntry.format).toBe('pdf');

      const parsedPdf = await parsePdfFile(book.absolutePath);
      expect(parsedPdf?.title).toBe('Auto PDF Title');
      expect(parsedPdf?.authors.map((author) => author.name)).toContain('Auto PDF Author');
      expect(parsedPdf?.description).toBe('Auto PDF Description');

      const [metadata] = await context.db
        .select({ lastWrittenAt: schema.bookMetadata.lastWrittenAt })
        .from(schema.bookMetadata)
        .where(eq(schema.bookMetadata.bookId, book.bookId))
        .limit(1);
      expect(metadata?.lastWrittenAt).toBeInstanceOf(Date);
    });

    it('writes EPUB metadata to disk and records auto write-log entry', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createEpubFixture(library.folderPath, 'auto-write/book.epub', { title: 'Auto Seed EPUB' });
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'auto-write/book.epub');

      const response = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: {
          title: 'Auto EPUB Title',
          authors: ['Auto EPUB Author'],
          language: 'fr',
          publishedYear: 2012,
          genres: ['Sci-Fi'],
          tags: ['AutoEpubTag'],
        },
      });
      expect(response.statusCode).toBe(200);

      const logEntry = await waitForWriteLogEntry(context.db, book.bookId, {
        triggeredBy: 'auto',
        status: 'success',
      });
      expect(logEntry.format).toBe('epub');

      const parsedEpub = await extractEpubMetadata(book.absolutePath);
      expect(parsedEpub?.title).toBe('Auto EPUB Title');
      expect(parsedEpub?.language).toBe('fr');
      expect(parsedEpub?.publishedYear).toBe(2012);
      expect(parsedEpub?.authors.map((author) => author.name)).toContain('Auto EPUB Author');

      const [metadata] = await context.db
        .select({ lastWrittenAt: schema.bookMetadata.lastWrittenAt })
        .from(schema.bookMetadata)
        .where(eq(schema.bookMetadata.bookId, book.bookId))
        .limit(1);
      expect(metadata?.lastWrittenAt).toBeInstanceOf(Date);
    });
  });

  describe('library sync write flow', () => {
    it('writes metadata to PDF/EPUB/CBZ/CB7 and emits SSE summary', async () => {
      const prepared = await prepareLibraryWithAllFormats(context);

      await setFileWriteSettings(context.db, {
        enabled: false,
        cbx: { enabled: true, formats: ['cbz', 'cb7'] },
      });

      const updates: Record<SupportedFormat, { title: string; author: string }> = {
        pdf: { title: 'Sync PDF Title', author: 'Sync PDF Author' },
        epub: { title: 'Sync EPUB Title', author: 'Sync EPUB Author' },
        cbz: { title: 'Sync CBZ Title', author: 'Sync CBZ Author' },
        cb7: { title: 'Sync CB7 Title', author: 'Sync CB7 Author' },
      };

      for (const format of Object.keys(prepared.books) as SupportedFormat[]) {
        const book = prepared.books[format];
        const payload = updates[format];
        const patchResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: {
            title: payload.title,
            authors: [payload.author],
            publisher: `Publisher ${format.toUpperCase()}`,
            publishedYear: 2020,
          },
        });
        expect(patchResponse.statusCode).toBe(200);
      }

      await setFileWriteSettings(context.db, {
        enabled: true,
        writeCover: false,
        cbx: { enabled: true, formats: ['cbz', 'cb7'] },
      });

      const syncResponse = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${prepared.libraryId}/write-metadata-to-files`,
        headers: authHeader(context.adminToken),
      });

      expect(syncResponse.statusCode).toBe(200);
      const events = parseSseEvents(syncResponse.body);
      const doneEvent = events.find(
        (event): event is Extract<LibraryFileSyncProgressEvent, { done: true }> => 'done' in event && event.done === true,
      );
      expect(doneEvent).toMatchObject({ processed: 4, succeeded: 4, failed: 0, skipped: 0 });
      expect(events.filter((event) => !('done' in event))).toHaveLength(4);

      for (const format of Object.keys(prepared.books) as SupportedFormat[]) {
        const book = prepared.books[format];
        const logEntry = await getLatestWriteLogEntry(context.db, book.bookId, 'sync');
        expect(logEntry?.status).toBe('success');
      }

      const parsedPdf = await parsePdfFile(prepared.books.pdf.absolutePath);
      expect(parsedPdf?.title).toBe(updates.pdf.title);
      expect(parsedPdf?.authors.map((author) => author.name)).toContain(updates.pdf.author);

      const parsedEpub = await extractEpubMetadata(prepared.books.epub.absolutePath);
      expect(parsedEpub?.title).toBe(updates.epub.title);
      expect(parsedEpub?.authors.map((author) => author.name)).toContain(updates.epub.author);

      const parsedCbz = await extractCbzMetadata(prepared.books.cbz.absolutePath);
      expect(parsedCbz?.title).toBe(updates.cbz.title);
      expect(parsedCbz?.authors.map((author) => author.name)).toContain(updates.cbz.author);

      const parsedCb7 = await extractCb7Metadata(prepared.books.cb7.absolutePath);
      expect(parsedCb7?.title).toBe(updates.cb7.title);
      expect(parsedCb7?.authors.map((author) => author.name)).toContain(updates.cb7.author);
    });

    it('supports dry-run sync and records skipped write-log entries', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'dry-run/book.pdf');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'dry-run/book.pdf');

      await setFileWriteSettings(context.db, { enabled: false });
      const patchResponse = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: {
          title: 'Dry Run Title',
          authors: ['Dry Run Author'],
        },
      });
      expect(patchResponse.statusCode).toBe(200);

      await setFileWriteSettings(context.db, { enabled: true });

      const dryRunResponse = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files?dryRun=true`,
        headers: authHeader(context.adminToken),
      });

      expect(dryRunResponse.statusCode).toBe(200);
      const events = parseSseEvents(dryRunResponse.body);
      const doneEvent = events.find(
        (event): event is Extract<LibraryFileSyncProgressEvent, { done: true }> => 'done' in event && event.done === true,
      );
      expect(doneEvent).toMatchObject({ processed: 1, succeeded: 0, failed: 0, skipped: 1 });

      const logEntry = await waitForWriteLogEntry(context.db, book.bookId, {
        triggeredBy: 'sync',
        status: 'skipped',
      });
      expect(logEntry.errorMessage).toBe('dry-run');

      const [metadata] = await context.db
        .select({ lastWrittenAt: schema.bookMetadata.lastWrittenAt })
        .from(schema.bookMetadata)
        .where(eq(schema.bookMetadata.bookId, book.bookId))
        .limit(1);
      expect(metadata?.lastWrittenAt ?? null).toBeNull();
    });

    it('rejects sync writes when file-write settings are disabled', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'disabled-sync/book.pdf');
      await triggerAndWaitForLibraryScan(context, library.libraryId);

      await setFileWriteSettings(context.db, { enabled: false });

      const response = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files`,
        headers: authHeader(context.adminToken),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        message: expect.stringContaining('Metadata file write is not enabled'),
      });
    });
  });

  describe('failure isolation', () => {
    it('continues processing other books when one file write fails', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'failure-isolation/ok.pdf');
      await writeFixtureFile(library.folderPath, 'failure-isolation/broken.epub', 'not a valid epub archive');
      await triggerAndWaitForLibraryScan(context, library.libraryId);

      const okBook = await locateBookFileByRelPath(context, library.libraryId, 'failure-isolation/ok.pdf');
      const brokenBook = await locateBookFileByRelPath(context, library.libraryId, 'failure-isolation/broken.epub');

      await setFileWriteSettings(context.db, { enabled: false });

      for (const target of [okBook, brokenBook]) {
        const patchResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${target.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: {
            title: target.bookId === okBook.bookId ? 'Failure Isolation Success' : 'Failure Isolation Broken',
            authors: ['Failure Isolation Author'],
          },
        });
        expect(patchResponse.statusCode).toBe(200);
      }

      await setFileWriteSettings(context.db, { enabled: true, cbx: { enabled: true, formats: ['cbz', 'cb7'] } });

      const syncResponse = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files`,
        headers: authHeader(context.adminToken),
      });
      expect(syncResponse.statusCode).toBe(200);

      const events = parseSseEvents(syncResponse.body);
      const doneEvent = events.find(
        (event): event is Extract<LibraryFileSyncProgressEvent, { done: true }> => 'done' in event && event.done === true,
      );
      expect(doneEvent).toMatchObject({ processed: 2, succeeded: 1, failed: 1, skipped: 0 });

      const successLog = await waitForWriteLogEntry(context.db, okBook.bookId, { triggeredBy: 'sync', status: 'success' });
      const failureLog = await waitForWriteLogEntry(context.db, brokenBook.bookId, { triggeredBy: 'sync', status: 'failed' });
      expect(successLog.errorMessage ?? null).toBeNull();
      expect(failureLog.errorMessage).toBeTruthy();

      const parsedPdf = await parsePdfFile(okBook.absolutePath);
      expect(parsedPdf?.title).toBe('Failure Isolation Success');
    });
  });

  describe('access control', () => {
    it('enforces permission and library access for PATCH /books/:id/metadata', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'access/patch.pdf');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'access/patch.pdf');

      const noPermissionUser = await createUserAndLogin(context);
      const withPermissionUser = await createUserAndLogin(context, {
        permissions: [Permission.LibraryEditMetadata],
      });

      await grantLibraryAccess(context, noPermissionUser.userId, library.libraryId, 'editor');

      const missingPermission = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(noPermissionUser.accessToken),
        payload: { title: 'Should Fail' },
      });
      expect(missingPermission.statusCode).toBe(403);

      const missingAccess = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(withPermissionUser.accessToken),
        payload: { title: 'Should Fail Access' },
      });
      expect(missingAccess.statusCode).toBe(403);

      await grantLibraryAccess(context, withPermissionUser.userId, library.libraryId, 'editor');

      const success = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(withPermissionUser.accessToken),
        payload: { title: 'Patch Access Success' },
      });
      expect(success.statusCode).toBe(200);
    });

    it('enforces permission and editor-level library access for sync endpoint', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'access/sync.pdf');
      await triggerAndWaitForLibraryScan(context, library.libraryId);

      const noPermissionUser = await createUserAndLogin(context);
      const withPermissionUser = await createUserAndLogin(context, {
        permissions: [Permission.LibraryEditMetadata],
      });

      await grantLibraryAccess(context, noPermissionUser.userId, library.libraryId, 'editor');

      const missingPermission = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files`,
        headers: authHeader(noPermissionUser.accessToken),
      });
      expect(missingPermission.statusCode).toBe(403);

      const noLibraryAccess = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files`,
        headers: authHeader(withPermissionUser.accessToken),
      });
      expect(noLibraryAccess.statusCode).toBe(403);

      await grantLibraryAccess(context, withPermissionUser.userId, library.libraryId, 'viewer');
      const viewerAccess = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files`,
        headers: authHeader(withPermissionUser.accessToken),
      });
      expect(viewerAccess.statusCode).toBe(403);

      await grantLibraryAccess(context, withPermissionUser.userId, library.libraryId, 'editor');
      const editorAccess = await context.app.inject({
        method: 'POST',
        url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files`,
        headers: authHeader(withPermissionUser.accessToken),
      });
      expect(editorAccess.statusCode).toBe(200);

      const events = parseSseEvents(editorAccess.body);
      const doneEvent = events.find(
        (event): event is Extract<LibraryFileSyncProgressEvent, { done: true }> => 'done' in event && event.done === true,
      );
      expect(doneEvent).toMatchObject({ processed: 1 });
    });
  });
});

async function prepareLibraryWithAllFormats(ctx: MetadataWriteE2EContext): Promise<PreparedLibraryResult> {
  const library = await createLibraryWithFolder(ctx, { mode: 'book_per_file' });

  await Promise.all([
    createPdfFixture(library.folderPath, 'all-formats/book.pdf', 'All Formats PDF Seed'),
    createEpubFixture(library.folderPath, 'all-formats/book.epub', { title: 'All Formats EPUB Seed' }),
    createCbzFixture(library.folderPath, 'all-formats/book.cbz', { title: 'All Formats CBZ Seed' }),
    createCb7Fixture(library.folderPath, 'all-formats/book.cb7', { title: 'All Formats CB7 Seed' }),
  ]);

  await triggerAndWaitForLibraryScan(ctx, library.libraryId);

  const [pdf, epub, cbz, cb7] = await Promise.all([
    locateBookFileByRelPath(ctx, library.libraryId, 'all-formats/book.pdf'),
    locateBookFileByRelPath(ctx, library.libraryId, 'all-formats/book.epub'),
    locateBookFileByRelPath(ctx, library.libraryId, 'all-formats/book.cbz'),
    locateBookFileByRelPath(ctx, library.libraryId, 'all-formats/book.cb7'),
  ]);

  return {
    libraryId: library.libraryId,
    books: { pdf, epub, cbz, cb7 },
  };
}

function parseSseEvents(rawBody: string): LibraryFileSyncProgressEvent[] {
  const events: LibraryFileSyncProgressEvent[] = [];

  for (const chunk of rawBody.split('\n\n')) {
    const line = chunk
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload) continue;
    events.push(JSON.parse(payload) as LibraryFileSyncProgressEvent);
  }

  return events;
}
