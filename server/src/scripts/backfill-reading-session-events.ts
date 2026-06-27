import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';

import { aggregateReadingSessionDailyStats } from '../common/utils/reading-daily-stats.utils';
import { resolveTimeZone } from '../common/utils/timezone.utils';
import * as schema from '../db/schema';

const INSERT_CHUNK_SIZE = 1_000;

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
    const groups = await db
      .select({
        userId: schema.readingSessions.userId,
        libraryId: schema.books.libraryId,
        settings: schema.users.settings,
        sessionsCount: sql<number>`count(*)::int`,
      })
      .from(schema.readingSessions)
      .innerJoin(schema.books, eq(schema.books.id, schema.readingSessions.bookId))
      .innerJoin(schema.users, eq(schema.users.id, schema.readingSessions.userId))
      .groupBy(schema.readingSessions.userId, schema.books.libraryId, schema.users.settings);

    let insertedDaily = 0;
    let sessionsCount = 0;

    for (const group of groups) {
      const timeZone = resolveTimeZone((group.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
      const sessions = await db
        .select({
          startedAt: schema.readingSessions.startedAt,
          endedAt: schema.readingSessions.endedAt,
          durationSeconds: schema.readingSessions.durationSeconds,
          progressDelta: schema.readingSessions.progressDelta,
        })
        .from(schema.readingSessions)
        .innerJoin(schema.books, eq(schema.books.id, schema.readingSessions.bookId))
        .where(and(eq(schema.readingSessions.userId, group.userId), eq(schema.books.libraryId, group.libraryId)));

      const now = new Date();
      const values = aggregateReadingSessionDailyStats(
        sessions.map((session) => ({
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          durationSeconds: session.durationSeconds,
          progressDelta: session.progressDelta ?? null,
        })),
        timeZone,
      ).map((segment) => ({
        userId: group.userId,
        libraryId: group.libraryId,
        day: segment.day,
        readingSeconds: segment.readingSeconds,
        progressDelta: segment.progressDelta,
        sessionsCount: segment.sessionsCount,
        updatedAt: now,
      }));

      for (let offset = 0; offset < values.length; offset += INSERT_CHUNK_SIZE) {
        await db.insert(schema.userReadingDailyStats).values(values.slice(offset, offset + INSERT_CHUNK_SIZE));
      }

      insertedDaily += values.length;
      sessionsCount += group.sessionsCount;
    }

    const deletedDaily = Number((rebuildDailyDelete as { rowCount?: number }).rowCount ?? 0);

    console.log(`Reading session backfill complete: deletedDaily=${deletedDaily}, insertedDaily=${insertedDaily}, sessions=${sessionsCount}`);
  } finally {
    await pool.end();
  }
}

void runBackfill();
