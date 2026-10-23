import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, like, lt, lte, max, min, notLike, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type {
  BookReadingSession,
  BookReadingSessionListResponse,
  BookReadingSessionStats,
  BookReadingSourceSlice,
  ReadingSessionSource,
  ReadingSessionType,
} from '@bookorbit/types';
import { READING_SESSION_SOURCE_BUCKETS, READING_SESSION_TYPES, emptySourceBucketRecord, toReadingSessionSourceBucket } from '@bookorbit/types';
import {
  aggregateReadingSessionDailyStats,
  getDayRangeForDateKeys,
  getReadingSessionDayKeys,
  splitReadingSessionByDay,
  type ReadingDailyStatsSegment,
} from '../../common/utils/reading-daily-stats.utils';
import { parseKoreaderSessionId } from '../../common/utils/koreader-session-id.utils';
import { resolveTimeZone, toDateKeyInTimeZone } from '../../common/utils/timezone.utils';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookFiles, books, koreaderSessionTombstones, readingSessionSyncCursors, readingSessions, userReadingDailyStats } from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const MIN_READING_SESSION_SECONDS = 10;

// The column is a free varchar, so anything unexpected reads as plain reading rather than leaking
// an unknown value to clients that switch on it.
function toReadingSessionType(value: string | null | undefined): ReadingSessionType {
  return (READING_SESSION_TYPES as readonly string[]).includes(value ?? '') ? (value as ReadingSessionType) : 'read';
}
const ESTIMATE_CLEANUP_PAGE_SIZE = 500;
const CLEANUP_DAILY_STATS_MAX_SPAN_DAYS = 31;
// Cumulative device counters tick in whole minutes, so less than one tick left is rounding, not reading.
const SYNC_COUNTER_RESOLUTION_SECONDS = 60;

// A device can push its counter while a book is open, on waking or on a manual sync, so a counter
// interval can begin or end inside a measured session. The session's seconds are split by how much
// of its wall-clock span falls in each interval rather than given whole to the one holding its start.
// `measuredSecondsInWindow` and `measuredShareOfWindow` must apply the same rule.
function measuredSecondsInWindow(windowStart: Date, windowEnd: Date): SQL<number> {
  return sql<number>`case when ${readingSessions.endedAt} > ${readingSessions.startedAt} then round(
    ${readingSessions.durationSeconds} * greatest(0, extract(epoch from (
      least(${readingSessions.endedAt}, ${windowEnd}::timestamptz) - greatest(${readingSessions.startedAt}, ${windowStart}::timestamptz)
    ))) / extract(epoch from (${readingSessions.endedAt} - ${readingSessions.startedAt}))
  ) else ${readingSessions.durationSeconds} end`;
}

function measuredShareOfWindow(session: { seconds: number; startedAt: Date; endedAt: Date }, windowStart: Date, windowEnd: Date): number {
  const spanMs = session.endedAt.getTime() - session.startedAt.getTime();
  if (spanMs <= 0) return session.seconds;
  const overlapMs = Math.min(session.endedAt.getTime(), windowEnd.getTime()) - Math.max(session.startedAt.getTime(), windowStart.getTime());
  return Math.round((session.seconds * Math.max(0, overlapMs)) / spanMs);
}

function scaleProgressDelta(progressDelta: number | null, keptSeconds: number, totalSeconds: number): number | null {
  if (progressDelta === null || keptSeconds === totalSeconds) return progressDelta;
  return Math.round(((progressDelta * keptSeconds) / totalSeconds) * 100) / 100;
}

function groupDateKeysByMaxSpan(days: Iterable<string>): string[][] {
  const sorted = [...new Set(days)].sort();
  const groups: string[][] = [];
  let group: string[] = [];
  let firstDayNumber = 0;

  for (const day of sorted) {
    const dayNumber = Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 86_400_000);
    if (group.length === 0 || dayNumber - firstDayNumber < CLEANUP_DAILY_STATS_MAX_SPAN_DAYS) {
      if (group.length === 0) firstDayNumber = dayNumber;
      group.push(day);
      continue;
    }

    groups.push(group);
    group = [day];
    firstDayNumber = dayNumber;
  }

  if (group.length > 0) groups.push(group);
  return groups;
}

export type SaveReadingSessionResult =
  | { kind: 'saved' }
  | { kind: 'superseded'; addedSeconds: number }
  | {
      kind: 'skipped';
      reason: 'duration_below_minimum' | 'book_file_not_found' | 'duplicate_session_id';
    };

