import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { hash } from 'bcryptjs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { sql } from 'drizzle-orm';

import type { Permission } from '@bookorbit/types';
import * as schema from '../../../src/db/schema';
import { closeE2EContext, createE2EContext, type Db, type E2EContext, waitForCondition } from '../app-harness';

const DEFAULT_ABS_IMAGE = 'ghcr.io/advplyr/audiobookshelf:2.36.0';
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_USER_PREFIX = 'migration-audiobookshelf-';
const MAX_ABS_LOG_BYTES = 16 * 1024;

interface EnvSnapshot {
  appDataPath: string | undefined;
  migrationEncryptionKey: string | undefined;
  migrationImportRoot: string | undefined;
}

export interface AudiobookshelfService {
  baseUrl: string;
  containerName: string;
  image: string;
  port: number;
  rootToken: string;
}

export interface MigrationAudiobookshelfE2EContext extends E2EContext {
  db: Db;
  fixtureRoot: string;
  booksPath: string;
  sourceMediaRoot: string;
  configDir: string;
  metadataDir: string;
  backupDir: string;
  targetLibraryRoot: string;
  envSnapshot: EnvSnapshot;
  audiobookshelf: AudiobookshelfService;
}

export interface CreatedUser {
  id: number;
  username: string;
  password: string;
}

export interface JsonResponse<T> {
  statusCode: number;
  body: T;
}

export async function createMigrationAudiobookshelfE2EContext(
  prepareMedia: (sourceMediaRoot: string) => Promise<void>,
): Promise<MigrationAudiobookshelfE2EContext> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'bookorbit-migration-audiobookshelf-'));
  const booksPath = join(fixtureRoot, 'app-data');
  const sourceMediaRoot = join(fixtureRoot, 'audiobookshelf-media');
  const configDir = join(fixtureRoot, 'audiobookshelf-config');
  const metadataDir = join(fixtureRoot, 'audiobookshelf-metadata');
  const backupDir = join(fixtureRoot, 'audiobookshelf-backups');
  const targetLibraryRoot = join(fixtureRoot, 'bookorbit-library');
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
    migrationEncryptionKey: process.env.MIGRATION_ENCRYPTION_KEY,
    migrationImportRoot: process.env.MIGRATION_IMPORT_ROOT,
  };

  await Promise.all(
    [booksPath, sourceMediaRoot, configDir, metadataDir, backupDir, targetLibraryRoot].map((path) => mkdir(path, { recursive: true })),
  );
  await prepareMedia(sourceMediaRoot);

  process.env.APP_DATA_PATH = booksPath;
  process.env.MIGRATION_ENCRYPTION_KEY = ENCRYPTION_KEY;
  process.env.MIGRATION_IMPORT_ROOT = fixtureRoot;

  let base: E2EContext | null = null;
  let audiobookshelf: AudiobookshelfService | null = null;
  try {
    audiobookshelf = await startAudiobookshelfContainer({ configDir, metadataDir, backupDir, sourceMediaRoot });
    base = await createE2EContext();
    return {
      ...base,
      fixtureRoot,
      booksPath,
      sourceMediaRoot,
      configDir,
      metadataDir,
      backupDir,
      targetLibraryRoot,
      envSnapshot,
      audiobookshelf,
    };
  } catch (error) {
    await Promise.allSettled([
      base ? closeE2EContext(base) : Promise.resolve(),
      audiobookshelf ? stopAudiobookshelfContainer(audiobookshelf, true) : Promise.resolve(),
    ]);
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined);
    restoreEnv(envSnapshot);
    throw error;
  }
}

export async function closeMigrationAudiobookshelfE2EContext(ctx: MigrationAudiobookshelfE2EContext, captureLogs = false): Promise<void> {
  const results = await Promise.allSettled([closeE2EContext(ctx), stopAudiobookshelfContainer(ctx.audiobookshelf, captureLogs)]);
  const fixtureResult = await Promise.allSettled([rm(ctx.fixtureRoot, { recursive: true, force: true })]);
  restoreEnv(ctx.envSnapshot);
  const failed = [...results, ...fixtureResult].find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}

export function buildApiConnectionConfig(ctx: MigrationAudiobookshelfE2EContext): Record<string, unknown> {
  return {
    mode: 'api',
    baseUrl: ctx.audiobookshelf.baseUrl,
    apiToken: ctx.audiobookshelf.rootToken,
    allowPrivateNetwork: true,
  };
}

export function buildBackupConnectionConfig(backupPath: string): Record<string, unknown> {
  return { mode: 'backup', backupPath };
}

