import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { hash } from 'bcryptjs';
import { sql } from 'drizzle-orm';
import mysql from 'mysql2/promise';

import type { Permission } from '@projectx/types';
import { coverDirPath } from '../../../src/modules/metadata/lib/cover';
import * as schema from '../../../src/db/schema';
import { closeE2EContext, createE2EContext, seedLibrary, type Db, type E2EContext, waitForCondition } from '../app-harness';

const TEST_USER_PREFIX = 'migration-booklore-';
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

interface EnvSnapshot {
  appDataPath: string | undefined;
  migrationEncryptionKey: string | undefined;
}

export interface MariaDbService {
  containerName: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  rootPassword: string;
}

export interface MigrationBookloreE2EContext extends E2EContext {
  db: Db;
  fixtureRoot: string;
  booksPath: string;
  sourceMediaRoot: string;
  envSnapshot: EnvSnapshot;
  mariadb: MariaDbService;
}

export interface CreatedUser {
  id: number;
  username: string;
  password: string;
  accessToken?: string;
}

export interface JsonResponse<T> {
  statusCode: number;
  body: T;
}

export async function createMigrationBookloreE2EContext(): Promise<MigrationBookloreE2EContext> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'projectx-migration-booklore-'));
  const booksPath = join(fixtureRoot, 'books');
  const sourceMediaRoot = join(fixtureRoot, 'booklore-media');
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
    migrationEncryptionKey: process.env.MIGRATION_ENCRYPTION_KEY,
  };

  await mkdir(booksPath, { recursive: true });
  await mkdir(sourceMediaRoot, { recursive: true });
  process.env.APP_DATA_PATH = booksPath;
  process.env.MIGRATION_ENCRYPTION_KEY = ENCRYPTION_KEY;

  let base: E2EContext | null = null;
  let mariadb: MariaDbService | null = null;

  try {
    base = await createE2EContext();
    mariadb = await startMariaDbContainer();
    await resetBookloreDatabase(mariadb);

    return {
      ...base,
      fixtureRoot,
      booksPath,
      sourceMediaRoot,
      envSnapshot,
      mariadb,
    };
  } catch (error) {
    if (base) {
      await closeE2EContext(base);
    }
    if (mariadb) {
      await stopMariaDbContainer(mariadb);
    }
    await rm(fixtureRoot, { recursive: true, force: true });
    restoreEnv(envSnapshot);
    throw error;
  }
}

export async function closeMigrationBookloreE2EContext(ctx: MigrationBookloreE2EContext): Promise<void> {
  await closeE2EContext(ctx);
  await stopMariaDbContainer(ctx.mariadb);
  await rm(ctx.fixtureRoot, { recursive: true, force: true });
  restoreEnv(ctx.envSnapshot);
}

