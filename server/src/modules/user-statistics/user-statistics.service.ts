import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  ChordDiagramData,
  UserCompletionLatencyDistribution,
  UserCompletionRaceBook,
  UserCompletionTimelinePoint,
  UserDailyReadingStat,
  UserFavoriteDayStat,
  UserGenreReadingTimeItem,
  UserGoalTrajectory,
  UserGoalTrajectoryPoint,
  UserPeakHourStat,
  UserProgressFunnelComparison,
  UserProgressFunnel,
  UserReadingPacePoint,
  UserReadingSessionTimeline,
  UserReadingSessionTimelineItem,
  UserReadingSurvivalPoint,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
} from '@projectx/types';

import type { RequestUser } from '../../common/types/request-user';
import type { UserDailyReadingQueryDto } from './dto/user-daily-reading-query.dto';
import type { UserGoalTrajectoryQueryDto } from './dto/user-goal-trajectory-query.dto';
import type { UserSessionTimelineQueryDto } from './dto/user-session-timeline-query.dto';
import type { UpdateUserSessionTimelineSessionDto } from './dto/update-user-session-timeline-session.dto';
import type { UserStatisticsFilterQueryDto } from './dto/user-statistics-filter-query.dto';
import { UserStatisticsRepository } from './user-statistics.repository';