export async function apiJson<T>(
  ctx: MigrationAudiobookshelfE2EContext,
  input: { method: string; url: string; payload?: unknown; token?: string },
): Promise<JsonResponse<T>> {
  const response = await ctx.app.inject({
    method: input.method,
    url: input.url,
    payload: input.payload,
    headers: input.token ? { authorization: `Bearer ${input.token}` } : undefined,
  });
  return { statusCode: response.statusCode, body: response.json() as T };
}

export async function absJson<T>(
  service: AudiobookshelfService,
  input: { method?: string; path: string; payload?: unknown; token?: string },
): Promise<T> {
  const response = await fetch(new URL(input.path, `${service.baseUrl}/`), {
    method: input.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(input.payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
    },
    body: input.payload === undefined ? undefined : JSON.stringify(input.payload),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 2_000);
    throw new Error(`Audiobookshelf ${input.method ?? 'GET'} ${input.path} failed (${response.status}): ${body}`);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
  const body = await response.text();
  if (!body) return undefined as T;
  if (!response.headers.get('content-type')?.includes('application/json')) return body as T;
  return JSON.parse(body) as T;
}

export async function createUser(
  ctx: MigrationAudiobookshelfE2EContext,
  options: { username: string; name: string; email: string; permissions?: Permission[] },
): Promise<CreatedUser> {
  const password = 'MigrationAudiobookshelf123';
  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username: options.username,
      name: options.name,
      email: options.email,
      passwordHash: await hash(password, 4),
      isDefaultPassword: false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });
  if (options.permissions?.length) {
    await ctx.db.insert(schema.userPermissions).values(options.permissions.map((permissionName) => ({ userId: created.id, permissionName })));
  }
  return { id: created.id, username: options.username, password };
}

export async function waitForMigrationToFinish(
  ctx: MigrationAudiobookshelfE2EContext,
  runId: number,
  timeoutMs = 60_000,
): Promise<{
  progress: { run: { id: number; state: string }; totals: Record<string, number>; metrics: Array<Record<string, unknown>> };
  report: {
    run: { id: number; state: string };
    totals: Record<string, number>;
    plan: Record<string, unknown> | null;
    details: Record<string, unknown>;
  };
}> {
  let progress: { run: { id: number; state: string }; totals: Record<string, number>; metrics: Array<Record<string, unknown>> } | undefined;
  await waitForCondition(
    async () => {
      const response = await apiJson<typeof progress>(ctx, {
        method: 'GET',
        url: `/api/v1/migration/runs/${runId}/progress`,
        token: ctx.adminToken,
      });
      if (response.statusCode !== 200 || !response.body) throw new Error(`Unexpected migration progress response ${response.statusCode}`);
      progress = response.body;
      if (progress.run.state === 'running') throw new Error(`Migration run ${runId} is still running`);
    },
    timeoutMs,
    250,
  );
  const report = await apiJson<{
    run: { id: number; state: string };
    totals: Record<string, number>;
    plan: Record<string, unknown> | null;
    details: Record<string, unknown>;
  }>(ctx, { method: 'GET', url: `/api/v1/migration/runs/${runId}/report`, token: ctx.adminToken });
  if (report.statusCode !== 200) throw new Error(`Unexpected migration report response ${report.statusCode}`);
  return { progress: progress!, report: report.body };
}

export async function truncateMigrationScenarioTables(db: Db): Promise<void> {
  await db.execute(
    sql.raw(`
      TRUNCATE TABLE
        migration_run_metrics, migration_runs, migration_plan_artifacts, migration_profiles, migration_sources,
        bookmarks, audiobook_progress, reading_progress, user_book_status, reading_sessions,
        book_tags, tags, book_genres, genres, book_narrators, narrators, book_authors, authors,
        book_metadata, book_files, books, library_folders, libraries
      RESTART IDENTITY CASCADE
    `),
  );
  await db.execute(sql.raw(`DELETE FROM users WHERE username LIKE '${TEST_USER_PREFIX}%'`));
}

