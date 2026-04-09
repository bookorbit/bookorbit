import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdir } from 'fs/promises';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DEFAULT_FORMAT_PRIORITY, type Permission } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/common/filters/http-exception.filter';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { MetadataService } from '../../../src/modules/metadata/metadata.service';
import { BookBucketWatcherService } from '../../../src/modules/book-bucket/book-bucket-watcher.service';
import { makeMetadataNoopMock, seedLibrary, waitForScanCompletion } from '../app-harness';
import { createReaderStateIsolationFixtureRoot, type ReaderStateIsolationFixtureRoot } from './reader-state-isolation-fixture-builder';

type Db = NodePgDatabase<typeof schema>;

const ADMIN_SETUP_DTO = {
  username: 'reader-state-e2e-admin',
  name: 'Reader State E2E Admin',
  email: 'reader-state-e2e-admin@example.com',
  password: 'ReaderStateAdmin123',
};

interface EnvSnapshot {
  appDataPath: string | undefined;
}

export interface ReaderStateIsolationE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: ReaderStateIsolationFixtureRoot;
  envSnapshot: EnvSnapshot;
}

export interface TestUserSession {
  userId: number;
  username: string;
  password: string;
  accessToken: string;
}

export interface CreatedLibrary {
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
}

export interface LocatedBookFile {
  libraryId: number;
  bookId: number;
  bookFileId: number;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createReaderStateIsolationE2EContext(): Promise<ReaderStateIsolationE2EContext> {
  const fixture = await createReaderStateIsolationFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
  };

  process.env.APP_DATA_PATH = fixture.booksPath;

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MetadataService)
    .useValue(makeMetadataNoopMock())
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
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await stopBookBucketWatcher(app);

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);

  return {
    app,
    db,
    adminToken,
    fixture,
    envSnapshot,
  };
}

export async function closeReaderStateIsolationE2EContext(ctx: ReaderStateIsolationE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function createLibraryWithFolder(
  ctx: ReaderStateIsolationE2EContext,
  options: {
    mode?: 'book_per_file' | 'book_per_folder';
    allowedFormats?: string[];
    name?: string;
  } = {},
): Promise<CreatedLibrary> {
  const folderPath = `${ctx.fixture.booksPath}/library-${randomUUID()}`;
  await mkdir(folderPath, { recursive: true });

  const [library] = await ctx.db
    .insert(schema.libraries)
    .values({
      name: options.name ?? `reader-state-library-${randomUUID()}`,
      watch: false,
      organizationMode: options.mode ?? 'book_per_file',
      allowedFormats: options.allowedFormats ?? [],
      excludePatterns: [],
      formatPriority: [...DEFAULT_FORMAT_PRIORITY],
    })
    .returning({ id: schema.libraries.id });

  const [libraryFolder] = await ctx.db
    .insert(schema.libraryFolders)
    .values({
      libraryId: library.id,
      path: folderPath,
    })
    .returning({ id: schema.libraryFolders.id });

  return {
    libraryId: library.id,
    libraryFolderId: libraryFolder.id,
    folderPath,
  };
}

export async function triggerAndWaitForLibraryScan(
  ctx: ReaderStateIsolationE2EContext,
  libraryId: number,
  timeoutMs = 45_000,
): Promise<typeof schema.scanJobs.$inferSelect> {
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

export async function locateBookByAbsolutePath(ctx: ReaderStateIsolationE2EContext, absolutePath: string): Promise<LocatedBookFile> {
  const [row] = await ctx.db
    .select({
      libraryId: schema.books.libraryId,
      bookId: schema.books.id,
      bookFileId: schema.bookFiles.id,
      absolutePath: schema.bookFiles.absolutePath,
      relPath: schema.bookFiles.relPath,
      format: schema.bookFiles.format,
    })
    .from(schema.bookFiles)
    .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
    .where(and(eq(schema.books.status, 'present'), eq(schema.bookFiles.absolutePath, absolutePath)))
    .limit(1);

  if (!row) {
    throw new Error(`No present book file found for path "${absolutePath}"`);
  }

  return row;
}

export async function createUserAndLogin(
  ctx: ReaderStateIsolationE2EContext,
  options: {
    permissions?: Permission[];
    isSuperuser?: boolean;
    isDefaultPassword?: boolean;
    active?: boolean;
    username?: string;
    password?: string;
    email?: string;
  } = {},
): Promise<TestUserSession> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = options.username ?? `reader-state-user-${suffix}`;
  const password = options.password ?? 'ReaderStateUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 4);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Reader State User ${suffix}`,
      email,
      passwordHash,
      active: options.active ?? true,
      isSuperuser: options.isSuperuser ?? false,
      isDefaultPassword: options.isDefaultPassword ?? false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });

  const permissions = options.permissions ?? [];
  if (permissions.length > 0) {
    await ctx.db.insert(schema.userPermissions).values(permissions.map((permissionName) => ({ userId: created.id, permissionName })));
  }

  const accessToken = await loginForToken(ctx.app, username, password);
  if (!accessToken) {
    throw new Error(`Login failed for ${username}`);
  }

  return {
    userId: created.id,
    username,
    password,
    accessToken,
  };
}

export async function grantLibraryAccess(
  ctx: ReaderStateIsolationE2EContext,
  userId: number,
  libraryId: number,
  accessLevel: 'viewer' | 'editor' | 'owner' = 'viewer',
): Promise<void> {
  await ctx.db
    .insert(schema.userLibraryAccess)
    .values({ userId, libraryId, accessLevel })
    .onConflictDoUpdate({
      target: [schema.userLibraryAccess.userId, schema.userLibraryAccess.libraryId],
      set: { accessLevel },
    });
}

async function stopBookBucketWatcher(app: NestFastifyApplication): Promise<void> {
  const watcher = app.get(BookBucketWatcherService);
  await watcher.onModuleDestroy();
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
    const fallbackUsername = `reader-state-e2e-admin-${suffix}`;
    const passwordHash = await hash(ADMIN_SETUP_DTO.password, 4);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'Reader State E2E Admin',
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

export { seedLibrary };
