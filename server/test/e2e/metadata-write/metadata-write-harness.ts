import { randomUUID } from 'crypto';
import { hash } from 'bcryptjs';
import fastifyCookie from '@fastify/cookie';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mkdir } from 'fs/promises';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DEFAULT_FILE_WRITE_SETTINGS, DEFAULT_FORMAT_PRIORITY, type GlobalFileWriteSettings, type Permission } from '@projectx/types';

import { AppModule } from '../../../src/app.module';
import { DB } from '../../../src/db';
import * as schema from '../../../src/db/schema';
import { appSettings, bookFiles, books, fileWriteLog, libraries, libraryFolders, scanJobs } from '../../../src/db/schema';
import { createMetadataWriteFixtureRoot, type MetadataWriteFixtureRoot } from './metadata-write-fixture-builder';

type Db = NodePgDatabase<typeof schema>;

const ADMIN_SETUP_DTO = {
  username: 'metadata-write-e2e-admin',
  name: 'Metadata Write E2E Admin',
  email: 'metadata-write-e2e-admin@example.com',
  password: 'MetadataWriteAdmin123',
};

interface EnvSnapshot {
  booksPath: string | undefined;
  fileWriteDebounceMs: string | undefined;
  fileWriteMaxConcurrentWrites: string | undefined;
}

export interface MetadataWriteE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
  fixture: MetadataWriteFixtureRoot;
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
  bookId: number;
  bookFileId: number;
  absolutePath: string;
  relPath: string | null;
  format: string | null;
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function createMetadataWriteE2EContext(): Promise<MetadataWriteE2EContext> {
  const fixture = await createMetadataWriteFixtureRoot();
  const envSnapshot: EnvSnapshot = {
    booksPath: process.env.BOOKS_PATH,
    fileWriteDebounceMs: process.env.FILE_WRITE_DEBOUNCE_MS,
    fileWriteMaxConcurrentWrites: process.env.FILE_WRITE_MAX_CONCURRENT_WRITES,
  };

  process.env.BOOKS_PATH = fixture.booksPath;
  process.env.FILE_WRITE_DEBOUNCE_MS = '100';
  process.env.FILE_WRITE_MAX_CONCURRENT_WRITES = '1';

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix('api/v1');
  await app.register(fastifyCookie as never);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const db = app.get<Db>(DB);
  const adminToken = await getAdminToken(app, db);

  await setFileWriteSettings(db, {
    enabled: true,
    writeCover: false,
    epub: { enabled: true, maxFileSizeBytes: DEFAULT_FILE_WRITE_SETTINGS.epub.maxFileSizeBytes },
    pdf: { enabled: true, maxFileSizeBytes: DEFAULT_FILE_WRITE_SETTINGS.pdf.maxFileSizeBytes },
    cbx: { enabled: true, maxFileSizeBytes: DEFAULT_FILE_WRITE_SETTINGS.cbx.maxFileSizeBytes, formats: ['cbz', 'cb7'] },
  });

  return {
    app,
    db,
    adminToken,
    fixture,
    envSnapshot,
  };
}

export async function closeMetadataWriteE2EContext(ctx: MetadataWriteE2EContext): Promise<void> {
  await ctx.app.close();
  await ctx.fixture.cleanup();
  restoreEnv(ctx.envSnapshot);
}

