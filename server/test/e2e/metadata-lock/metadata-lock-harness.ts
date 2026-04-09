import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { randomUUID } from 'crypto';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { and, count, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DEFAULT_FORMAT_PRIORITY, MetadataProviderKey } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/common/filters/http-exception.filter';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import {
  bookFiles,
  bookGenres,
  bookMetadata,
  bookMetadataFetchQueue,
  bookNarrators,
  books,
  comicMetadata,
  genres,
  libraries,
  libraryFolders,
  narrators,
  scanJobs,
} from '../../../src/db/schema';
import { COVER_CUSTOM_FILE_PREFIX, COVER_EXTRACTED_FILE_PREFIX } from '../../../src/modules/cover/constants';
import { coverDirPath } from '../../../src/modules/metadata/lib/cover';
import { METADATA_PROVIDERS } from '../../../src/modules/metadata-fetch/constants';
import {
  BLUE_PNG_BYTES,
  GREEN_PNG_BYTES,
  RED_PNG_BYTES,
  createMetadataLockFixtureRoot,
  type MetadataLockFixtureRoot,
} from './metadata-lock-fixture-builder';
import { createMetadataLockTestProviders } from './metadata-lock-test-providers';

type Db = NodePgDatabase<typeof schema>;

const ADMIN_SETUP_DTO = {
  username: 'metadata-lock-e2e-admin',
  name: 'Metadata Lock E2E Admin',
  email: 'metadata-lock-e2e-admin@example.com',
  password: 'MetadataLockAdmin123',
};

const MAX_MULTIPART_BYTES = 20 * 1024 * 1024;

interface EnvSnapshot {
  appDataPath: string | undefined;
}

interface StaticCoverServer {
  urlFor: (providerKey: MetadataProviderKey) => string;
  close: () => Promise<void>;
}

export interface MetadataLockE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: MetadataLockFixtureRoot;
  envSnapshot: EnvSnapshot;
  coverServer: StaticCoverServer;
}

export interface CreatedLibrary {
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
}

export interface LocatedBookFile {
  bookId: number;
  bookFileId: number;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
}

export interface BookMutationState {
  metadata: {
    title: string | null;
    subtitle: string | null;
    description: string | null;
    publisher: string | null;
    publishedYear: number | null;
    language: string | null;
    pageCount: number | null;
    coverSource: string | null;
    goodreadsId: string | null;
    openLibraryId: string | null;
    durationSeconds: number | null;
    abridged: boolean;
    chapters: unknown;
    lockedFields: string[];
    lastMetadataFetchAt: Date | null;
  } | null;
  genres: string[];
  narrators: string[];
  comicMetadata: {
    issueNumber: string | null;
    volumeName: string | null;
    storyArcs: string[];
  } | null;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createMetadataLockE2EContext(): Promise<MetadataLockE2EContext> {
  const fixture = await createMetadataLockFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
  };

  process.env.APP_DATA_PATH = fixture.booksPath;