export async function resetMigrationBookloreState(ctx: MigrationBookloreE2EContext): Promise<void> {
  await truncateScenarioTables(ctx.db);
  await deleteTestUsers(ctx.db);
  await resetDirectory(ctx.booksPath);
  await resetDirectory(ctx.sourceMediaRoot);
  await resetBookloreDatabase(ctx.mariadb);
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export async function apiJson<T>(
  ctx: MigrationBookloreE2EContext,
  input: {
    method: string;
    url: string;
    payload?: unknown;
    token?: string;
    headers?: Record<string, string>;
  },
): Promise<JsonResponse<T>> {
  const response = await ctx.app.inject({
    method: input.method,
    url: input.url,
    payload: input.payload,
    headers: {
      ...(input.token ? authHeader(input.token) : {}),
      ...(input.headers ?? {}),
    },
  });

  return {
    statusCode: response.statusCode,
    body: response.json() as T,
  };
}

export async function apiText(
  ctx: MigrationBookloreE2EContext,
  input: {
    method: string;
    url: string;
    payload?: unknown;
    token?: string;
    headers?: Record<string, string>;
  },
): Promise<{ statusCode: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const response = await ctx.app.inject({
    method: input.method,
    url: input.url,
    payload: input.payload,
    headers: {
      ...(input.token ? authHeader(input.token) : {}),
      ...(input.headers ?? {}),
    },
  });

  return {
    statusCode: response.statusCode,
    body: response.body,
    headers: response.headers,
  };
}

export async function createUser(
  ctx: MigrationBookloreE2EContext,
  options: {
    username?: string;
    password?: string;
    email?: string;
    isSuperuser?: boolean;
    permissions?: Permission[];
    login?: boolean;
  } = {},
): Promise<CreatedUser> {
  const suffix = randomUUID().replaceAll('-', '');
  const username = options.username ?? `${TEST_USER_PREFIX}${suffix}`;
  const password = options.password ?? 'MigrationBooklore123';
  const email = options.email ?? `${username}@example.com`;
  const passwordHash = await hash(password, 12);

  const [created] = await ctx.db
    .insert(schema.users)
    .values({
      username,
      name: `Migration Booklore ${suffix}`,
      email,
      passwordHash,
      isSuperuser: options.isSuperuser ?? false,
      isDefaultPassword: false,
      provisioningMethod: 'local',
    })
    .returning({ id: schema.users.id });

  if (options.permissions?.length) {
    await ctx.db.insert(schema.userPermissions).values(options.permissions.map((permissionName) => ({ userId: created.id, permissionName })));
  }

  const accessToken = options.login ? await loginForToken(ctx, username, password) : undefined;
  return { id: created.id, username, password, accessToken };
}

export async function waitForMigrationToFinish(
  ctx: MigrationBookloreE2EContext,
  runId: number,
  timeoutMs = 45_000,
): Promise<{
  progress: {
    run: { id: number; state: string; currentStage: string | null };
    totals: { processed: number; imported: number; skipped: number; unresolved: number; failed: number };
    metrics: Array<Record<string, unknown>>;
  };
  report: {
    run: { id: number; state: string; currentStage: string | null };
    totals: { processed: number; imported: number; skipped: number; unresolved: number; failed: number };
    metrics: Array<Record<string, unknown>>;
    plan: Record<string, unknown> | null;
    summary: Record<string, unknown> | null;
    details: Record<string, unknown>;
  };
}> {
  let latestProgress:
    | {
        run: { id: number; state: string; currentStage: string | null };
        totals: { processed: number; imported: number; skipped: number; unresolved: number; failed: number };
        metrics: Array<Record<string, unknown>>;
      }
    | undefined;

  await waitForCondition(
    async () => {
      const response = await apiJson<{
        run: { id: number; state: string; currentStage: string | null };
        totals: { processed: number; imported: number; skipped: number; unresolved: number; failed: number };
        metrics: Array<Record<string, unknown>>;
      }>(ctx, {
        method: 'GET',
        url: `/api/v1/migration/runs/${runId}/progress`,
        token: ctx.adminToken,
      });

      if (response.statusCode !== 200) {
        throw new Error(`Unexpected progress response: ${response.statusCode}`);
      }
      latestProgress = response.body;
      if (response.body.run.state === 'running') {
        throw new Error(`Migration run ${runId} is still running`);
      }
    },
    timeoutMs,
    200,
  );

  const reportResponse = await apiJson<{
    run: { id: number; state: string; currentStage: string | null };
    totals: { processed: number; imported: number; skipped: number; unresolved: number; failed: number };
    metrics: Array<Record<string, unknown>>;
    plan: Record<string, unknown> | null;
    summary: Record<string, unknown> | null;
    details: Record<string, unknown>;
  }>(ctx, {
    method: 'GET',
    url: `/api/v1/migration/runs/${runId}/report`,
    token: ctx.adminToken,
  });

  if (reportResponse.statusCode !== 200) {
    throw new Error(`Unexpected report response: ${reportResponse.statusCode}`);
  }

  return {
    progress: latestProgress!,
    report: reportResponse.body,
  };
}

export function coverDirectoryForBook(ctx: MigrationBookloreE2EContext, bookId: number): string {
  return coverDirPath(ctx.booksPath, bookId);
}

export function buildBookloreConnectionConfig(
  ctx: MigrationBookloreE2EContext,
  overrides: Partial<Record<'host' | 'port' | 'user' | 'password' | 'database' | 'ssl' | 'mediaRootPath', unknown>> = {},
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    host: ctx.mariadb.host,
    port: ctx.mariadb.port,
    user: ctx.mariadb.user,
    password: ctx.mariadb.password,
    database: ctx.mariadb.database,
    ssl: false,
    mediaRootPath: ctx.sourceMediaRoot,
    ...overrides,
  };

  if (config.mediaRootPath === null) {
    delete config.mediaRootPath;
  }

  return config;
}

export async function withBookloreConnection<T>(
  ctx: MigrationBookloreE2EContext,
  handler: (connection: mysql.Connection) => Promise<T>,
  options: { root?: boolean; database?: string } = {},
): Promise<T> {
  const connection = await mysql.createConnection({
    host: ctx.mariadb.host,
    port: ctx.mariadb.port,
    user: options.root ? 'root' : ctx.mariadb.user,
    password: options.root ? ctx.mariadb.rootPassword : ctx.mariadb.password,
    database: options.database ?? ctx.mariadb.database,
    multipleStatements: true,
  });

  try {
    return await handler(connection);
  } finally {
    await connection.end();
  }
}

