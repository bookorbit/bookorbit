import { Injectable } from '@nestjs/common';

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
  UserReadingSurvivalPoint,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
} from '@projectx/types';

import type { RequestUser } from '../../common/types/request-user';
import type { UserDailyReadingQueryDto } from './dto/user-daily-reading-query.dto';
import type { UserGoalTrajectoryQueryDto } from './dto/user-goal-trajectory-query.dto';
import type { UserStatisticsFilterQueryDto } from './dto/user-statistics-filter-query.dto';
import { UserStatisticsRepository } from './user-statistics.repository';

const HEATMAP_DEFAULT_DAYS = 365;
const BEHAVIOR_DEFAULT_DAYS = 365;
const COMPLETION_TIMELINE_DEFAULT_DAYS = 1825;
const GOAL_TRAJECTORY_DEFAULT_DAYS = 365;
const GOAL_TRAJECTORY_DEFAULT_GOAL_BOOKS = 12;
const PROGRESS_FUNNEL_DEFAULT_DAYS = 365;
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
      const byHour = new Map(rows.map((row) => [row.hour, row]));

      return Array.from({ length: 24 }, (_, hour) => {
        const row = byHour.get(hour);
        return {
          hour,
          readingSeconds: row?.readingSeconds ?? 0,
          eventsCount: row?.eventsCount ?? 0,
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
