import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, readingSessions, userReadingDailyStats } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const MIN_SESSION_SECONDS = 10;

@Injectable()
export class ReadingSessionRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async saveSession(
    userId: number,
    bookFileId: number,
    sessionId: string,
    startedAt: Date,
    endedAt: Date,
    durationSeconds: number,
    progressDelta: number | null,
    endProgress: number | null,
  ): Promise<void> {
    if (durationSeconds < MIN_SESSION_SECONDS) return;

    const [fileRow] = await this.db
      .select({ libraryId: books.libraryId })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, bookFileId))
      .limit(1);

    if (!fileRow) return;

    const { libraryId } = fileRow;
    const day = startedAt.toISOString().slice(0, 10);

    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(readingSessions)
        .values({ userId, bookFileId, sessionId, startedAt, endedAt, durationSeconds, progressDelta, endProgress })
        .onConflictDoNothing({ target: [readingSessions.sessionId] })
        .returning({ id: readingSessions.id });

      if (inserted.length === 0) return;

      await tx
        .insert(userReadingDailyStats)
        .values({
          userId,
          libraryId,
          day,
          readingSeconds: durationSeconds,
          progressDelta: progressDelta ?? 0,
          sessionsCount: 1,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [userReadingDailyStats.userId, userReadingDailyStats.libraryId, userReadingDailyStats.day],
          set: {
            readingSeconds: sql`${userReadingDailyStats.readingSeconds} + ${durationSeconds}`,
            progressDelta: sql`${userReadingDailyStats.progressDelta} + ${progressDelta ?? 0}`,
            sessionsCount: sql`${userReadingDailyStats.sessionsCount} + 1`,
            updatedAt: new Date(),
          },
        });
    });
  }

  async recomputeRecentDailyStats(since: Date): Promise<{ deleted: number; inserted: number }> {
    const sinceDay = since.toISOString().slice(0, 10);

    return this.db.transaction(async (tx) => {
      const deleteResult = await tx.execute(sql`delete from user_reading_daily_stats where day >= ${sinceDay}::date`);

      const insertResult = await tx.execute(sql`
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
        inner join book_files bf on bf.id = rs.book_file_id
        inner join books b on b.id = bf.book_id
        where rs.started_at >= ${since}
        group by rs.user_id, b.library_id, date_trunc('day', rs.started_at)::date
        on conflict (user_id, library_id, day) do update set
          reading_seconds = excluded.reading_seconds,
          progress_delta = excluded.progress_delta,
          sessions_count = excluded.sessions_count,
          updated_at = excluded.updated_at
      `);

      return {
        deleted: Number((deleteResult as { rowCount?: number }).rowCount ?? 0),
        inserted: Number((insertResult as { rowCount?: number }).rowCount ?? 0),
      };
    });
  }
}
