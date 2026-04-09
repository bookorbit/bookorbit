import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdir, stat } from 'fs/promises';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Permission, BookBucketMetadata } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { GlobalExceptionFilter } from '../../../src/common/filters/http-exception.filter';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { MetadataService } from '../../../src/modules/metadata/metadata.service';
import { BookBucketWatcherService } from '../../../src/modules/book-bucket/book-bucket-watcher.service';
import { makeMetadataNoopMock, seedLibrary, waitForScanCompletion, type MetadataNoopMock } from '../app-harness';
import {
  buildFb2Fixture,
  createAuthorizationFixtureRoot,
  type AuthorizationMatrixFixtureRoot,
  writeFixtureFile,
} from './authorization-matrix-fixture-builder';

type Db = NodePgDatabase<typeof schema>;
const TEST_PASSWORD_HASH_ROUNDS = 4;

const ADMIN_SETUP_DTO = {
  username: 'authorization-matrix-e2e-admin',
  name: 'Authorization Matrix E2E Admin',
  email: 'authorization-matrix-e2e-admin@example.com',
  password: 'AuthorizationMatrixAdmin123',
};

interface EnvSnapshot {
  appDataPath: string | undefined;
}

export interface AuthorizationMatrixE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: AuthorizationMatrixFixtureRoot;
  envSnapshot: EnvSnapshot;
  metadataMock: MetadataNoopMock;
}

export interface CreatedLibrary {
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
}

export interface TestUserSession {
  userId: number;
  username: string;
  password: string;
  accessToken: string;
}

export interface LocatedBookFile {
  libraryId: number;
  bookId: number;
  bookFileId: number;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
}

export interface CreateBookBucketRowInput {
  fileName?: string;
  content?: string | Buffer;
  status?: typeof schema.bookBucketFiles.$inferInsert.status;
  format?: string;
  embeddedMetadata?: BookBucketMetadata | null;
  selectedMetadata?: BookBucketMetadata | null;
  fetchedMetadata?: BookBucketMetadata | null;
  targetLibraryId?: number | null;
  targetFolderId?: number | null;
  confidence?: number | null;
  errorMessage?: string | null;
  metadataEditedAt?: Date | null;
}

export interface CreateReadingSessionInput {
  userId: number;
  bookFileId: number;
  startedAt: Date;
  endedAt: Date;
  sessionId?: string;
  progressDelta?: number | null;
  endProgress?: number | null;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createAuthorizationMatrixE2EContext(): Promise<AuthorizationMatrixE2EContext> {
  const fixture = await createAuthorizationFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
  };

  process.env.APP_DATA_PATH = fixture.booksPath;

  const metadataMock = makeMetadataNoopMock();
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(MetadataService)
    .useValue(metadataMock)
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
  await app.register(fastifyMultipart as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await stopBookBucketWatcher(app);

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);
  await setSettingValue(db, 'book_bucket_auto_fetch_metadata', 'false');
  await setSettingValue(db, 'book_bucket_auto_finalize_enabled', 'false');
  await setSettingValue(db, 'opds_enabled', 'true');

  return {
    app,
    db,
    adminToken,
    fixture,
    envSnapshot,
    metadataMock,
  };
}

export async function closeAuthorizationMatrixE2EContext(ctx: AuthorizationMatrixE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function createLibraryWithFolder(
  ctx: AuthorizationMatrixE2EContext,
  options: {
    mode?: 'book_per_file' | 'book_per_folder';
    allowedFormats?: string[];
    name?: string;
  } = {},
): Promise<CreatedLibrary> {
  const folderPath = `${ctx.fixture.booksPath}/library-${randomUUID()}`;
  await mkdir(folderPath, { recursive: true });

  const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, {
    rootPath: folderPath,
    mode: options.mode ?? 'book_per_file',
    allowedFormats: options.allowedFormats ?? [],
    watch: false,
    name: options.name,
  });

  return {
    libraryId,
    libraryFolderId,
    folderPath,
  };
}

export async function triggerAndWaitForLibraryScan(
  ctx: AuthorizationMatrixE2EContext,
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

export async function createUserAndLogin(
  ctx: AuthorizationMatrixE2EContext,
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
  const username = options.username ?? `authorization-matrix-user-${suffix}`;
  const password = options.password ?? 'AuthorizationMatrixUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, TEST_PASSWORD_HASH_ROUNDS);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Authorization Matrix User ${suffix}`,
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
  ctx: AuthorizationMatrixE2EContext,
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

export async function replaceUserPermissions(ctx: AuthorizationMatrixE2EContext, userId: number, permissions: Permission[]): Promise<void> {
  await ctx.db.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, userId));
  if (permissions.length === 0) return;
  await ctx.db.insert(schema.userPermissions).values(permissions.map((permissionName) => ({ userId, permissionName })));
}

export async function setUserActive(ctx: AuthorizationMatrixE2EContext, userId: number, active: boolean): Promise<void> {
  await ctx.db.update(schema.users).set({ active }).where(eq(schema.users.id, userId));
}

export async function setSetting(ctx: AuthorizationMatrixE2EContext, key: string, value: string): Promise<void> {
  await setSettingValue(ctx.db, key, value);
}

