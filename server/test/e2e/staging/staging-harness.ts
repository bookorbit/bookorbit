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
import { Permission, type StagingMetadata } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { StagingWatcherService } from '../../../src/modules/staging/staging-watcher.service';
import { seedLibrary, waitForCondition, type Db } from '../app-harness';
import { buildFb2Fixture, createStagingFixtureRoot, writeFixtureFile, type StagingFixtureRoot } from './staging-fixture-builder';

const ADMIN_SETUP_DTO = {
  username: 'staging-e2e-admin',
  name: 'Staging E2E Admin',
  email: 'staging-e2e-admin@example.com',
  password: 'StagingAdmin123',
};

interface EnvSnapshot {
  booksPath: string | undefined;
  stagingPath: string | undefined;
}

export interface StagingE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: StagingFixtureRoot;
  envSnapshot: EnvSnapshot;
}

export interface TestUserSession {
  userId: number;
  username: string;
  password: string;
  accessToken: string;
}

export interface UploadStagingFileInput {
  token: string;
  fileName: string;
  content: string | Buffer;
  contentType?: string;
}

export interface CreateStagingRowInput {
  fileName?: string;
  content?: string | Buffer;
  status?: typeof schema.stagingFiles.$inferInsert.status;
  format?: string;
  embeddedMetadata?: StagingMetadata | null;
  selectedMetadata?: StagingMetadata | null;
  fetchedMetadata?: StagingMetadata | null;
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

export async function createStagingE2EContext(): Promise<StagingE2EContext> {
  const fixture = await createStagingFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    booksPath: process.env.BOOKS_PATH,
    stagingPath: process.env.STAGING_PATH,
  };

  process.env.BOOKS_PATH = fixture.booksPath;
  process.env.STAGING_PATH = fixture.stagingPath;

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

  await stopStagingWatcher(app);

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);
  await setSetting(db, 'staging_auto_fetch_metadata', 'false');
  await setSetting(db, 'staging_auto_finalize_enabled', 'false');

  return {
    app,
    db,
    adminToken,
    fixture,
    envSnapshot,
  };
}

export async function closeStagingE2EContext(ctx: StagingE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function resetStagingState(ctx: StagingE2EContext): Promise<void> {
  await ctx.db.delete(schema.stagingFiles);
  await rm(ctx.fixture.stagingPath, { recursive: true, force: true });
  await mkdir(ctx.fixture.stagingPath, { recursive: true });
}

export async function createLibraryWithFolder(
  ctx: StagingE2EContext,
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
  ctx: StagingE2EContext,
  options: {
    permissions?: Permission[];
    isSuperuser?: boolean;
    username?: string;
    password?: string;
    email?: string;
  } = {},
): Promise<TestUserSession> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = options.username ?? `staging-user-${suffix}`;
  const password = options.password ?? 'StagingUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Staging User ${suffix}`,
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
  ctx: StagingE2EContext,
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

export async function uploadStagingFile(ctx: StagingE2EContext, input: UploadStagingFileInput) {
  const contentBuffer = typeof input.content === 'string' ? Buffer.from(input.content, 'utf8') : input.content;
  const { body, boundary } = buildMultipartBody(input.fileName, contentBuffer, input.contentType ?? 'application/octet-stream');

  return ctx.app.inject({
    method: 'POST',
    url: '/api/v1/staging/upload',
    headers: {
      ...authHeader(input.token),
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(body.length),
    },
    payload: body,
  });
}

export async function createStagingRow(ctx: StagingE2EContext, input: CreateStagingRowInput = {}): Promise<typeof schema.stagingFiles.$inferSelect> {
  const fileName = input.fileName ?? `staging-${randomUUID()}.fb2`;
  const content = input.content ?? buildFb2Fixture({ title: `Title ${randomUUID()}`, authors: ['Fixture Author'] });
  const format = (input.format ?? extname(fileName).toLowerCase().slice(1)) || 'fb2';
  const relativePath = `staging/${fileName}`;
  const absolutePath = await writeFixtureFile(ctx.fixture.booksPath, relativePath, content);
  const fileStat = await stat(absolutePath);

  const [row] = await ctx.db
    .insert(schema.stagingFiles)
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

export async function getStagingRow(ctx: StagingE2EContext, fileId: number) {
  return ctx.db.query.stagingFiles.findFirst({
    where: eq(schema.stagingFiles.id, fileId),
  });
}

export async function waitForStagingStatus(
  ctx: StagingE2EContext,
  fileId: number,
  statuses: Array<typeof schema.stagingFiles.$inferSelect.status>,
  timeoutMs = 20_000,
): Promise<typeof schema.stagingFiles.$inferSelect> {
  let row: typeof schema.stagingFiles.$inferSelect | undefined;

  await waitForCondition(async () => {
    row = await getStagingRow(ctx, fileId);
    if (!row) {
      throw new Error(`Staging file ${fileId} was not found`);
    }
    if (!statuses.includes(row.status)) {
      throw new Error(`Staging file ${fileId} is ${row.status}, waiting for one of: ${statuses.join(', ')}`);
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
  const boundary = `----projectx-staging-${randomUUID()}`;
  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    'utf8',
  );
  const closing = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([preamble, content, closing]), boundary };
}

async function stopStagingWatcher(app: NestFastifyApplication): Promise<void> {
  const watcher = app.get(StagingWatcherService);
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
    const fallbackUsername = `staging-e2e-admin-${suffix}`;
    const fallbackPassword = ADMIN_SETUP_DTO.password;
    const passwordHash = await hash(fallbackPassword, 12);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'Staging E2E Admin',
      email: `staging-e2e-admin-${suffix}@example.com`,
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
  if (snapshot.booksPath === undefined) delete process.env.BOOKS_PATH;
  else process.env.BOOKS_PATH = snapshot.booksPath;

  if (snapshot.stagingPath === undefined) delete process.env.STAGING_PATH;
  else process.env.STAGING_PATH = snapshot.stagingPath;
}
