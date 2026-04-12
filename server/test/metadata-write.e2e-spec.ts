import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

import { eq } from 'drizzle-orm';
import { Permission, type LibraryFileSyncProgressEvent } from '@projectx/types';

import * as schema from '../src/db/schema';
import { BookService, type MetadataUpdateFailpoint } from '../src/modules/book/book.service';
import { FileWriteService } from '../src/modules/file-write/file-write.service';
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
  setLibraryFileWriteSettings,
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

interface ExpectedWritePayload {
  title: string;
  subtitle: string;
  description: string;
  publisher: string;
  publishedYear: number;
  language: string;
  pageCount: number;
  seriesName: string;
  seriesIndex: number;
  isbn10: string;
  isbn13: string;
  rating: number;
  authors: string[];
  genres: string[];
  tags: string[];
  googleBooksId: string;
  goodreadsId: string;
  amazonId: string;
  hardcoverId: string;
  openLibraryId: string;
  itunesId: string;
}

const MATRIX_SET_PAYLOAD = {
  title: 'Matrix Title',
  subtitle: 'Matrix Subtitle',
  description: 'Matrix Description',
  publisher: 'Matrix Publisher',
  publishedYear: 2007,
  language: 'en',
  pageCount: 321,
  seriesName: 'Matrix Series',
  seriesIndex: 3.5,
  isbn10: '123456789X',
  isbn13: '9781234567890',
  rating: 5,
  authors: ['Matrix Author A', 'Matrix Author B'],
  genres: ['Matrix Genre A', 'Matrix Genre B'],
  tags: ['MatrixTagA', 'MatrixTagB'],
  googleBooksId: 'gbook-123',
  goodreadsId: 'goodreads-123',
  amazonId: 'B00TEST123',
  hardcoverId: 'hardcover-123',
  openLibraryId: 'OL123W',
  itunesId: 'itunes-123',
} as const;

const MATRIX_CLEAR_PAYLOAD = {
  title: null,
  subtitle: null,
  description: null,
  publisher: null,
  publishedYear: null,
  language: null,
  pageCount: null,
  seriesName: null,
  seriesIndex: null,
  isbn10: null,
  isbn13: null,
  rating: null,
  authors: [],
  genres: [],
  tags: [],
  googleBooksId: null,
  goodreadsId: null,
  amazonId: null,
  hardcoverId: null,
  openLibraryId: null,
  itunesId: null,
} as const;

const METADATA_UPDATE_FAILPOINT_SEQUENCE: MetadataUpdateFailpoint[] = [
  'afterScalarUpdate',
  'afterComicMetadataUpsert',
  'afterAuthorsReplace',
  'afterNarratorsReplace',
  'afterGenresReplace',
  'afterTagsReplace',
  'beforeTransactionCommit',
];

