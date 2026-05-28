import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdir } from 'fs/promises';
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DEFAULT_FORMAT_PRIORITY } from '@bookorbit/types';
import type { BulkRenamePreviewPage, BulkRenameProgressEvent, BulkRenameStatus } from '@bookorbit/types';

import { AppModule } from '../../../src/app.module';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { bookFiles, books, libraries, libraryFolders, scanJobs } from '../../../src/db/schema';
import { GlobalExceptionFilter } from '../../../src/common/filters/http-exception.filter';

export type Db = NodePgDatabase<typeof schema>;

const ADMIN_SETUP_DTO = {
  username: 'file-rename-e2e-admin',
  name: 'File Rename E2E Admin',
  email: 'file-rename-e2e-admin@example.com',
  password: 'FileRenameE2E123!',
};

interface EnvSnapshot {
  appDataPath: string | undefined;
  fileWriteDebounceMs: string | undefined;
  booksPath: string | undefined;
}

export interface FileRenameE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  booksRoot: string;
  envSnapshot: EnvSnapshot;
}

export interface CreatedLibrary {
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
}

export interface LocatedBook {
  bookId: number;
  primaryFileId: number | null;
  absolutePath: string;
  relPath: string | null;
  folderPath: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createFileRenameE2EContext(booksRoot: string): Promise<FileRenameE2EContext> {
  await mkdir(booksRoot, { recursive: true });

  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
    fileWriteDebounceMs: process.env.FILE_WRITE_DEBOUNCE_MS,
    booksPath: process.env.BOOKS_PATH,
  };

  process.env.APP_DATA_PATH = booksRoot;
  process.env.BOOKS_PATH = booksRoot;
  // Large debounce prevents auto-renames from racing with bulk-rename test steps
  process.env.FILE_WRITE_DEBOUNCE_MS = '300000';

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);

  return { app, db, adminToken, booksRoot, envSnapshot };
}

export async function closeFileRenameE2EContext(ctx: FileRenameE2EContext): Promise<void> {
  await ctx.app.close();
  restoreEnv(ctx.envSnapshot);
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.appDataPath !== undefined) process.env.APP_DATA_PATH = snapshot.appDataPath;
  else delete process.env.APP_DATA_PATH;

  if (snapshot.fileWriteDebounceMs !== undefined) process.env.FILE_WRITE_DEBOUNCE_MS = snapshot.fileWriteDebounceMs;
  else delete process.env.FILE_WRITE_DEBOUNCE_MS;

  if (snapshot.booksPath !== undefined) process.env.BOOKS_PATH = snapshot.booksPath;
  else delete process.env.BOOKS_PATH;
}

export async function createLibrary(
  ctx: FileRenameE2EContext,
  options: {
    mode?: 'book_per_file' | 'book_per_folder';
    name?: string;
    fileRenameEnabled?: boolean;
    fileNamingPattern?: string | null;
  } = {},
): Promise<CreatedLibrary> {
  const folderPath = `${ctx.booksRoot}/library-${randomUUID()}`;
  await mkdir(folderPath, { recursive: true });

  const [library] = await ctx.db
    .insert(libraries)
    .values({
      name: options.name ?? `file-rename-${randomUUID()}`,
      icon: '📚',
      watch: false,
      organizationMode: options.mode ?? 'book_per_file',
      allowedFormats: [],
      excludePatterns: [],
      formatPriority: [...DEFAULT_FORMAT_PRIORITY],
      fileWriteEnabled: false,
      fileWriteWriteCover: false,
      fileWriteEpubEnabled: false,
      fileWritePdfEnabled: false,
      fileWriteCbxEnabled: false,
      fileRenameEnabled: options.fileRenameEnabled ?? true,
      fileNamingPattern: options.fileNamingPattern ?? null,
    })
    .returning({ id: libraries.id });

  const [libraryFolder] = await ctx.db
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: folderPath })
    .returning({ id: libraryFolders.id });

  return { libraryId: library.id, libraryFolderId: libraryFolder.id, folderPath };
}

