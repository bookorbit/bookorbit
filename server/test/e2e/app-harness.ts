import { randomUUID } from 'crypto';
import { expect } from 'vitest';
import fastifyCookie from '@fastify/cookie';
import { count, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DEFAULT_FORMAT_PRIORITY } from '@projectx/types';

import { AppModule } from '../../src/app.module';
import { DB } from '../../src/db';
import * as schema from '../../src/db/schema';
import { books, bookFiles, libraries, libraryFolders, scanJobs } from '../../src/db/schema';
import { MetadataService } from '../../src/modules/metadata/metadata.service';

export type Db = NodePgDatabase<typeof schema>;
type OrganizationMode = 'book_per_file' | 'book_per_folder';

const ADMIN_SETUP_DTO = {
  username: 'scanner-e2e-admin',
  name: 'Scanner E2E Admin',
  email: 'scanner-e2e-admin@example.com',
  password: 'ScannerE2E123',
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeMetadataNoopMock(): Pick<
  MetadataService,
  'extractAndSave' | 'refreshCoverForBook' | 'extractAudioFileDuration' | 'aggregateAudioDuration' | 'extractAudioChaptersAndNarrators'
> {
  return {
    extractAndSave: () => Promise.resolve(undefined),
    refreshCoverForBook: () => Promise.resolve(false),
    extractAudioFileDuration: () => Promise.resolve(undefined),
    aggregateAudioDuration: () => Promise.resolve(undefined),
    extractAudioChaptersAndNarrators: () => Promise.resolve(undefined),
  };
}

async function getAdminToken(app: NestFastifyApplication): Promise<string> {
  const setupResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: ADMIN_SETUP_DTO,
  });

  if (setupResponse.statusCode === 201) {
    const body = setupResponse.json() as { accessToken?: string };
    if (!body.accessToken) throw new Error('Setup succeeded but accessToken was missing');
    return body.accessToken;
  }

  if (setupResponse.statusCode === 409) {
    throw new Error('Initial setup already completed. Use the dedicated e2e database reset command before running e2e tests.');
  }

  throw new Error(`Unexpected setup response: ${setupResponse.statusCode} ${setupResponse.body}`);
}

export interface E2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
}

export async function createE2EContext(): Promise<E2EContext> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MetadataService)
    .useValue(makeMetadataNoopMock())
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app);
  return { app, db, adminToken };
}

export async function closeE2EContext(ctx: E2EContext): Promise<void> {
  await ctx.app.close();
}

export interface SeedLibraryInput {
  rootPath: string;
  mode: OrganizationMode;
  allowedFormats?: string[];
  excludePatterns?: string[];
  watch?: boolean;
  name?: string;
}

export async function seedLibrary(db: Db, input: SeedLibraryInput): Promise<{ libraryId: number; libraryFolderId: number }> {
  const [library] = await db
    .insert(libraries)
    .values({
      name: input.name ?? `e2e-${input.mode}-${randomUUID()}`,
      watch: input.watch ?? false,
      organizationMode: input.mode,
      allowedFormats: input.allowedFormats ?? [],
      excludePatterns: input.excludePatterns ?? [],
      formatPriority: [...DEFAULT_FORMAT_PRIORITY],
    })
    .returning({ id: libraries.id });

  const [libraryFolder] = await db
    .insert(libraryFolders)
    .values({
      libraryId: library.id,
      path: input.rootPath,
    })
    .returning({ id: libraryFolders.id });

  return { libraryId: library.id, libraryFolderId: libraryFolder.id };
}

export async function triggerLibraryScan(ctx: E2EContext, libraryId: number): Promise<number> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/scanner/libraries/${libraryId}/scan`,
    headers: { authorization: `Bearer ${ctx.adminToken}` },
  });

  if (response.statusCode !== 202) {
    throw new Error(`Scan endpoint failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as { jobId?: number };
  if (!body.jobId) {
    throw new Error(`Scan endpoint returned no jobId: ${response.body}`);
  }
  return body.jobId;
}

export async function triggerAndWaitForLibraryScan(ctx: E2EContext, libraryId: number, timeoutMs = 30_000): Promise<typeof scanJobs.$inferSelect> {
  const jobId = await triggerLibraryScan(ctx, libraryId);
  return waitForScanCompletion(ctx.db, jobId, timeoutMs);
}