export type RecordCumulativeReadingSessionResult =
  | { kind: 'baseline' | 'unchanged' | 'reset' | 'stale' }
  | { kind: 'saved'; durationSeconds: number; progressDelta: number | null; sessionId: string }
  | {
      kind: 'skipped';
      reason: 'book_file_not_found' | 'duplicate_session_id' | 'measured_session_present';
    };

export interface ReadingSessionSyncOptions {
  sourceDeviceKey: string;
  estimateSessionIdPrefix?: string;
}

export interface RecordCumulativeReadingSessionParams {
  userId: number;
  bookId: number;
  bookFileId: number | null;
  cursorSource: string;
  sourceDeviceKey: string;
  sessionIdPrefix: string;
  buildSessionId: (bookFileId: number, generation: number, counter: number) => string;
  counter: number;
  endedAt: Date;
  progressDelta: number | null;
  endProgress: number | null;
  source: ReadingSessionSource;
  timeZone: string;
}

export interface InsertManualSessionParams {
  userId: number;
  bookId: number;
  libraryId: number;
  bookFileId: number | null;
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
  timeZone: string;
}

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
    source: ReadingSessionSource = 'web',
    timeZone = 'UTC',
    sync?: ReadingSessionSyncOptions,
    sessionType: 'read' | 'tts' | 'listen' = 'read',
  ): Promise<SaveReadingSessionResult> {
    if (durationSeconds < MIN_READING_SESSION_SECONDS) {
      return { kind: 'skipped', reason: 'duration_below_minimum' };
    }

    const [fileRow] = await this.db
      .select({ bookId: books.id, libraryId: books.libraryId })
      .from(bookFiles)
      .innerJoin(books, eq(books.id, bookFiles.bookId))
      .where(eq(bookFiles.id, bookFileId))
      .limit(1);

    if (!fileRow) {
      return { kind: 'skipped', reason: 'book_file_not_found' };
    }

    const { bookId, libraryId } = fileRow;

    return this.db.transaction(async (tx): Promise<SaveReadingSessionResult> => {
      if (sync) await this.lockSyncSource(tx, userId, bookId, sync.sourceDeviceKey);

      const inserted = await tx
        .insert(readingSessions)
        .values({
          userId,
          bookFileId,
          bookId,
          attemptId: sql`(select id from reading_attempts where user_id = ${userId} and book_id = ${bookId} and outcome is null and deleted_at is null limit 1)`,
          sessionId,
          source,
          sourceDeviceKey: sync?.sourceDeviceKey ?? null,
          sessionType,
          startedAt,
          endedAt,
          durationSeconds,
          progressDelta,
          endProgress,
        })
        .onConflictDoNothing({ target: [readingSessions.userId, readingSessions.sessionId] })
        .returning({ id: readingSessions.id });

      let result: SaveReadingSessionResult;

      if (inserted.length === 0) {
        // A row already exists for this sessionId, and that is usually deliberate rather than a
        // replay. Clients checkpoint a session mid-flight - the iOS player writes one when the app
        // is backgrounded, because `willTerminate` is not delivered if it is then killed - and the
        // later close carries the *same* id specifically to supersede that partial row.
        //
        // Dropping the second write capped every backgrounded session at whatever the checkpoint
        // had captured. Measured on iOS: a 50s listen containing one backgrounding recorded 17s,
        // and the client had correctly sent 56.
        //
        // Superseding only upward keeps this idempotent for the sync queue, which may retry the
        // identical write: an equal or smaller duration is still a no-op, so a stale retry can
        // never shrink a session.
        const [existing] = await tx
          .select({
            id: readingSessions.id,
            durationSeconds: readingSessions.durationSeconds,
            progressDelta: readingSessions.progressDelta,
          })
          .from(readingSessions)
          .where(and(eq(readingSessions.userId, userId), eq(readingSessions.sessionId, sessionId)))
          .limit(1);

        if (!existing || durationSeconds <= existing.durationSeconds) {
          result = { kind: 'skipped', reason: 'duplicate_session_id' };
        } else {
          const addedSeconds = durationSeconds - existing.durationSeconds;
          const addedProgress = progressDelta === null ? null : progressDelta - (existing.progressDelta ?? 0);

          await tx.update(readingSessions).set({ endedAt, durationSeconds, progressDelta, endProgress }).where(eq(readingSessions.id, existing.id));

          // Daily stats accumulate, so only add the portion beyond the checkpoint.
          await this.upsertDailyStats(tx, {
            userId,
            libraryId,
            startedAt,
            endedAt,
            durationSeconds: addedSeconds,
            progressDelta: addedProgress,
            timeZone,
          });

          result = { kind: 'superseded', addedSeconds };
        }
      } else {
        result = { kind: 'saved' };
        await this.upsertDailyStats(tx, { userId, libraryId, startedAt, endedAt, durationSeconds, progressDelta, timeZone });
      }

      if (result.kind !== 'saved' && sync) {
        await tx
          .update(readingSessions)
          .set({ sourceDeviceKey: sync.sourceDeviceKey })
          .where(
            and(
              eq(readingSessions.userId, userId),
              eq(readingSessions.bookId, bookId),
              eq(readingSessions.sessionId, sessionId),
              eq(readingSessions.source, source),
              isNull(readingSessions.sourceDeviceKey),
            ),
          );
      }

      if (sync?.estimateSessionIdPrefix) {
        await this.reconcileSyncEstimates(tx, {
          userId,
          bookId,
          libraryId,
          source,
          sourceDeviceKey: sync.sourceDeviceKey,
          estimateSessionIdPrefix: sync.estimateSessionIdPrefix,
          startedAt,
          endedAt,
          timeZone,
          newlyMeasuredSeconds: result.kind === 'saved' ? durationSeconds : result.kind === 'superseded' ? result.addedSeconds : 0,
        });
      }

      return result;
    });
  }

  async recordCumulativeSyncedSession(params: RecordCumulativeReadingSessionParams): Promise<RecordCumulativeReadingSessionResult> {
    return this.db.transaction(async (tx): Promise<RecordCumulativeReadingSessionResult> => {
      await this.lockSyncSource(tx, params.userId, params.bookId, params.sourceDeviceKey);

      const [cursor] = await tx
        .select({
          counter: readingSessionSyncCursors.counter,
          generation: readingSessionSyncCursors.generation,
          lastModified: readingSessionSyncCursors.lastModified,
        })
        .from(readingSessionSyncCursors)
        .where(
          and(
            eq(readingSessionSyncCursors.userId, params.userId),
            eq(readingSessionSyncCursors.bookId, params.bookId),
            eq(readingSessionSyncCursors.source, params.cursorSource),
            eq(readingSessionSyncCursors.sourceDeviceKey, params.sourceDeviceKey),
          ),
        )
        .limit(1);

      if (!cursor) {
        await tx.insert(readingSessionSyncCursors).values({
          userId: params.userId,
          bookId: params.bookId,
          source: params.cursorSource,
          sourceDeviceKey: params.sourceDeviceKey,
          counter: params.counter,
          lastModified: params.endedAt,
        });
        return { kind: 'baseline' };
      }

      if (params.endedAt.getTime() < cursor.lastModified.getTime()) return { kind: 'stale' };

      if (params.counter === cursor.counter) {
        if (params.endedAt.getTime() > cursor.lastModified.getTime()) {
          await this.updateSyncCursor(tx, params, cursor.generation);
        }
        return { kind: 'unchanged' };
      }

      if (params.counter < cursor.counter) {
        await this.updateSyncCursor(tx, params, cursor.generation + 1);
        return { kind: 'reset' };
      }

      // The counter covers everything read since the previous push, however long ago that reading
      // was: a device that read offline only pushes with its next sync. The share of measured
      // sessions that falls in that interval is subtracted rather than taken as proof the whole
      // delta is covered, so reading the device did not measure is kept.
      const counterSeconds = (params.counter - cursor.counter) * 60;

      const [measured] = await tx
        .select({ seconds: sql<number>`coalesce(sum(${measuredSecondsInWindow(cursor.lastModified, params.endedAt)}), 0)::int` })
        .from(readingSessions)
        .where(
          and(
            eq(readingSessions.userId, params.userId),
            eq(readingSessions.bookId, params.bookId),
            eq(readingSessions.source, params.source),
            eq(readingSessions.sourceDeviceKey, params.sourceDeviceKey),
            notLike(readingSessions.sessionId, `${params.sessionIdPrefix}%`),
            lt(readingSessions.startedAt, params.endedAt),
            gt(readingSessions.endedAt, cursor.lastModified),
          ),
        );

      const durationSeconds = counterSeconds - (measured?.seconds ?? 0);
      if (durationSeconds < SYNC_COUNTER_RESOLUTION_SECONDS) {
        await this.updateSyncCursor(tx, params, cursor.generation);
        return { kind: 'skipped', reason: 'measured_session_present' };
      }

      const startedAt = new Date(params.endedAt.getTime() - durationSeconds * 1000);
      const progressDelta = scaleProgressDelta(params.progressDelta, durationSeconds, counterSeconds);

      if (params.bookFileId === null) return { kind: 'skipped', reason: 'book_file_not_found' };

      const sessionId = params.buildSessionId(params.bookFileId, cursor.generation, params.counter);

      const [fileRow] = await tx
        .select({ bookId: books.id, libraryId: books.libraryId })
        .from(bookFiles)
        .innerJoin(books, eq(books.id, bookFiles.bookId))
        .where(and(eq(bookFiles.id, params.bookFileId), eq(books.id, params.bookId)))
        .limit(1);
      if (!fileRow) return { kind: 'skipped', reason: 'book_file_not_found' };

      const inserted = await tx
        .insert(readingSessions)
        .values({
          userId: params.userId,
          bookFileId: params.bookFileId,
          bookId: params.bookId,
          attemptId: sql`(select id from reading_attempts where user_id = ${params.userId} and book_id = ${params.bookId} and outcome is null and deleted_at is null limit 1)`,
          sessionId,
          source: params.source,
          sourceDeviceKey: params.sourceDeviceKey,
          startedAt,
          endedAt: params.endedAt,
          durationSeconds,
          progressDelta,
          endProgress: params.endProgress,
          syncIntervalStartedAt: cursor.lastModified,
        })
        .onConflictDoNothing({ target: [readingSessions.userId, readingSessions.sessionId] })
        .returning({ id: readingSessions.id });

      await this.updateSyncCursor(tx, params, cursor.generation);
      if (inserted.length === 0) return { kind: 'skipped', reason: 'duplicate_session_id' };

      await this.upsertDailyStats(tx, {
        userId: params.userId,
        libraryId: fileRow.libraryId,
        startedAt,
        endedAt: params.endedAt,
        durationSeconds,
        progressDelta,
        timeZone: params.timeZone,
      });

      return { kind: 'saved', durationSeconds, progressDelta, sessionId };
    });
  }

  async insertManualSession(params: InsertManualSessionParams): Promise<{ id: number; attemptId: number | null }> {
    const { userId, bookId, libraryId, bookFileId, sessionId, startedAt, endedAt, durationSeconds, progressDelta, endProgress, timeZone } = params;

    return this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(readingSessions)
        .values({
          userId,
          bookId,
          bookFileId,
          attemptId: sql`(select id from reading_attempts where user_id = ${userId} and book_id = ${bookId} and outcome is null and deleted_at is null limit 1)`,
          sessionId,
          source: 'manual',
          startedAt,
          endedAt,
          durationSeconds,
          progressDelta,
          endProgress,
        })
        .returning({ id: readingSessions.id, attemptId: readingSessions.attemptId });

      await this.upsertDailyStats(tx, { userId, libraryId, startedAt, endedAt, durationSeconds, progressDelta, timeZone });

      return { id: inserted.id, attemptId: inserted.attemptId ?? null };
    });
  }

  async findBookContext(bookId: number): Promise<{ libraryId: number; files: { id: number; format: string | null }[] } | null> {
    const [bookRow] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    if (!bookRow) return null;

    const files = await this.db
      .select({ id: bookFiles.id, format: sql<string | null>`nullif(${bookFiles.format}, '')` })
      .from(bookFiles)
      .where(eq(bookFiles.bookId, bookId));

    return { libraryId: bookRow.libraryId, files };
  }

  async findLatestEndProgressBefore(userId: number, bookId: number, before: Date): Promise<number | null> {
    const [row] = await this.db
      .select({ endProgress: readingSessions.endProgress })
      .from(readingSessions)
      .where(
        and(
          eq(readingSessions.userId, userId),
          eq(readingSessions.bookId, bookId),
          lt(readingSessions.startedAt, before),
          isNotNull(readingSessions.endProgress),
        ),
      )
      .orderBy(desc(readingSessions.startedAt))
      .limit(1);

    return row?.endProgress ?? null;
  }

  // Deliberately unscoped by the list filters: this feeds the book's progress ring, which
  // must not move when the reading log is filtered by date range or format.
  async findLatestEndProgress(userId: number, bookId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ endProgress: readingSessions.endProgress })
      .from(readingSessions)
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId), isNotNull(readingSessions.endProgress)))
      .orderBy(desc(readingSessions.startedAt), desc(readingSessions.id))
      .limit(1);

    return row?.endProgress ?? null;
  }

  async listByBook(
    userId: number,
    bookId: number,
    page: number,
    pageSize: number,
    sortBy: string,
    sortDir: string,
    dateFrom?: string,
    dateTo?: string,
    format?: string,
    timeZone = 'UTC',
  ): Promise<BookReadingSessionListResponse> {
    const conditions = [eq(readingSessions.bookId, bookId), eq(readingSessions.userId, userId)];
    if (dateFrom) conditions.push(gte(readingSessions.startedAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(readingSessions.startedAt, new Date(dateTo)));
    if (format) conditions.push(eq(sql`upper(${bookFiles.format})`, format.toUpperCase()));

    const whereClause = and(...conditions);

    let orderCol;
    switch (sortBy) {
      case 'durationSeconds':
        orderCol = readingSessions.durationSeconds;
        break;
      case 'progressDelta':
        orderCol = readingSessions.progressDelta;
        break;
      case 'endProgress':
        orderCol = readingSessions.endProgress;
        break;
      default:
        orderCol = readingSessions.startedAt;
    }
    const orderExpr = sortDir === 'asc' ? asc(orderCol) : desc(orderCol);
    const offset = (page - 1) * pageSize;

    const [rows, countRows, statsRows, summaryRows, sourceRows, latestEndProgress] = await Promise.all([
      this.db
        .select({
          id: readingSessions.id,
          bookFileId: readingSessions.bookFileId,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
          endProgress: readingSessions.endProgress,
          format: sql<string | null>`nullif(${bookFiles.format}, '')`,
          source: readingSessions.source,
          attemptId: readingSessions.attemptId,
          sessionType: readingSessions.sessionType,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause)
        .orderBy(orderExpr)
        .limit(pageSize)
        .offset(offset),

      this.db.select({ total: count() }).from(readingSessions).leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId)).where(whereClause),

      this.db
        .select({
          totalSessions: count(),
          totalSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
          avgDurationSeconds: sql<number>`coalesce(avg(${readingSessions.durationSeconds}), 0)::int`,
          firstSessionAt: min(readingSessions.startedAt),
          lastSessionAt: max(readingSessions.startedAt),
          paceProgressDelta: sql<number>`coalesce(sum(${readingSessions.progressDelta}) filter (where ${readingSessions.progressDelta} > 0), 0)::real`,
          paceDurationSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}) filter (where ${readingSessions.progressDelta} > 0), 0)::int`,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause),

      this.db
        .select({
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
          endProgress: readingSessions.endProgress,
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause)
        .orderBy(asc(readingSessions.startedAt)),

      this.db
        .select({
          source: readingSessions.source,
          totalSeconds: sql<number>`coalesce(sum(${readingSessions.durationSeconds}), 0)::int`,
          totalSessions: count(),
        })
        .from(readingSessions)
        .leftJoin(bookFiles, eq(bookFiles.id, readingSessions.bookFileId))
        .where(whereClause)
        .groupBy(readingSessions.source),

      this.findLatestEndProgress(userId, bookId),
    ]);

    const total = countRows[0]?.total ?? 0;
    const statsRow = statsRows[0];

    const bucketSeconds = emptySourceBucketRecord();
    const bucketSessions = emptySourceBucketRecord();
    for (const row of sourceRows) {
      const bucket = toReadingSessionSourceBucket(row.source);
      bucketSeconds[bucket] += row.totalSeconds;
      bucketSessions[bucket] += row.totalSessions;
    }
    const bySource: BookReadingSourceSlice[] = READING_SESSION_SOURCE_BUCKETS.filter((bucket) => bucketSessions[bucket] > 0).map((bucket) => ({
      bucket,
      totalSeconds: bucketSeconds[bucket],
      totalSessions: bucketSessions[bucket],
    }));

    const dailySummary = aggregateReadingSessionDailyStats(
      summaryRows.map((row) => ({
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        progressDelta: row.progressDelta ?? null,
      })),
      timeZone,
    ).map((segment) => ({
      day: segment.day,
      totalMinutes: Math.round((segment.readingSeconds / 60) * 10) / 10,
    }));

    // summaryRows already covers every session in the window, so the two aggregates the client
    // cannot derive from a single page cost nothing extra here.
    let longestSessionSeconds = 0;
    let longestSessionAt: string | null = null;
    let backtrackCount = 0;
    for (const row of summaryRows) {
      if (row.durationSeconds > longestSessionSeconds) {
        longestSessionSeconds = row.durationSeconds;
        longestSessionAt = row.startedAt.toISOString();
      }
      if (row.progressDelta != null && row.progressDelta < -0.5) backtrackCount += 1;
    }

    const progressByDay = new Map<string, { day: string; endProgress: number; endedAtMs: number }>();
    for (const row of summaryRows) {
      if (row.endProgress == null) continue;
      const day = toDateKeyInTimeZone(row.endedAt, timeZone);
      const endedAtMs = row.endedAt.getTime();
      const existing = progressByDay.get(day);
      if (!existing || endedAtMs > existing.endedAtMs) {
        progressByDay.set(day, { day, endProgress: row.endProgress, endedAtMs });
      }
    }
    const progressSummary = [...progressByDay.values()]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(({ day, endProgress }) => ({ day, endProgress }));

    const stats: BookReadingSessionStats = {
      totalSessions: statsRow?.totalSessions ?? 0,
      totalSeconds: statsRow?.totalSeconds ?? 0,
      avgDurationSeconds: statsRow?.avgDurationSeconds ?? 0,
      firstSessionAt: statsRow?.firstSessionAt ? (statsRow.firstSessionAt as Date).toISOString() : null,
      lastSessionAt: statsRow?.lastSessionAt ? (statsRow.lastSessionAt as Date).toISOString() : null,
      dailySummary,
      paceProgressDelta: statsRow?.paceProgressDelta ?? 0,
      paceDurationSeconds: statsRow?.paceDurationSeconds ?? 0,
      progressSummary,
      latestEndProgress,
      bySource,
      longestSessionSeconds,
      longestSessionAt,
      backtrackCount,
    };

    const items: BookReadingSession[] = rows.map((r) => ({
      id: r.id,
      bookFileId: r.bookFileId ?? null,
      startedAt: (r.startedAt as Date).toISOString(),
      endedAt: (r.endedAt as Date).toISOString(),
      durationSeconds: r.durationSeconds,
      progressDelta: r.progressDelta ?? null,
      endProgress: r.endProgress ?? null,
      format: r.format ?? null,
      source: r.source ?? null,
      attemptId: r.attemptId ?? null,
      sessionType: toReadingSessionType(r.sessionType),
    }));

    return { items, total, page, pageSize, stats };
  }

  async deleteSessionByBook(userId: number, bookId: number, sessionId: number, timeZone = 'UTC'): Promise<{ found: boolean }> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: readingSessions.id,
          sessionId: readingSessions.sessionId,
          source: readingSessions.source,
          bookFileId: readingSessions.bookFileId,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
          libraryId: books.libraryId,
        })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .where(and(eq(readingSessions.id, sessionId), eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId)))
        .limit(1);

      if (!row) return { found: false };

      const { startedAt, endedAt, durationSeconds, progressDelta, libraryId } = row;
      const affectedDays = getReadingSessionDayKeys({ startedAt, endedAt, durationSeconds, progressDelta: progressDelta ?? null }, timeZone);

      await tx.delete(readingSessions).where(eq(readingSessions.id, sessionId));

      // A KOReader session is derived from page events that stay stored, so without this the next
      // event within the session gap, or a plugin uploading its history again, re-derives it.
      const derived = row.source === 'koreader' ? parseKoreaderSessionId(row.sessionId) : null;
      const startTime = Math.floor(startedAt.getTime() / 1000);
      const endTime = Math.ceil(endedAt.getTime() / 1000);
      if (derived && row.bookFileId != null && endTime > startTime) {
        await tx.insert(koreaderSessionTombstones).values({ userId, bookFileId: row.bookFileId, deviceKey: derived.deviceKey, startTime, endTime });
      }

      await this.recomputeDailyStats(tx, userId, libraryId, affectedDays, timeZone);

      return { found: true };
    });
  }

  async deleteLegacyKoreaderSyncEstimatesBatch(limit: number): Promise<{ deleted: number }> {
    return this.db.transaction(async (tx) => {
      // The exact id shape was reserved by the removed estimator. Plugin-measured sessions use
      // the `kor:` namespace, so this cannot match supported KOReader telemetry.
      const rows = await tx
        .select({
          id: readingSessions.id,
          userId: readingSessions.userId,
          libraryId: books.libraryId,
          startedAt: readingSessions.startedAt,
          endedAt: readingSessions.endedAt,
          durationSeconds: readingSessions.durationSeconds,
          progressDelta: readingSessions.progressDelta,
          userSettings: schema.users.settings,
        })
        .from(readingSessions)
        .innerJoin(books, eq(books.id, readingSessions.bookId))
        .innerJoin(schema.users, eq(schema.users.id, readingSessions.userId))
        .where(and(eq(readingSessions.source, 'koreader'), sql<boolean>`${readingSessions.sessionId} ~ ${'^ks-[0-9a-f]{12}-[0-9a-f]{32}$'}`))
        .orderBy(readingSessions.id)
        .limit(limit);

      if (rows.length === 0) return { deleted: 0 };

      const affected = new Map<string, { userId: number; libraryId: number; timeZone: string; days: Set<string> }>();
      for (const row of rows) {
        const timeZone = resolveTimeZone((row.userSettings as { timezone?: unknown } | null)?.timezone, 'UTC');
        const key = `${row.userId}:${row.libraryId}`;
        const group = affected.get(key) ?? { userId: row.userId, libraryId: row.libraryId, timeZone, days: new Set<string>() };
        for (const day of getReadingSessionDayKeys(
          {
            startedAt: row.startedAt,
            endedAt: row.endedAt,
            durationSeconds: row.durationSeconds,
            progressDelta: row.progressDelta ?? null,
          },
          timeZone,
        )) {
          group.days.add(day);
        }
        affected.set(key, group);
      }

      await tx.delete(readingSessions).where(
        inArray(
          readingSessions.id,
          rows.map((row) => row.id),
        ),
      );

      const groups = [...affected.values()].sort((left, right) => left.userId - right.userId || left.libraryId - right.libraryId);
      for (const group of groups) {
        // Keep each recompute's database range bounded even when one batch contains sparse
        // sessions from years apart.
        for (const days of groupDateKeysByMaxSpan(group.days)) {
          await this.recomputeDailyStats(tx, group.userId, group.libraryId, days, group.timeZone);
        }
      }

      return { deleted: rows.length };
    });
  }

  private async upsertDailyStats(
    tx: Tx,
    params: {
      userId: number;
      libraryId: number;
      startedAt: Date;
      endedAt: Date;
      durationSeconds: number;
      progressDelta: number | null;
      timeZone: string;
    },
  ): Promise<void> {
    const { userId, libraryId, startedAt, endedAt, durationSeconds, progressDelta, timeZone } = params;
    await this.lockDailyStats(tx, userId, libraryId);
    const segments = splitReadingSessionByDay({ startedAt, endedAt, durationSeconds, progressDelta }, timeZone);
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments, 'increment');
  }

  private async recomputeDailyStats(tx: Tx, userId: number, libraryId: number, days: string[], timeZone: string): Promise<void> {
    const affectedDays = [...new Set(days)].sort();
    if (affectedDays.length === 0) return;

    await this.lockDailyStats(tx, userId, libraryId);

    await tx
      .delete(userReadingDailyStats)
      .where(
        and(
          eq(userReadingDailyStats.userId, userId),
          eq(userReadingDailyStats.libraryId, libraryId),
          inArray(userReadingDailyStats.day, affectedDays),
        ),
      );

    const range = getDayRangeForDateKeys(affectedDays, timeZone);
    if (!range) return;

    const rows = await tx
      .select({
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
        ),
      );

    const segments = aggregateReadingSessionDailyStats(
      rows.map((row) => ({
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
        progressDelta: row.progressDelta ?? null,
      })),
      timeZone,
      new Set(affectedDays),
    );
    await this.insertDailyStatsSegments(tx, userId, libraryId, segments, 'replace');
  }

  private async updateSyncCursor(tx: Tx, params: RecordCumulativeReadingSessionParams, generation: number): Promise<void> {
    await tx
      .update(readingSessionSyncCursors)
      .set({ counter: params.counter, generation, lastModified: params.endedAt, updatedAt: new Date() })
      .where(
        and(
          eq(readingSessionSyncCursors.userId, params.userId),
          eq(readingSessionSyncCursors.bookId, params.bookId),
          eq(readingSessionSyncCursors.source, params.cursorSource),
          eq(readingSessionSyncCursors.sourceDeviceKey, params.sourceDeviceKey),
        ),
      );
  }

  private async lockSyncSource(tx: Tx, userId: number, bookId: number, sourceDeviceKey: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, hashtext(${`${sourceDeviceKey}:${bookId}`})::int)`);
  }

  /**
   * Reconciles the counter-derived estimates of a device with a session it also measured.
   *
   * An estimate stands for whatever was read between two counter pushes, and it is dated on the
   * minutes leading up to the push. That is only when the reading happened if the device pushed
   * right after it; after offline reading the push comes with the next sync. So the measured
   * session is matched to every estimate whose counter interval it overlaps, and each takes the
   * share of its seconds that falls in that interval. They are taken once, when first stored: a
   * replay takes nothing, and the shares never add up to more than the session. What is left
   * stays as reading the device did not measure, unless it is below the counter resolution.
   *
   * Estimates written before the interval was recorded keep the overlap rule they were created under.
   */
  private async reconcileSyncEstimates(
    tx: Tx,
    params: {
      userId: number;
      bookId: number;
      libraryId: number;
      source: ReadingSessionSource;
      sourceDeviceKey: string;
      estimateSessionIdPrefix: string;
      startedAt: Date;
      endedAt: Date;
      timeZone: string;
      newlyMeasuredSeconds: number;
    },
  ): Promise<void> {
    const affectedDays = new Set<string>();
    const estimateColumns = {
      id: readingSessions.id,
      startedAt: readingSessions.startedAt,
      endedAt: readingSessions.endedAt,
      durationSeconds: readingSessions.durationSeconds,
      progressDelta: readingSessions.progressDelta,
    };
    const sameDeviceEstimate = and(
      eq(readingSessions.userId, params.userId),
      eq(readingSessions.bookId, params.bookId),
      eq(readingSessions.source, params.source),
      eq(readingSessions.sourceDeviceKey, params.sourceDeviceKey),
      like(readingSessions.sessionId, `${params.estimateSessionIdPrefix}%`),
    );
    const collectAffectedDays = (row: { startedAt: Date; endedAt: Date; durationSeconds: number; progressDelta: number | null }) => {
      for (const day of getReadingSessionDayKeys(row, params.timeZone)) affectedDays.add(day);
    };
    let cursor = 0;

    for (;;) {
      const rows = await tx
        .select(estimateColumns)
        .from(readingSessions)
        .where(
          and(
            sameDeviceEstimate,
            isNull(readingSessions.syncIntervalStartedAt),
            lt(readingSessions.startedAt, params.endedAt),
            gt(readingSessions.endedAt, params.startedAt),
            gt(readingSessions.id, cursor),
          ),
        )
        .orderBy(readingSessions.id)
        .limit(ESTIMATE_CLEANUP_PAGE_SIZE);

      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;

      for (const row of rows) collectAffectedDays(row);

      await tx.delete(readingSessions).where(
        and(
          eq(readingSessions.userId, params.userId),
          inArray(
            readingSessions.id,
            rows.map((row) => row.id),
          ),
        ),
      );

      if (rows.length < ESTIMATE_CLEANUP_PAGE_SIZE) break;
    }

    if (params.newlyMeasuredSeconds > 0) {
      const measured = { seconds: params.newlyMeasuredSeconds, startedAt: params.startedAt, endedAt: params.endedAt };
      const overlapping = await tx
        .select({ ...estimateColumns, syncIntervalStartedAt: readingSessions.syncIntervalStartedAt })
        .from(readingSessions)
        .where(
          and(
            sameDeviceEstimate,
            isNotNull(readingSessions.syncIntervalStartedAt),
            lt(readingSessions.syncIntervalStartedAt, params.endedAt),
            gt(readingSessions.endedAt, params.startedAt),
          ),
        )
        .orderBy(asc(readingSessions.endedAt), asc(readingSessions.id));

      for (const estimate of overlapping) {
        const share = measuredShareOfWindow(measured, estimate.syncIntervalStartedAt!, estimate.endedAt);
        if (share <= 0) continue;

        const ownEstimate = and(eq(readingSessions.userId, params.userId), eq(readingSessions.id, estimate.id));
        const remainingSeconds = estimate.durationSeconds - share;
        collectAffectedDays(estimate);

        if (remainingSeconds < SYNC_COUNTER_RESOLUTION_SECONDS) {
          await tx.delete(readingSessions).where(ownEstimate);
        } else {
          const shortened = {
            startedAt: new Date(estimate.endedAt.getTime() - remainingSeconds * 1000),
            endedAt: estimate.endedAt,
            durationSeconds: remainingSeconds,
            progressDelta: scaleProgressDelta(estimate.progressDelta, remainingSeconds, estimate.durationSeconds),
          };
          await tx
            .update(readingSessions)
            .set({ startedAt: shortened.startedAt, durationSeconds: shortened.durationSeconds, progressDelta: shortened.progressDelta })
            .where(ownEstimate);
          collectAffectedDays(shortened);
        }
      }
    }

    if (affectedDays.size > 0) {
      await this.recomputeDailyStats(tx, params.userId, params.libraryId, [...affectedDays], params.timeZone);
    }
  }

  private async lockDailyStats(tx: Tx, userId: number, libraryId: number): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(${userId}::int, ${libraryId}::int)`);
  }

  private async insertDailyStatsSegments(
    tx: Tx,
    userId: number,
    libraryId: number,
    segments: ReadingDailyStatsSegment[],
    mode: 'increment' | 'replace',
  ): Promise<void> {
    if (segments.length === 0) return;

    const now = new Date();
    await tx
      .insert(userReadingDailyStats)
      .values(
        segments.map((segment) => ({
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
        set:
          mode === 'increment'
            ? {
                readingSeconds: sql`${userReadingDailyStats.readingSeconds} + excluded.reading_seconds`,
                progressDelta: sql`${userReadingDailyStats.progressDelta} + excluded.progress_delta`,
                sessionsCount: sql`${userReadingDailyStats.sessionsCount} + excluded.sessions_count`,
                updatedAt: now,
              }
            : {
                readingSeconds: sql`excluded.reading_seconds`,
                progressDelta: sql`excluded.progress_delta`,
                sessionsCount: sql`excluded.sessions_count`,
                updatedAt: now,
              },
      });
  }
}
