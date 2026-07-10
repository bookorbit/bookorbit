import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { UserBookStatus } from '@bookorbit/types';
import {
  addDateKeyDays,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  splitReadingSessionByDay,
  type ReadingDailyStatsSegment,
} from '../../common/utils/reading-daily-stats.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  audiobookProgress,
  bookFiles,
  books,
  koboLibrarySnapshots,
  koboReadingStates,
  koboSnapshotBooks,
  koreaderDeviceProgress,
  koreaderPageStats,
  readingProgress,
  readingSessions,
  userBookStatus,
  userReadingDailyStats,
} from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const RESET_BATCH_SIZE = 250;

export interface ResetReadingStateResult {
  readStatus: UserBookStatus;
  sessionsDeleted: number;
  progressDeleted: number;
  audioProgressDeleted: number;
  koreaderDeviceProgressDeleted: number;
  koreaderPageStatsDeleted: number;
  koboStateReset: boolean;
}

@Injectable()
export class ReadingStateRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async resetBookReadingState(userId: number, bookId: number, timeZone: string): Promise<ResetReadingStateResult> {
    return this.db.transaction(async (tx) => {
      const [book] = await tx.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
      if (!book) throw new NotFoundException(`Book ${bookId} not found`);

      await this.lockDailyStats(tx, userId, book.libraryId);
      const { sessionsDeleted, affectedDays } = await this.collectAffectedSessionDays(tx, userId, bookId, timeZone);
      const fileIds = tx.select({ id: bookFiles.id }).from(bookFiles).where(eq(bookFiles.bookId, bookId));

      const [progressCount, audioProgressCount, koreaderProgressCount, koreaderPageStatsCount, koboState] = await Promise.all([
        this.countRows(tx, readingProgress, and(eq(readingProgress.userId, userId), inArray(readingProgress.bookFileId, fileIds))),
        this.countRows(tx, audiobookProgress, and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.bookId, bookId))),
        this.countRows(
          tx,
          koreaderDeviceProgress,
          and(eq(koreaderDeviceProgress.userId, userId), inArray(koreaderDeviceProgress.bookFileId, fileIds)),
        ),
        this.countRows(tx, koreaderPageStats, and(eq(koreaderPageStats.userId, userId), inArray(koreaderPageStats.bookFileId, fileIds))),
        tx
          .select({ id: koboReadingStates.id })
          .from(koboReadingStates)
          .where(and(eq(koboReadingStates.userId, userId), eq(koboReadingStates.bookId, bookId)))
          .limit(1),
      ]);

      const now = new Date();
      const nowIso = now.toISOString();