export async function resolveBackupPath(ctx: MigrationAudiobookshelfE2EContext): Promise<string> {
  await absJson(ctx.audiobookshelf, { method: 'POST', path: '/api/backups', token: ctx.audiobookshelf.rootToken });
  let backup: { id: string; filename: string } | undefined;
  await waitForCondition(
    async () => {
      const response = await absJson<{ backups: Array<{ id?: string; filename?: string }> }>(ctx.audiobookshelf, {
        path: '/api/backups',
        token: ctx.audiobookshelf.rootToken,
      });
      const latest = response.backups.at(-1);
      if (!latest?.id || !latest.filename) throw new Error('Audiobookshelf backup is not available yet');
      backup = { id: latest.id, filename: latest.filename };
    },
    30_000,
    250,
  );
  const response = await fetch(new URL(`/api/backups/${encodeURIComponent(backup!.id)}/download`, `${ctx.audiobookshelf.baseUrl}/`), {
    headers: { authorization: `Bearer ${ctx.audiobookshelf.rootToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Audiobookshelf backup download failed (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 64 * 1024 * 1024) {
    throw new Error(`Audiobookshelf backup download size is invalid (${bytes.byteLength} bytes)`);
  }
  const backupPath = join(ctx.backupDir, backup!.filename);
  await writeFile(backupPath, bytes, { mode: 0o600 });
  return backupPath;
}

async function startAudiobookshelfContainer(paths: {
  configDir: string;
  metadataDir: string;
  backupDir: string;
  sourceMediaRoot: string;
}): Promise<AudiobookshelfService> {
  await runCommand('docker', ['version', '--format', '{{.Server.Version}}']);
  const containerName = `bookorbit-migration-audiobookshelf-${randomUUID()}`;
  const image = process.env.ABS_E2E_IMAGE || DEFAULT_ABS_IMAGE;
  await runCommand('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '-e',
    'TZ=UTC',
    '-e',
    'BACKUP_PATH=/backups',
    '-p',
    '127.0.0.1::80',
    '-v',
    `${paths.configDir}:/config`,
    '-v',
    `${paths.metadataDir}:/metadata`,
    '-v',
    `${paths.backupDir}:/backups`,
    '-v',
    `${paths.sourceMediaRoot}:/audiobooks:ro`,
    image,
  ]);
  try {
    const portText = await runCommand('docker', ['inspect', '-f', '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}', containerName]);
    const port = Number(portText.trim());
    if (!Number.isInteger(port) || port < 1) throw new Error(`Could not resolve Audiobookshelf port for ${containerName}`);
    const service: AudiobookshelfService = { baseUrl: `http://127.0.0.1:${port}`, containerName, image, port, rootToken: '' };

    await waitForCondition(
      async () => {
        const response = await fetch(`${service.baseUrl}/status`, { signal: AbortSignal.timeout(2_000) });
        if (!response.ok) throw new Error(`Audiobookshelf status returned ${response.status}`);
      },
      60_000,
      500,
    );
    const username = 'migration-root';
    const password = 'AudiobookshelfMigration123';
    await absJson(service, { method: 'POST', path: '/init', payload: { newRoot: { username, password } } });
    const login = await absJson<{ user: { accessToken?: string } }>(service, { method: 'POST', path: '/login', payload: { username, password } });
    if (!login.user.accessToken) throw new Error('Audiobookshelf login returned no access token');
    service.rootToken = login.user.accessToken;
    return service;
  } catch (error) {
    await runCommand('docker', ['rm', '-f', containerName], true);
    throw error;
  }
}

async function stopAudiobookshelfContainer(service: AudiobookshelfService, captureLogs: boolean): Promise<void> {
  if (captureLogs) {
    const logs = await runCommand('docker', ['logs', '--tail', '200', service.containerName], true);
    if (logs) {
      const tokenRedacted = service.rootToken ? logs.replaceAll(service.rootToken, '[REDACTED]') : logs;
      const sanitized = tokenRedacted.replace(/(password|token|authorization)([=: ]+)[^\s,}]+/gi, '$1$2[REDACTED]').slice(-MAX_ABS_LOG_BYTES);
      process.stderr.write(`\nAudiobookshelf E2E logs (${service.containerName}):\n${sanitized}\n`);
    }
  }
  await runCommand('docker', ['rm', '-f', service.containerName], true);
}

async function runCommand(command: string, args: string[], allowFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 || allowFailure) return resolve(stdout.trim() || stderr.trim());
      reject(new Error(`${command} failed (${code ?? 'unknown'}): ${(stderr || stdout).trim().slice(-4_000)}`));
    });
  });
}

function restoreEnv(snapshot: EnvSnapshot): void {
  setOrDeleteEnv('APP_DATA_PATH', snapshot.appDataPath);
  setOrDeleteEnv('MIGRATION_ENCRYPTION_KEY', snapshot.migrationEncryptionKey);
  setOrDeleteEnv('MIGRATION_IMPORT_ROOT', snapshot.migrationImportRoot);
}

function setOrDeleteEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
