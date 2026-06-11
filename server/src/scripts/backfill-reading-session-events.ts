import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';

import * as schema from '../db/schema';

async function runBackfill() {
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

  const db = drizzle(pool, { schema });

  try {
    const rebuildDailyDelete = await db.execute(sql`delete from user_reading_daily_stats`);
    const rebuildDailyInsert = await db.execute(sql`
      insert into user_reading_daily_stats (user_id, library_id, day, reading_seconds, progress_delta, sessions_count, updated_at)
      select
        rs.user_id,
        b.library_id,
        date_trunc('day', rs.started_at)::date as day,
        coalesce(sum(rs.duration_seconds), 0)::int as reading_seconds,
        coalesce(sum(rs.progress_delta), 0)::real as progress_delta,
        count(*)::int as sessions_count,
        now() as updated_at
      from reading_sessions rs
      inner join books b on b.id = rs.book_id
      group by rs.user_id, b.library_id, date_trunc('day', rs.started_at)::date
    `);

    const deletedDaily = Number((rebuildDailyDelete as { rowCount?: number }).rowCount ?? 0);
    const insertedDaily = Number((rebuildDailyInsert as { rowCount?: number }).rowCount ?? 0);

    console.log(`Reading session backfill complete: deletedDaily=${deletedDaily}, insertedDaily=${insertedDaily}`);
  } finally {
    await pool.end();
  }
}

void runBackfill();