  const coverServer = await startStaticCoverServer();

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(METADATA_PROVIDERS)
    .useValue(createMetadataLockTestProviders((providerKey) => coverServer.urlFor(providerKey)))
    .compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.register(fastifyCookie as never);
  await app.register(fastifyMultipart as never, { limits: { fileSize: MAX_MULTIPART_BYTES } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);

  return {
    app,
    db,
    adminToken,
    fixture,
    envSnapshot,
    coverServer,
  };
}

export async function closeMetadataLockE2EContext(ctx: MetadataLockE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.coverServer.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function createLibraryWithFolder(
  ctx: MetadataLockE2EContext,
  options: {
    mode?: 'book_per_file' | 'book_per_folder';
    allowedFormats?: string[];
    name?: string;
  } = {},
): Promise<CreatedLibrary> {
  const folderPath = `${ctx.fixture.booksPath}/library-${randomUUID()}`;
  const [library] = await ctx.db
    .insert(libraries)
    .values({
      name: options.name ?? `metadata-lock-${randomUUID()}`,
      watch: false,
      organizationMode: options.mode ?? 'book_per_file',
      allowedFormats: options.allowedFormats ?? [],
      excludePatterns: [],
      formatPriority: [...DEFAULT_FORMAT_PRIORITY],
    })
    .returning({ id: libraries.id });

  const [libraryFolder] = await ctx.db
    .insert(libraryFolders)
    .values({
      libraryId: library.id,
      path: folderPath,
    })
    .returning({ id: libraryFolders.id });

  return {
    libraryId: library.id,
    libraryFolderId: libraryFolder.id,
    folderPath,
  };
}

export async function triggerAndWaitForLibraryScan(
  ctx: MetadataLockE2EContext,
  libraryId: number,
  timeoutMs = 45_000,
): Promise<typeof scanJobs.$inferSelect> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: `/api/v1/scanner/libraries/${libraryId}/scan`,
    headers: authHeader(ctx.adminToken),
  });

  if (response.statusCode !== 202) {
    throw new Error(`Scan endpoint failed: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as { jobId?: number };
  if (!body.jobId) {
    throw new Error(`Scan endpoint returned no jobId: ${response.body}`);
  }

  return waitForScanCompletion(ctx.db, body.jobId, timeoutMs);
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

export async function locateBookFileByRelPath(ctx: MetadataLockE2EContext, libraryId: number, relPath: string): Promise<LocatedBookFile> {
  const [row] = await ctx.db
    .select({
      bookId: books.id,
      bookFileId: bookFiles.id,
      absolutePath: bookFiles.absolutePath,
      relPath: bookFiles.relPath,
      format: bookFiles.format,
    })
    .from(bookFiles)
    .innerJoin(books, eq(books.id, bookFiles.bookId))
    .where(and(eq(books.libraryId, libraryId), eq(bookFiles.relPath, relPath), eq(books.status, 'present')))
    .limit(1);

  if (!row) {
    throw new Error(`No present book file found for relPath "${relPath}" in library ${libraryId}`);
  }

  return row;
}

export async function readBookMutationState(ctx: MetadataLockE2EContext, bookId: number): Promise<BookMutationState> {
  const [metadataRows, genreRows, narratorRows, comicRows] = await Promise.all([
    ctx.db
      .select({
        title: bookMetadata.title,
        subtitle: bookMetadata.subtitle,
        description: bookMetadata.description,
        publisher: bookMetadata.publisher,
        publishedYear: bookMetadata.publishedYear,
        language: bookMetadata.language,
        pageCount: bookMetadata.pageCount,
        coverSource: bookMetadata.coverSource,
        goodreadsId: bookMetadata.goodreadsId,
        openLibraryId: bookMetadata.openLibraryId,
        durationSeconds: bookMetadata.durationSeconds,
        abridged: bookMetadata.abridged,
        chapters: bookMetadata.chapters,
        lockedFields: bookMetadata.lockedFields,
        lastMetadataFetchAt: bookMetadata.lastMetadataFetchAt,
      })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1),
    ctx.db.select({ name: genres.name }).from(bookGenres).innerJoin(genres, eq(genres.id, bookGenres.genreId)).where(eq(bookGenres.bookId, bookId)),
    ctx.db
      .select({ name: narrators.name })
      .from(bookNarrators)
      .innerJoin(narrators, eq(narrators.id, bookNarrators.narratorId))
      .where(eq(bookNarrators.bookId, bookId)),
    ctx.db.select().from(comicMetadata).where(eq(comicMetadata.bookId, bookId)).limit(1),
  ]);

  const meta = metadataRows[0];
  const comic = comicRows[0] ?? null;

  return {
    metadata: meta
      ? {
          title: meta.title,
          subtitle: meta.subtitle,
          description: meta.description,
          publisher: meta.publisher,
          publishedYear: meta.publishedYear,
          language: meta.language,
          pageCount: meta.pageCount,
          coverSource: meta.coverSource,
          goodreadsId: meta.goodreadsId,
          openLibraryId: meta.openLibraryId,
          durationSeconds: meta.durationSeconds,
          abridged: meta.abridged,
          chapters: meta.chapters,
          lockedFields: [...meta.lockedFields],
          lastMetadataFetchAt: meta.lastMetadataFetchAt,
        }
      : null,
    genres: genreRows.map((row) => row.name).sort(),
    narrators: narratorRows.map((row) => row.name),
    comicMetadata: comic
      ? {
          issueNumber: comic.issueNumber,
          volumeName: comic.volumeName,
          storyArcs: [...(comic.storyArcs ?? [])].sort(),
        }
      : null,
  };
}

export async function findCoverFilePath(
  ctx: MetadataLockE2EContext,
  bookId: number,
  prefix: string = COVER_EXTRACTED_FILE_PREFIX,
): Promise<string | null> {
  const dir = coverDirPath(ctx.fixture.booksPath, bookId);
  const entries = await readdir(dir).catch(() => [] as string[]);
  const fileName = entries.find((entry) => entry.startsWith(prefix));
  return fileName ? join(dir, fileName) : null;
}

export async function uploadBookCover(
  ctx: MetadataLockE2EContext,
  bookId: number,
  buffer: Buffer,
  fileName = 'cover.png',
  contentType = 'image/png',
) {
  const { body, boundary } = buildMultipartBody(fileName, buffer, contentType);
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/books/${bookId}/cover`,
    headers: {
      ...authHeader(ctx.adminToken),
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    payload: body,
  });
}

