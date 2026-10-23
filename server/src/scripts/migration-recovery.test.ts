import type { MigrationMeta } from 'drizzle-orm/migrator';
import type { Pool } from 'pg';

import { applyPendingMigrationsTolerantly } from './migration-recovery';

type Failure = { match: string; error: Error & { code: string } };

function createClient(appliedHashes: string[] = [], failure?: Failure) {
  const query = vi.fn((statement: string) => {
    if (statement.includes('SELECT hash')) {
      return Promise.resolve({ rows: appliedHashes.map((hash) => ({ hash })), rowCount: appliedHashes.length });
    }
    if (failure && statement.includes(failure.match)) return Promise.reject(failure.error);
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;
  return { pool, query, release };
}

const migrations: Array<Pick<MigrationMeta, 'hash' | 'folderMillis' | 'sql'>> = [
  { hash: 'first', folderMillis: 100, sql: ['CREATE TABLE "upload_sessions" ("id" uuid);'] },
  {
    hash: 'second',
    folderMillis: 200,
    sql: ['ALTER TABLE "libraries" ADD COLUMN "type" varchar(20);', 'CREATE INDEX "libraries_type_idx" ON "libraries" ("type");'],
  },
];

describe('applyPendingMigrationsTolerantly', () => {
  it('applies every unrecorded migration and records it', async () => {
    const { pool, query, release } = createClient();

    await expect(applyPendingMigrationsTolerantly(pool, migrations)).resolves.toEqual({ appliedMigrations: 2, skippedStatements: 0 });
    expect(query).toHaveBeenCalledWith(`INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)`, ['first', 100]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('skips an object that already exists and still records the migration', async () => {
    const failure = { match: 'ADD COLUMN "type"', error: Object.assign(new Error('column "type" already exists'), { code: '42701' }) };
    const { pool, query } = createClient([], failure);

    await expect(applyPendingMigrationsTolerantly(pool, migrations)).resolves.toEqual({ appliedMigrations: 2, skippedStatements: 1 });
    expect(query).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT bookorbit_migration_statement');
    expect(query.mock.calls.filter(([statement]) => String(statement).startsWith('INSERT INTO'))).toHaveLength(2);
  });

  it('does nothing when every migration is already recorded', async () => {
    const { pool, query } = createClient(['first', 'second']);

    await expect(applyPendingMigrationsTolerantly(pool, migrations)).resolves.toEqual({ appliedMigrations: 0, skippedStatements: 0 });
    expect(query.mock.calls.some(([statement]) => String(statement).includes('SAVEPOINT'))).toBe(false);
  });

  it('rolls back and fails on a statement that is not an already-exists error', async () => {
    const failure = { match: 'CREATE TABLE "upload_sessions"', error: Object.assign(new Error('syntax error'), { code: '42601' }) };
    const { pool, query, release } = createClient([], failure);

    await expect(applyPendingMigrationsTolerantly(pool, migrations)).rejects.toBe(failure.error);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
