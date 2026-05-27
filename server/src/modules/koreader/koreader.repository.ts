import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class KoreaderRepository {
  constructor(@Inject(DB) private readonly db: Db) {}

  async findKoreaderUser(userId: number) {
    return this.db.query.koreaderUsers.findFirst({
      where: eq(schema.koreaderUsers.userId, userId),
    });
  }

  async findKoreaderUserByUsername(username: string) {
    return this.db.query.koreaderUsers.findFirst({
      where: eq(schema.koreaderUsers.username, username),
    });
  }

  async createKoreaderUser(data: { userId: number; username: string; passwordHash: string; passwordMd5: string }) {
    const [row] = await this.db.insert(schema.koreaderUsers).values(data).returning();
    return row!;
  }

  async updateKoreaderUser(userId: number, data: Partial<{ username: string; passwordHash: string; passwordMd5: string; syncEnabled: boolean }>) {
    await this.db.update(schema.koreaderUsers).set(data).where(eq(schema.koreaderUsers.userId, userId));
  }

  async deleteKoreaderUser(userId: number) {
    await this.db.delete(schema.koreaderUsers).where(eq(schema.koreaderUsers.userId, userId));
  }

  async resolveBookFileByHash(hash: string, accessibleLibraryIds: number[] | null): Promise<{ id: number; bookId: number } | null> {
    if (accessibleLibraryIds !== null && accessibleLibraryIds.length === 0) return null;

    const libraryFilter = accessibleLibraryIds ? inArray(schema.books.libraryId, accessibleLibraryIds) : undefined;

    const [byFileHash] = await this.db
      .select({ id: schema.bookFiles.id, bookId: schema.bookFiles.bookId })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.bookFiles.fileHash, hash), libraryFilter))
      .limit(1);

    if (byFileHash) return byFileHash;

    const [byFileHashHistory] = await this.db
      .select({ id: schema.bookFiles.id, bookId: schema.bookFiles.bookId })
      .from(schema.bookFileHashHistory)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.bookFileHashHistory.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.bookFileHashHistory.fileHash, hash), libraryFilter))
      .limit(1);

    if (byFileHashHistory) return byFileHashHistory;

    return null;
  }

  async getAccessibleLibraryIds(userId: number): Promise<number[] | null> {
    const user = await this.db.query.users.findFirst({
      where: eq(schema.users.id, userId),
      columns: { isSuperuser: true },
    });
    if (user?.isSuperuser) return null;

    const rows = await this.db
      .select({ libraryId: schema.userLibraryAccess.libraryId })
      .from(schema.userLibraryAccess)
      .where(eq(schema.userLibraryAccess.userId, userId));
    return rows.map((r) => r.libraryId);
  }

  async upsertDeviceProgress(data: {
    bookFileId: number;
    userId: number;
    device: string;
    deviceId: string;
    percentage: number;
    progress: string | null;
    chapterIndex: number | null;
    syncTimestamp: number | null;
  }) {
    await this.db
      .insert(schema.koreaderDeviceProgress)
      .values({
        bookFileId: data.bookFileId,
        userId: data.userId,
        device: data.device,
        deviceId: data.deviceId,
        percentage: data.percentage,
        progress: data.progress,
        chapterIndex: data.chapterIndex,
        syncTimestamp: data.syncTimestamp,
        orphaned: false,
        orphanedHash: null,
      })
      .onConflictDoUpdate({
        target: [
          schema.koreaderDeviceProgress.bookFileId,
          schema.koreaderDeviceProgress.userId,
          schema.koreaderDeviceProgress.device,
          schema.koreaderDeviceProgress.deviceId,
        ],
        targetWhere: eq(schema.koreaderDeviceProgress.orphaned, false),
        set: {
          percentage: data.percentage,
          progress: data.progress,
          chapterIndex: data.chapterIndex,
          syncTimestamp: data.syncTimestamp,
          updatedAt: new Date(),
        },
      });
  }

  async getLatestDeviceProgress(bookFileId: number, userId: number) {
    const [row] = await this.db
      .select()
      .from(schema.koreaderDeviceProgress)
      .where(
        and(
          eq(schema.koreaderDeviceProgress.bookFileId, bookFileId),
          eq(schema.koreaderDeviceProgress.userId, userId),
          eq(schema.koreaderDeviceProgress.orphaned, false),
        ),
      )
      .orderBy(desc(schema.koreaderDeviceProgress.updatedAt))
      .limit(1);
    return row ?? null;
  }

  async getReadingProgress(bookFileId: number, userId: number) {
    const [row] = await this.db
      .select()
      .from(schema.readingProgress)
      .where(and(eq(schema.readingProgress.bookFileId, bookFileId), eq(schema.readingProgress.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async upsertReadingProgress(bookFileId: number, userId: number, percentage: number) {
    await this.db
      .insert(schema.readingProgress)
      .values({ bookFileId, userId, percentage })
      .onConflictDoUpdate({
        target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
        // Deliberately do NOT update updatedAt here. reading_progress.updatedAt must only
        // change when the web reader writes it, so getProgress can use it as an accurate
        // "last web-reader sync time" for comparison against koreader_device_progress.updatedAt.
        // KOReader sends percentage + XPointer, while the web reader stores CFI. If we keep a
        // stale CFI from a previous web session, the web reader may resume at an older location
        // even when KOReader synced newer percentage. Clear incompatible web locator fields so
        // the reader resumes from percentage fallback.
        set: { percentage, cfi: null, pageNumber: null, updatedAt: sql`"reading_progress"."updated_at"` },
      });
  }

  async getAllDeviceProgress(bookFileId: number, userId: number) {
    return this.db
      .select()
      .from(schema.koreaderDeviceProgress)
      .where(
        and(
          eq(schema.koreaderDeviceProgress.bookFileId, bookFileId),
          eq(schema.koreaderDeviceProgress.userId, userId),
          eq(schema.koreaderDeviceProgress.orphaned, false),
        ),
      )
      .orderBy(desc(schema.koreaderDeviceProgress.updatedAt));
  }

  async getDevicesList(userId: number) {
    const result = await this.db.execute<{
      device: string;
      device_id: string;
      last_sync_at: Date;
      last_book_title: string | null;
    }>(sql`
      SELECT device, device_id, last_sync_at, last_book_title
      FROM (
        SELECT DISTINCT ON (d.device, d.device_id)
          d.device,
          d.device_id,
          d.updated_at AS last_sync_at,
          bm.title AS last_book_title
        FROM koreader_device_progress d
        LEFT JOIN book_files bf ON bf.id = d.book_file_id
        LEFT JOIN book_metadata bm ON bm.book_id = bf.book_id
        WHERE d.user_id = ${userId} AND d.orphaned = false
        ORDER BY d.device, d.device_id, d.updated_at DESC
      ) sub
      ORDER BY last_sync_at DESC
    `);

    return result.rows.map((r) => ({
      device: r.device,
      deviceId: r.device_id,
      lastSyncAt: new Date(r.last_sync_at),
      lastBookTitle: r.last_book_title ?? null,
    }));
  }

  async getTotalSyncedBooks(userId: number): Promise<number> {
    const [result] = await this.db
      .select({ count: sql<number>`count(distinct ${schema.books.id})` })
      .from(schema.koreaderDeviceProgress)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.koreaderDeviceProgress.bookFileId))
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.koreaderDeviceProgress.userId, userId), eq(schema.koreaderDeviceProgress.orphaned, false)));
    return Number(result?.count ?? 0);
  }

  async getChapters(bookFileId: number) {
    return this.db
      .select()
      .from(schema.bookFileChapters)
      .where(eq(schema.bookFileChapters.bookFileId, bookFileId))
      .orderBy(schema.bookFileChapters.chapterIndex);
  }

  async getLastFileWriteTime(bookFileId: number): Promise<Date | null> {
    const [row] = await this.db
      .select({ writtenAt: schema.fileWriteLog.writtenAt })
      .from(schema.fileWriteLog)
      .where(eq(schema.fileWriteLog.bookFileId, bookFileId))
      .orderBy(desc(schema.fileWriteLog.writtenAt))
      .limit(1);
    return row?.writtenAt ?? null;
  }

  async getBookProgressForDashboard(bookFileId: number, userId: number) {
    const deviceProgress = await this.getAllDeviceProgress(bookFileId, userId);
    const readingProg = await this.getReadingProgress(bookFileId, userId);
    return { deviceProgress, readingProgress: readingProg };
  }

  async findBookFileIdByBookId(bookId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ id: schema.bookFiles.id })
      .from(schema.bookFiles)
      .innerJoin(schema.books, eq(schema.books.id, schema.bookFiles.bookId))
      .where(and(eq(schema.books.id, bookId), eq(schema.books.primaryFileId, schema.bookFiles.id)))
      .limit(1);
    return row?.id ?? null;
  }

  async upsertKoreaderBookStats(data: {
    bookFileId: number;
    userId: number;
    totalReadSecs: number;
    totalReadPages: number;
    highlightsCount: number;
    notesCount: number;
    lastOpenAt: Date | null;
  }): Promise<void> {
    await this.db
      .insert(schema.koreaderBookStats)
      .values({
        bookFileId: data.bookFileId,
        userId: data.userId,
        totalReadSecs: data.totalReadSecs,
        totalReadPages: data.totalReadPages,
        highlightsCount: data.highlightsCount,
        notesCount: data.notesCount,
        lastOpenAt: data.lastOpenAt,
      })
      .onConflictDoUpdate({
        target: [schema.koreaderBookStats.userId, schema.koreaderBookStats.bookFileId],
        set: {
          totalReadSecs: sql`GREATEST(${schema.koreaderBookStats.totalReadSecs}, EXCLUDED.total_read_secs)`,
          totalReadPages: sql`GREATEST(${schema.koreaderBookStats.totalReadPages}, EXCLUDED.total_read_pages)`,
          highlightsCount: data.highlightsCount,
          notesCount: data.notesCount,
          lastOpenAt: sql`GREATEST(${schema.koreaderBookStats.lastOpenAt}, EXCLUDED.last_open_at)`,
          updatedAt: new Date(),
        },
      });
  }

  async bulkInsertKoreaderReadingSessions(
    sessions: Array<{
      bookFileId: number;
      userId: number;
      sessionHash: string;
      page: number;
      startedAt: Date;
      durationSeconds: number;
      totalPages: number;
    }>,
  ): Promise<void> {
    if (sessions.length === 0) return;
    await this.db.insert(schema.koreaderReadingSessions).values(sessions).onConflictDoNothing();
  }

  async getKoreaderBookStats(bookFileId: number, userId: number): Promise<typeof schema.koreaderBookStats.$inferSelect | null> {
    const [row] = await this.db
      .select()
      .from(schema.koreaderBookStats)
      .where(and(eq(schema.koreaderBookStats.bookFileId, bookFileId), eq(schema.koreaderBookStats.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  async getKoreaderReadingSessions(
    bookFileId: number,
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<{ rows: (typeof schema.koreaderReadingSessions.$inferSelect)[]; total: number }> {
    const offset = (page - 1) * pageSize;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.koreaderReadingSessions)
      .where(and(eq(schema.koreaderReadingSessions.bookFileId, bookFileId), eq(schema.koreaderReadingSessions.userId, userId)));

    const total = Number(countResult?.count ?? 0);

    const rows = await this.db
      .select()
      .from(schema.koreaderReadingSessions)
      .where(and(eq(schema.koreaderReadingSessions.bookFileId, bookFileId), eq(schema.koreaderReadingSessions.userId, userId)))
      .orderBy(desc(schema.koreaderReadingSessions.startedAt))
      .limit(pageSize)
      .offset(offset);

    return { rows, total };
  }

  async getKoreaderAggregateStats(userId: number): Promise<{ booksWithStats: number; totalReadingSeconds: number }> {
    const [result] = await this.db
      .select({
        booksWithStats: sql<number>`count(distinct ${schema.bookFiles.bookId})`,
        totalReadingSeconds: sql<number>`coalesce(sum(${schema.koreaderBookStats.totalReadSecs}), 0)`,
      })
      .from(schema.koreaderBookStats)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.koreaderBookStats.bookFileId))
      .where(eq(schema.koreaderBookStats.userId, userId));

    return {
      booksWithStats: Number(result?.booksWithStats ?? 0),
      totalReadingSeconds: Number(result?.totalReadingSeconds ?? 0),
    };
  }

  async hasKoreaderBookStats(bookFileId: number, userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ id: schema.koreaderBookStats.id })
      .from(schema.koreaderBookStats)
      .where(and(eq(schema.koreaderBookStats.bookFileId, bookFileId), eq(schema.koreaderBookStats.userId, userId)))
      .limit(1);
    return row != null;
  }

  async getKoreaderSessionsDailySummary(bookFileId: number, userId: number): Promise<{ day: string; durationSeconds: number }[]> {
    const result = await this.db.execute<{ day: string; duration_seconds: number }>(sql`
      SELECT
        to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        sum(duration_seconds)::integer AS duration_seconds
      FROM koreader_reading_sessions
      WHERE book_file_id = ${bookFileId} AND user_id = ${userId}
      GROUP BY date_trunc('day', started_at AT TIME ZONE 'UTC')
      ORDER BY day ASC
    `);
    return result.rows.map((r) => ({ day: r.day, durationSeconds: Number(r.duration_seconds) }));
  }

  async getKoreaderStatsActiveDates(userId: number): Promise<string[]> {
    const result = await this.db.execute<{ day: string }>(sql`
      SELECT DISTINCT to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day
      FROM koreader_reading_sessions
      WHERE user_id = ${userId} AND duration_seconds > 0
      ORDER BY day ASC
    `);
    return result.rows.map((r) => r.day);
  }

  async getKoreaderStatsTotals(userId: number): Promise<{
    totalSessions: number;
    totalDurationSecs: number;
    totalHighlights: number;
    totalNotes: number;
    booksWithStats: number;
  }> {
    const sessionsResult = await this.db.execute<{ total_sessions: number; total_duration_secs: number }>(sql`
      SELECT count(*)::integer AS total_sessions,
             coalesce(sum(duration_seconds), 0)::integer AS total_duration_secs
      FROM koreader_reading_sessions
      WHERE user_id = ${userId} AND duration_seconds > 0
    `);
    const bookStatsResult = await this.db.execute<{ total_highlights: number; total_notes: number; books_with_stats: number }>(sql`
      SELECT coalesce(sum(highlights_count), 0)::integer AS total_highlights,
             coalesce(sum(notes_count), 0)::integer AS total_notes,
             count(distinct ${schema.bookFiles.bookId})::integer AS books_with_stats
      FROM koreader_book_stats
      INNER JOIN book_files ON book_files.id = koreader_book_stats.book_file_id
      WHERE koreader_book_stats.user_id = ${userId}
    `);
    const sessions = sessionsResult.rows[0];
    const bookStats = bookStatsResult.rows[0];
    return {
      totalSessions: Number(sessions?.total_sessions ?? 0),
      totalDurationSecs: Number(sessions?.total_duration_secs ?? 0),
      totalHighlights: Number(bookStats?.total_highlights ?? 0),
      totalNotes: Number(bookStats?.total_notes ?? 0),
      booksWithStats: Number(bookStats?.books_with_stats ?? 0),
    };
  }

  async getKoreaderActivityHeatmap(userId: number): Promise<{ date: string; durationSeconds: number }[]> {
    const result = await this.db.execute<{ date: string; duration_seconds: number }>(sql`
      SELECT
        to_char(date_trunc('day', started_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
        sum(duration_seconds)::integer AS duration_seconds
      FROM koreader_reading_sessions
      WHERE user_id = ${userId} AND duration_seconds > 0
      GROUP BY date_trunc('day', started_at AT TIME ZONE 'UTC')
      ORDER BY date ASC
    `);
    return result.rows.map((r) => ({ date: r.date, durationSeconds: Number(r.duration_seconds) }));
  }

  async getKoreaderMonthlyReading(userId: number): Promise<{ year: number; month: number; durationSeconds: number }[]> {
    const result = await this.db.execute<{ year: number; month: number; duration_seconds: number }>(sql`
      WITH months AS (
        SELECT
          EXTRACT(YEAR FROM m)::integer AS year,
          EXTRACT(MONTH FROM m)::integer AS month
        FROM generate_series(
          date_trunc('month', (now() AT TIME ZONE 'UTC') - interval '23 months'),
          date_trunc('month', now() AT TIME ZONE 'UTC'),
          interval '1 month'
        ) AS m
      ),
      session_sums AS (
        SELECT
          EXTRACT(YEAR FROM started_at AT TIME ZONE 'UTC')::integer AS year,
          EXTRACT(MONTH FROM started_at AT TIME ZONE 'UTC')::integer AS month,
          sum(duration_seconds)::integer AS duration_seconds
        FROM koreader_reading_sessions
        WHERE user_id = ${userId} AND duration_seconds > 0
        GROUP BY 1, 2
      )
      SELECT m.year, m.month, coalesce(s.duration_seconds, 0) AS duration_seconds
      FROM months m
      LEFT JOIN session_sums s USING (year, month)
      ORDER BY m.year, m.month
    `);
    return result.rows.map((r) => ({ year: Number(r.year), month: Number(r.month), durationSeconds: Number(r.duration_seconds) }));
  }

  async getKoreaderTimeOfDay(userId: number): Promise<{ hour: number; durationSeconds: number }[]> {
    const result = await this.db.execute<{ hour: number; duration_seconds: number }>(sql`
      WITH hours AS (
        SELECT generate_series(0, 23) AS hour
      ),
      session_sums AS (
        SELECT
          EXTRACT(HOUR FROM started_at AT TIME ZONE 'UTC')::integer AS hour,
          sum(duration_seconds)::integer AS duration_seconds
        FROM koreader_reading_sessions
        WHERE user_id = ${userId} AND duration_seconds > 0
        GROUP BY 1
      )
      SELECT h.hour, coalesce(s.duration_seconds, 0) AS duration_seconds
      FROM hours h
      LEFT JOIN session_sums s USING (hour)
      ORDER BY h.hour
    `);
    return result.rows.map((r) => ({ hour: Number(r.hour), durationSeconds: Number(r.duration_seconds) }));
  }

  async getKoreaderSessionLengths(userId: number): Promise<{ label: string; minSecs: number; maxSecs: number | null; count: number }[]> {
    const result = await this.db.execute<{ label: string; min_secs: number; max_secs: number | null; count: number }>(sql`
      WITH bins(label, min_secs, max_secs) AS (VALUES
        ('0-5m',  0,    300),
        ('5-10m', 300,  600),
        ('10-20m',600,  1200),
        ('20-30m',1200, 1800),
        ('30-60m',1800, 3600),
        ('1-2h',  3600, 7200),
        ('2h+',   7200, null)
      ),
      session_counts AS (
        SELECT
          b.label,
          b.min_secs,
          b.max_secs,
          count(s.id)::integer AS count
        FROM bins b
        LEFT JOIN koreader_reading_sessions s
          ON s.user_id = ${userId}
          AND s.duration_seconds > 0
          AND s.duration_seconds >= b.min_secs
          AND (b.max_secs IS NULL OR s.duration_seconds < b.max_secs)
        GROUP BY b.label, b.min_secs, b.max_secs
      )
      SELECT label, min_secs, max_secs, count
      FROM session_counts
      ORDER BY min_secs
    `);
    return result.rows.map((r) => ({
      label: r.label,
      minSecs: Number(r.min_secs),
      maxSecs: r.max_secs != null ? Number(r.max_secs) : null,
      count: Number(r.count),
    }));
  }

  async getKoreaderTopBooks(userId: number, limit = 20): Promise<{ bookId: number; title: string; totalReadSecs: number }[]> {
    const result = await this.db.execute<{ book_id: number; title: string; total_read_secs: number }>(sql`
      SELECT
        b.id AS book_id,
        coalesce(b.title, 'Unknown Book') AS title,
        sum(ks.total_read_secs)::integer AS total_read_secs
      FROM koreader_book_stats ks
      INNER JOIN book_files bf ON bf.id = ks.book_file_id
      INNER JOIN books b ON b.id = bf.book_id
      WHERE ks.user_id = ${userId} AND ks.total_read_secs > 0
      GROUP BY b.id, b.title
      ORDER BY total_read_secs DESC
      LIMIT ${limit}
    `);
    return result.rows.map((r) => ({ bookId: Number(r.book_id), title: r.title, totalReadSecs: Number(r.total_read_secs) }));
  }

  async getKoreaderTopAnnotated(
    userId: number,
    limit = 20,
  ): Promise<{ bookId: number; title: string; highlightsCount: number; notesCount: number }[]> {
    const result = await this.db.execute<{ book_id: number; title: string; highlights_count: number; notes_count: number }>(sql`
      SELECT
        b.id AS book_id,
        coalesce(b.title, 'Unknown Book') AS title,
        sum(ks.highlights_count)::integer AS highlights_count,
        sum(ks.notes_count)::integer AS notes_count
      FROM koreader_book_stats ks
      INNER JOIN book_files bf ON bf.id = ks.book_file_id
      INNER JOIN books b ON b.id = bf.book_id
      WHERE ks.user_id = ${userId}
        AND (ks.highlights_count > 0 OR ks.notes_count > 0)
      GROUP BY b.id, b.title
      HAVING sum(ks.highlights_count) + sum(ks.notes_count) > 0
      ORDER BY sum(ks.highlights_count) + sum(ks.notes_count) DESC
      LIMIT ${limit}
    `);
    return result.rows.map((r) => ({
      bookId: Number(r.book_id),
      title: r.title,
      highlightsCount: Number(r.highlights_count),
      notesCount: Number(r.notes_count),
    }));
  }

  async getKoreaderWeeklyRhythm(userId: number): Promise<{ dow: number; durationSeconds: number }[]> {
    const result = await this.db.execute<{ dow: number; duration_seconds: number }>(sql`
      WITH days AS (
        SELECT generate_series(1, 7) AS dow
      ),
      session_sums AS (
        SELECT
          EXTRACT(ISODOW FROM started_at AT TIME ZONE 'UTC')::integer AS dow,
          sum(duration_seconds)::integer AS duration_seconds
        FROM koreader_reading_sessions
        WHERE user_id = ${userId} AND duration_seconds > 0
        GROUP BY 1
      )
      SELECT d.dow, coalesce(s.duration_seconds, 0) AS duration_seconds
      FROM days d
      LEFT JOIN session_sums s USING (dow)
      ORDER BY d.dow
    `);
    return result.rows.map((r) => ({ dow: Number(r.dow), durationSeconds: Number(r.duration_seconds) }));
  }

  async getKoreaderDevices(userId: number): Promise<{ device: string; booksTracked: number }[]> {
    const result = await this.db.execute<{ device: string; books_tracked: number }>(sql`
      SELECT
        coalesce(device, 'Unknown Device') AS device,
        count(distinct book_file_id)::integer AS books_tracked
      FROM koreader_device_progress
      WHERE user_id = ${userId} AND orphaned = false AND book_file_id IS NOT NULL
      GROUP BY coalesce(device, 'Unknown Device')
      ORDER BY books_tracked DESC
    `);
    return result.rows.map((r) => ({ device: r.device, booksTracked: Number(r.books_tracked) }));
  }
}
