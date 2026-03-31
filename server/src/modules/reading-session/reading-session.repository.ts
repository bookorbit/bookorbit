import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, readingSessions, userReadingDailyStats } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

const MIN_READING_SESSION_SECONDS = 10;

export type SaveReadingSessionResult =
  | { kind: 'saved' }
  | {
      kind: 'skipped';
      reason: 'duration_below_minimum' | 'book_file_not_found' | 'duplicate_session_id';
    };

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
  ): Promise<SaveReadingSessionResult> {
    if (durationSeconds < MIN_READING_SESSION_SECONDS) {
      return { kind: 'skipped', reason: 'duration_below_minimum' };
    }

    const [fileRow] = await this.db
      .select({ libraryId: books.libraryId })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, bookFileId))
      .limit(1);

    if (!fileRow) {
      return { kind: 'skipped', reason: 'book_file_not_found' };
    }

    const { libraryId } = fileRow;

    return this.db.transaction(async (tx): Promise<SaveReadingSessionResult> => {
      const inserted = await tx
        .insert(readingSessions)
        .values({ userId, bookFileId, sessionId, startedAt, endedAt, durationSeconds, progressDelta, endProgress })
        .onConflictDoNothing({ target: [readingSessions.sessionId] })
        .returning({ id: readingSessions.id });

      if (inserted.length === 0) {
        return { kind: 'skipped', reason: 'duplicate_session_id' };
      }

      await tx
        .insert(userReadingDailyStats)
        .values({
          userId,
          libraryId,
          day: sql<string>`date_trunc('day', ${startedAt}::timestamp)::date`,
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

      return { kind: 'saved' };
    });
  }
}