async function loginForToken(ctx: MigrationBookloreE2EContext, username: string, password: string): Promise<string> {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username, password },
  });

  if (response.statusCode !== 200) {
    throw new Error(`Login failed for ${username}: ${response.statusCode} ${response.body}`);
  }

  const body = response.json() as { accessToken?: string };
  if (!body.accessToken) {
    throw new Error(`Login returned no accessToken for ${username}`);
  }

  return body.accessToken;
}

async function startMariaDbContainer(): Promise<MariaDbService> {
  await runCommand('docker', ['version', '--format', '{{.Server.Version}}']);

  const containerName = `projectx-migration-booklore-${randomUUID()}`;
  const database = 'booklore';
  const user = 'booklore';
  const password = 'booklore-secret';
  const rootPassword = 'root-secret';

  await runCommand('docker', [
    'run',
    '--rm',
    '-d',
    '--name',
    containerName,
    '-e',
    `MARIADB_DATABASE=${database}`,
    '-e',
    `MARIADB_USER=${user}`,
    '-e',
    `MARIADB_PASSWORD=${password}`,
    '-e',
    `MARIADB_ROOT_PASSWORD=${rootPassword}`,
    '-p',
    '127.0.0.1::3306',
    'mariadb:11.4',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_unicode_ci',
  ]);

  const portText = await runCommand('docker', ['inspect', '-f', '{{(index (index .NetworkSettings.Ports "3306/tcp") 0).HostPort}}', containerName]);
  const port = Number(portText.trim());

  if (!Number.isFinite(port) || port < 1) {
    throw new Error(`Could not resolve MariaDB port for container ${containerName}`);
  }

  const service: MariaDbService = {
    containerName,
    host: '127.0.0.1',
    port,
    database,
    user,
    password,
    rootPassword,
  };

  await waitForCondition(
    async () => {
      const connection = await mysql.createConnection({
        host: service.host,
        port: service.port,
        user: 'root',
        password: service.rootPassword,
      });
      try {
        await connection.query('SELECT 1');
      } finally {
        await connection.end();
      }
    },
    60_000,
    1_000,
  );

  return service;
}

async function stopMariaDbContainer(service: MariaDbService): Promise<void> {
  await runCommand('docker', ['rm', '-f', service.containerName], true);
}

async function resetBookloreDatabase(service: MariaDbService): Promise<void> {
  const connection = await mysql.createConnection({
    host: service.host,
    port: service.port,
    user: 'root',
    password: service.rootPassword,
    multipleStatements: true,
  });

  try {
    await connection.query(`DROP DATABASE IF EXISTS \`${service.database}\``);
    await connection.query(`CREATE DATABASE \`${service.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`GRANT ALL PRIVILEGES ON \`${service.database}\`.* TO '${service.user}'@'%'`);
    await connection.query('FLUSH PRIVILEGES');
  } finally {
    await connection.end();
  }
}

async function runCommand(command: string, args: string[], allowFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      reject(error);
    });

    child.once('exit', (code) => {
      if (code === 0 || allowFailure) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim() || stdout.trim() || `exit code ${code ?? 'unknown'}`}`));
    });
  });
}

async function truncateScenarioTables(db: Db): Promise<void> {
  await db.execute(
    sql.raw(`
      TRUNCATE TABLE
        migration_run_metrics,
        migration_runs,
        migration_plan_artifacts,
        migration_profiles,
        migration_sources,
        collection_books,
        collections,
        annotations,
        bookmarks,
        audiobook_progress,
        reading_progress,
        user_book_status,
        reader_preferences,
        reader_default_preferences,
        reading_sessions,
        user_reading_daily_stats,
        book_tags,
        tags,
        book_genres,
        genres,
        book_narrators,
        narrators,
        book_authors,
        authors,
        book_metadata,
        book_files,
        books,
        library_folders,
        libraries
      RESTART IDENTITY CASCADE
    `),
  );
}

async function deleteTestUsers(db: Db): Promise<void> {
  await db.execute(sql.raw(`DELETE FROM user_permissions WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}%')`));
  await db.execute(sql.raw(`DELETE FROM user_library_access WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}%')`));
  await db.execute(sql.raw(`DELETE FROM refresh_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}%')`));
  await db.execute(sql.raw(`DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE username LIKE '${TEST_USER_PREFIX}%')`));
  await db.execute(sql.raw(`DELETE FROM users WHERE username LIKE '${TEST_USER_PREFIX}%'`));
}

async function resetDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

function restoreEnv(snapshot: EnvSnapshot): void {
  process.env.APP_DATA_PATH = snapshot.appDataPath;
  process.env.MIGRATION_ENCRYPTION_KEY = snapshot.migrationEncryptionKey;
}

export { seedLibrary };
