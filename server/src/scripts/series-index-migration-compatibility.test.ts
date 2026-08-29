import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { prepareLegacySeriesIndexColumns } from './series-index-migration-compatibility';

function createPool(rows: Array<{ tableName: string }>, counts: Record<string, string> = {}) {
  const query = vi.fn((statement: string) => {
    if (statement.includes('information_schema.columns')) return Promise.resolve({ rows });
    const table = Object.keys(counts).find((name) => statement.includes(`FROM public.${name}`));
    if (table) return Promise.resolve({ rows: [{ count: counts[table] }] });
    return Promise.resolve({ rows: [] });
  });
  const release = vi.fn();
  const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;
  return { pool, query, release };
}

describe('prepareLegacySeriesIndexColumns', () => {
  it('does nothing when the legacy real columns are absent', async () => {
    const { pool, query, release } = createPool([]);

    await expect(prepareLegacySeriesIndexColumns(pool)).resolves.toEqual({ convertedColumns: 0, clearedValues: 0 });
    expect(query).toHaveBeenCalledTimes(4);
    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(query).toHaveBeenNthCalledWith(2, `SELECT pg_advisory_xact_lock(hashtext('bookorbit'), hashtext('series-index-migration-compatibility'))`);
    expect(query).toHaveBeenLastCalledWith('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('normalizes both legacy columns before migration 0076 runs', async () => {
    const { pool, query } = createPool([{ tableName: 'book_metadata' }, { tableName: 'book_series_memberships' }], {
      book_metadata: '2',
      book_series_memberships: '1',
    });

    await expect(prepareLegacySeriesIndexColumns(pool)).resolves.toEqual({ convertedColumns: 2, clearedValues: 3 });

    const statements = query.mock.calls.map(([statement]) => statement);
    const counts = statements.filter((statement) => statement.includes('SELECT count(*)::text AS count'));
    const alters = statements.filter((statement) => statement.includes('ALTER TABLE'));
    expect(counts).toHaveLength(2);
    for (const statement of counts) {
      expect(statement).toContain('length(trim_scale(series_index::text::numeric)::text) > 20');
    }
    expect(alters).toHaveLength(2);
    expect(alters).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ALTER TABLE public.book_metadata'),
        expect.stringContaining('ALTER TABLE public.book_series_memberships'),
      ]),
    );
    for (const statement of alters) {
      expect(statement).toContain('trim_scale(series_index::text::numeric)::text');
      expect(statement).toContain("series_index::text IN ('NaN', 'Infinity', '-Infinity')");
      expect(statement).toContain('WHEN series_index < 0 THEN NULL');
      expect(statement).toContain('WHEN length(trim_scale(series_index::text::numeric)::text) > 20 THEN NULL');
    }
  });

  it('rolls back and releases the client when conversion fails', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ tableName: 'book_metadata' }] })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] })
      .mockRejectedValueOnce(new Error('conversion failed'))
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const pool = { connect: vi.fn(() => Promise.resolve({ query, release })) } as unknown as Pick<Pool, 'connect'>;

    await expect(prepareLegacySeriesIndexColumns(pool)).rejects.toThrow('conversion failed');
    expect(query).toHaveBeenLastCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