      await Promise.all([
        tx.delete(readingProgress).where(and(eq(readingProgress.userId, userId), inArray(readingProgress.bookFileId, fileIds))),
        tx.delete(audiobookProgress).where(and(eq(audiobookProgress.userId, userId), eq(audiobookProgress.bookId, bookId))),
        tx.delete(koreaderDeviceProgress).where(and(eq(koreaderDeviceProgress.userId, userId), inArray(koreaderDeviceProgress.bookFileId, fileIds))),
        tx.delete(koreaderPageStats).where(and(eq(koreaderPageStats.userId, userId), inArray(koreaderPageStats.bookFileId, fileIds))),
        tx.delete(readingSessions).where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId))),
        tx
          .insert(userBookStatus)
          .values({ userId, bookId, status: 'unread', source: 'manual', startedAt: null, finishedAt: null, updatedAt: now })
          .onConflictDoUpdate({
            target: [userBookStatus.userId, userBookStatus.bookId],
            set: { status: 'unread', source: 'manual', startedAt: null, finishedAt: null, updatedAt: now },
          }),
      ]);

      const koboStateReset = koboState.length > 0;
      if (koboStateReset) {
        await Promise.all([
          tx
            .update(koboReadingStates)
            .set({
              lastModifiedKobo: nowIso,
              priorityTimestamp: nowIso,
              currentBookmark: { LastModified: nowIso, ProgressPercent: 0 },
              statistics: { LastModified: nowIso },
              statusInfo: { LastModified: nowIso, Status: 'ReadyToRead', TimesStartedReading: 0 },
              updatedAt: now,
            })
            .where(and(eq(koboReadingStates.userId, userId), eq(koboReadingStates.bookId, bookId))),
          tx.execute(sql`
            UPDATE ${koboSnapshotBooks} AS sb
            SET synced = false,
                is_new = false
            FROM ${koboLibrarySnapshots} AS snap
            WHERE snap.id = sb.snapshot_id
              AND snap.user_id = ${userId}
              AND sb.book_id = ${bookId}
              AND sb.pending_delete = false
              AND sb.removed_by_device = false
          `),
        ]);
      }

      await this.recomputeDailyStats(tx, userId, book.libraryId, affectedDays, timeZone);

      return {
        readStatus: {
          status: 'unread',
          source: 'manual',
          startedAt: null,
          finishedAt: null,
          updatedAt: nowIso,
        },
        sessionsDeleted,
        progressDeleted: progressCount,
        audioProgressDeleted: audioProgressCount,
        koreaderDeviceProgressDeleted: koreaderProgressCount,
        koreaderPageStatsDeleted: koreaderPageStatsCount,
        koboStateReset,
      };
    });
  }

  private async countRows(tx: Tx, table: typeof readingProgress, where: ReturnType<typeof and>): Promise<number>;
  private async countRows(tx: Tx, table: typeof audiobookProgress, where: ReturnType<typeof and>): Promise<number>;
  private async countRows(tx: Tx, table: typeof koreaderDeviceProgress, where: ReturnType<typeof and>): Promise<number>;
  private async countRows(tx: Tx, table: typeof koreaderPageStats, where: ReturnType<typeof and>): Promise<number>;
  private async countRows(
    tx: Tx,
    table: typeof readingProgress | typeof audiobookProgress | typeof koreaderDeviceProgress | typeof koreaderPageStats,
    where: ReturnType<typeof and>,
  ) {
    const [row] = await tx.select({ total: count() }).from(table).where(where);
    return Number(row?.total ?? 0);
  }

  private async collectAffectedSessionDays(
    tx: Tx,
    userId: number,
    bookId: number,
    timeZone: string,
  ): Promise<{ sessionsDeleted: number; affectedDays: string[] }> {
    const affectedDays = new Set<string>();
    let sessionsDeleted = 0;
    let lastId = 0;

    while (true) {
      const rows = await tx
        .select({
          id: readingSessions.id,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
        })
        .from(readingSessions)
        .where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId), gt(readingSessions.id, lastId)))
        .orderBy(asc(readingSessions.id))
        .limit(RESET_BATCH_SIZE);

      if (rows.length === 0) break;

      for (const row of rows) {
        sessionsDeleted += 1;
        for (const day of getReadingSessionDayKeys(row, timeZone)) {
          affectedDays.add(day);
        }
      }

      lastId = rows[rows.length - 1]!.id;
      if (rows.length < RESET_BATCH_SIZE) break;
    }

    return { sessionsDeleted, affectedDays: [...affectedDays].sort() };
  }

  private async recomputeDailyStats(tx: Tx, userId: number, libraryId: number, days: string[], timeZone: string): Promise<void> {
    for (const dayBatch of this.groupDays(days)) {
      await tx
        .delete(userReadingDailyStats)
        .where(
          and(eq(userReadingDailyStats.userId, userId), eq(userReadingDailyStats.libraryId, libraryId), inArray(userReadingDailyStats.day, dayBatch)),
        );

      const range = getDayRangeForDateKeys(dayBatch, timeZone);
      if (!range) continue;

      const daySet = new Set(dayBatch);
      const segmentsByDay = new Map<string, ReadingDailyStatsSegment>();
      let lastId = 0;

      while (true) {
        const rows = await tx
          .select({
            id: readingSessions.id,
            startedAt: readingSessions.startedAt,
            endedAt: readingSessions.endedAt,
            durationSeconds: readingSessions.durationSeconds,
            progressDelta: readingSessions.progressDelta,
          })
          .from(readingSessions)
          .innerJoin(books, eq(books.id, readingSessions.bookId))
          .where(
            and(
              eq(readingSessions.userId, userId),
              eq(books.libraryId, libraryId),
              lt(readingSessions.startedAt, range.end),
              gt(readingSessions.endedAt, range.start),
              gt(readingSessions.id, lastId),
            ),
          )
          .orderBy(asc(readingSessions.id))
          .limit(RESET_BATCH_SIZE);

        if (rows.length === 0) break;

        for (const row of rows) {
          for (const segment of splitReadingSessionByDay(row, timeZone)) {
            if (!daySet.has(segment.day)) continue;
            const current = segmentsByDay.get(segment.day);
            if (current) {
              current.readingSeconds += segment.readingSeconds;
              current.progressDelta += segment.progressDelta;
              current.sessionsCount += segment.sessionsCount;
            } else {
              segmentsByDay.set(segment.day, { ...segment });
            }
          }
        }

        lastId = rows[rows.length - 1]!.id;
        if (rows.length < RESET_BATCH_SIZE) break;
      }

      await this.insertDailyStatsSegments(tx, userId, libraryId, [...segmentsByDay.values()]);
    }
  }

  private groupDays(days: string[]): string[][] {
    const sorted = [...new Set(days)].sort();
    const groups: string[][] = [];
    let current: string[] = [];

    for (const day of sorted) {
      const previous = current[current.length - 1];
      if (previous && (day !== addDateKeyDays(previous, 1) || current.length === RESET_BATCH_SIZE)) {
        groups.push(current);
        current = [];
      }
      current.push(day);
    }

    if (current.length > 0) groups.push(current);
    return groups;
  }

  private async insertDailyStatsSegments(tx: Tx, userId: number, libraryId: number, segments: ReadingDailyStatsSegment[]): Promise<void> {
    for (let index = 0; index < segments.length; index += RESET_BATCH_SIZE) {
      const batch = segments.slice(index, index + RESET_BATCH_SIZE);
      const now = new Date();
      await tx
        .insert(userReadingDailyStats)
        .values(
          batch.map((segment) => ({
            userId,
            libraryId,
            day: segment.day,
            readingSeconds: segment.readingSeconds,
            progressDelta: segment.progressDelta,
            sessionsCount: segment.sessionsCount,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [userReadingDailyStats.userId, userReadingDailyStats.libraryId, userReadingDailyStats.day],
          set: {
            readingSeconds: sql`excluded.reading_seconds`,
            progressDelta: sql`excluded.progress_delta`,
            sessionsCount: sql`excluded.sessions_count`,
            updatedAt: now,
          },
        });
    }
  }

  private async lockDailyStats(tx: Tx, userId: number, libraryId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
  }
}
