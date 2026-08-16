import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { copyFile, lstat, mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';

import { closeE2EContext, createE2EContext, type Db, type E2EContext, waitForCondition } from '../app-harness';

const DEFAULT_CWA_IMAGE = 'crocodilestick/calibre-web-automated:v4.0.6';
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const MAX_CWA_LOG_BYTES = 16 * 1024;

interface EnvSnapshot {
  appDataPath: string | undefined;
  migrationEncryptionKey: string | undefined;
  migrationImportRoot: string | undefined;
}

export interface CalibreWebAutomatedService {
  baseUrl: string;
  containerName: string;
  image: string;
  port: number;
  version: string;
}

export interface StoppedCalibreWebAutomatedInstance {
  appDatabasePath: string;
  metadataDatabasePath: string;
  sourceLibraryRoot: string;
}

export interface MigrationCalibreWebAutomatedE2EContext<TSourceFixture = unknown> extends E2EContext {
  db: Db;
  fixtureRoot: string;
  booksPath: string;
  configDir: string;
  cwaLibraryDir: string;
  ingestDir: string;
  snapshotDir: string;
  targetLibraryRoot: string;
  appSnapshotPath: string;
  metadataSnapshotPath: string;
  envSnapshot: EnvSnapshot;
  cwa: CalibreWebAutomatedService;
  sourceFixture: TSourceFixture;
}

export interface JsonResponse<T> {
  statusCode: number;
  body: T;
}

export async function createMigrationCalibreWebAutomatedE2EContext<TSourceFixture>(
  prepareStoppedSource: (instance: StoppedCalibreWebAutomatedInstance) => Promise<TSourceFixture>,
): Promise<MigrationCalibreWebAutomatedE2EContext<TSourceFixture>> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'bookorbit-migration-cwa-'));
  const booksPath = join(fixtureRoot, 'app-data');
  const configDir = join(fixtureRoot, 'cwa-config');
  const cwaLibraryDir = join(fixtureRoot, 'cwa-library');
  const ingestDir = join(fixtureRoot, 'cwa-ingest');
  const snapshotDir = join(fixtureRoot, 'snapshots');
  const targetLibraryRoot = join(fixtureRoot, 'bookorbit-library');
  const appSnapshotPath = join(snapshotDir, 'app.db');
  const metadataSnapshotPath = join(snapshotDir, 'metadata.db');
  const envSnapshot: EnvSnapshot = {
    appDataPath: process.env.APP_DATA_PATH,
    migrationEncryptionKey: process.env.MIGRATION_ENCRYPTION_KEY,
    migrationImportRoot: process.env.MIGRATION_IMPORT_ROOT,
  };

  await Promise.all([booksPath, configDir, cwaLibraryDir, ingestDir, snapshotDir, targetLibraryRoot].map((path) => mkdir(path, { recursive: true })));

  let base: E2EContext | null = null;
  let cwa: CalibreWebAutomatedService | null = null;
  try {
    cwa = await startCalibreWebAutomatedContainer({ configDir, cwaLibraryDir, ingestDir });
    await ensureRealProgressSchemas(cwa);
    await stopCalibreWebAutomatedContainer(cwa);

    const appDatabasePath = join(configDir, 'app.db');
    const metadataDatabasePath = join(cwaLibraryDir, 'metadata.db');
    const sourceFixture = await prepareStoppedSource({ appDatabasePath, metadataDatabasePath, sourceLibraryRoot: cwaLibraryDir });
    assertDatabaseIntegrity(appDatabasePath);
    assertDatabaseIntegrity(metadataDatabasePath);
    await assertColdSnapshot(appDatabasePath);
    await assertColdSnapshot(metadataDatabasePath);
    await Promise.all([copyFile(appDatabasePath, appSnapshotPath), copyFile(metadataDatabasePath, metadataSnapshotPath)]);

    process.env.APP_DATA_PATH = booksPath;
    process.env.MIGRATION_ENCRYPTION_KEY = ENCRYPTION_KEY;
    process.env.MIGRATION_IMPORT_ROOT = fixtureRoot;
    base = await createE2EContext();

    return {
      ...base,
      fixtureRoot,
      booksPath,
      configDir,
      cwaLibraryDir,
      ingestDir,
      snapshotDir,
      targetLibraryRoot,
      appSnapshotPath,
      metadataSnapshotPath,
      envSnapshot,
      cwa,
      sourceFixture,
    };
  } catch (error) {
    await Promise.allSettled([
      base ? closeE2EContext(base) : Promise.resolve(),
      cwa ? removeCalibreWebAutomatedContainer(cwa, true) : Promise.resolve(),
    ]);
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined);
    restoreEnv(envSnapshot);
    throw error;
  }
}