export async function triggerAndWaitForScan(ctx: FileRenameE2EContext, libraryId: number, timeoutMs = 30_000): Promise<void> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/scanner/libraries/${libraryId}/scan`,
    headers: authHeader(ctx.adminToken),
  });

  if (response.statusCode !== 202) {
    throw new Error(`Scan endpoint returned ${response.statusCode}: ${response.body}`);
  }

  const body = response.json() as { jobId?: number };
  if (!body.jobId) throw new Error(`Scan returned no jobId: ${response.body}`);

  await waitForScanJob(ctx.db, body.jobId, timeoutMs);
}

async function waitForScanJob(db: Db, jobId: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [job] = await db.select().from(scanJobs).where(eq(scanJobs.id, jobId)).limit(1);
    if (!job) throw new Error(`Scan job ${jobId} not found`);
    if (job.status === 'completed') return;
    if (job.status === 'failed') throw new Error(`Scan job failed: ${job.errorMessage ?? 'unknown'}`);
    await sleep(100);
  }

  throw new Error(`Timed out waiting for scan job ${jobId}`);
}

export async function findBookByRelPath(ctx: FileRenameE2EContext, libraryId: number, relPath: string): Promise<LocatedBook> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const [row] = await ctx.db
      .select({
        bookId: books.id,
        primaryFileId: books.primaryFileId,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        folderPath: books.folderPath,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.relPath, relPath))
      .limit(1);

    if (row && row.absolutePath.includes(libraryId.toString().padStart(1))) {
      return row;
    }

    // fallback: search by just relPath without lib filter for simplicity
    const [anyRow] = await ctx.db
      .select({
        bookId: books.id,
        primaryFileId: books.primaryFileId,
        absolutePath: bookFiles.absolutePath,
        relPath: bookFiles.relPath,
        folderPath: books.folderPath,
      })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.relPath, relPath))
      .limit(1);

    if (anyRow) return anyRow;
    await sleep(100);
  }

  throw new Error(`Book with relPath "${relPath}" not found after waiting`);
}

export async function findAllBooksInLibrary(ctx: FileRenameE2EContext, libraryId: number): Promise<LocatedBook[]> {
  const rows = await ctx.db
    .select({
      bookId: books.id,
      primaryFileId: books.primaryFileId,
      absolutePath: bookFiles.absolutePath,
      relPath: bookFiles.relPath,
      folderPath: books.folderPath,
    })
    .from(bookFiles)
    .innerJoin(books, eq(books.id, bookFiles.bookId))
    .where(eq(books.libraryId, libraryId))
    .orderBy(asc(books.id));

  return rows;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function setBookMetadata(
  ctx: FileRenameE2EContext,
  bookId: number,
  metadata: {
    title?: string | null;
    subtitle?: string | null;
    publisher?: string | null;
    publishedYear?: number | null;
    seriesName?: string | null;
    seriesIndex?: number | null;
    language?: string | null;
    isbn13?: string | null;
    authors?: string[];
  },
): Promise<void> {
  const response = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/v1/books/${bookId}/metadata`,
    headers: authHeader(ctx.adminToken),
    payload: {
      ...(metadata.title !== undefined && { title: metadata.title }),
      ...(metadata.subtitle !== undefined && { subtitle: metadata.subtitle }),
      ...(metadata.publisher !== undefined && { publisher: metadata.publisher }),
      ...(metadata.publishedYear !== undefined && { publishedYear: metadata.publishedYear }),
      ...(metadata.seriesName !== undefined && { seriesName: metadata.seriesName }),
      ...(metadata.seriesIndex !== undefined && { seriesIndex: metadata.seriesIndex }),
      ...(metadata.language !== undefined && { language: metadata.language }),
      ...(metadata.isbn13 !== undefined && { isbn13: metadata.isbn13 }),
      ...(metadata.authors !== undefined && { authors: metadata.authors }),
    },
  });

  if (response.statusCode !== 200) {
    throw new Error(`PATCH metadata returned ${response.statusCode}: ${response.body}`);
  }
}

