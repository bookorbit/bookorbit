import { existsSync } from 'fs';
import { join } from 'path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { createPostgresClientConfig } from '../db/postgres-connection-config';
import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';
import { dropUnreleasedMigrationRows, reconcileMigrationLedgerTimestamps, rewindRenumberedMigrationRows } from './migration-ledger-compatibility';
import { applyPendingMigrationsTolerantly } from './migration-recovery';
import { installPostgresExtensions } from './postgres-extensions';
import { prepareLegacySeriesIndexColumns } from './series-index-migration-compatibility';

function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, '..', '..', 'migrations'),
    join(__dirname, '..', 'db', 'migrations'),
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'src', 'db', 'migrations'),
  ];

  const match = candidates.find((path) => existsSync(path));
  if (!match) {
    throw new Error(`Unable to locate migrations folder. Checked: ${candidates.join(', ')}`);
  }
  return match;
}

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required');
  }

  const pool = new Pool(
    createPostgresClientConfig(connectionString, {
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    }),
  );

  try {
    await installPostgresExtensions(pool);
    const migrationsFolder = resolveMigrationsFolder();
    const migrationFiles = readMigrationFiles({ migrationsFolder });
    await dropUnreleasedMigrationRows(pool, migrationFiles);
    await rewindRenumberedMigrationRows(pool, migrationFiles);
    await reconcileMigrationLedgerTimestamps(pool, migrationFiles);
    await prepareLegacySeriesIndexColumns(pool);

    const startedAt = Date.now();
    try {
      await migrate(drizzle(pool), { migrationsFolder });
      console.log(`Migrations applied successfully from ${migrationsFolder}`);
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : typeof error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[db.migrate] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - strict migration failed; retrying tolerantly`,
      );
      await applyPendingMigrationsTolerantly(pool, migrationFiles);
      console.log(`Migrations applied successfully from ${migrationsFolder} after tolerant recovery`);
    }
  } finally {
    await pool.end();
  }
}

void runMigrations();
