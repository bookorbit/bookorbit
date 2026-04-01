import { Client } from 'pg';

const DEFAULT_E2E_DATABASE_URL = 'postgres://projectx:projectx@localhost:5432/projectx_e2e';
const CONNECT_RETRY_ATTEMPTS = 30;
const CONNECT_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function resolveTargetDatabaseUrl(): URL {
  const connectionString = process.env.E2E_DATABASE_URL ?? DEFAULT_E2E_DATABASE_URL;
  return new URL(connectionString);
}

function parseDatabaseName(url: URL): string {
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName) {
    throw new Error('E2E database URL must include a database name');
  }
  return databaseName;
}

function assertSafeDatabaseName(databaseName: string): void {
  if (!databaseName.endsWith('_e2e')) {
    throw new Error(`Refusing to reset non-e2e database "${databaseName}"`);
  }
  if (!/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsupported database name "${databaseName}". Use only letters, numbers, and underscores.`);
  }
}

async function connectWithRetry(connectionString: string, label: string): Promise<Client> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CONNECT_RETRY_ATTEMPTS; attempt++) {
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => undefined);
      if (attempt < CONNECT_RETRY_ATTEMPTS) {
        await sleep(CONNECT_RETRY_DELAY_MS);
      }
    }
  }

  throw new Error(
    `Could not connect to ${label} after ${CONNECT_RETRY_ATTEMPTS} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

async function createDatabaseIfMissing(adminClient: Client, databaseName: string): Promise<void> {
  const existing = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1', [databaseName]);
  if (existing.rowCount && existing.rowCount > 0) return;
  await adminClient.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
}

async function resetE2EDatabase(targetClient: Client): Promise<void> {
  await targetClient.query('DROP SCHEMA IF EXISTS public CASCADE');
  await targetClient.query('CREATE SCHEMA public');
  await targetClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await targetClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await targetClient.query('CREATE EXTENSION IF NOT EXISTS vector');
  await targetClient.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await targetClient.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)');
  await targetClient.query('DELETE FROM drizzle.__drizzle_migrations');
}

async function run(): Promise<void> {
  const targetUrl = resolveTargetDatabaseUrl();
  const databaseName = parseDatabaseName(targetUrl);
  assertSafeDatabaseName(databaseName);

  const adminUrl = new URL(targetUrl.toString());
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  adminUrl.hash = '';

  const adminClient = await connectWithRetry(adminUrl.toString(), 'PostgreSQL admin database');
  try {
    await createDatabaseIfMissing(adminClient, databaseName);
  } finally {
    await adminClient.end();
  }

  const targetClient = await connectWithRetry(targetUrl.toString(), `PostgreSQL database "${databaseName}"`);
  try {
    await resetE2EDatabase(targetClient);
  } finally {
    await targetClient.end();
  }

  console.log(`Prepared e2e database: ${databaseName}`);
}

void run();