export async function createLibraryWithFolder(
  ctx: MetadataWriteE2EContext,
  options: {
    mode?: 'book_per_file' | 'book_per_folder';
    allowedFormats?: string[];
    name?: string;
  } = {},
): Promise<CreatedLibrary> {
  const folderPath = `${ctx.fixture.booksPath}/library-${randomUUID()}`;
  await mkdir(folderPath, { recursive: true });

  const [library] = await ctx.db
    .insert(libraries)
    .values({
      name: options.name ?? `metadata-write-${randomUUID()}`,
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
  ctx: MetadataWriteE2EContext,
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

export async function locateBookFileByRelPath(ctx: MetadataWriteE2EContext, libraryId: number, relPath: string): Promise<LocatedBookFile> {
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

export async function setFileWriteSettings(db: Db, patch: Partial<GlobalFileWriteSettings>): Promise<GlobalFileWriteSettings> {
  const currentRow = await db.query.appSettings.findFirst({
    where: eq(appSettings.key, 'file_write_settings'),
  });

  const current = parseFileWriteSettings(currentRow?.value);
  const merged = mergeFileWriteSettings(current, patch);
  const value = JSON.stringify(merged);

  await db.insert(appSettings).values({ key: 'file_write_settings', value }).onConflictDoUpdate({
    target: appSettings.key,
    set: { value },
  });

  return merged;
}

export async function getLatestWriteLogEntry(db: Db, bookId: number, triggeredBy?: 'auto' | 'sync') {
  const rows = await db
    .select()
    .from(fileWriteLog)
    .where(triggeredBy ? and(eq(fileWriteLog.bookId, bookId), eq(fileWriteLog.triggeredBy, triggeredBy)) : eq(fileWriteLog.bookId, bookId))
    .orderBy(desc(fileWriteLog.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function waitForWriteLogEntry(
  db: Db,
  bookId: number,
  options: { triggeredBy?: 'auto' | 'sync'; status?: 'success' | 'skipped' | 'failed'; timeoutMs?: number } = {},
) {
  let row: typeof fileWriteLog.$inferSelect | null = null;

  await waitForCondition(async () => {
    row = await getLatestWriteLogEntry(db, bookId, options.triggeredBy);
    if (!row) {
      throw new Error(`Write log not found for book ${bookId}`);
    }
    if (options.status && row.status !== options.status) {
      throw new Error(`Write log status mismatch for book ${bookId}: expected ${options.status}, received ${row.status}`);
    }
  }, options.timeoutMs ?? 15_000);

  return row!;
}

export async function createUserAndLogin(
  ctx: MetadataWriteE2EContext,
  options: {
    permissions?: Permission[];
    isSuperuser?: boolean;
    username?: string;
    password?: string;
    email?: string;
  } = {},
): Promise<TestUserSession> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = options.username ?? `metadata-write-user-${suffix}`;
  const password = options.password ?? 'MetadataWriteUser123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Metadata Write User ${suffix}`,
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
  ctx: MetadataWriteE2EContext,
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
    const fallbackUsername = `metadata-write-admin-${suffix}`;
    const passwordHash = await hash(ADMIN_SETUP_DTO.password, 12);

    await db.insert(schema.users).values({
      username: fallbackUsername,
      name: 'Metadata Write E2E Admin',
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

function parseFileWriteSettings(value: string | undefined): GlobalFileWriteSettings {
  if (!value) return { ...DEFAULT_FILE_WRITE_SETTINGS };
  try {
    const parsed = JSON.parse(value) as Partial<GlobalFileWriteSettings>;
    return mergeFileWriteSettings(DEFAULT_FILE_WRITE_SETTINGS, parsed);
  } catch {
    return { ...DEFAULT_FILE_WRITE_SETTINGS };
  }
}

function mergeFileWriteSettings(base: GlobalFileWriteSettings, patch: Partial<GlobalFileWriteSettings>): GlobalFileWriteSettings {
  return {
    ...base,
    ...patch,
    epub: { ...base.epub, ...(patch.epub ?? {}) },
    pdf: { ...base.pdf, ...(patch.pdf ?? {}) },
    cbx: { ...base.cbx, ...(patch.cbx ?? {}) },
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.booksPath === undefined) delete process.env.BOOKS_PATH;
  else process.env.BOOKS_PATH = snapshot.booksPath;

  if (snapshot.fileWriteDebounceMs === undefined) delete process.env.FILE_WRITE_DEBOUNCE_MS;
  else process.env.FILE_WRITE_DEBOUNCE_MS = snapshot.fileWriteDebounceMs;

  if (snapshot.fileWriteMaxConcurrentWrites === undefined) delete process.env.FILE_WRITE_MAX_CONCURRENT_WRITES;
  else process.env.FILE_WRITE_MAX_CONCURRENT_WRITES = snapshot.fileWriteMaxConcurrentWrites;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
