import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdir } from 'fs/promises';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Permission } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { MetadataService } from '../../../src/modules/metadata/metadata.service';
import { StagingWatcherService } from '../../../src/modules/staging/staging-watcher.service';
import { seedLibrary } from '../app-harness';
import { createUsersAdminLifecycleFixtureRoot, type UsersAdminLifecycleFixtureRoot } from './users-admin-lifecycle-fixture-builder';

type Db = NodePgDatabase<typeof schema>;

const ADMIN_SETUP_DTO = {
  username: 'users-admin-lifecycle-e2e-admin',
  name: 'Users Admin Lifecycle E2E Admin',
  email: 'users-admin-lifecycle-e2e-admin@example.com',
  password: 'UsersAdminLifecycleE2E123',
};
const MAX_MULTIPART_BYTES = 20 * 1024 * 1024;

interface EnvSnapshot {
  booksPath: string | undefined;
  stagingPath: string | undefined;
}

export interface UsersAdminLifecycleE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: UsersAdminLifecycleFixtureRoot;
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

export interface OidcUserSeed {
  userId: number;
  username: string;
  email: string;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createUsersAdminLifecycleE2EContext(): Promise<UsersAdminLifecycleE2EContext> {
  const fixture = await createUsersAdminLifecycleFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    booksPath: process.env.BOOKS_PATH,
    stagingPath: process.env.STAGING_PATH,
  };

  process.env.BOOKS_PATH = fixture.booksPath;
  process.env.STAGING_PATH = fixture.stagingPath;

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
  await app.register(fastifyCookie as never);
  await app.register(fastifyMultipart as never, { limits: { fileSize: MAX_MULTIPART_BYTES } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  await stopStagingWatcher(app);

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

export async function closeUsersAdminLifecycleE2EContext(ctx: UsersAdminLifecycleE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function createLibraryWithFolder(
  ctx: UsersAdminLifecycleE2EContext,
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

export async function createUserAndLogin(
  ctx: UsersAdminLifecycleE2EContext,
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
  const username = options.username ?? `users-admin-lifecycle-${suffix}`;
  const password = options.password ?? 'UsersAdminLifecycleUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Users Admin Lifecycle ${suffix}`,
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

export async function createOidcUser(
  ctx: UsersAdminLifecycleE2EContext,
  options: {
    username?: string;
    email?: string;
  } = {},
): Promise<OidcUserSeed> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = options.username ?? `users-admin-lifecycle-oidc-${suffix}`;
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(`OIDC_${suffix}`, 12);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Users Admin Lifecycle OIDC ${suffix}`,
      email,
      passwordHash,
      active: true,
      isSuperuser: false,
      isDefaultPassword: false,
      provisioningMethod: 'oidc',
      oidcSubject: `oidc-subject-${suffix}`,
      oidcIssuer: 'https://oidc.example.com',
    })
    .returning({ id: schema.users.id });

  return {
    userId: created.id,
    username,
    email,
  };
}

export async function grantLibraryAccess(
  ctx: UsersAdminLifecycleE2EContext,
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

export async function setUserActive(ctx: UsersAdminLifecycleE2EContext, userId: number, active: boolean): Promise<void> {
  await ctx.db.update(schema.users).set({ active }).where(eq(schema.users.id, userId));
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
    const fallbackUsername = `users-admin-lifecycle-admin-${suffix}`;
    const passwordHash = await hash(ADMIN_SETUP_DTO.password, 12);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'Users Admin Lifecycle E2E Admin',
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

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.booksPath === undefined) delete process.env.BOOKS_PATH;
  else process.env.BOOKS_PATH = snapshot.booksPath;

  if (snapshot.stagingPath === undefined) delete process.env.STAGING_PATH;
  else process.env.STAGING_PATH = snapshot.stagingPath;
}