const HEATMAP_DEFAULT_DAYS = 365;
const BEHAVIOR_DEFAULT_DAYS = 365;
const COMPLETION_TIMELINE_DEFAULT_DAYS = 1825;
const GOAL_TRAJECTORY_DEFAULT_DAYS = 365;
const GOAL_TRAJECTORY_DEFAULT_GOAL_BOOKS = 12;
const PROGRESS_FUNNEL_DEFAULT_DAYS = 365;
const SESSION_TIMELINE_MAX_SESSIONS = 3000;
const COMPLETION_LATENCY_DEFAULT_DAYS = 1825;
const GENRE_READING_TIME_DEFAULT_DAYS = 365;
const READING_PACE_DEFAULT_DAYS = 1825;
const READING_SURVIVAL_DEFAULT_DAYS = 1825;
const COMPLETION_RACE_DEFAULT_DAYS = 1825;
const SESSION_ARCHETYPES_DEFAULT_DAYS = 365;
const SUMMARY_CACHE_TTL_MS = 30_000;
const QUERY_CACHE_TTL_MS = 120_000;
const QUERY_CACHE_MAX_ENTRIES = 2_000;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class UserStatisticsService {
  constructor(private readonly repo: UserStatisticsRepository) {}
  private readonly queryCache = new Map<string, CacheEntry<unknown>>();

  private startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private startOfUtcMonth(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  private startOfUtcIsoWeek(date: Date): Date {
    const start = this.startOfUtcDay(date);
    const day = (start.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    start.setUTCDate(start.getUTCDate() - day);
    return start;
  }

  private getUtcIsoWeekYear(date: Date): number {
    const d = this.startOfUtcDay(date);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3); // Thursday
    return d.getUTCFullYear();
  }

  private getUtcIsoWeek(date: Date): number {
    const d = this.startOfUtcDay(date);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3); // Thursday
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDay = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
    return 1 + Math.round((d.getTime() - firstThursday.getTime()) / 604_800_000);
  }

  private getUtcIsoWeeksInYear(year: number): number {
    return this.getUtcIsoWeek(new Date(Date.UTC(year, 11, 28)));
  }

  private getUtcIsoWeekStart(year: number, week: number): Date {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const week1Start = this.startOfUtcIsoWeek(jan4);
    const weekStart = new Date(week1Start);
    weekStart.setUTCDate(week1Start.getUTCDate() + (week - 1) * 7);
    return weekStart;
  }

  private sinceDateForDays(days: number): Date {
    const normalized = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
    const startToday = this.startOfUtcDay(new Date());
    startToday.setUTCDate(startToday.getUTCDate() - (normalized - 1));
    return startToday;
  }

  private formatDayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private roundProgressDelta(value: number): number {
    return Number(value.toFixed(4));
  }

  private percentile(sorted: number[], p: number): number | null {
    if (sorted.length === 0) return null;
    if (sorted.length === 1) return Number(sorted[0].toFixed(1));
    const rank = (p / 100) * (sorted.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    const weight = rank - low;
    const value = sorted[low] * (1 - weight) + sorted[high] * weight;
    return Number(value.toFixed(1));
  }

  private normalizeLibraryIds(libraryIds?: number[]): string {
    return [...(libraryIds ?? [])].sort((a, b) => a - b).join(',');
  }

  private cacheKey(metric: string, user: RequestUser, params: Record<string, string | number | undefined>): string {
    const pieces = Object.entries(params)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);
    return `${metric}|u=${user.id}|su=${user.isSuperuser ? 1 : 0}|${pieces.join('|')}`;
  }

  private pruneCacheIfNeeded() {
    const now = Date.now();
    for (const [key, entry] of this.queryCache.entries()) {
      if (entry.expiresAt <= now) this.queryCache.delete(key);
    }
    if (this.queryCache.size < QUERY_CACHE_MAX_ENTRIES) return;
    const overflow = this.queryCache.size - QUERY_CACHE_MAX_ENTRIES + 1;
    const oldest = [...this.queryCache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt).slice(0, overflow);
    for (const [key] of oldest) this.queryCache.delete(key);
  }

  private async withCache<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const cached = this.queryCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value as T;

    const value = await loader();
    this.queryCache.set(key, { value, expiresAt: now + ttlMs });
    this.pruneCacheIfNeeded();
    return value;
  }

  async getSummary(user: RequestUser, query: UserStatisticsFilterQueryDto): Promise<UserStatisticsSummary> {
    const key = this.cacheKey('summary', user, { libraries: this.normalizeLibraryIds(query.libraryIds) });
    return this.withCache(key, SUMMARY_CACHE_TTL_MS, async () => {
      const summary = await this.repo.getSummary(user.id, user.isSuperuser, query.libraryIds);
      return {
        ...summary,
        meanProgressPercent: Number(summary.meanProgressPercent.toFixed(2)),
      };
    });
  }

  async getDailyReading(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserDailyReadingStat[]> {
    const days = query.days ?? 365;
    const key = this.cacheKey('daily-reading', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const items = await this.repo.getDailyReadingStats(user.id, user.isSuperuser, query.libraryIds, days);
      return items.map((item) => ({
        ...item,
        progressDelta: this.roundProgressDelta(item.progressDelta),
      }));
    });
  }

  async getReadingHeatmap(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserDailyReadingStat[]> {
    const days = query.days ?? HEATMAP_DEFAULT_DAYS;
    const key = this.cacheKey('reading-heatmap', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const items = await this.repo.getDailyReadingStats(user.id, user.isSuperuser, query.libraryIds, days);
      const byDay = new Map(items.map((item) => [item.day, item]));
      const start = this.sinceDateForDays(days);
      const end = this.startOfUtcDay(new Date());
      const result: UserDailyReadingStat[] = [];

      for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        const day = this.formatDayKey(cursor);
        const value = byDay.get(day);
        result.push({
          day,
          readingSeconds: value?.readingSeconds ?? 0,
          progressDelta: this.roundProgressDelta(value?.progressDelta ?? 0),
          eventsCount: value?.eventsCount ?? 0,
        });
      }

      return result;
    });
  }

  async getPeakReadingHours(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserPeakHourStat[]> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const key = this.cacheKey('peak-hours', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const rows = await this.repo.getPeakReadingHours(user.id, user.isSuperuser, query.libraryIds, days);

      const byHour = new Map<number, { readingSeconds: number; eventsCount: number; byFormat: Record<string, number> }>();
      for (const row of rows) {
        if (!byHour.has(row.hour)) {
          byHour.set(row.hour, { readingSeconds: 0, eventsCount: 0, byFormat: {} });
        }
        const entry = byHour.get(row.hour)!;
        entry.readingSeconds += row.readingSeconds;
        entry.eventsCount += row.eventsCount;
        entry.byFormat[row.format] = row.readingSeconds;
      }

      return Array.from({ length: 24 }, (_, hour) => {
        const entry = byHour.get(hour);
        return {
          hour,
          readingSeconds: entry?.readingSeconds ?? 0,
          eventsCount: entry?.eventsCount ?? 0,
          byFormat: entry?.byFormat ?? {},
        };
      });
    });
  }

  async getFavoriteReadingDays(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserFavoriteDayStat[]> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const key = this.cacheKey('favorite-days', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const rows = await this.repo.getFavoriteReadingDays(user.id, user.isSuperuser, query.libraryIds, days);
      const byDay = new Map(rows.map((row) => [row.dayOfWeek, row]));

      return Array.from({ length: 7 }, (_, dayOfWeek) => {
        const row = byDay.get(dayOfWeek);
        return {
          dayOfWeek,
          readingSeconds: row?.readingSeconds ?? 0,
          eventsCount: row?.eventsCount ?? 0,
        };
      });
    });
  }

  private toTimelineItem(row: {
    sessionId: number;
    bookId: number;
    bookTitle: string | null;
    bookFormat: string | null;
    startedAt: Date;
    endedAt: Date;
    durationSeconds: number;
  }): UserReadingSessionTimelineItem {
    return {
      sessionId: row.sessionId,
      bookId: row.bookId,
      bookTitle: row.bookTitle,
      bookFormat: row.bookFormat,
      startedAt: row.startedAt.toISOString(),
      endedAt: row.endedAt.toISOString(),
      durationSeconds: row.durationSeconds,
    };
  }

  async getSessionTimeline(user: RequestUser, query: UserSessionTimelineQueryDto): Promise<UserReadingSessionTimeline> {
    const now = new Date();
    const defaultYear = this.getUtcIsoWeekYear(now);
    const defaultWeek = this.getUtcIsoWeek(now);
    const year = query.year ?? defaultYear;
    const weeksInYear = this.getUtcIsoWeeksInYear(year);
    const week = Math.min(Math.max(query.week ?? defaultWeek, 1), weeksInYear);
    const weekStart = this.getUtcIsoWeekStart(year, week);
    const weekEndExclusive = new Date(weekStart);
    weekEndExclusive.setUTCDate(weekEndExclusive.getUTCDate() + 7);

    const key = this.cacheKey('session-timeline', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      year,
      week,
    });

    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const rows = await this.repo.getSessionTimelineItems(
        user.id,
        user.isSuperuser,
        query.libraryIds,
        weekStart,
        weekEndExclusive,
        SESSION_TIMELINE_MAX_SESSIONS,
      );
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);

      return {
        year,
        week,
        weekStart: this.formatDayKey(weekStart),
        weekEnd: this.formatDayKey(weekEnd),
        items: rows.map((row) => this.toTimelineItem(row)),
      };
    });
  }

  async updateSessionTimelineSession(
    user: RequestUser,
    sessionId: number,
    dto: UpdateUserSessionTimelineSessionDto,
    query: UserStatisticsFilterQueryDto,
  ): Promise<UserReadingSessionTimelineItem> {
    const startedAt = new Date(dto.startedAt);
    const endedAt = new Date(dto.endedAt);
    if (!Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime())) {
      throw new BadRequestException('Invalid session timestamps');
    }
    if (endedAt <= startedAt) {
      throw new BadRequestException('Session end time must be after start time');
    }

    const existing = await this.repo.getSessionTimelineSessionById(user.id, user.isSuperuser, query.libraryIds, sessionId);
    if (!existing) {
      throw new NotFoundException('Reading session not found');
    }

    const proposedDuration = Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
    if (proposedDuration !== existing.durationSeconds) {
      throw new BadRequestException('Dragging can move a session only; duration cannot change');
    }

    const moveResult = await this.repo.moveSessionTimelineSessionAtomic(
      user.id,
      sessionId,
      existing.libraryId,
      existing.startedAt,
      startedAt,
      endedAt,
      proposedDuration,
    );
    if (moveResult.conflict) {
      const conflictStart = moveResult.conflict.startedAt.toISOString();
      throw new ConflictException(`Session overlaps with #${moveResult.conflict.sessionId} starting at ${conflictStart}`);
    }
    if (!moveResult.updated) {
      throw new NotFoundException('Reading session not found');
    }

    this.queryCache.clear();

    return this.toTimelineItem(moveResult.updated);
  }

  async getCompletionTimeline(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserCompletionTimelinePoint[]> {
    const days = query.days ?? COMPLETION_TIMELINE_DEFAULT_DAYS;
    const key = this.cacheKey('completion-timeline', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const rows = await this.repo.getCompletionTimeline(user.id, user.isSuperuser, query.libraryIds, days);
      const byMonth = new Map(rows.map((row) => [`${row.year}-${row.month}`, row.count]));
      const start = this.startOfUtcMonth(this.sinceDateForDays(days));
      const end = this.startOfUtcMonth(new Date());
      const result: UserCompletionTimelinePoint[] = [];

      for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth() + 1;
        result.push({
          year,
          month,
          count: byMonth.get(`${year}-${month}`) ?? 0,
        });
      }

      return result;
    });
  }

  async getGoalTrajectory(user: RequestUser, query: UserGoalTrajectoryQueryDto): Promise<UserGoalTrajectory> {
    const days = query.days ?? GOAL_TRAJECTORY_DEFAULT_DAYS;
    const goalBooks = query.goalBooks ?? GOAL_TRAJECTORY_DEFAULT_GOAL_BOOKS;
    const key = this.cacheKey('goal-trajectory', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      days,
      goalBooks,
    });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const rows = await this.repo.getMonthlyCompletions(user.id, user.isSuperuser, query.libraryIds, days);
      const byMonth = new Map(rows.map((row) => [`${row.year}-${row.month}`, row.count]));
      const start = this.startOfUtcMonth(this.sinceDateForDays(days));
      const end = this.startOfUtcMonth(new Date());
      const points: UserGoalTrajectoryPoint[] = [];
      const targetPerMonth = goalBooks / 12;
      let actualCumulative = 0;
      let monthIndex = 0;

      for (const cursor = new Date(start); cursor <= end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
        monthIndex += 1;
        const year = cursor.getUTCFullYear();
        const month = cursor.getUTCMonth() + 1;
        const monthActual = byMonth.get(`${year}-${month}`) ?? 0;
        actualCumulative += monthActual;

        points.push({
          year,
          month,
          actualCumulative,
          targetCumulative: Number((targetPerMonth * monthIndex).toFixed(2)),
        });
      }

      return { goalBooks, points };
    });
  }

  async getProgressFunnel(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserProgressFunnelComparison> {
    const days = query.days ?? PROGRESS_FUNNEL_DEFAULT_DAYS;
    const comparePrevious = query.comparePrevious ?? false;
    const key = this.cacheKey('progress-funnel', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      days,
      comparePrevious: comparePrevious ? 1 : 0,
    });

    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const currentSince = this.sinceDateForDays(days);
      const currentUntilExclusive = new Date(this.startOfUtcDay(new Date()));
      currentUntilExclusive.setUTCDate(currentUntilExclusive.getUTCDate() + 1);

      const current = await this.repo.getProgressFunnelInRange(user.id, user.isSuperuser, query.libraryIds, currentSince, currentUntilExclusive);

      let previous: UserProgressFunnel | null = null;
      if (comparePrevious) {
        const previousSince = new Date(currentSince);
        previousSince.setUTCDate(previousSince.getUTCDate() - days);
        previous = await this.repo.getProgressFunnelInRange(user.id, user.isSuperuser, query.libraryIds, previousSince, currentSince);
      }

      return {
        days,
        current,
        previous,
      };
    });
  }

  async getCompletionLatency(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserCompletionLatencyDistribution> {
    const days = query.days ?? COMPLETION_LATENCY_DEFAULT_DAYS;
    const key = this.cacheKey('completion-latency', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const values = await this.repo.getCompletionLatencyDays(user.id, user.isSuperuser, query.libraryIds, days);
      const sorted = [...values].sort((a, b) => a - b);

      const buckets = [
        { label: '0-7d', minDays: 0, maxDays: 7, count: 0 },
        { label: '8-30d', minDays: 8, maxDays: 30, count: 0 },
        { label: '31-90d', minDays: 31, maxDays: 90, count: 0 },
        { label: '91-180d', minDays: 91, maxDays: 180, count: 0 },
        { label: '181-365d', minDays: 181, maxDays: 365, count: 0 },
        { label: '366d+', minDays: 366, maxDays: null, count: 0 },
      ];

      for (const value of sorted) {
        const rounded = Math.round(value);
        const target =
          buckets.find((bucket) => rounded >= bucket.minDays && (bucket.maxDays === null || rounded <= bucket.maxDays)) ??
          buckets[buckets.length - 1];
        target.count += 1;
      }

      return {
        totalCompletions: sorted.length,
        medianDays: this.percentile(sorted, 50),
        percentile75Days: this.percentile(sorted, 75),
        percentile90Days: this.percentile(sorted, 90),
        buckets,
      };
    });
  }

  async getReadingSurvival(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserReadingSurvivalPoint[]> {
    const days = query.days ?? READING_SURVIVAL_DEFAULT_DAYS;
    const key = this.cacheKey('reading-survival', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const values = await this.repo.getReadingSurvivalMaxProgress(user.id, user.isSuperuser, query.libraryIds, days);
      const total = values.length;
      const thresholds = Array.from({ length: 21 }, (_, i) => i * 5);
      return thresholds.map((threshold) => {
        const survivedCount = values.filter((v) => v >= threshold).length;
        return {
          threshold,
          survivedCount,
          survivedPct: total > 0 ? Number(((survivedCount / total) * 100).toFixed(1)) : 0,
        };
      });
    });
  }

  async getCompletionRace(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserCompletionRaceBook[]> {
    const days = query.days ?? COMPLETION_RACE_DEFAULT_DAYS;
    const key = this.cacheKey('completion-race', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, async () => {
      const rows = await this.repo.getCompletionRaceRawSessions(user.id, user.isSuperuser, query.libraryIds, days);
      const byBook = new Map<number, { title: string; sessions: { startedAt: Date; endProgress: number }[] }>();

      for (const row of rows) {
        if (!byBook.has(row.bookId)) {
          byBook.set(row.bookId, { title: row.title ?? `Book ${row.bookId}`, sessions: [] });
        }
        byBook.get(row.bookId)!.sessions.push({ startedAt: row.startedAt, endProgress: row.endProgress });
      }

      const result: UserCompletionRaceBook[] = [];
      for (const [bookId, { title, sessions }] of byBook.entries()) {
        if (sessions.length < 2) continue;
        const firstMs = sessions[0].startedAt.getTime();
        result.push({
          bookId,
          title: title.length > 40 ? `${title.slice(0, 37)}...` : title,
          points: sessions.map((s) => ({
            daysSinceStart: Number(((s.startedAt.getTime() - firstMs) / 86_400_000).toFixed(2)),
            progress: Number(s.endProgress.toFixed(1)),
          })),
        });
      }

      return result;
    });
  }

  async getSessionArchetypes(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserSessionArchetypePoint[]> {
    const days = query.days ?? SESSION_ARCHETYPES_DEFAULT_DAYS;
    const key = this.cacheKey('session-archetypes', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, () => this.repo.getSessionArchetypePoints(user.id, user.isSuperuser, query.libraryIds, days));
  }

  async getGenreReadingTime(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserGenreReadingTimeItem[]> {
    const days = query.days ?? GENRE_READING_TIME_DEFAULT_DAYS;
    const key = this.cacheKey('genre-reading-time', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, () => this.repo.getGenreReadingTime(user.id, user.isSuperuser, query.libraryIds, days));
  }

  async getReadingPace(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserReadingPacePoint[]> {
    const days = query.days ?? READING_PACE_DEFAULT_DAYS;
    const key = this.cacheKey('reading-pace', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, () => this.repo.getReadingPacePoints(user.id, user.isSuperuser, query.libraryIds, days));
  }

  async getAuthorGenreChord(user: RequestUser, query: UserDailyReadingQueryDto): Promise<ChordDiagramData> {
    const days = query.days ?? 1825;
    const key = this.cacheKey('author-genre-chord', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.withCache(key, QUERY_CACHE_TTL_MS, () => this.repo.getAuthorGenreChord(user.id, user.isSuperuser, query.libraryIds, days));
  }

  async recomputeRecentDailyStats(days = 2) {
    const result = await this.repo.recomputeRecentDailyStats(days);
    this.queryCache.clear();
    return result;
  }
}
