import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { reconcileMigrationLedgerTimestamps } from './migration-ledger-compatibility';

const migrations = [
  { hash: 'first', folderMillis: 100 },
  { hash: 'second', folderMillis: 200 },
] as const satisfies readonly Pick<MigrationMeta, 'folderMillis' | 'hash'>[];

function createPool(tableName: string | null, ledgerRows: Array<{ id: number; hash: string; createdAt: string }> = []) {
  const query = vi.fn((statement: string) => {
    if (statement.includes('to_regclass')) return Promise.resolve({ rows: [{ tableName }] });
    if (statement.includes('SELECT id, hash')) return Promise.resolve({ rows: ledgerRows });
    if (statement.startsWith('UPDATE')) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;
  return { pool, query, release };
}

describe('reconcileMigrationLedgerTimestamps', () => {
  it('does nothing before Drizzle has created its ledger table', async () => {
    const { pool, query, release } = createPool(null);

    await expect(reconcileMigrationLedgerTimestamps(pool, migrations)).resolves.toEqual({ repairedRows: 0 });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('repairs timestamps only when an applied migration hash is known and mismatched', async () => {
    const { pool, query } = createPool('drizzle.__drizzle_migrations', [
      { id: 7, hash: 'first', createdAt: '50' },
      { id: 8, hash: 'second', createdAt: '200' },
      { id: 9, hash: 'unknown', createdAt: '25' },
    ]);

    await expect(reconcileMigrationLedgerTimestamps(pool, migrations)).resolves.toEqual({ repairedRows: 1 });
    expect(query).toHaveBeenCalledWith('UPDATE drizzle.__drizzle_migrations SET created_at = $1 WHERE id = $2 AND hash = $3 AND created_at <> $1', [
      100,
      7,
      'first',
    ]);
    expect(query.mock.calls.filter(([statement]) => statement.startsWith('UPDATE'))).toHaveLength(1);
  });

  it('rolls back and releases the client when reconciliation fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('ledger unavailable'))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;

    await expect(reconcileMigrationLedgerTimestamps(pool, migrations)).rejects.toThrow('ledger unavailable');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
