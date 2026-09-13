import { randomUUID } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Client, Pool } from 'pg';

import { prepareLegacySeriesIndexColumns } from '../src/scripts/series-index-migration-compatibility';

const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function applyMigrations(client: Client, filenames: string[]): Promise<void> {
  for (const filename of filenames) {
    await client.query(await readFile(join(MIGRATIONS_DIRECTORY, filename), 'utf8'));
  }
}

describe('Series index migration compatibility (e2e)', { timeout: 60_000 }, () => {
  it('repairs legacy values before applying the 2.8 series index migration', async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    const databaseName = `series_index_${randomUUID().replace(/-/g, '').slice(0, 12)}_e2e`;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';

    const admin = new Client({ connectionString: adminUrl.toString() });
    let target: Client | undefined;
    let pool: Pool | undefined;
    await admin.connect();

    try {
      await admin.query(`CREATE DATABASE ${escapeIdentifier(databaseName)}`);
      target = new Client({ connectionString: targetUrl.toString() });
      await target.connect();
      await target.query(`
        CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
        CREATE EXTENSION IF NOT EXISTS "pg_trgm";
        CREATE EXTENSION IF NOT EXISTS "unaccent";
        CREATE EXTENSION IF NOT EXISTS "vector";
        CREATE OR REPLACE FUNCTION public.bookorbit_unaccent(value text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        PARALLEL SAFE
        STRICT
        AS $function$ SELECT public.unaccent('public.unaccent', value) $function$;
      `);

      const migrationFiles = (await readdir(MIGRATIONS_DIRECTORY)).filter((filename) => filename.endsWith('.sql')).sort();
      await applyMigrations(
        target,
        migrationFiles.filter((filename) => filename < '0076_add_series_index_labels.sql'),
      );
      await target.query(`
        WITH new_library AS (
          INSERT INTO libraries (name) VALUES ('Series Index Migration') RETURNING id
        ), new_folder AS (
          INSERT INTO library_folders (library_id, path)
          SELECT id, '/series-index-migration' FROM new_library
          RETURNING id, library_id
        ), new_book AS (
          INSERT INTO books (library_id, library_folder_id, folder_path)
          SELECT library_id, id, '/series-index-migration/book' FROM new_folder
          RETURNING id
        ), new_series AS (
          INSERT INTO book_series (name, normalized_name)
          VALUES ('Legacy Series', 'legacy series')
          RETURNING id
        ), new_membership AS (
          INSERT INTO book_series_memberships (book_id, series_id, series_index)
          SELECT new_book.id, new_series.id, -1::real
          FROM new_book, new_series
        )
        INSERT INTO book_metadata (book_id, series_index)
        SELECT id, 1e-5::real FROM new_book;
      `);
      await target.query(`
        WITH samples(folder_path, series_index) AS (
          VALUES
            ('/series-index-migration/precision-1234567', 123456.7::real),
            ('/series-index-migration/precision-16777215', 16777215::real),
            ('/series-index-migration/precision-10485765', 1048576.5::real)
        ), folder AS (
          SELECT id, library_id
          FROM library_folders
          WHERE path = '/series-index-migration'
        ), new_books AS (
          INSERT INTO books (library_id, library_folder_id, folder_path)
          SELECT folder.library_id, folder.id, samples.folder_path
          FROM folder, samples
          RETURNING id, folder_path
        )
        INSERT INTO book_metadata (book_id, series_index)
        SELECT new_books.id, samples.series_index
        FROM new_books
        JOIN samples USING (folder_path);
      `);

      const seriesIndexMigration = await readFile(join(MIGRATIONS_DIRECTORY, '0076_add_series_index_labels.sql'), 'utf8');
      await target.query('BEGIN');
      await expect(target.query(seriesIndexMigration)).rejects.toThrow('book_series_memberships_series_index_format_chk');
      await target.query('ROLLBACK');

      pool = new Pool({ connectionString: targetUrl.toString() });
      const compatibilityResults = await Promise.all([prepareLegacySeriesIndexColumns(pool), prepareLegacySeriesIndexColumns(pool)]);
      expect(compatibilityResults).toEqual(
        expect.arrayContaining([
          { convertedColumns: 2, clearedValues: 1 },
          { convertedColumns: 0, clearedValues: 0 },
        ]),
      );
      await target.query(seriesIndexMigration);

      const values = await target.query<{ source: string; seriesIndex: string | null }>(`
        SELECT source, "seriesIndex"
        FROM (
          SELECT 0 AS sort_order, 'membership' AS source, series_index AS "seriesIndex" FROM book_series_memberships
          UNION ALL
          SELECT 1, books.folder_path, book_metadata.series_index
          FROM book_metadata
          INNER JOIN books ON books.id = book_metadata.book_id
        ) AS migrated_values
        ORDER BY sort_order, source
      `);
      expect(values.rows).toEqual([
        { source: 'membership', seriesIndex: null },
        { source: '/series-index-migration/book', seriesIndex: '0.00001' },
        { source: '/series-index-migration/precision-10485765', seriesIndex: '1048576.5' },
        { source: '/series-index-migration/precision-1234567', seriesIndex: '123456.7' },
        { source: '/series-index-migration/precision-16777215', seriesIndex: '16777215' },
      ]);

      await applyMigrations(
        target,
        migrationFiles.filter((filename) => filename > '0076_add_series_index_labels.sql'),
      );
    } finally {
      await pool?.end();
      await target?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE)`);
      await admin.end();
    }
  });
});
