import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import { extname, join } from 'path';
import { mkdir, rm, stat } from 'fs/promises';

import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { Permission, type BookDockMetadata } from '@bookorbit/types';

import { AppModule } from '../../../src/app.module';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { BookDockWatcherService } from '../../../src/modules/book-dock/book-dock-watcher.service';
import { seedLibrary, waitForCondition, type Db } from '../app-harness';
import { buildFb2Fixture, createBookDockFixtureRoot, writeFixtureFile, type BookDockFixtureRoot } from './book-dock-fixture-builder';

const ADMIN_SETUP_DTO = {
  username: 'book-dock-e2e-admin',
  name: 'Book Dock E2E Admin',
  email: 'book-dock-e2e-admin@example.com',
  password: 'BookDockAdmin123',
};

interface EnvSnapshot {
  appDataPath: string | undefined;
}

export interface BookDockE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: BookDockFixtureRoot;
  envSnapshot: EnvSnapshot;
}

export interface TestUserSession {
  userId: number;
  username: string;
  password: string;
  accessToken: string;
}

export interface UploadBookDockFileInput {
  token: string;
  fileName: string;
  content: string | Buffer;
  contentType?: string;
}

export interface CreateBookDockRowInput {
  fileName?: string;
  content?: string | Buffer;
  status?: typeof schema.bookDockFiles.$inferInsert.status;
  format?: string;
  embeddedMetadata?: BookDockMetadata | null;
  selectedMetadata?: BookDockMetadata | null;
  fetchedMetadata?: BookDockMetadata | null;
  targetLibraryId?: number | null;
  targetFolderId?: number | null;
  confidence?: number | null;
  errorMessage?: string | null;
  metadataEditedAt?: Date | null;
}

export interface CreatedLibrary {
  libraryId: number;
  libraryFolderId: number;
  folderPath: string;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createBookDockE2EContext(): Promise<BookDockE2EContext> {
  const fixture = await createBookDockFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
  };

  process.env.APP_DATA_PATH = fixture.booksPath;

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.register(fastifyCookie as never);
  await app.register(fastifyMultipart as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await stopBookDockWatcher(app);

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);
  await setSetting(db, 'book_dock_auto_fetch_metadata', 'false');
  await setSetting(db, 'book_dock_auto_finalize_enabled', 'false');

  return {
    app,
    db,
    adminToken,
    fixture,
    envSnapshot,
  };
}

export async function closeBookDockE2EContext(ctx: BookDockE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function resetBookDockState(ctx: BookDockE2EContext): Promise<void> {
  await ctx.db.delete(schema.bookDockFiles);
  await rm(ctx.fixture.bookDockPath, { recursive: true, force: true });
  await mkdir(ctx.fixture.bookDockPath, { recursive: true });
}

export async function createLibraryWithFolder(
  ctx: BookDockE2EContext,
  options: {
    mode?: 'book_per_file' | 'book_per_folder';
    allowedFormats?: string[];
    name?: string;
  } = {},
): Promise<CreatedLibrary> {
  const folderPath = join(ctx.fixture.booksPath, `library-${randomUUID()}`);
  await mkdir(folderPath, { recursive: true });

  const { libraryId, libraryFolderId } = await seedLibrary(ctx.db, {
    rootPath: folderPath,
    mode: options.mode ?? 'book_per_folder',
    allowedFormats: options.allowedFormats,
    watch: false,
    name: options.name,
  });

  return {
    libraryId,
    libraryFolderId,
    folderPath,
  };
}

export async function createUserAndLogin(
  ctx: BookDockE2EContext,
  options: {
    permissions?: Permission[];
    isSuperuser?: boolean;
    username?: string;
    password?: string;
    email?: string;
  } = {},
): Promise<TestUserSession> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = options.username ?? `book-dock-user-${suffix}`;
  const password = options.password ?? 'BookDockUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 4);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Book Dock User ${suffix}`,
      email,
      passwordHash,
      isSuperuser: options.isSuperuser ?? false,
      isDefaultPassword: false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });

  const permissions = options.permissions ?? [];
  if (permissions.length > 0) {
    await ctx.db.insert(schema.userPermissions).values(permissions.map((permissionName) => ({ userId: created.id, permissionName })));
  }

  const loginResponse = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });

  if (loginResponse.statusCode !== 200) {
    throw new Error(`Login failed for ${username}: ${loginResponse.statusCode} ${loginResponse.body}`);
  }

  const loginBody = loginResponse.json() as { accessToken?: string };
  if (!loginBody.accessToken) {
    throw new Error(`Login for ${username} returned no accessToken`);
  }

  return {
    userId: created.id,
    username,
    password,
    accessToken: loginBody.accessToken,
  };
}