const ATOMICITY_BASELINE_PAYLOAD = {
  title: 'Atomic Baseline Title',
  subtitle: 'Atomic Baseline Subtitle',
  description: 'Atomic Baseline Description',
  publisher: 'Atomic Baseline Publisher',
  publishedYear: 2001,
  language: 'en',
  pageCount: 111,
  seriesName: 'Atomic Baseline Series',
  seriesIndex: 1.5,
  isbn10: '1111111111',
  isbn13: '9781111111111',
  rating: 4,
  authors: ['Atomic Baseline Author A', 'Atomic Baseline Author B'],
  genres: ['Atomic Baseline Genre'],
  tags: ['AtomicBaselineTag'],
  googleBooksId: 'atomic-baseline-google',
  goodreadsId: 'atomic-baseline-goodreads',
  amazonId: 'ATOMICBASE01',
  hardcoverId: 'atomic-baseline-hardcover',
  openLibraryId: 'ATOMICBASE-OL',
  itunesId: 'atomic-baseline-itunes',
  audibleId: 'ATOMICBASEAUD',
  comicvineId: 'atomic-baseline-comicvine',
  audioMetadata: {
    narrators: ['Atomic Baseline Narrator'],
    durationSeconds: 4200,
    abridged: true,
    chapters: [{ title: 'Atomic Baseline Chapter', startMs: 0 }],
  },
  comicMetadata: {
    issueNumber: '1',
    volumeName: 'Atomic Baseline Volume',
    pencillers: ['Atomic Baseline Penciller'],
    inkers: ['Atomic Baseline Inker'],
    colorists: ['Atomic Baseline Colorist'],
    letterers: ['Atomic Baseline Letterer'],
    coverArtists: ['Atomic Baseline CoverArtist'],
    characters: ['Atomic Baseline Character'],
    teams: ['Atomic Baseline Team'],
    locations: ['Atomic Baseline Location'],
    storyArcs: ['Atomic Baseline StoryArc'],
  },
} as const;

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

  afterEach(async (taskContext) => {
    if (context) {
      context.app.get(BookService).clearMetadataUpdateFailpointForTests();
      await drainScheduledFileWrites(context);
    }

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

  beforeEach(() => {
    scenarioStartedAt = Date.now();
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

    it('applies clear semantics for scalar and relational metadata through PATCH /books/:id/metadata', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'db-clear/book.pdf');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'db-clear/book.pdf');

      const setResponse = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: MATRIX_SET_PAYLOAD,
      });
      expect(setResponse.statusCode).toBe(200);

      const clearResponse = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: MATRIX_CLEAR_PAYLOAD,
      });
      expect(clearResponse.statusCode).toBe(200);

      const [metadata] = await context.db
        .select({
          title: schema.bookMetadata.title,
          subtitle: schema.bookMetadata.subtitle,
          description: schema.bookMetadata.description,
          publisher: schema.bookMetadata.publisher,
          publishedYear: schema.bookMetadata.publishedYear,
          language: schema.bookMetadata.language,
          pageCount: schema.bookMetadata.pageCount,
          seriesName: schema.bookMetadata.seriesName,
          seriesIndex: schema.bookMetadata.seriesIndex,
          isbn10: schema.bookMetadata.isbn10,
          isbn13: schema.bookMetadata.isbn13,
          rating: schema.bookMetadata.rating,
          googleBooksId: schema.bookMetadata.googleBooksId,
          goodreadsId: schema.bookMetadata.goodreadsId,
          amazonId: schema.bookMetadata.amazonId,
          hardcoverId: schema.bookMetadata.hardcoverId,
          openLibraryId: schema.bookMetadata.openLibraryId,
          itunesId: schema.bookMetadata.itunesId,
        })
        .from(schema.bookMetadata)
        .where(eq(schema.bookMetadata.bookId, book.bookId))
        .limit(1);

      expect(metadata).toMatchObject({
        title: null,
        subtitle: null,
        description: null,
        publisher: null,
        publishedYear: null,
        language: null,
        pageCount: null,
        seriesName: null,
        seriesIndex: null,
        isbn10: null,
        isbn13: null,
        rating: null,
        googleBooksId: null,
        goodreadsId: null,
        amazonId: null,
        hardcoverId: null,
        openLibraryId: null,
        itunesId: null,
      });

      const [authorRows, genreRows, tagRows] = await Promise.all([
        context.db.select({ bookId: schema.bookAuthors.bookId }).from(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, book.bookId)),
        context.db.select({ bookId: schema.bookGenres.bookId }).from(schema.bookGenres).where(eq(schema.bookGenres.bookId, book.bookId)),
        context.db.select({ bookId: schema.bookTags.bookId }).from(schema.bookTags).where(eq(schema.bookTags.bookId, book.bookId)),
      ]);

      expect(authorRows).toHaveLength(0);
      expect(genreRows).toHaveLength(0);
      expect(tagRows).toHaveLength(0);
    });
  });

  describe('atomicity failpoints', () => {
    it('rolls back metadata mutations for each failpoint stage', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'atomicity/book.pdf', 'Atomicity Seed PDF');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'atomicity/book.pdf');

      const baselineResponse = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${book.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: ATOMICITY_BASELINE_PAYLOAD,
      });
      expect(baselineResponse.statusCode).toBe(200);

      const baselineState = await readMetadataMutationState(context, book.bookId);
      const bookService = context.app.get(BookService);

      for (const failpoint of METADATA_UPDATE_FAILPOINT_SEQUENCE) {
        bookService.setMetadataUpdateFailpointForTests(failpoint);

        const failureResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: buildAtomicityFailurePayload(failpoint),
        });
        expect(failureResponse.statusCode).toBe(500);

        const afterFailureState = await readMetadataMutationState(context, book.bookId);
        expect(afterFailureState).toEqual(baselineState);
      }
    });
  });

  describe('auto-write on metadata patch', () => {
    it('writes PDF metadata to disk and records auto write-log entry', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file', fileWriteEnabled: true });
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

      const parsedPdf = await parsePdfFile(book.absolutePath, { extractCover: false });
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
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file', fileWriteEnabled: true });
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
      const prepared = await prepareLibraryWithAllFormats(context, { fileWriteCbxEnabled: true });

      for (const format of Object.keys(prepared.books) as SupportedFormat[]) {
        const book = prepared.books[format];
        const patchResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: MATRIX_SET_PAYLOAD,
        });
        expect(patchResponse.statusCode).toBe(200);
      }

      await drainScheduledFileWrites(context);

      await setLibraryFileWriteSettings(context.db, prepared.libraryId, {
        fileWriteEnabled: true,
        fileWriteWriteCover: false,
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
        if (format === 'cbz' || format === 'cb7') {
          expect(logEntry?.fieldsWritten ?? []).not.toContain('itunesId');
        } else {
          expect(logEntry?.fieldsWritten ?? []).toContain('itunesId');
        }
      }

      const parsedPdf = await parsePdfFile(prepared.books.pdf.absolutePath, { extractCover: false });
      expect(parsedPdf).toMatchObject({
        title: MATRIX_SET_PAYLOAD.title,
        subtitle: MATRIX_SET_PAYLOAD.subtitle,
        description: MATRIX_SET_PAYLOAD.description,
        publisher: MATRIX_SET_PAYLOAD.publisher,
        publishedYear: MATRIX_SET_PAYLOAD.publishedYear,
        language: MATRIX_SET_PAYLOAD.language,
        pageCount: MATRIX_SET_PAYLOAD.pageCount,
        seriesName: MATRIX_SET_PAYLOAD.seriesName,
        seriesIndex: MATRIX_SET_PAYLOAD.seriesIndex,
        isbn10: MATRIX_SET_PAYLOAD.isbn10,
        isbn13: MATRIX_SET_PAYLOAD.isbn13,
        rating: MATRIX_SET_PAYLOAD.rating,
        googleBooksId: MATRIX_SET_PAYLOAD.googleBooksId,
        goodreadsId: MATRIX_SET_PAYLOAD.goodreadsId,
        amazonId: MATRIX_SET_PAYLOAD.amazonId,
        hardcoverId: MATRIX_SET_PAYLOAD.hardcoverId,
        openLibraryId: MATRIX_SET_PAYLOAD.openLibraryId,
        itunesId: MATRIX_SET_PAYLOAD.itunesId,
      });
      expect(parsedPdf?.authors.map((author) => author.name)).toEqual(MATRIX_SET_PAYLOAD.authors);
      expect(parsedPdf?.genres).toEqual(MATRIX_SET_PAYLOAD.genres);
      expect(parsedPdf?.tags).toEqual(MATRIX_SET_PAYLOAD.tags);

      const parsedEpub = await extractEpubMetadata(prepared.books.epub.absolutePath);
      expect(parsedEpub).toMatchObject({
        title: MATRIX_SET_PAYLOAD.title,
        subtitle: MATRIX_SET_PAYLOAD.subtitle,
        description: MATRIX_SET_PAYLOAD.description,
        publisher: MATRIX_SET_PAYLOAD.publisher,
        publishedYear: MATRIX_SET_PAYLOAD.publishedYear,
        language: MATRIX_SET_PAYLOAD.language,
        pageCount: MATRIX_SET_PAYLOAD.pageCount,
        seriesName: MATRIX_SET_PAYLOAD.seriesName,
        seriesIndex: MATRIX_SET_PAYLOAD.seriesIndex,
        isbn10: MATRIX_SET_PAYLOAD.isbn10,
        isbn13: MATRIX_SET_PAYLOAD.isbn13,
        rating: MATRIX_SET_PAYLOAD.rating,
        googleBooksId: MATRIX_SET_PAYLOAD.googleBooksId,
        goodreadsId: MATRIX_SET_PAYLOAD.goodreadsId,
        amazonId: MATRIX_SET_PAYLOAD.amazonId,
        hardcoverId: MATRIX_SET_PAYLOAD.hardcoverId,
        openLibraryId: MATRIX_SET_PAYLOAD.openLibraryId,
        itunesId: MATRIX_SET_PAYLOAD.itunesId,
      });
      expect(parsedEpub?.authors.map((author) => author.name)).toEqual(MATRIX_SET_PAYLOAD.authors);
      expect(parsedEpub?.genres).toEqual(MATRIX_SET_PAYLOAD.genres);
      expect(parsedEpub?.tags).toEqual(MATRIX_SET_PAYLOAD.tags);

      const parsedCbz = await extractCbzMetadata(prepared.books.cbz.absolutePath);
      expect(parsedCbz).toMatchObject({
        title: MATRIX_SET_PAYLOAD.title,
        subtitle: MATRIX_SET_PAYLOAD.subtitle,
        description: MATRIX_SET_PAYLOAD.description,
        publisher: MATRIX_SET_PAYLOAD.publisher,
        publishedYear: MATRIX_SET_PAYLOAD.publishedYear,
        language: MATRIX_SET_PAYLOAD.language,
        pageCount: MATRIX_SET_PAYLOAD.pageCount,
        seriesName: MATRIX_SET_PAYLOAD.seriesName,
        seriesIndex: MATRIX_SET_PAYLOAD.seriesIndex,
        isbn10: MATRIX_SET_PAYLOAD.isbn10,
        isbn13: MATRIX_SET_PAYLOAD.isbn13,
        rating: MATRIX_SET_PAYLOAD.rating,
        googleBooksId: MATRIX_SET_PAYLOAD.googleBooksId,
        goodreadsId: MATRIX_SET_PAYLOAD.goodreadsId,
        amazonId: MATRIX_SET_PAYLOAD.amazonId,
        hardcoverId: MATRIX_SET_PAYLOAD.hardcoverId,
        openLibraryId: MATRIX_SET_PAYLOAD.openLibraryId,
        itunesId: null,
      });
      expect(parsedCbz?.authors.map((author) => author.name)).toEqual(MATRIX_SET_PAYLOAD.authors);
      expect(parsedCbz?.genres).toEqual(MATRIX_SET_PAYLOAD.genres);
      expect(parsedCbz?.tags).toEqual(MATRIX_SET_PAYLOAD.tags);

      const parsedCb7 = await extractCb7Metadata(prepared.books.cb7.absolutePath);
      expect(parsedCb7).toMatchObject({
        title: MATRIX_SET_PAYLOAD.title,
        subtitle: MATRIX_SET_PAYLOAD.subtitle,
        description: MATRIX_SET_PAYLOAD.description,
        publisher: MATRIX_SET_PAYLOAD.publisher,
        publishedYear: MATRIX_SET_PAYLOAD.publishedYear,
        language: MATRIX_SET_PAYLOAD.language,
        pageCount: MATRIX_SET_PAYLOAD.pageCount,
        seriesName: MATRIX_SET_PAYLOAD.seriesName,
        seriesIndex: MATRIX_SET_PAYLOAD.seriesIndex,
        isbn10: MATRIX_SET_PAYLOAD.isbn10,
        isbn13: MATRIX_SET_PAYLOAD.isbn13,
        rating: MATRIX_SET_PAYLOAD.rating,
        googleBooksId: MATRIX_SET_PAYLOAD.googleBooksId,
        goodreadsId: MATRIX_SET_PAYLOAD.goodreadsId,
        amazonId: MATRIX_SET_PAYLOAD.amazonId,
        hardcoverId: MATRIX_SET_PAYLOAD.hardcoverId,
        openLibraryId: MATRIX_SET_PAYLOAD.openLibraryId,
        itunesId: null,
      });
      expect(parsedCb7?.authors.map((author) => author.name)).toEqual(MATRIX_SET_PAYLOAD.authors);
      expect(parsedCb7?.genres).toEqual(MATRIX_SET_PAYLOAD.genres);
      expect(parsedCb7?.tags).toEqual(MATRIX_SET_PAYLOAD.tags);
    });

    it('clears supported metadata in DB and files across all formats', async () => {
      const prepared = await prepareLibraryWithAllFormats(context, { fileWriteCbxEnabled: true });

      for (const format of Object.keys(prepared.books) as SupportedFormat[]) {
        const book = prepared.books[format];

        const setResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: MATRIX_SET_PAYLOAD,
        });
        expect(setResponse.statusCode).toBe(200);

        const clearResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: MATRIX_CLEAR_PAYLOAD,
        });
        expect(clearResponse.statusCode).toBe(200);
      }

      for (const format of Object.keys(prepared.books) as SupportedFormat[]) {
        const book = prepared.books[format];

        const [metadata] = await context.db
          .select({
            title: schema.bookMetadata.title,
            subtitle: schema.bookMetadata.subtitle,
            description: schema.bookMetadata.description,
            publisher: schema.bookMetadata.publisher,
            publishedYear: schema.bookMetadata.publishedYear,
            language: schema.bookMetadata.language,
            pageCount: schema.bookMetadata.pageCount,
            seriesName: schema.bookMetadata.seriesName,
            seriesIndex: schema.bookMetadata.seriesIndex,
            isbn10: schema.bookMetadata.isbn10,
            isbn13: schema.bookMetadata.isbn13,
            rating: schema.bookMetadata.rating,
            googleBooksId: schema.bookMetadata.googleBooksId,
            goodreadsId: schema.bookMetadata.goodreadsId,
            amazonId: schema.bookMetadata.amazonId,
            hardcoverId: schema.bookMetadata.hardcoverId,
            openLibraryId: schema.bookMetadata.openLibraryId,
            itunesId: schema.bookMetadata.itunesId,
          })
          .from(schema.bookMetadata)
          .where(eq(schema.bookMetadata.bookId, book.bookId))
          .limit(1);

        expect(metadata).toMatchObject({
          title: null,
          subtitle: null,
          description: null,
          publisher: null,
          publishedYear: null,
          language: null,
          pageCount: null,
          seriesName: null,
          seriesIndex: null,
          isbn10: null,
          isbn13: null,
          rating: null,
          googleBooksId: null,
          goodreadsId: null,
          amazonId: null,
          hardcoverId: null,
          openLibraryId: null,
          itunesId: null,
        });

        const [authorRows, genreRows, tagRows] = await Promise.all([
          context.db.select({ bookId: schema.bookAuthors.bookId }).from(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, book.bookId)),
          context.db.select({ bookId: schema.bookGenres.bookId }).from(schema.bookGenres).where(eq(schema.bookGenres.bookId, book.bookId)),
          context.db.select({ bookId: schema.bookTags.bookId }).from(schema.bookTags).where(eq(schema.bookTags.bookId, book.bookId)),
        ]);

        expect(authorRows).toHaveLength(0);
        expect(genreRows).toHaveLength(0);
        expect(tagRows).toHaveLength(0);
      }

      await drainScheduledFileWrites(context);

      await setLibraryFileWriteSettings(context.db, prepared.libraryId, {
        fileWriteEnabled: true,
        fileWriteWriteCover: false,
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

      const parsedPdf = await parsePdfFile(prepared.books.pdf.absolutePath, { extractCover: false });
      expect(parsedPdf).toMatchObject({
        title: null,
        subtitle: null,
        description: null,
        publisher: null,
        publishedYear: null,
        language: null,
        pageCount: null,
        seriesName: null,
        seriesIndex: null,
        isbn10: null,
        isbn13: null,
        rating: null,
        googleBooksId: null,
        goodreadsId: null,
        amazonId: null,
        hardcoverId: null,
        openLibraryId: null,
        itunesId: null,
      });
      expect(parsedPdf?.authors).toEqual([]);
      expect(parsedPdf?.genres).toEqual([]);
      expect(parsedPdf?.tags).toEqual([]);

      const parsedEpub = await extractEpubMetadata(prepared.books.epub.absolutePath);
      expect(parsedEpub).toMatchObject({
        title: null,
        subtitle: null,
        description: null,
        publisher: null,
        publishedYear: null,
        language: null,
        pageCount: null,
        seriesName: null,
        seriesIndex: null,
        isbn10: null,
        isbn13: null,
        rating: null,
        googleBooksId: null,
        goodreadsId: null,
        amazonId: null,
        hardcoverId: null,
        openLibraryId: null,
        itunesId: null,
      });
      expect(parsedEpub?.authors).toEqual([]);
      expect(parsedEpub?.genres).toEqual([]);
      expect(parsedEpub?.tags).toEqual([]);

      const parsedCbz = await extractCbzMetadata(prepared.books.cbz.absolutePath);
      expect(parsedCbz).toMatchObject({
        title: null,
        subtitle: null,
        description: null,
        publisher: null,
        publishedYear: null,
        language: null,
        pageCount: null,
        seriesName: null,
        seriesIndex: null,
        isbn10: null,
        isbn13: null,
        rating: null,
        googleBooksId: null,
        goodreadsId: null,
        amazonId: null,
        hardcoverId: null,
        openLibraryId: null,
        itunesId: null,
      });
      expect(parsedCbz?.authors).toEqual([]);
      expect(parsedCbz?.genres).toEqual([]);
      expect(parsedCbz?.tags).toEqual([]);

      const parsedCb7 = await extractCb7Metadata(prepared.books.cb7.absolutePath);
      expect(parsedCb7).toMatchObject({
        title: null,
        subtitle: null,
        description: null,
        publisher: null,
        publishedYear: null,
        language: null,
        pageCount: null,
        seriesName: null,
        seriesIndex: null,
        isbn10: null,
        isbn13: null,
        rating: null,
        googleBooksId: null,
        goodreadsId: null,
        amazonId: null,
        hardcoverId: null,
        openLibraryId: null,
        itunesId: null,
      });
      expect(parsedCb7?.authors).toEqual([]);
      expect(parsedCb7?.genres).toEqual([]);
      expect(parsedCb7?.tags).toEqual([]);
    });

    it('supports dry-run sync and records skipped write-log entries', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      await createPdfFixture(library.folderPath, 'dry-run/book.pdf');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'dry-run/book.pdf');

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

      await drainScheduledFileWrites(context);

      await setLibraryFileWriteSettings(context.db, library.libraryId, { fileWriteEnabled: true });

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

      await drainScheduledFileWrites(context);

      await setLibraryFileWriteSettings(context.db, library.libraryId, { fileWriteEnabled: true, fileWriteCbxEnabled: true });

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

      const parsedPdf = await parsePdfFile(okBook.absolutePath, { extractCover: false });
      expect(parsedPdf?.title).toBe('Failure Isolation Success');
    });
  });

  describe('concurrency hardening', () => {
    it('resolves parallel PATCH conflicts to one complete payload shape', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file', fileWriteEnabled: true });
      await createPdfFixture(library.folderPath, 'concurrency/parallel-patch.pdf', 'Parallel Patch Seed');
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'concurrency/parallel-patch.pdf');

      const payloadA = {
        title: 'Parallel Patch Title A',
        subtitle: 'Parallel Patch Subtitle A',
        description: 'Parallel Patch Description A',
        publisher: 'Parallel Patch Publisher A',
        publishedYear: 2003,
        language: 'en',
        pageCount: 203,
        seriesName: 'Parallel Patch Series A',
        seriesIndex: 1.1,
        isbn10: '1234500001',
        isbn13: '9781234500001',
        rating: 4,
        authors: ['Parallel Patch Author A1', 'Parallel Patch Author A2'],
        genres: ['Parallel Patch Genre A'],
        tags: ['ParallelPatchTagA'],
        googleBooksId: 'parallel-a-google',
        goodreadsId: 'parallel-a-goodreads',
        amazonId: 'PARALLELA01',
        hardcoverId: 'parallel-a-hardcover',
        openLibraryId: 'PARALLELA-OL',
        itunesId: 'parallel-a-itunes',
      } as const;

      const payloadB = {
        title: 'Parallel Patch Title B',
        subtitle: 'Parallel Patch Subtitle B',
        description: 'Parallel Patch Description B',
        publisher: 'Parallel Patch Publisher B',
        publishedYear: 2004,
        language: 'fr',
        pageCount: 204,
        seriesName: 'Parallel Patch Series B',
        seriesIndex: 2.2,
        isbn10: '1234500002',
        isbn13: '9781234500002',
        rating: 5,
        authors: ['Parallel Patch Author B1', 'Parallel Patch Author B2'],
        genres: ['Parallel Patch Genre B'],
        tags: ['ParallelPatchTagB'],
        googleBooksId: 'parallel-b-google',
        goodreadsId: 'parallel-b-goodreads',
        amazonId: 'PARALLELB02',
        hardcoverId: 'parallel-b-hardcover',
        openLibraryId: 'PARALLELB-OL',
        itunesId: 'parallel-b-itunes',
      } as const;

      const [responseA, responseB] = await Promise.all([
        context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: payloadA,
        }),
        context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: payloadB,
        }),
      ]);

      expect(responseA.statusCode).toBe(200);
      expect(responseB.statusCode).toBe(200);

      await waitForWriteLogEntry(context.db, book.bookId, {
        triggeredBy: 'auto',
        status: 'success',
        timeoutMs: 20_000,
      });

      const dbState = await readBookWriteState(context, book.bookId);
      const winningPayload = matchesBookWriteState(dbState, payloadA) ? payloadA : matchesBookWriteState(dbState, payloadB) ? payloadB : null;
      expect(winningPayload).not.toBeNull();

      const parsedPdf = await parsePdfFile(book.absolutePath, { extractCover: false });
      expect(parsedPdf).toMatchObject({
        title: winningPayload!.title,
        subtitle: winningPayload!.subtitle,
        description: winningPayload!.description,
        publisher: winningPayload!.publisher,
        publishedYear: winningPayload!.publishedYear,
        language: winningPayload!.language,
        pageCount: winningPayload!.pageCount,
        seriesName: winningPayload!.seriesName,
        seriesIndex: winningPayload!.seriesIndex,
        isbn10: winningPayload!.isbn10,
        isbn13: winningPayload!.isbn13,
        rating: winningPayload!.rating,
        googleBooksId: winningPayload!.googleBooksId,
        goodreadsId: winningPayload!.goodreadsId,
        amazonId: winningPayload!.amazonId,
        hardcoverId: winningPayload!.hardcoverId,
        openLibraryId: winningPayload!.openLibraryId,
        itunesId: winningPayload!.itunesId,
      });
      expect(parsedPdf?.authors.map((author) => author.name)).toEqual(winningPayload!.authors);
      expect(parsedPdf?.genres).toEqual(winningPayload!.genres);
      expect(parsedPdf?.tags).toEqual(winningPayload!.tags);
    });

    it('converges to latest PATCH state when PATCH overlaps with sync run', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });
      const relPaths = ['concurrency/overlap/a.pdf', 'concurrency/overlap/b.pdf', 'concurrency/overlap/c.pdf', 'concurrency/overlap/d.pdf'];
      await Promise.all(relPaths.map((relPath) => createPdfFixture(library.folderPath, relPath, `Overlap Seed ${relPath}`)));
      await triggerAndWaitForLibraryScan(context, library.libraryId);

      const books = await Promise.all(relPaths.map((relPath) => locateBookFileByRelPath(context, library.libraryId, relPath)));
      const targetBook = books[0]!;

      for (const located of books) {
        const seedResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${located.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: {
            title: `Overlap Seed ${located.bookId}`,
            authors: ['Overlap Seed Author'],
            tags: ['OverlapSeedTag'],
          },
        });
        expect(seedResponse.statusCode).toBe(200);
      }

      await drainScheduledFileWrites(context);

      await setLibraryFileWriteSettings(context.db, library.libraryId, {
        fileWriteEnabled: true,
        fileWriteWriteCover: false,
      });

      const overlapPayload = {
        title: 'Overlap Final Title',
        subtitle: 'Overlap Final Subtitle',
        description: 'Overlap Final Description',
        publisher: 'Overlap Final Publisher',
        publishedYear: 2017,
        language: 'es',
        pageCount: 417,
        seriesName: 'Overlap Final Series',
        seriesIndex: 7.7,
        isbn10: '7654321098',
        isbn13: '9787654321098',
        rating: 5,
        authors: ['Overlap Final Author A', 'Overlap Final Author B'],
        genres: ['Overlap Final Genre'],
        tags: ['OverlapFinalTag'],
        googleBooksId: 'overlap-google',
        goodreadsId: 'overlap-goodreads',
        amazonId: 'OVERLAP017',
        hardcoverId: 'overlap-hardcover',
        openLibraryId: 'OVERLAP-OL',
        itunesId: 'overlap-itunes',
      } as const;

      const fileWriteService = context.app.get(FileWriteService);
      const originalWriteToFile = fileWriteService.writeToFile.bind(fileWriteService);
      let releaseFirstSyncWrite!: () => void;
      let resolveFirstSyncWriteStarted!: () => void;
      const firstSyncWriteStarted = new Promise<void>((resolve) => {
        resolveFirstSyncWriteStarted = resolve;
      });
      const releaseFirstSyncWritePromise = new Promise<void>((resolve) => {
        releaseFirstSyncWrite = resolve;
      });
      let blockedFirstSyncWrite = false;
      let releasedFirstSyncWrite = false;

      const writeSpy = vi
        .spyOn(fileWriteService, 'writeToFile')
        .mockImplementation(async (bookId: number, triggeredBy: 'auto' | 'sync', userId?: number, dryRun?: boolean) => {
          if (triggeredBy === 'sync' && !blockedFirstSyncWrite) {
            blockedFirstSyncWrite = true;
            resolveFirstSyncWriteStarted();
            await releaseFirstSyncWritePromise;
          }
          return originalWriteToFile(bookId, triggeredBy, userId, dryRun);
        });

      let syncResponse!: Awaited<ReturnType<typeof context.app.inject>>;
      try {
        const syncPromise = context.app.inject({
          method: 'POST',
          url: `/api/v1/libraries/${library.libraryId}/write-metadata-to-files`,
          headers: authHeader(context.adminToken),
        });

        await firstSyncWriteStarted;

        const patchResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${targetBook.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: overlapPayload,
        });
        expect(patchResponse.statusCode).toBe(200);

        releasedFirstSyncWrite = true;
        releaseFirstSyncWrite();
        syncResponse = await syncPromise;
      } finally {
        if (blockedFirstSyncWrite && !releasedFirstSyncWrite) {
          releaseFirstSyncWrite();
        }
        writeSpy.mockRestore();
      }

      expect(syncResponse.statusCode).toBe(200);
      const syncEvents = parseSseEvents(syncResponse.body);
      const doneEvent = syncEvents.find(
        (event): event is Extract<LibraryFileSyncProgressEvent, { done: true }> => 'done' in event && event.done === true,
      );
      expect(doneEvent).toMatchObject({ processed: books.length, failed: 0 });

      await waitForWriteLogEntry(context.db, targetBook.bookId, {
        triggeredBy: 'auto',
        status: 'success',
        timeoutMs: 20_000,
      });

      const targetState = await readBookWriteState(context, targetBook.bookId);
      expect(matchesBookWriteState(targetState, overlapPayload)).toBe(true);

      const parsedPdf = await parsePdfFile(targetBook.absolutePath, { extractCover: false });
      expect(parsedPdf).toMatchObject({
        title: overlapPayload.title,
        subtitle: overlapPayload.subtitle,
        description: overlapPayload.description,
        publisher: overlapPayload.publisher,
        publishedYear: overlapPayload.publishedYear,
        language: overlapPayload.language,
        pageCount: overlapPayload.pageCount,
        seriesName: overlapPayload.seriesName,
        seriesIndex: overlapPayload.seriesIndex,
        isbn10: overlapPayload.isbn10,
        isbn13: overlapPayload.isbn13,
        rating: overlapPayload.rating,
        googleBooksId: overlapPayload.googleBooksId,
        goodreadsId: overlapPayload.goodreadsId,
        amazonId: overlapPayload.amazonId,
        hardcoverId: overlapPayload.hardcoverId,
        openLibraryId: overlapPayload.openLibraryId,
        itunesId: overlapPayload.itunesId,
      });
      expect(parsedPdf?.authors.map((author) => author.name)).toEqual(overlapPayload.authors);
      expect(parsedPdf?.genres).toEqual(overlapPayload.genres);
      expect(parsedPdf?.tags).toEqual(overlapPayload.tags);
    });

    it('allows concurrent sync runs on the same library with consistent outcomes', async () => {
      const prepared = await prepareLibraryWithAllFormats(context, { fileWriteCbxEnabled: true, fileWriteWriteCover: false });

      for (const format of Object.keys(prepared.books) as SupportedFormat[]) {
        const book = prepared.books[format];
        const patchResponse = await context.app.inject({
          method: 'PATCH',
          url: `/api/v1/books/${book.bookId}/metadata`,
          headers: authHeader(context.adminToken),
          payload: MATRIX_SET_PAYLOAD,
        });
        expect(patchResponse.statusCode).toBe(200);
      }

      await drainScheduledFileWrites(context);

      await setLibraryFileWriteSettings(context.db, prepared.libraryId, { fileWriteEnabled: true });

      const [syncA, syncB] = await Promise.all([
        context.app.inject({
          method: 'POST',
          url: `/api/v1/libraries/${prepared.libraryId}/write-metadata-to-files`,
          headers: authHeader(context.adminToken),
        }),
        context.app.inject({
          method: 'POST',
          url: `/api/v1/libraries/${prepared.libraryId}/write-metadata-to-files`,
          headers: authHeader(context.adminToken),
        }),
      ]);

      expect(syncA.statusCode).toBe(200);
      expect(syncB.statusCode).toBe(200);

      const doneA = parseSseEvents(syncA.body).find(
        (event): event is Extract<LibraryFileSyncProgressEvent, { done: true }> => 'done' in event && event.done === true,
      );
      const doneB = parseSseEvents(syncB.body).find(
        (event): event is Extract<LibraryFileSyncProgressEvent, { done: true }> => 'done' in event && event.done === true,
      );
      expect(doneA).toMatchObject({ processed: 4, succeeded: 4, failed: 0, skipped: 0 });
      expect(doneB).toMatchObject({ processed: 4, succeeded: 4, failed: 0, skipped: 0 });

      for (const format of Object.keys(prepared.books) as SupportedFormat[]) {
        const book = prepared.books[format];
        const syncSuccessLogs = await countSyncSuccessLogs(context, book.bookId);
        expect(syncSuccessLogs).toBe(2);
      }
    });
  });

  describe('per-library file write settings', () => {
    it('only auto-writes for the library that has file write enabled', async () => {
      const enabledLibrary = await createLibraryWithFolder(context, { mode: 'book_per_file', fileWriteEnabled: true });
      const disabledLibrary = await createLibraryWithFolder(context, { mode: 'book_per_file' });

      await createPdfFixture(enabledLibrary.folderPath, 'per-library/enabled.pdf');
      await createPdfFixture(disabledLibrary.folderPath, 'per-library/disabled.pdf');
      await triggerAndWaitForLibraryScan(context, enabledLibrary.libraryId);
      await triggerAndWaitForLibraryScan(context, disabledLibrary.libraryId);

      const enabledBook = await locateBookFileByRelPath(context, enabledLibrary.libraryId, 'per-library/enabled.pdf');
      const disabledBook = await locateBookFileByRelPath(context, disabledLibrary.libraryId, 'per-library/disabled.pdf');

      await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${enabledBook.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: { title: 'Enabled Library Book' },
      });
      await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/books/${disabledBook.bookId}/metadata`,
        headers: authHeader(context.adminToken),
        payload: { title: 'Disabled Library Book' },
      });

      const enabledLog = await waitForWriteLogEntry(context.db, enabledBook.bookId, {
        triggeredBy: 'auto',
        status: 'success',
      });
      expect(enabledLog.format).toBe('pdf');

      const disabledLog = await getLatestWriteLogEntry(context.db, disabledBook.bookId, 'auto');
      expect(disabledLog).toBeNull();
    });

    it('skips cbz book when cbx format is disabled for the library', async () => {
      const library = await createLibraryWithFolder(context, {
        mode: 'book_per_file',
        fileWriteEnabled: true,
        fileWriteCbxEnabled: false,
      });
      await createCbzFixture(library.folderPath, 'per-format/book.cbz', { title: 'CBX Disabled' });
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'per-format/book.cbz');

      await setLibraryFileWriteSettings(context.db, library.libraryId, { fileWriteEnabled: true, fileWriteCbxEnabled: false });

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
      expect(doneEvent).toMatchObject({ processed: 1, succeeded: 0, failed: 0, skipped: 1 });

      const logEntry = await getLatestWriteLogEntry(context.db, book.bookId, 'sync');
      expect(logEntry?.status).toBe('skipped');
      expect(logEntry?.errorMessage).toBe('format disabled');
    });

    it('skips epub book when epub exceeds per-library max file size', async () => {
      const library = await createLibraryWithFolder(context, {
        mode: 'book_per_file',
        fileWriteEnabled: true,
        fileWriteEpubMaxFileSizeMb: 1,
      });

      await createEpubFixture(library.folderPath, 'per-size/book.epub', { title: 'Large EPUB' });
      await triggerAndWaitForLibraryScan(context, library.libraryId);
      const book = await locateBookFileByRelPath(context, library.libraryId, 'per-size/book.epub');

      const [fileRow] = await context.db
        .select({ sizeBytes: schema.bookFiles.sizeBytes })
        .from(schema.bookFiles)
        .where(eq(schema.bookFiles.id, book.bookFileId))
        .limit(1);

      const fileSizeBytes = fileRow?.sizeBytes ?? 0;
      const limitBytes = 1 * 1024 * 1024;

      if (fileSizeBytes <= limitBytes) {
        await context.db
          .update(schema.bookFiles)
          .set({ sizeBytes: limitBytes + 1 })
          .where(eq(schema.bookFiles.id, book.bookFileId));
      }

      await setLibraryFileWriteSettings(context.db, library.libraryId, { fileWriteEpubMaxFileSizeMb: 1 });

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
      expect(doneEvent).toMatchObject({ processed: 1, skipped: 1, succeeded: 0, failed: 0 });

      const logEntry = await getLatestWriteLogEntry(context.db, book.bookId, 'sync');
      expect(logEntry?.status).toBe('skipped');
      expect(logEntry?.errorMessage).toBe('file exceeds size limit');
    });

    it('persists file write settings when creating library via API', async () => {
      const folderPath = `${context.fixture.booksPath}/api-create-${randomUUID()}`;
      await mkdir(folderPath, { recursive: true });

      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/libraries',
        headers: authHeader(context.adminToken),
        payload: {
          name: `api-create-file-write-${randomUUID()}`,
          icon: 'BookOpen',
          folders: [folderPath],
          fileWriteEnabled: true,
          fileWriteWriteCover: false,
          fileWriteEpubEnabled: true,
          fileWriteEpubMaxFileSizeMb: 200,
          fileWritePdfEnabled: false,
          fileWritePdfMaxFileSizeMb: 50,
          fileWriteCbxEnabled: true,
          fileWriteCbxMaxFileSizeMb: 1000,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as Record<string, unknown>;
      expect(body.fileWriteEnabled).toBe(true);
      expect(body.fileWriteWriteCover).toBe(false);
      expect(body.fileWriteEpubEnabled).toBe(true);
      expect(body.fileWriteEpubMaxFileSizeMb).toBe(200);
      expect(body.fileWritePdfEnabled).toBe(false);
      expect(body.fileWritePdfMaxFileSizeMb).toBe(50);
      expect(body.fileWriteCbxEnabled).toBe(true);
      expect(body.fileWriteCbxMaxFileSizeMb).toBe(1000);
    });

    it('updates file write settings for an existing library via API', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });

      const response = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/libraries/${library.libraryId}`,
        headers: authHeader(context.adminToken),
        payload: {
          fileWriteEnabled: true,
          fileWriteCbxEnabled: true,
          fileWriteCbxMaxFileSizeMb: 750,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;
      expect(body.fileWriteEnabled).toBe(true);
      expect(body.fileWriteCbxEnabled).toBe(true);
      expect(body.fileWriteCbxMaxFileSizeMb).toBe(750);
    });

    it('rejects API call when max size is below minimum', async () => {
      const library = await createLibraryWithFolder(context, { mode: 'book_per_file' });

      const response = await context.app.inject({
        method: 'PATCH',
        url: `/api/v1/libraries/${library.libraryId}`,
        headers: authHeader(context.adminToken),
        payload: { fileWriteEpubMaxFileSizeMb: 0 },
      });

      expect(response.statusCode).toBe(400);
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

    it('returns 404 for sync requests targeting a missing library', async () => {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/v1/libraries/999999/write-metadata-to-files',
        headers: authHeader(context.adminToken),
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ message: 'Library not found' });
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
      await setLibraryFileWriteSettings(context.db, library.libraryId, { fileWriteEnabled: true });
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

async function prepareLibraryWithAllFormats(
  ctx: MetadataWriteE2EContext,
  fileWriteOptions: {
    fileWriteEnabled?: boolean;
    fileWriteWriteCover?: boolean;
    fileWriteCbxEnabled?: boolean;
  } = {},
): Promise<PreparedLibraryResult> {
  const library = await createLibraryWithFolder(ctx, { mode: 'book_per_file', ...fileWriteOptions });

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

async function drainScheduledFileWrites(context: MetadataWriteE2EContext): Promise<void> {
  await context.app.get(FileWriteService).drainScheduledWritesForTests();
}

function buildAtomicityFailurePayload(failpoint: MetadataUpdateFailpoint) {
  const token = failpoint
    .replace(/[^a-z]/gi, '')
    .toLowerCase()
    .slice(0, 10);
  return {
    title: `Atomic Failure Title ${token}`,
    subtitle: `Atomic Failure Subtitle ${token}`,
    description: `Atomic Failure Description ${token}`,
    publisher: `Atomic Failure Publisher ${token}`,
    publishedYear: 2020,
    language: 'de',
    pageCount: 520,
    seriesName: `Atomic Failure Series ${token}`,
    seriesIndex: 9.9,
    isbn10: '9999999999',
    isbn13: '9789999999999',
    rating: 2,
    authors: [`Atomic Failure Author ${token}`],
    genres: [`Atomic Failure Genre ${token}`],
    tags: [`AtomicFailureTag${token}`],
    googleBooksId: `atomic-fail-g-${token}`,
    goodreadsId: `atomic-fail-gr-${token}`,
    amazonId: `ATFAIL${token.slice(0, 5).toUpperCase()}`,
    hardcoverId: `atomic-fail-hc-${token}`,
    openLibraryId: `ATFAIL-${token.toUpperCase()}`,
    itunesId: `atomic-fail-it-${token}`,
    audibleId: `ATF${token.slice(0, 8).toUpperCase()}`,
    comicvineId: `atomic-fail-cv-${token}`,
    audioMetadata: {
      narrators: [`Atomic Failure Narrator ${token}`],
      durationSeconds: 777,
      abridged: false,
      chapters: [{ title: `Atomic Failure Chapter ${token}`, startMs: 1000 }],
    },
    comicMetadata: {
      issueNumber: '9',
      volumeName: `Atomic Failure Volume ${token}`,
      pencillers: [`Atomic Failure Penciller ${token}`],
      inkers: [`Atomic Failure Inker ${token}`],
      colorists: [`Atomic Failure Colorist ${token}`],
      letterers: [`Atomic Failure Letterer ${token}`],
      coverArtists: [`Atomic Failure CoverArtist ${token}`],
      characters: [`Atomic Failure Character ${token}`],
      teams: [`Atomic Failure Team ${token}`],
      locations: [`Atomic Failure Location ${token}`],
      storyArcs: [`Atomic Failure StoryArc ${token}`],
    },
  };
}

async function readMetadataMutationState(context: MetadataWriteE2EContext, bookId: number) {
  const [metadata, authors, genres, tags, narrators, comicRows] = await Promise.all([
    context.db
      .select({
        title: schema.bookMetadata.title,
        subtitle: schema.bookMetadata.subtitle,
        description: schema.bookMetadata.description,
        publisher: schema.bookMetadata.publisher,
        publishedYear: schema.bookMetadata.publishedYear,
        language: schema.bookMetadata.language,
        pageCount: schema.bookMetadata.pageCount,
        seriesName: schema.bookMetadata.seriesName,
        seriesIndex: schema.bookMetadata.seriesIndex,
        isbn10: schema.bookMetadata.isbn10,
        isbn13: schema.bookMetadata.isbn13,
        rating: schema.bookMetadata.rating,
        googleBooksId: schema.bookMetadata.googleBooksId,
        goodreadsId: schema.bookMetadata.goodreadsId,
        amazonId: schema.bookMetadata.amazonId,
        hardcoverId: schema.bookMetadata.hardcoverId,
        openLibraryId: schema.bookMetadata.openLibraryId,
        itunesId: schema.bookMetadata.itunesId,
        audibleId: schema.bookMetadata.audibleId,
        comicvineId: schema.bookMetadata.comicvineId,
        durationSeconds: schema.bookMetadata.durationSeconds,
        abridged: schema.bookMetadata.abridged,
        chapters: schema.bookMetadata.chapters,
      })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, bookId))
      .limit(1),
    context.db
      .select({ name: schema.authors.name })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(eq(schema.bookAuthors.bookId, bookId))
      .orderBy(schema.bookAuthors.displayOrder),
    context.db
      .select({ name: schema.genres.name })
      .from(schema.bookGenres)
      .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
      .where(eq(schema.bookGenres.bookId, bookId)),
    context.db
      .select({ name: schema.tags.name })
      .from(schema.bookTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.bookTags.tagId))
      .where(eq(schema.bookTags.bookId, bookId)),
    context.db
      .select({ name: schema.narrators.name })
      .from(schema.bookNarrators)
      .innerJoin(schema.narrators, eq(schema.narrators.id, schema.bookNarrators.narratorId))
      .where(eq(schema.bookNarrators.bookId, bookId))
      .orderBy(schema.bookNarrators.displayOrder),
    context.db.select().from(schema.comicMetadata).where(eq(schema.comicMetadata.bookId, bookId)).limit(1),
  ]);

  const comic = comicRows[0] ?? null;

  return {
    metadata: metadata[0] ?? null,
    authors: authors.map((row) => row.name),
    genres: genres.map((row) => row.name).sort(),
    tags: tags.map((row) => row.name).sort(),
    narrators: narrators.map((row) => row.name),
    comicMetadata: comic
      ? {
          issueNumber: comic.issueNumber ?? null,
          volumeName: comic.volumeName ?? null,
          pencillers: [...(comic.pencillers ?? [])].sort(),
          inkers: [...(comic.inkers ?? [])].sort(),
          colorists: [...(comic.colorists ?? [])].sort(),
          letterers: [...(comic.letterers ?? [])].sort(),
          coverArtists: [...(comic.coverArtists ?? [])].sort(),
          characters: [...(comic.characters ?? [])].sort(),
          teams: [...(comic.teams ?? [])].sort(),
          locations: [...(comic.locations ?? [])].sort(),
          storyArcs: [...(comic.storyArcs ?? [])].sort(),
        }
      : null,
  };
}

async function readBookWriteState(context: MetadataWriteE2EContext, bookId: number) {
  const [metadata, authors, genres, tags] = await Promise.all([
    context.db
      .select({
        title: schema.bookMetadata.title,
        subtitle: schema.bookMetadata.subtitle,
        description: schema.bookMetadata.description,
        publisher: schema.bookMetadata.publisher,
        publishedYear: schema.bookMetadata.publishedYear,
        language: schema.bookMetadata.language,
        pageCount: schema.bookMetadata.pageCount,
        seriesName: schema.bookMetadata.seriesName,
        seriesIndex: schema.bookMetadata.seriesIndex,
        isbn10: schema.bookMetadata.isbn10,
        isbn13: schema.bookMetadata.isbn13,
        rating: schema.bookMetadata.rating,
        googleBooksId: schema.bookMetadata.googleBooksId,
        goodreadsId: schema.bookMetadata.goodreadsId,
        amazonId: schema.bookMetadata.amazonId,
        hardcoverId: schema.bookMetadata.hardcoverId,
        openLibraryId: schema.bookMetadata.openLibraryId,
        itunesId: schema.bookMetadata.itunesId,
      })
      .from(schema.bookMetadata)
      .where(eq(schema.bookMetadata.bookId, bookId))
      .limit(1),
    context.db
      .select({ name: schema.authors.name })
      .from(schema.bookAuthors)
      .innerJoin(schema.authors, eq(schema.authors.id, schema.bookAuthors.authorId))
      .where(eq(schema.bookAuthors.bookId, bookId))
      .orderBy(schema.bookAuthors.displayOrder),
    context.db
      .select({ name: schema.genres.name })
      .from(schema.bookGenres)
      .innerJoin(schema.genres, eq(schema.genres.id, schema.bookGenres.genreId))
      .where(eq(schema.bookGenres.bookId, bookId)),
    context.db
      .select({ name: schema.tags.name })
      .from(schema.bookTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.bookTags.tagId))
      .where(eq(schema.bookTags.bookId, bookId)),
  ]);

  return {
    ...(metadata[0] ?? {}),
    authors: authors.map((row) => row.name),
    genres: genres.map((row) => row.name).sort(),
    tags: tags.map((row) => row.name).sort(),
  };
}

function matchesBookWriteState(state: Awaited<ReturnType<typeof readBookWriteState>>, payload: ExpectedWritePayload): boolean {
  return (
    state.title === payload.title &&
    state.subtitle === payload.subtitle &&
    state.description === payload.description &&
    state.publisher === payload.publisher &&
    state.publishedYear === payload.publishedYear &&
    state.language === payload.language &&
    state.pageCount === payload.pageCount &&
    state.seriesName === payload.seriesName &&
    state.seriesIndex === payload.seriesIndex &&
    state.isbn10 === payload.isbn10 &&
    state.isbn13 === payload.isbn13 &&
    state.rating === payload.rating &&
    state.googleBooksId === payload.googleBooksId &&
    state.goodreadsId === payload.goodreadsId &&
    state.amazonId === payload.amazonId &&
    state.hardcoverId === payload.hardcoverId &&
    state.openLibraryId === payload.openLibraryId &&
    state.itunesId === payload.itunesId &&
    JSON.stringify(state.authors) === JSON.stringify(payload.authors) &&
    JSON.stringify(state.genres) === JSON.stringify([...payload.genres].sort()) &&
    JSON.stringify(state.tags) === JSON.stringify([...payload.tags].sort())
  );
}

async function countSyncSuccessLogs(context: MetadataWriteE2EContext, bookId: number): Promise<number> {
  const rows = await context.db
    .select({ triggeredBy: schema.fileWriteLog.triggeredBy, status: schema.fileWriteLog.status })
    .from(schema.fileWriteLog)
    .where(eq(schema.fileWriteLog.bookId, bookId));

  return rows.filter((row) => row.triggeredBy === 'sync' && row.status === 'success').length;
}
