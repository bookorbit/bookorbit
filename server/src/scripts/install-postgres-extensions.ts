import { Pool } from 'pg';

import { createPostgresClientConfig } from '../db/postgres-connection-config';
import { installPostgresExtensions } from './postgres-extensions';

async function run(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');

  const pool = new Pool(createPostgresClientConfig(connectionString));
  try {
    await installPostgresExtensions(pool);
  } finally {
    await pool.end();
  }
}

void run();
