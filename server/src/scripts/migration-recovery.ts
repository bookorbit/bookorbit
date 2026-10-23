import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';

/**
 * Objects a migration creates can already exist when an older build applied part of the migration
 * history without recording it, or when a fork migration added the same object under another
 * number. Skipping those statements lets the rest of the migration run and fills in what is
 * genuinely missing (for example a table that never got created).
 */
const BENIGN_MIGRATION_ERROR_CODES = new Set([
  '23505', // unique_violation from an idempotent seed write
  '42P06', // duplicate_schema
  '42P07', // duplicate_table
  '42701', // duplicate_column
  '42710', // duplicate_object
  '42723', // duplicate_function
]);

function isBenignMigrationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return BENIGN_MIGRATION_ERROR_CODES.has(String((error as { code?: unknown }).code));
}

function migrationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies every migration the ledger has not recorded, statement by statement, tolerating objects
 * that already exist. Used only after Drizzle's migrate fails: the normal path keeps its single
 * transaction and strict failure semantics, while a database that is partially applied can still
 * be brought forward instead of crash-looping on the first duplicate object.
 */
export async function applyPendingMigrationsTolerantly(
  pool: Pick<Pool, 'connect'>,
  migrations: readonly Pick<MigrationMeta, 'hash' | 'folderMillis' | 'sql'>[],
): Promise<{ appliedMigrations: number; skippedStatements: number }> {
  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('bookorbit'), hashtext('migration-tolerant-apply'))`);
    await client.query(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
    await client.query(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`);

    const ledger = await client.query<{ hash: string }>(`SELECT hash FROM "drizzle"."__drizzle_migrations"`);
    const appliedHashes = new Set(ledger.rows.map((row) => row.hash));
    const pending = migrations.filter((migration) => !appliedHashes.has(migration.hash));
    if (pending.length === 0) return { appliedMigrations: 0, skippedStatements: 0 };

    console.warn(`[db.migrate.recovery] [start] pending=${pending.length} - tolerant migration apply started`);

    let appliedMigrations = 0;
    let skippedStatements = 0;
    for (const migration of pending) {
      await client.query('BEGIN');
      try {
        for (const statement of migration.sql) {
          if (!statement.trim()) continue;
          await client.query('SAVEPOINT bookorbit_migration_statement');
          try {
            await client.query(statement);
            await client.query('RELEASE SAVEPOINT bookorbit_migration_statement');
          } catch (error) {
            if (!isBenignMigrationError(error)) throw error;
            await client.query('ROLLBACK TO SAVEPOINT bookorbit_migration_statement');
            skippedStatements += 1;
          }
        }
        await client.query(`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`, [
          migration.hash,
          migration.folderMillis,
        ]);
        await client.query('COMMIT');
        appliedMigrations += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.warn(
      `[db.migrate.recovery] [end] applied=${appliedMigrations} skippedStatements=${skippedStatements} durationMs=${Date.now() - startedAt} - tolerant migration apply completed`,
    );
    return { appliedMigrations, skippedStatements };
  } catch (error) {
    const errorClass = error instanceof Error ? error.name : typeof error;
    console.error(
      `[db.migrate.recovery] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(migrationErrorMessage(error))}" - tolerant migration apply failed`,
    );
    throw error;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('bookorbit'), hashtext('migration-tolerant-apply'))`).catch(() => undefined);
    client.release();
  }
}
