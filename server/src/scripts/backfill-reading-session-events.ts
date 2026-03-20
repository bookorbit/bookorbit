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
    const insertEvents = await db.execute(sql`
      insert into reading_session_events (
        user_id,
        book_file_id,
        event_key,
        recorded_at,
        percentage,
        percentage_delta,
        page_number,
        page_delta,
        delta_seconds,
        source,
        synthetic,
        created_at
      )
      select
        rp.user_id,
        rp.book_file_id,
        concat(
          'backfill:',
          rp.user_id,
          ':',
          rp.book_file_id,
          ':',
          extract(epoch from rp.updated_at)::bigint,
          ':',
          coalesce(rp.page_number::text, 'na'),
          ':',
          floor(rp.percentage * 100)::int
        ) as event_key,
        rp.updated_at,
        rp.percentage,
        0::real as percentage_delta,
        rp.page_number,
        0::int as page_delta,
        0::int as delta_seconds,
        'backfill' as source,
        true as synthetic,
        now() as created_at
      from reading_progress rp
      on conflict (event_key) do nothing
    `);

    const rebuildDailyDelete = await db.execute(sql`delete from user_reading_daily_stats`);
    const rebuildDailyInsert = await db.execute(sql`
      insert into user_reading_daily_stats (user_id, library_id, day, reading_seconds, progress_delta, events_count, updated_at)
      select
        rse.user_id,
        b.library_id,
        date_trunc('day', rse.recorded_at)::date as day,
        coalesce(
          sum(
            case
              when rse.delta_seconds > 0 and rse.delta_seconds <= 1800 then rse.delta_seconds
              else 0
            end
          ),
          0
        )::int as reading_seconds,
        coalesce(sum(rse.percentage_delta), 0)::real as progress_delta,
        count(*)::int as events_count,
        now() as updated_at
      from reading_session_events rse
      inner join book_files bf on bf.id = rse.book_file_id
      inner join books b on b.id = bf.book_id
      group by rse.user_id, b.library_id, date_trunc('day', rse.recorded_at)::date
    `);

    const insertedEvents = Number((insertEvents as { rowCount?: number }).rowCount ?? 0);
    const deletedDaily = Number((rebuildDailyDelete as { rowCount?: number }).rowCount ?? 0);
    const insertedDaily = Number((rebuildDailyInsert as { rowCount?: number }).rowCount ?? 0);

    console.log(`Reading session backfill complete: insertedEvents=${insertedEvents}, deletedDaily=${deletedDaily}, insertedDaily=${insertedDaily}`);
  } finally {
    await pool.end();
  }
}

void runBackfill();