export async function waitForMetadataFetchIdle(ctx: MetadataLockE2EContext, timeoutMs = 20_000): Promise<void> {
  await waitForCondition(async () => {
    const rows = await ctx.db
      .select({ status: bookMetadataFetchQueue.status, cnt: count() })
      .from(bookMetadataFetchQueue)
      .groupBy(bookMetadataFetchQueue.status);
    const total = rows.reduce((sum, row) => sum + Number(row.cnt), 0);
    if (total > 0) {
      throw new Error(`Metadata fetch queue still busy: ${rows.map((row) => `${row.status}:${Number(row.cnt)}`).join(', ')}`);
    }
  }, timeoutMs);
}

export async function waitForCondition(check: () => Promise<void>, timeoutMs = 15_000, pollMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await sleep(pollMs);
    }
  }

  throw new Error(`Timed out waiting for condition: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function buildMultipartBody(fileName: string, content: Buffer, contentType: string): { body: Buffer; boundary: string } {
  const boundary = `----projectx-metadata-lock-${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([preamble, content, closing]), boundary };
}

async function startStaticCoverServer(): Promise<StaticCoverServer> {
  const images = new Map<MetadataProviderKey, Buffer>([
    [MetadataProviderKey.GOODREADS, GREEN_PNG_BYTES],
    [MetadataProviderKey.OPEN_LIBRARY, BLUE_PNG_BYTES],
  ]);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname.slice(1).replace(/\.png$/i, '') as MetadataProviderKey;
    const image = images.get(pathname);
    if (!image) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(image.length));
    res.end(image);
  });

  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const info = server.address();
      if (!info || typeof info === 'string') {
        reject(new Error('Unable to resolve static cover server address'));
        return;
      }
      resolve({ port: info.port });
    });
  });

  return {
    urlFor: (providerKey) => `http://127.0.0.1:${address.port}/${providerKey}.png`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

async function getAdminToken(app: NestFastifyApplication, db: Db): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: ADMIN_SETUP_DTO,
  });

  if (response.statusCode === 409) {
    const existingToken = await loginForToken(app, ADMIN_SETUP_DTO.username, ADMIN_SETUP_DTO.password);
    if (existingToken) return existingToken;

    const suffix = randomUUID().replaceAll('-', '');
    const fallbackUsername = `metadata-lock-admin-${suffix}`;
    const passwordHash = await hash(ADMIN_SETUP_DTO.password, 12);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'Metadata Lock E2E Admin',
      email: `${fallbackUsername}@example.com`,
      passwordHash,
      isSuperuser: true,
      isDefaultPassword: false,
      provisioningMethod: 'local',
    });

    const fallbackToken = await loginForToken(app, fallbackUsername, ADMIN_SETUP_DTO.password);
    if (fallbackToken) return fallbackToken;
    throw new Error('Setup is already complete and fallback admin login failed');
  }

  if (response.statusCode !== 201) {
    throw new Error(`Unable to complete setup: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as { accessToken?: string };
  if (!body.accessToken) {
    throw new Error('Setup succeeded but accessToken is missing');
  }

  return body.accessToken;
}

async function loginForToken(app: NestFastifyApplication, username: string, password: string): Promise<string | null> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });
  if (response.statusCode !== 200) return null;
  const body = response.json() as { accessToken?: string };
  return body.accessToken ?? null;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.appDataPath === undefined) delete process.env.APP_DATA_PATH;
  else process.env.APP_DATA_PATH = snapshot.appDataPath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { BLUE_PNG_BYTES, COVER_CUSTOM_FILE_PREFIX, COVER_EXTRACTED_FILE_PREFIX, GREEN_PNG_BYTES, RED_PNG_BYTES };
