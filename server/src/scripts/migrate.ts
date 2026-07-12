import { existsSync } from 'fs';
import { join } from 'path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { installPostgresExtensions } from './postgres-extensions';

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

  const pool = new Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  try {
    await installPostgresExtensions(pool);

    const migrationsFolder = resolveMigrationsFolder();
    await migrate(drizzle(pool), { migrationsFolder });

    console.log(`Migrations applied successfully from ${migrationsFolder}`);
  } finally {
    await pool.end();
  }
}

void runMigrations();