export async function closeMigrationCalibreWebAutomatedE2EContext(ctx: MigrationCalibreWebAutomatedE2EContext, captureLogs = false): Promise<void> {
  const results = await Promise.allSettled([closeE2EContext(ctx), removeCalibreWebAutomatedContainer(ctx.cwa, captureLogs, ctx.fixtureRoot)]);
  const fixtureResult = await Promise.allSettled([rm(ctx.fixtureRoot, { recursive: true, force: true })]);
  restoreEnv(ctx.envSnapshot);
  const failed = [...results, ...fixtureResult].find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
}

export function buildSnapshotConnectionConfig(ctx: MigrationCalibreWebAutomatedE2EContext): Record<string, unknown> {
  return {
    mode: 'snapshot',
    appDatabasePath: ctx.appSnapshotPath,
    metadataDatabasePath: ctx.metadataSnapshotPath,
  };
}

export async function apiJson<T>(
  ctx: MigrationCalibreWebAutomatedE2EContext,
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

export async function waitForMigrationToFinish(
  ctx: MigrationCalibreWebAutomatedE2EContext,
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

async function startCalibreWebAutomatedContainer(paths: {
  configDir: string;
  cwaLibraryDir: string;
  ingestDir: string;
}): Promise<CalibreWebAutomatedService> {
  await runCommand('docker', ['version', '--format', '{{.Server.Version}}']);
  const containerName = `bookorbit-migration-cwa-${randomUUID()}`;
  const image = process.env.CWA_E2E_IMAGE || DEFAULT_CWA_IMAGE;
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '1000';
  const gid = typeof process.getgid === 'function' ? String(process.getgid()) : '1000';
  await runCommand('docker', [
    'run',
    '-d',
    '--name',
    containerName,
    '-e',
    'TZ=UTC',
    '-e',
    `PUID=${uid}`,
    '-e',
    `PGID=${gid}`,
    '-e',
    'NETWORK_SHARE_MODE=true',
    '-p',
    '127.0.0.1::8083',
    '-v',
    `${paths.configDir}:/config`,
    '-v',
    `${paths.cwaLibraryDir}:/calibre-library`,
    '-v',
    `${paths.ingestDir}:/cwa-book-ingest`,
    image,
  ]);

  try {
    const portText = await runCommand('docker', ['inspect', '-f', '{{(index (index .NetworkSettings.Ports "8083/tcp") 0).HostPort}}', containerName]);
    const port = Number(portText.trim());
    if (!Number.isInteger(port) || port < 1) throw new Error('Could not resolve the Calibre-Web Automated E2E port');
    const service: CalibreWebAutomatedService = {
      baseUrl: `http://127.0.0.1:${port}`,
      containerName,
      image,
      port,
      version: '',
    };

    await waitForCondition(
      async () => {
        const response = await fetch(`${service.baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
        if (!response.ok) throw new Error(`Calibre-Web Automated health returned ${response.status}`);
        const body = (await response.json()) as { version?: unknown };
        if (typeof body.version !== 'string' || !body.version.startsWith('CWA/')) {
          throw new Error('Calibre-Web Automated health returned an invalid version');
        }
        service.version = body.version;
      },
      120_000,
      500,
    );
    return service;
  } catch (error) {
    const service = { baseUrl: '', containerName, image, port: 0, version: '' };
    await removeCalibreWebAutomatedContainer(service, true);
    throw error;
  }
}

async function ensureRealProgressSchemas(service: CalibreWebAutomatedService): Promise<void> {
  await waitForCondition(
    async () => {
      const output = await runCommand('docker', [
        'exec',
        service.containerName,
        'python3',
        '-c',
        "import sqlite3; a=sqlite3.connect('/config/app.db'); m=sqlite3.connect('/calibre-library/metadata.db'); assert a.execute(\"select 1 from sqlite_master where type='table' and name='kosync_progress'\").fetchone(); assert m.execute(\"select 1 from sqlite_master where type='table' and name='books'\").fetchone(); a.close(); m.close(); print('ready')",
      ]);
      if (output.trim() !== 'ready') throw new Error('Calibre-Web Automated database schema is not ready');
    },
    30_000,
    500,
  );

  await runCommand('docker', [
    'exec',
    service.containerName,
    'sh',
    '-lc',
    'cd /app/calibre-web-automated && python3 -c "import sqlite3; from cps.progress_syncing.models import ensure_checksum_table; c=sqlite3.connect(\'/calibre-library/metadata.db\'); ensure_checksum_table(c); c.close()"',
  ]);
  const verified = await runCommand('docker', [
    'exec',
    service.containerName,
    'python3',
    '-c',
    "import sqlite3; a=sqlite3.connect('/config/app.db'); m=sqlite3.connect('/calibre-library/metadata.db'); assert a.execute(\"select 1 from sqlite_master where type='table' and name='kosync_progress'\").fetchone(); assert m.execute(\"select 1 from sqlite_master where type='table' and name='book_format_checksums'\").fetchone(); a.close(); m.close(); print('ready')",
  ]);
  if (verified.trim() !== 'ready') throw new Error('Calibre-Web Automated progress schema initialization failed');
}

async function stopCalibreWebAutomatedContainer(service: CalibreWebAutomatedService): Promise<void> {
  await runCommand('docker', ['stop', '-t', '20', service.containerName]);
}

async function removeCalibreWebAutomatedContainer(service: CalibreWebAutomatedService, captureLogs: boolean, fixtureRoot?: string): Promise<void> {
  if (captureLogs) {
    const logs = await runCommand('docker', ['logs', '--tail', '200', service.containerName], true);
    if (logs) {
      const sanitized = sanitizeContainerLogs(logs, fixtureRoot).slice(-MAX_CWA_LOG_BYTES);
      process.stderr.write(`\nCalibre-Web Automated E2E logs:\n${sanitized}\n`);
    }
  }
  await runCommand('docker', ['rm', '-f', service.containerName], true);
}

function assertDatabaseIntegrity(path: string): void {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const row = database.prepare('PRAGMA quick_check(1)').get() as Record<string, unknown> | undefined;
    if (row?.quick_check !== 'ok') throw new Error('Calibre-Web Automated fixture database failed its integrity check');
  } finally {
    database.close();
  }
}

async function assertColdSnapshot(path: string): Promise<void> {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try {
      await lstat(`${path}${suffix}`);
      throw new Error('Calibre-Web Automated fixture still has an active SQLite sidecar after shutdown');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') continue;
      throw error;
    }
  }
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

function sanitizeContainerLogs(value: string, fixtureRoot?: string): string {
  const withoutFixtureRoot = fixtureRoot ? value.replaceAll(fixtureRoot, '[FIXTURE_ROOT]') : value;
  return withoutFixtureRoot.replace(/(password|token|authorization)([=: ]+)[^\s,}]+/gi, '$1$2[REDACTED]');
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
