import type { Pool } from 'pg';

import { sanitizeLogValue } from '../common/utils/log-sanitize.utils';

const LEGACY_SERIES_INDEX_TABLES = ['book_series_memberships', 'book_metadata'] as const;

type LegacySeriesIndexTable = (typeof LEGACY_SERIES_INDEX_TABLES)[number];

type CompatibilityResult = {
  convertedColumns: number;
  clearedValues: number;
};

function isLegacySeriesIndexTable(value: string): value is LegacySeriesIndexTable {
  return LEGACY_SERIES_INDEX_TABLES.includes(value as LegacySeriesIndexTable);
}

export async function prepareLegacySeriesIndexColumns(pool: Pick<Pool, 'connect'>): Promise<CompatibilityResult> {
  const client = await pool.connect();
  const startedAt = Date.now();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bookorbit'), hashtext('series-index-migration-compatibility'))`);
    const columns = await client.query<{ tableName: string }>(`
      SELECT table_name AS "tableName"
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'series_index'
        AND data_type = 'real'
        AND table_name IN ('book_series_memberships', 'book_metadata')
      ORDER BY table_name
    `);
    const tables = columns.rows.map((row) => row.tableName).filter(isLegacySeriesIndexTable);

    if (tables.length === 0) {
      await client.query('COMMIT');
      return { convertedColumns: 0, clearedValues: 0 };
    }

    console.log(`[db.series-index-compatibility] [start] columns=${tables.length} - legacy series index conversion started`);

    let clearedValues = 0;
    for (const table of tables) {
      const countResult = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM public.${table}
        WHERE series_index IS NOT NULL
          AND (
            series_index::text IN ('NaN', 'Infinity', '-Infinity')
            OR series_index < 0
            OR length(trim_scale(series_index::text::numeric)::text) > 20
          )
      `);
      clearedValues += Number.parseInt(countResult.rows[0]?.count ?? '0', 10);

      await client.query(`
        ALTER TABLE public.${table}
        ALTER COLUMN series_index TYPE varchar(20)
        USING CASE
          WHEN series_index IS NULL THEN NULL
          WHEN series_index::text IN ('NaN', 'Infinity', '-Infinity') THEN NULL
          WHEN series_index < 0 THEN NULL
          WHEN length(trim_scale(series_index::text::numeric)::text) > 20 THEN NULL
          ELSE trim_scale(series_index::text::numeric)::text
        END
      `);
    }

    await client.query('COMMIT');
    const endMessage = `[db.series-index-compatibility] [end] durationMs=${Date.now() - startedAt} columns=${tables.length} cleared=${clearedValues} - legacy series index conversion completed`;
    if (clearedValues > 0) console.warn(endMessage);
    else console.log(endMessage);
    return { convertedColumns: tables.length, clearedValues };
  } catch (error) {
    await client.query('ROLLBACK');
    const errorClass = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[db.series-index-compatibility] [fail] durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - legacy series index conversion failed`,
    );
    throw error;
  } finally {
    client.release();
  }
}