export async function waitForScanCompletion(db: Db, jobId: number, timeoutMs = 30_000, pollMs = 100): Promise<typeof scanJobs.$inferSelect> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [job] = await db.select().from(scanJobs).where(eq(scanJobs.id, jobId)).limit(1);
    if (!job) throw new Error(`Scan job ${jobId} not found`);

    if (job.status === 'completed') return job;
    if (job.status === 'failed') {
      throw new Error(`Scan job ${jobId} failed: ${job.errorMessage ?? 'Unknown error'}`);
    }

    await sleep(pollMs);
  }

  throw new Error(`Timed out waiting for scan job ${jobId} to complete`);
}

export interface LibraryBookState {
  folderPath: string;
  status: string;
  primaryPath: string | null;
  filePaths: string[];
}

export async function loadLibraryBookState(db: Db, libraryId: number): Promise<LibraryBookState[]> {
  const bookRows = await db
    .select({
      id: books.id,
      folderPath: books.folderPath,
      status: books.status,
      primaryFileId: books.primaryFileId,
    })
    .from(books)
    .where(eq(books.libraryId, libraryId));

  const states: LibraryBookState[] = [];

  for (const row of bookRows) {
    const fileRows = await db.select({ absolutePath: bookFiles.absolutePath }).from(bookFiles).where(eq(bookFiles.bookId, row.id));

    let primaryPath: string | null = null;
    if (row.primaryFileId !== null) {
      const [primary] = await db.select({ absolutePath: bookFiles.absolutePath }).from(bookFiles).where(eq(bookFiles.id, row.primaryFileId)).limit(1);
      primaryPath = primary?.absolutePath ?? null;
    }

    states.push({
      folderPath: row.folderPath,
      status: row.status,
      primaryPath,
      filePaths: fileRows.map((fileRow) => fileRow.absolutePath).sort(),
    });
  }

  return states.sort((a, b) => a.folderPath.localeCompare(b.folderPath));
}

export interface IntegritySnapshot {
  orphanBookMetadata: number;
  orphanBookFiles: number;
  orphanBookAuthors: number;
  orphanBookGenres: number;
  orphanBookTags: number;
  orphanBookNarrators: number;
  orphanCollectionBooks: number;
  orphanUserBookStatus: number;
  orphanReadingProgress: number;
  orphanReadingSessions: number;
  orphanAudiobookProgressBook: number;
  orphanAudiobookProgressFile: number;
  orphanBookmarks: number;
  orphanAnnotations: number;
  orphanReaderPreferences: number;
  booksWithoutMetadata: number;
  invalidPrimaryFileRef: number;
  duplicatePresentFilePathPerLibrary: number;
}

