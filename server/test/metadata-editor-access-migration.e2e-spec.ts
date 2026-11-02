import { randomUUID } from 'crypto';
import { readFile, readdir } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'pg';

const MIGRATIONS_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '../src/db/migrations');
const BACKFILL_MIGRATION = '0131_restore_metadata_editor_access.sql';

function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function applyMigrations(client: Client, filenames: string[]): Promise<void> {
  for (const filename of filenames) {
    await client.query(await readFile(join(MIGRATIONS_DIRECTORY, filename), 'utf8'));
  }
}

describe('Metadata editor access migration (e2e)', { timeout: 60_000 }, () => {
  it('restores Editor on book libraries only for accounts the role enforcement left unable to edit', async () => {
    const baseUrl = new URL(process.env.DATABASE_URL!);
    const databaseName = `editor_access_${randomUUID().replace(/-/g, '').slice(0, 12)}_e2e`;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = `/${databaseName}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.pathname = '/postgres';

    const admin = new Client({ connectionString: adminUrl.toString() });
    let target: Client | undefined;
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
        migrationFiles.filter((filename) => filename < BACKFILL_MIGRATION),
      );
      await target.query(`
        INSERT INTO libraries (id, name) VALUES (1, 'Fiction'), (2, 'Comics');
        INSERT INTO users (id, username, name, password_hash, is_superuser, active) VALUES
          (1, 'upgraded', 'Upgraded', 'x', false, true),
          (2, 'configured', 'Configured', 'x', false, true),
          (3, 'reader', 'Reader', 'x', false, true),
          (4, 'superuser', 'Superuser', 'x', true, true),
          (6, 'suspended', 'Suspended', 'x', false, false);
        INSERT INTO user_permissions (user_id, permission_name) VALUES
          (1, 'library_edit_metadata'), (1, 'library_download'),
          (2, 'library_edit_metadata'),
          (3, 'library_download'),
          (4, 'library_edit_metadata'),
          (6, 'library_edit_metadata');
        INSERT INTO user_library_access (user_id, library_id, access_level) VALUES
          (1, 1, 'viewer'), (1, 2, 'viewer'),
          (2, 1, 'editor'), (2, 2, 'viewer'),
          (3, 1, 'viewer'),
          (4, 1, 'viewer'),
          (6, 1, 'viewer');
      `);

      await applyMigrations(
        target,
        migrationFiles.filter((filename) => filename >= BACKFILL_MIGRATION),
      );

      const grants = await target.query<{ username: string; library: string; accessLevel: string }>(`
        SELECT users.username, libraries.name AS library, user_library_access.access_level AS "accessLevel"
        FROM user_library_access
        INNER JOIN users ON users.id = user_library_access.user_id
        INNER JOIN libraries ON libraries.id = user_library_access.library_id
        ORDER BY users.id, libraries.id
      `);
      expect(grants.rows).toEqual([
        { username: 'upgraded', library: 'Fiction', accessLevel: 'editor' },
        { username: 'upgraded', library: 'Comics', accessLevel: 'editor' },
        { username: 'configured', library: 'Fiction', accessLevel: 'editor' },
        { username: 'configured', library: 'Comics', accessLevel: 'viewer' },
        { username: 'reader', library: 'Fiction', accessLevel: 'viewer' },
        { username: 'superuser', library: 'Fiction', accessLevel: 'viewer' },
        { username: 'suspended', library: 'Fiction', accessLevel: 'editor' },
      ]);
    } finally {
      await target?.end();
      await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(databaseName)} WITH (FORCE)`);
      await admin.end();
    }
  });
});
