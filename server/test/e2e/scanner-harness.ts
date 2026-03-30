import { randomUUID } from 'crypto';
import fastifyCookie from '@fastify/cookie';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { DEFAULT_FORMAT_PRIORITY } from '@projectx/types';

import { AppModule } from '../../src/app.module';
import { DB } from '../../src/db';
import * as schema from '../../src/db/schema';
import { bookFiles, books, libraries, libraryFolders, scanJobs } from '../../src/db/schema';
import { MetadataService } from '../../src/modules/metadata/metadata.service';
import { FileWatcherService } from '../../src/modules/scanner/file-watcher.service';

type Db = NodePgDatabase<typeof schema>;
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
    throw new Error('Initial setup already completed. Use the dedicated e2e database reset command before running scanner e2e tests.');
  }

  throw new Error(`Unexpected setup response: ${setupResponse.statusCode} ${setupResponse.body}`);
}

export interface ScannerE2EContext {
  app: NestFastifyApplication;
  db: Db;
  adminToken: string;
}

export async function createScannerE2EContext(): Promise<ScannerE2EContext> {
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

export async function closeScannerE2EContext(ctx: ScannerE2EContext): Promise<void> {
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
      name: input.name ?? `scanner-e2e-${input.mode}-${randomUUID()}`,
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

export async function triggerLibraryScan(ctx: ScannerE2EContext, libraryId: number): Promise<number> {
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

export async function triggerAndWaitForLibraryScan(
  ctx: ScannerE2EContext,
  libraryId: number,
  timeoutMs = 30_000,
): Promise<typeof scanJobs.$inferSelect> {
  const jobId = await triggerLibraryScan(ctx, libraryId);
  return waitForScanCompletion(ctx.db, jobId, timeoutMs);
}

export async function startLibraryWatcher(ctx: ScannerE2EContext, libraryId: number, paths: string[]): Promise<void> {
  const watcher = ctx.app.get(FileWatcherService);
  await watcher.startWatcher(libraryId, paths);
}

export async function stopLibraryWatcher(ctx: ScannerE2EContext, libraryId: number): Promise<void> {
  const watcher = ctx.app.get(FileWatcherService);
  await watcher.stopWatcher(libraryId);
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
