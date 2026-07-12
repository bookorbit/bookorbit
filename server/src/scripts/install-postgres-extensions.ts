import { Pool } from 'pg';

import { installPostgresExtensions } from './postgres-extensions';

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool({ connectionString });
  try {
    await installPostgresExtensions(pool);
  } finally {
    await pool.end();
  }
}

void run();