export async function getBulkRenamePreview(
  ctx: FileRenameE2EContext,
  libraryId: number,
  options: { page?: number; pageSize?: number; status?: BulkRenameStatus } = {},
): Promise<BulkRenamePreviewPage> {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('pageSize', String(options.pageSize ?? 100));
  if (options.status) params.set('status', options.status);

  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/libraries/${libraryId}/bulk-rename/preview?${params.toString()}`,
    headers: authHeader(ctx.adminToken),
  });

  if (response.statusCode !== 200) {
    throw new Error(`Preview returned ${response.statusCode}: ${response.body}`);
  }

  return response.json() as BulkRenamePreviewPage;
}

export async function getBulkRenameStatus(ctx: FileRenameE2EContext, libraryId: number): Promise<{ running: boolean }> {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/api/v1/libraries/${libraryId}/bulk-rename/status`,
    headers: authHeader(ctx.adminToken),
  });

  if (response.statusCode !== 200) {
    throw new Error(`Status returned ${response.statusCode}: ${response.body}`);
  }

  return response.json() as { running: boolean };
}

export interface BulkRenameExecuteResult {
  statusCode: number;
  events: BulkRenameProgressEvent[];
  rawBody: string;
  error?: string;
}

export async function executeBulkRename(ctx: FileRenameE2EContext, libraryId: number): Promise<BulkRenameExecuteResult> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/libraries/${libraryId}/bulk-rename/execute`,
    headers: authHeader(ctx.adminToken),
  });

  const rawBody = response.body;
  const events: BulkRenameProgressEvent[] = [];

  if (response.statusCode === 200) {
    for (const line of rawBody.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          events.push(JSON.parse(line.slice(6)) as BulkRenameProgressEvent);
        } catch {
          // skip malformed lines
        }
      }
    }
  }

  return { statusCode: response.statusCode, events, rawBody };
}

export async function refreshPreviewCache(ctx: FileRenameE2EContext, libraryId: number): Promise<void> {
  // Wait a moment to ensure the cache TTL doesn't interfere (cache is 60s)
  // We invalidate by patching library settings to force a fresh compute
  await ctx.db.update(libraries).set({ updatedAt: new Date() }).where(eq(libraries.id, libraryId));
}

async function getAdminToken(app: NestFastifyApplication, db: Db): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: ADMIN_SETUP_DTO,
  });

  if (response.statusCode === 409) {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: ADMIN_SETUP_DTO.username, password: ADMIN_SETUP_DTO.password },
    });

    if (loginResponse.statusCode === 200) {
      const body = loginResponse.json() as { accessToken?: string };
      if (body.accessToken) return body.accessToken;
    }

    const suffix = randomUUID().replaceAll('-', '');
    const fallbackUsername = `file-rename-admin-${suffix}`;
    const passwordHash = await hash(ADMIN_SETUP_DTO.password, 12);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'File Rename E2E Admin (fallback)',
      email: `${fallbackUsername}@example.com`,
      passwordHash,
      isSuperuser: true,
      isDefaultPassword: false,
      provisioningMethod: 'local',
    });

    const fallbackResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: fallbackUsername, password: ADMIN_SETUP_DTO.password },
    });

    if (fallbackResponse.statusCode !== 200) {
      throw new Error(`Fallback admin login failed: ${fallbackResponse.statusCode} ${fallbackResponse.body}`);
    }

    const body = fallbackResponse.json() as { accessToken?: string };
    if (!body.accessToken) throw new Error('Fallback login returned no accessToken');
    return body.accessToken;
  }

  if (response.statusCode !== 201) {
    throw new Error(`Setup returned ${response.statusCode}: ${response.body}`);
  }

  const body = response.json() as { accessToken?: string };
  if (!body.accessToken) throw new Error('Setup returned no accessToken');
  return body.accessToken;
}
