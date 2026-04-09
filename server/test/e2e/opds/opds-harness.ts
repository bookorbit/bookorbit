import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdir } from 'fs/promises';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DEFAULT_FORMAT_PRIORITY, type Permission } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { MetadataService } from '../../../src/modules/metadata/metadata.service';
import { BookBucketWatcherService } from '../../../src/modules/book-bucket/book-bucket-watcher.service';
import { seedLibrary, waitForScanCompletion } from '../app-harness';
import { createOpdsFixtureRoot, type OpdsFixtureRoot, writeFixtureFile } from './opds-fixture-builder';

type Db = NodePgDatabase<typeof schema>;

const ADMIN_SETUP_DTO = {
  username: 'opds-e2e-admin',
  name: 'OPDS E2E Admin',
  email: 'opds-e2e-admin@example.com',
  password: 'OpdsE2EAdmin123',
};

interface EnvSnapshot {
  appDataPath: string | undefined;
}

export interface OpdsE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: OpdsFixtureRoot;
  envSnapshot: EnvSnapshot;
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

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function basicAuth(username: string, password: string): string {
  const value = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${value}`;
}

export async function createOpdsE2EContext(): Promise<OpdsE2EContext> {
  const fixture = await createOpdsFixtureRoot();
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
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await stopBookBucketWatcher(app);

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);
  await setSettingValue(db, 'opds_enabled', 'true');

  return {
    app,
    db,
    adminToken,
    fixture,
    envSnapshot,
  };
}

export async function closeOpdsE2EContext(ctx: OpdsE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function createLibraryWithFolder(
  ctx: OpdsE2EContext,
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
      name: options.name ?? `opds-e2e-library-${randomUUID()}`,
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
  ctx: OpdsE2EContext,
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

export async function locateBookByAbsolutePath(ctx: OpdsE2EContext, absolutePath: string): Promise<LocatedBookFile> {
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
  ctx: OpdsE2EContext,
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

export async function createUserAndLogin(
  ctx: OpdsE2EContext,
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
  const username = options.username ?? `opds-e2e-user-${suffix}`;
  const password = options.password ?? 'OpdsE2EUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `OPDS E2E User ${suffix}`,
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
  ctx: OpdsE2EContext,
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

export async function replaceUserPermissions(ctx: OpdsE2EContext, userId: number, permissions: Permission[]): Promise<void> {
  await ctx.db.delete(schema.userPermissions).where(eq(schema.userPermissions.userId, userId));
  if (permissions.length === 0) return;
  await ctx.db.insert(schema.userPermissions).values(permissions.map((permissionName) => ({ userId, permissionName })));
}

export async function setUserActive(ctx: OpdsE2EContext, userId: number, active: boolean): Promise<void> {
  await ctx.db.update(schema.users).set({ active }).where(eq(schema.users.id, userId));
}

export async function setSetting(ctx: OpdsE2EContext, key: string, value: string): Promise<void> {
  await setSettingValue(ctx.db, key, value);
}

export async function createOpdsUserCredential(
  ctx: OpdsE2EContext,
  input: {
    userId: number;
    username?: string;
    password?: string;
    sortOrder?: typeof schema.opdsUsers.$inferInsert.sortOrder;
  },
): Promise<{ row: typeof schema.opdsUsers.$inferSelect; password: string }> {
  const username = input.username ?? `opds-${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const password = input.password ?? 'OpdsCredential123';
  const passwordHash = await hash(password, 12);

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
    const fallbackUsername = `opds-e2e-admin-${suffix}`;
    const passwordHash = await hash(ADMIN_SETUP_DTO.password, 12);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'OPDS E2E Admin',
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

export { seedLibrary };