export async function locateBookByAbsolutePath(ctx: AuthorizationMatrixE2EContext, absolutePath: string): Promise<LocatedBookFile> {
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

export async function createBookCoverArtifacts(
  ctx: AuthorizationMatrixE2EContext,
  bookId: number,
  options: {
    coverExtension?: 'jpg' | 'png';
    coverContent?: Buffer;
    thumbnailContent?: Buffer;
  } = {},
): Promise<void> {
  const coverExtension = options.coverExtension ?? 'jpg';
  const coverContent = options.coverContent ?? Buffer.from(`cover-${bookId}`, 'utf8');
  const thumbnailContent = options.thumbnailContent ?? Buffer.from(`thumbnail-${bookId}`, 'utf8');

  await writeFixtureFile(ctx.fixture.booksPath, `covers/${bookId}/cover.${coverExtension}`, coverContent);
  await writeFixtureFile(ctx.fixture.booksPath, `covers/${bookId}/thumbnail.jpg`, thumbnailContent);
}

export async function createBookBucketRow(
  ctx: AuthorizationMatrixE2EContext,
  input: CreateBookBucketRowInput = {},
): Promise<typeof schema.bookBucketFiles.$inferSelect> {
  const fileName = input.fileName ?? `authz-book-bucket-${randomUUID()}.fb2`;
  const content = input.content ?? buildFb2Fixture({ title: `Authorization Matrix ${randomUUID()}`, authors: ['Fixture Author'] });
  const format = input.format ?? fileName.split('.').pop()?.toLowerCase() ?? 'fb2';
  const absolutePath = await writeFixtureFile(ctx.fixture.booksPath, `book-bucket/${fileName}`, content);
  const fileStat = await stat(absolutePath);

  const [row] = await ctx.db
    .insert(schema.bookBucketFiles)
    .values({
      fileName,
      absolutePath,
      fileSize: fileStat.size,
      format,
      status: input.status ?? 'ready',
      embeddedMetadata: input.embeddedMetadata ?? null,
      selectedMetadata: input.selectedMetadata ?? null,
      fetchedMetadata: input.fetchedMetadata ?? null,
      targetLibraryId: input.targetLibraryId ?? null,
      targetFolderId: input.targetFolderId ?? null,
      confidence: input.confidence ?? null,
      errorMessage: input.errorMessage ?? null,
      metadataEditedAt: input.metadataEditedAt ?? null,
    })
    .returning();

  return row;
}

export async function createKoboDevice(
  ctx: AuthorizationMatrixE2EContext,
  userId: number,
  name = `kobo-device-${randomUUID()}`,
): Promise<typeof schema.koboDevices.$inferSelect> {
  const token = randomUUID().replaceAll('-', '');
  const [device] = await ctx.db
    .insert(schema.koboDevices)
    .values({
      userId,
      name,
      token,
    })
    .returning();

  return device;
}

export async function createOpdsUser(
  ctx: AuthorizationMatrixE2EContext,
  input: {
    userId: number;
    username?: string;
    password?: string;
    sortOrder?: typeof schema.opdsUsers.$inferInsert.sortOrder;
  },
): Promise<{ row: typeof schema.opdsUsers.$inferSelect; password: string }> {
  const username = input.username ?? `opds-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const password = input.password ?? 'OpdsPassword123';
  const passwordHash = await hash(password, TEST_PASSWORD_HASH_ROUNDS);

  const [row] = await ctx.db
    .insert(schema.opdsUsers)
    .values({
      userId: input.userId,
      username,
      passwordHash,
      sortOrder: input.sortOrder ?? 'recent',
    })
    .returning();

  return { row, password };
}

export async function createReadingSession(
  ctx: AuthorizationMatrixE2EContext,
  input: CreateReadingSessionInput,
): Promise<typeof schema.readingSessions.$inferSelect> {
  const durationSeconds = Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 1000);
  const [row] = await ctx.db
    .insert(schema.readingSessions)
    .values({
      userId: input.userId,
      bookFileId: input.bookFileId,
      sessionId: input.sessionId ?? `session-${randomUUID()}`,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationSeconds,
      progressDelta: input.progressDelta ?? null,
      endProgress: input.endProgress ?? null,
    })
    .returning();
  return row;
}

export async function uploadLibraryFile(
  ctx: AuthorizationMatrixE2EContext,
  input: {
    token: string;
    libraryId: number;
    fileName: string;
    content: string | Buffer;
    folderId?: number;
    contentType?: string;
  },
) {
  const contentBuffer = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
  const { body, boundary } = buildMultipartBody(input.fileName, contentBuffer, input.contentType ?? 'application/octet-stream');
  const folderQuery = input.folderId ? `?folderId=${input.folderId}` : '';
  return ctx.app.inject({
    method: 'POST',
    url: `/api/v1/libraries/${input.libraryId}/upload${folderQuery}`,
    headers: {
      ...authHeader(input.token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    payload: body,
  });
}

function buildMultipartBody(fileName: string, content: Buffer, contentType: string): { body: Buffer; boundary: string } {
  const boundary = `----projectx-authz-${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([preamble, content, closing]), boundary };
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
    const fallbackUsername = `authorization-matrix-admin-${suffix}`;
    const fallbackPassword = ADMIN_SETUP_DTO.password;
    const passwordHash = await hash(fallbackPassword, TEST_PASSWORD_HASH_ROUNDS);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'Authorization Matrix E2E Admin',
      email: `${fallbackUsername}@example.com`,
      passwordHash,
      isSuperuser: true,
      isDefaultPassword: false,
      provisioningMethod: 'local',
    });

    const fallbackToken = await loginForToken(app, fallbackUsername, fallbackPassword);
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

async function setSettingValue(db: Db, key: string, value: string): Promise<void> {
  await db.insert(schema.appSettings).values({ key, value }).onConflictDoUpdate({
    target: schema.appSettings.key,
    set: { value },
  });
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.appDataPath === undefined) delete process.env.APP_DATA_PATH;
  else process.env.APP_DATA_PATH = snapshot.appDataPath;
}
