import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';

type CompatibilityResult = {
  repairedRows: number;
};

type LedgerRow = {
  id: number;
  hash: string;
  createdAt: string;
};

export async function reconcileMigrationLedgerTimestamps(
  pool: Pick<Pool, 'connect'>,
  migrations: readonly Pick<MigrationMeta, 'folderMillis' | 'hash'>[],
): Promise<CompatibilityResult> {
  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bookorbit'), hashtext('migration-ledger-compatibility'))`);
    const table = await client.query<{ tableName: string | null }>(`SELECT to_regclass('drizzle.__drizzle_migrations')::text AS "tableName"`);
    if (table.rows[0]?.tableName === null || table.rows.length === 0) {
      await client.query('COMMIT');
      return { repairedRows: 0 };
    }

    const expectedTimestamps = new Map(migrations.map((migration) => [migration.hash, migration.folderMillis]));
    const ledger = await client.query<LedgerRow>(`
      SELECT id, hash, created_at::text AS "createdAt"
      FROM drizzle.__drizzle_migrations
      ORDER BY id
    `);

    let repairedRows = 0;
    for (const row of ledger.rows) {
      const expected = expectedTimestamps.get(row.hash);
      if (expected === undefined || row.createdAt === String(expected)) continue;
      const updated = await client.query(`UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2 AND hash = $3 AND created_at <> $1`, [
        expected,
        row.id,
        row.hash,
      ]);
      repairedRows += updated.rowCount ?? 0;
    }

    await client.query('COMMIT');
    if (repairedRows > 0) {
      console.warn(
        `[db.migration-ledger-compatibility] [end] durationMs=${Date.now() - startedAt} repaired=${repairedRows} - applied migration timestamps reconciled`,
      );
    }
    return { repairedRows };
  } catch (error) {
    await client.query('ROLLBACK');
    const errorClass = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[db.migration-ledger-compatibility] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - applied migration timestamps could not be reconciled`,
    );
    throw error;
  } finally {
    client.release();
  }
}