export async function loadIntegritySnapshot(db: Db): Promise<IntegritySnapshot> {
  const [orphanBookMetadata] = await db
    .select({ value: count() })
    .from(schema.bookMetadata)
    .leftJoin(schema.books, eq(schema.bookMetadata.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanBookFiles] = await db
    .select({ value: count() })
    .from(schema.bookFiles)
    .leftJoin(schema.books, eq(schema.bookFiles.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanBookAuthors] = await db
    .select({ value: count() })
    .from(schema.bookAuthors)
    .leftJoin(schema.books, eq(schema.bookAuthors.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanBookGenres] = await db
    .select({ value: count() })
    .from(schema.bookGenres)
    .leftJoin(schema.books, eq(schema.bookGenres.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanBookTags] = await db
    .select({ value: count() })
    .from(schema.bookTags)
    .leftJoin(schema.books, eq(schema.bookTags.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanBookNarrators] = await db
    .select({ value: count() })
    .from(schema.bookNarrators)
    .leftJoin(schema.books, eq(schema.bookNarrators.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanCollectionBooks] = await db
    .select({ value: count() })
    .from(schema.collectionBooks)
    .leftJoin(schema.books, eq(schema.collectionBooks.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanUserBookStatus] = await db
    .select({ value: count() })
    .from(schema.userBookStatus)
    .leftJoin(schema.books, eq(schema.userBookStatus.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanReadingProgress] = await db
    .select({ value: count() })
    .from(schema.readingProgress)
    .leftJoin(schema.bookFiles, eq(schema.readingProgress.bookFileId, schema.bookFiles.id))
    .where(isNull(schema.bookFiles.id));

  const [orphanReadingSessions] = await db
    .select({ value: count() })
    .from(schema.readingSessions)
    .leftJoin(schema.bookFiles, eq(schema.readingSessions.bookFileId, schema.bookFiles.id))
    .where(isNull(schema.bookFiles.id));

  const [orphanAudiobookProgressBook] = await db
    .select({ value: count() })
    .from(schema.audiobookProgress)
    .leftJoin(schema.books, eq(schema.audiobookProgress.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanAudiobookProgressFile] = await db
    .select({ value: count() })
    .from(schema.audiobookProgress)
    .leftJoin(schema.bookFiles, eq(schema.audiobookProgress.currentFileId, schema.bookFiles.id))
    .where(isNull(schema.bookFiles.id));

  const [orphanBookmarks] = await db
    .select({ value: count() })
    .from(schema.bookmarks)
    .leftJoin(schema.books, eq(schema.bookmarks.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanAnnotations] = await db
    .select({ value: count() })
    .from(schema.annotations)
    .leftJoin(schema.books, eq(schema.annotations.bookId, schema.books.id))
    .where(isNull(schema.books.id));

  const [orphanReaderPreferences] = await db
    .select({ value: count() })
    .from(schema.readerPreferences)
    .leftJoin(schema.bookFiles, eq(schema.readerPreferences.bookFileId, schema.bookFiles.id))
    .where(isNull(schema.bookFiles.id));

  const [booksWithoutMetadata] = await db
    .select({ value: count() })
    .from(schema.books)
    .leftJoin(schema.bookMetadata, eq(schema.bookMetadata.bookId, schema.books.id))
    .where(isNull(schema.bookMetadata.bookId));

  const invalidPrimaryRows = await db
    .select({ bookId: schema.books.id })
    .from(schema.books)
    .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
    .where(
      sql`${schema.books.status} = 'present' AND ${schema.books.primaryFileId} IS NOT NULL AND (${schema.bookFiles.id} IS NULL OR ${schema.bookFiles.bookId} <> ${schema.books.id})`,
    );

  const duplicatePresentRows = await db
    .select({
      libraryId: schema.books.libraryId,
      absolutePath: schema.bookFiles.absolutePath,
      fileCount: sql<number>`count(*)`,
    })
    .from(schema.bookFiles)
    .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
    .where(eq(schema.books.status, 'present'))
    .groupBy(schema.books.libraryId, schema.bookFiles.absolutePath)
    .having(sql`count(*) > 1`);

  return {
    orphanBookMetadata: Number(orphanBookMetadata.value),
    orphanBookFiles: Number(orphanBookFiles.value),
    orphanBookAuthors: Number(orphanBookAuthors.value),
    orphanBookGenres: Number(orphanBookGenres.value),
    orphanBookTags: Number(orphanBookTags.value),
    orphanBookNarrators: Number(orphanBookNarrators.value),
    orphanCollectionBooks: Number(orphanCollectionBooks.value),
    orphanUserBookStatus: Number(orphanUserBookStatus.value),
    orphanReadingProgress: Number(orphanReadingProgress.value),
    orphanReadingSessions: Number(orphanReadingSessions.value),
    orphanAudiobookProgressBook: Number(orphanAudiobookProgressBook.value),
    orphanAudiobookProgressFile: Number(orphanAudiobookProgressFile.value),
    orphanBookmarks: Number(orphanBookmarks.value),
    orphanAnnotations: Number(orphanAnnotations.value),
    orphanReaderPreferences: Number(orphanReaderPreferences.value),
    booksWithoutMetadata: Number(booksWithoutMetadata.value),
    invalidPrimaryFileRef: invalidPrimaryRows.length,
    duplicatePresentFilePathPerLibrary: duplicatePresentRows.length,
  };
}

export async function assertNoIntegrityViolations(db: Db): Promise<void> {
  const snapshot = await loadIntegritySnapshot(db);
  for (const [key, value] of Object.entries(snapshot)) {
    expect(value, `integrity violation: ${key}`).toBe(0);
  }
}

export async function waitForCondition(check: () => Promise<void>, timeoutMs = 20_000, pollMs = 200): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (err) {
      lastError = err;
      await sleep(pollMs);
    }
  }

  throw new Error(`Timed out waiting for condition: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