export async function grantLibraryAccess(
  ctx: BookDockE2EContext,
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

export async function uploadBookDockFile(ctx: BookDockE2EContext, input: UploadBookDockFileInput) {
  const contentBuffer = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
  const { body, boundary } = buildMultipartBody(input.fileName, contentBuffer, input.contentType ?? 'application/octet-stream');

  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/book-dock/upload',
    headers: {
      ...authHeader(input.token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    payload: body,
  });
}

export async function createBookDockRow(
  ctx: BookDockE2EContext,
  input: CreateBookDockRowInput = {},
): Promise<typeof schema.bookDockFiles.$inferSelect> {
  const fileName = input.fileName ?? `book-dock-${randomUUID()}.fb2`;
  const content = input.content ?? buildFb2Fixture({ title: `Title ${randomUUID()}`, authors: ['Fixture Author'] });
  const format = (input.format ?? extname(fileName).toLowerCase().slice(1)) || 'fb2';
  const relativePath = `book-dock/${fileName}`;
  const absolutePath = await writeFixtureFile(ctx.fixture.booksPath, relativePath, content);
  const fileStat = await stat(absolutePath);

  const [row] = await ctx.db
    .insert(schema.bookDockFiles)
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

export async function getBookDockRow(ctx: BookDockE2EContext, fileId: number) {
  return ctx.db.query.bookDockFiles.findFirst({
    where: eq(schema.bookDockFiles.id, fileId),
  });
}

export async function waitForBookDockStatus(
  ctx: BookDockE2EContext,
  fileId: number,
  statuses: Array<typeof schema.bookDockFiles.$inferSelect.status>,
  timeoutMs = 20_000,
): Promise<typeof schema.bookDockFiles.$inferSelect> {
  let row: typeof schema.bookDockFiles.$inferSelect | undefined;

  await waitForCondition(async () => {
    row = await getBookDockRow(ctx, fileId);
    if (!row) {
      throw new Error(`Book Dock file ${fileId} was not found`);
    }
    if (!statuses.includes(row.status)) {
      throw new Error(`Book Dock file ${fileId} is ${row.status}, waiting for one of: ${statuses.join(', ')}`);
    }
  }, timeoutMs);

  return row!;
}

export async function fileExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

function buildMultipartBody(fileName: string, content: Buffer, contentType: string): { body: Buffer; boundary: string } {
  const boundary = `----bookorbit-book-dock-${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([preamble, content, closing]), boundary };
}

async function stopBookDockWatcher(app: NestFastifyApplication): Promise<void> {
  const watcher = app.get(BookDockWatcherService);
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
    const fallbackUsername = `book-dock-e2e-admin-${suffix}`;
    const fallbackPassword = ADMIN_SETUP_DTO.password;
    const passwordHash = await hash(fallbackPassword, 4);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'Book Dock E2E Admin',
      email: `book-dock-e2e-admin-${suffix}@example.com`,
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

async function setSetting(db: Db, key: string, value: string): Promise<void> {
  const updated = await db.update(schema.appSettings).set({ value }).where(eq(schema.appSettings.key, key)).returning({ id: schema.appSettings.id });
  if (updated.length === 0) {
    throw new Error(`Missing app setting ${key}`);
  }
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.appDataPath === undefined) delete process.env.APP_DATA_PATH;
  else process.env.APP_DATA_PATH = snapshot.appDataPath;
}
