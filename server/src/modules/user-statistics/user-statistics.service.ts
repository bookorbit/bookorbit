import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type {
  ActivityCalendarResponse,
  ActivityCompletionSpeedBucket,
  ActivityCompletionSpeedResponse,
  ActivityDayDetailResponse,
  ActivityDayPoint,
  ActivityDurationBreakdown,
  ActivityGenreTimeResponse,
  ActivityGoalStatus,
  ActivityMediaBucket,
  ActivityOverviewResponse,
  ActivityPaceDetailResponse,
  ActivityPaceDurationBand,
  ActivitySessionDurationBucket,
  ActivitySessionPatternsResponse,
  ChordDiagramData,
  ReadingSessionSource,
  ReadingSessionSourceBucket,
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
  UserReadingSourceDistribution,
  UserReadingSurvivalPoint,
  UserSessionArchetypePoint,
  UserStatisticsSummary,
} from '@bookorbit/types';
import { ACTIVITY_MEDIA_BUCKETS, READING_SESSION_SOURCE_BUCKETS, emptySourceBucketRecord, toReadingSessionSourceBucket } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { StatsCache } from '../../common/cache/stats-cache';
import { addDateKeyDays, getDayRangeForDateKeys, splitReadingSessionByDay } from '../../common/utils/reading-daily-stats.utils';
import { isDateKey, resolveTimeZone, toDateKeyInTimeZone } from '../../common/utils/timezone.utils';
import type { ActivityCalendarQueryDto } from './dto/activity-calendar-query.dto';
import type { ActivityCompletionSpeedQueryDto } from './dto/activity-completion-speed-query.dto';
import type { ActivityDayQueryDto } from './dto/activity-day-query.dto';
import type { ActivityPaceQueryDto } from './dto/activity-pace-query.dto';
import type { UserDailyReadingQueryDto } from './dto/user-daily-reading-query.dto';
import type { UserGoalTrajectoryQueryDto } from './dto/user-goal-trajectory-query.dto';
import type { UserSessionTimelineQueryDto } from './dto/user-session-timeline-query.dto';
import type { UpdateUserSessionTimelineSessionDto } from './dto/update-user-session-timeline-session.dto';
import type { UserStatisticsFilterQueryDto } from './dto/user-statistics-filter-query.dto';
import { UserStatisticsRepository, type ActivitySessionRow } from './user-statistics.repository';

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
const USER_STATS_CACHE_TTL_MS = 300_000;
const USER_STATS_CACHE_MAX_ENTRIES = 2_000;
const ACTIVITY_OVERVIEW_DAYS = 365;
const ACTIVITY_DAILY_DAYS = 84;
const ACTIVITY_SESSION_BATCH_SIZE = 2_000;
const ACTIVITY_DETAILS_WINDOW_DAYS = 365;
const ACTIVITY_DETAILS_LONG_WINDOW_DAYS = 1825;

@Injectable()
export class UserStatisticsService {
  private readonly cache = new StatsCache({ ttlMs: USER_STATS_CACHE_TTL_MS, maxEntries: USER_STATS_CACHE_MAX_ENTRIES });

  constructor(private readonly repo: UserStatisticsRepository) {}

  invalidateUser(userId: number): void {
    this.cache.clearForScope(String(userId));
  }

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

  private buildUserCacheKey(metric: string, user: RequestUser, params: Record<string, string | number | undefined>): string {
    const pieces = Object.entries(params)
      .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`);
    return `${metric}|su=${user.isSuperuser ? 1 : 0}|${pieces.join('|')}`;
  }

  private emptyDuration(): ActivityDurationBreakdown {
    return { totalSeconds: 0, readingSeconds: 0, listeningSeconds: 0 };
  }

  private emptyActivityDay(day: string): ActivityDayPoint {
    return { day, ...this.emptyDuration(), sessionsCount: 0, bySource: emptySourceBucketRecord() };
  }

  private mediaBucket(sessionType: string): ActivityMediaBucket {
    return sessionType === 'tts' || sessionType === 'listen' ? 'listening' : 'reading';
  }

  private addDuration(target: ActivityDurationBreakdown, seconds: number, bucket: ActivityMediaBucket): void {
    target.totalSeconds += seconds;
    if (bucket === 'listening') target.listeningSeconds += seconds;
    else target.readingSeconds += seconds;
  }

  private sumDays(days: ActivityDayPoint[]): ActivityDurationBreakdown {
    return days.reduce<ActivityDurationBreakdown>((total, day) => {
      total.totalSeconds += day.totalSeconds;
      total.readingSeconds += day.readingSeconds;
      total.listeningSeconds += day.listeningSeconds;
      return total;
    }, this.emptyDuration());
  }

  private dateKeys(start: string, endInclusive: string): string[] {
    const keys: string[] = [];
    for (let day = start; day <= endInclusive; day = addDateKeyDays(day, 1)) keys.push(day);
    return keys;
  }

  private weekStart(day: string): string {
    const date = new Date(`${day}T00:00:00Z`);
    const offset = (date.getUTCDay() + 6) % 7;
    return addDateKeyDays(day, -offset);
  }

  private dateKeyDifference(start: string, end: string): number {
    return Math.max(0, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000));
  }

  private localHour(date: Date, timeZone: string): number {
    const value = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    const hour = Number(value);
    return Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 0;
  }

  private async forEachActivitySession(
    userId: number,
    libraryIds: number[] | null,
    start: Date,
    end: Date,
    consume: (row: ActivitySessionRow) => void,
  ): Promise<void> {
    let afterId = 0;
    while (true) {
      const rows = await this.repo.getActivitySessionPage(userId, libraryIds, start, end, afterId, ACTIVITY_SESSION_BATCH_SIZE);
      for (const row of rows) consume(row);
      if (rows.length < ACTIVITY_SESSION_BATCH_SIZE) return;
      afterId = rows[rows.length - 1]!.id;
    }
  }

  private computeStreak(activeDays: Set<string>, today: string): { currentStreak: number; longestStreak: number } {
    const sorted = [...activeDays].sort();
    let longestStreak = 0;
    let running = 0;
    let previous: string | null = null;
    for (const day of sorted) {
      running = previous && addDateKeyDays(previous, 1) === day ? running + 1 : 1;
      longestStreak = Math.max(longestStreak, running);
      previous = day;
    }

    let cursor = activeDays.has(today) ? today : addDateKeyDays(today, -1);
    let currentStreak = 0;
    while (activeDays.has(cursor)) {
      currentStreak += 1;
      cursor = addDateKeyDays(cursor, -1);
    }
    return { currentStreak, longestStreak };
  }

  async getActivityOverview(user: RequestUser, query: UserStatisticsFilterQueryDto): Promise<ActivityOverviewResponse> {
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const today = toDateKeyInTimeZone(new Date(), timeZone);
    const year = Number(today.slice(0, 4));
    const key = this.buildUserCacheKey('activity-overview', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      timeZone,
      today,
    });

    return this.cache.get(String(user.id), key, async () => {
      const libraryIds = await this.repo.resolveActivityLibraryIds(user.id, user.isSuperuser, query.libraryIds);
      const rangeStartDay = addDateKeyDays(today, -(ACTIVITY_OVERVIEW_DAYS - 1));
      const range = getDayRangeForDateKeys([rangeStartDay, today], timeZone)!;
      const byDay = new Map<string, ActivityDayPoint>();
      const hourDurations = Array.from({ length: 24 }, () => this.emptyDuration());
      const hourSessions = Array.from({ length: 24 }, () => 0);
      const hourSources = Array.from({ length: 24 }, () => emptySourceBucketRecord());

      await this.forEachActivitySession(user.id, libraryIds, range.start, range.end, (session) => {
        const media = this.mediaBucket(session.sessionType);
        const source = toReadingSessionSourceBucket(session.source);
        for (const segment of splitReadingSessionByDay(session, timeZone)) {
          if (segment.day < rangeStartDay || segment.day > today) continue;
          const point = byDay.get(segment.day) ?? this.emptyActivityDay(segment.day);
          this.addDuration(point, segment.readingSeconds, media);
          point.sessionsCount += 1;
          point.bySource[source] += segment.readingSeconds;
          byDay.set(segment.day, point);
        }

        const startDay = toDateKeyInTimeZone(session.startedAt, timeZone);
        if (startDay >= rangeStartDay && startDay <= today) {
          const hour = this.localHour(session.startedAt, timeZone);
          this.addDuration(hourDurations[hour]!, session.durationSeconds, media);
          hourSessions[hour]! += 1;
          hourSources[hour]![source] += session.durationSeconds;
        }
      });

      const allDays = this.dateKeys(rangeStartDay, today).map((day) => byDay.get(day) ?? this.emptyActivityDay(day));
      const dailyDays = allDays.slice(-ACTIVITY_DAILY_DAYS);
      const currentYearStart = `${year}-01-01`;
      const currentYearEnd = `${year}-12-31`;
      const calendarDays = this.dateKeys(currentYearStart, currentYearEnd).map((day) => byDay.get(day) ?? this.emptyActivityDay(day));
      const activeDays = new Set(await this.repo.getActivityActiveDays(user.id, libraryIds));
      for (const day of byDay.values()) {
        if (day.totalSeconds > 0) activeDays.add(day.day);
      }
      const streak = this.computeStreak(activeDays, today);

      const [availableYearsRaw, completionRows, funnel, pace] = await Promise.all([
        this.repo.getActivityAvailableYears(user.id, libraryIds, timeZone),
        this.repo.getActivityCompletionTimeline(user.id, libraryIds),
        this.getProgressFunnel(user, { libraryIds: query.libraryIds, days: 365, comparePrevious: true }),
        this.repo.getActivityPaceSummary(user.id, libraryIds),
      ]);
      const availableYears = [...new Set([...availableYearsRaw, year])].sort((a, b) => a - b);

      const completionByMonth = new Map(completionRows.map((row) => [`${row.year}-${row.month}`, row.count]));
      const firstCompletion = completionRows[0];
      const completionStartYear = firstCompletion?.year ?? year;
      const completionStartMonth = firstCompletion?.month ?? 1;
      const currentMonth = Number(today.slice(5, 7));
      const completionMonths: Array<{ year: number; month: number; count: number }> = [];
      for (
        let cursorYear = completionStartYear, cursorMonth = completionStartMonth;
        cursorYear < year || (cursorYear === year && cursorMonth <= currentMonth);
      ) {
        completionMonths.push({ year: cursorYear, month: cursorMonth, count: completionByMonth.get(`${cursorYear}-${cursorMonth}`) ?? 0 });
        cursorMonth += 1;
        if (cursorMonth === 13) {
          cursorMonth = 1;
          cursorYear += 1;
        }
      }

      let completedBooks = 0;
      const goalBooksValue = (user.settings?.dashboardConfig as { readingGoal?: unknown } | undefined)?.readingGoal;
      const goalBooks =
        typeof goalBooksValue === 'number' && Number.isFinite(goalBooksValue) && goalBooksValue > 0 ? Math.round(goalBooksValue) : null;
      const goalPoints = Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        completedBooks += completionByMonth.get(`${year}-${month}`) ?? 0;
        return {
          month,
          actualCumulative: completedBooks,
          targetCumulative: goalBooks == null ? null : Number(((goalBooks * month) / 12).toFixed(2)),
        };
      });
      const todayUtc = new Date(`${today}T00:00:00Z`);
      const yearStartUtc = new Date(`${year}-01-01T00:00:00Z`);
      const dayOfYear = Math.floor((todayUtc.getTime() - yearStartUtc.getTime()) / 86_400_000) + 1;
      const daysInYear = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1 ? 366 : 365;
      const projectedBooks = dayOfYear > 0 ? Number(((completedBooks / dayOfYear) * daysInYear).toFixed(1)) : 0;
      let goalStatus: ActivityGoalStatus | null = null;
      if (goalBooks != null) {
        const delta = completedBooks - (goalBooks * dayOfYear) / daysInYear;
        goalStatus = delta >= 0.5 ? 'ahead' : delta <= -0.5 ? 'behind' : 'on_pace';
      }

      const weekdayOccurrences = Array.from({ length: 7 }, () => 0);
      const weekdayTotals = Array.from({ length: 7 }, () => this.emptyDuration());
      const weekdaySessions = Array.from({ length: 7 }, () => 0);
      const weekdaySources = Array.from({ length: 7 }, () => emptySourceBucketRecord());
      for (const day of allDays) {
        const weekday = new Date(`${day.day}T00:00:00Z`).getUTCDay();
        weekdayOccurrences[weekday]! += 1;
        weekdayTotals[weekday]!.totalSeconds += day.totalSeconds;
        weekdayTotals[weekday]!.readingSeconds += day.readingSeconds;
        weekdayTotals[weekday]!.listeningSeconds += day.listeningSeconds;
        weekdaySessions[weekday]! += day.sessionsCount;
        for (const source of READING_SESSION_SOURCE_BUCKETS) weekdaySources[weekday]![source] += day.bySource[source];
      }
      const weekdays = Array.from({ length: 7 }, (_, dayOfWeek) => {
        const divisor = Math.max(1, weekdayOccurrences[dayOfWeek]!);
        return {
          dayOfWeek,
          averageSeconds: Math.round(weekdayTotals[dayOfWeek]!.totalSeconds / divisor),
          averageReadingSeconds: Math.round(weekdayTotals[dayOfWeek]!.readingSeconds / divisor),
          averageListeningSeconds: Math.round(weekdayTotals[dayOfWeek]!.listeningSeconds / divisor),
          sessionsCount: weekdaySessions[dayOfWeek]!,
          averageBySource: Object.fromEntries(
            READING_SESSION_SOURCE_BUCKETS.map((source) => [source, Math.round(weekdaySources[dayOfWeek]![source] / divisor)]),
          ) as Record<ReadingSessionSourceBucket, number>,
        };
      });
      const hours = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        ...hourDurations[hour]!,
        sessionsCount: hourSessions[hour]!,
        bySource: hourSources[hour]!,
      }));
      const favoriteDayOfWeek = weekdays.some((item) => item.sessionsCount > 0)
        ? weekdays.reduce((best, item) => (item.averageSeconds > best.averageSeconds ? item : best)).dayOfWeek
        : null;
      const peakHour = hours.some((item) => item.sessionsCount > 0)
        ? hours.reduce((best, item) => (item.totalSeconds > best.totalSeconds ? item : best)).hour
        : null;

      const sourceTotals = emptySourceBucketRecord();
      for (const day of allDays) for (const source of READING_SESSION_SOURCE_BUCKETS) sourceTotals[source] += day.bySource[source];
      const sourceSlices = READING_SESSION_SOURCE_BUCKETS.filter((source) => sourceTotals[source] > 0).map((source) => ({
        bucket: source,
        totalSeconds: sourceTotals[source],
      }));
      const sourceDuration = this.sumDays(allDays);

      const paceByMedia = new Map(pace.byMedia.map((item) => [item.bucket, item]));

      return {
        generatedAt: new Date().toISOString(),
        timezone: timeZone,
        libraryIds: query.libraryIds?.length ? [...(libraryIds ?? [])].sort((a, b) => a - b) : [],
        achievementsEnabled: (user.settings?.achievementPreferences as { enabled?: unknown } | undefined)?.enabled !== false,
        snapshot: {
          today: this.sumDays(allDays.slice(-1)),
          lastSevenDays: this.sumDays(allDays.slice(-7)),
          previousSevenDays: this.sumDays(allDays.slice(-14, -7)),
          ...streak,
          completedBooksYtd: completedBooks,
        },
        dailyActivity: { days: dailyDays },
        calendar: { year, availableYears, days: calendarDays },
        goal: {
          year,
          goalBooks,
          completedBooks,
          projectedBooks,
          status: goalStatus,
          points: goalPoints,
        },
        rhythm: {
          windowDays: ACTIVITY_OVERVIEW_DAYS,
          sessionsCount: allDays.reduce((sum, day) => sum + day.sessionsCount, 0),
          weekdays,
          hours,
          favoriteDayOfWeek,
          peakHour,
        },
        completion: {
          availableSince: firstCompletion ? `${firstCompletion.year}-${String(firstCompletion.month).padStart(2, '0')}-01` : null,
          months: completionMonths,
          funnel,
        },
        sources: {
          windowDays: ACTIVITY_OVERVIEW_DAYS,
          totals: sourceDuration,
          slices: sourceSlices,
        },
        pace: {
          ...pace.overall,
          byMedia: ACTIVITY_MEDIA_BUCKETS.map((bucket) => ({
            bucket,
            eligibleSessions: paceByMedia.get(bucket)?.eligibleSessions ?? 0,
            medianDurationSeconds: paceByMedia.get(bucket)?.medianDurationSeconds ?? null,
            medianProgressDelta: paceByMedia.get(bucket)?.medianProgressDelta ?? null,
          })),
        },
      };
    });
  }

  async getActivityCalendar(user: RequestUser, year: number, query: ActivityCalendarQueryDto): Promise<ActivityCalendarResponse> {
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const currentYear = Number(toDateKeyInTimeZone(new Date(), timeZone).slice(0, 4));
    if (!Number.isInteger(year) || year < 1970 || year > currentYear) throw new BadRequestException('Invalid activity year');
    const key = this.buildUserCacheKey('activity-calendar', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      timeZone,
      year,
    });

    return this.cache.get(String(user.id), key, async () => {
      const libraryIds = await this.repo.resolveActivityLibraryIds(user.id, user.isSuperuser, query.libraryIds);
      const availableYears = [...new Set([...(await this.repo.getActivityAvailableYears(user.id, libraryIds, timeZone)), currentYear])].sort(
        (a, b) => a - b,
      );
      if (year < availableYears[0]!) throw new BadRequestException('Activity year is not available');

      const startDay = `${year}-01-01`;
      const endDay = `${year}-12-31`;
      const range = getDayRangeForDateKeys([startDay, endDay], timeZone)!;
      const byDay = new Map<string, ActivityDayPoint>();
      await this.forEachActivitySession(user.id, libraryIds, range.start, range.end, (session) => {
        const media = this.mediaBucket(session.sessionType);
        const source = toReadingSessionSourceBucket(session.source);
        for (const segment of splitReadingSessionByDay(session, timeZone)) {
          if (segment.day < startDay || segment.day > endDay) continue;
          const point = byDay.get(segment.day) ?? this.emptyActivityDay(segment.day);
          this.addDuration(point, segment.readingSeconds, media);
          point.sessionsCount += 1;
          point.bySource[source] += segment.readingSeconds;
          byDay.set(segment.day, point);
        }
      });
      return { year, availableYears, days: this.dateKeys(startDay, endDay).map((day) => byDay.get(day) ?? this.emptyActivityDay(day)) };
    });
  }

  async getActivityDay(user: RequestUser, day: string, query: ActivityDayQueryDto): Promise<ActivityDayDetailResponse> {
    if (!isDateKey(day)) throw new BadRequestException('Invalid activity day');
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const libraryIds = await this.repo.resolveActivityLibraryIds(user.id, user.isSuperuser, query.libraryIds);
    const range = getDayRangeForDateKeys([day], timeZone)!;
    const totals = this.emptyActivityDay(day);
    const sessions: ActivityDayDetailResponse['sessions'] = [];

    await this.forEachActivitySession(user.id, libraryIds, range.start, range.end, (session) => {
      const segment = splitReadingSessionByDay(session, timeZone).find((item) => item.day === day);
      if (!segment) return;
      const mediaBucket = this.mediaBucket(session.sessionType);
      const sourceBucket = toReadingSessionSourceBucket(session.source);
      this.addDuration(totals, segment.readingSeconds, mediaBucket);
      totals.sessionsCount += 1;
      totals.bySource[sourceBucket] += segment.readingSeconds;
      sessions.push({
        id: session.id,
        bookId: session.bookId,
        bookFileId: session.bookFileId,
        bookTitle: session.bookTitle,
        hasCover: session.coverSource != null,
        coverVersion: session.metadataUpdatedAt?.toISOString() ?? null,
        format: session.format,
        mediaBucket,
        sourceBucket,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt.toISOString(),
        durationOnDaySeconds: segment.readingSeconds,
        progressDelta: session.progressDelta,
      });
    });
    sessions.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    return { day, timezone: timeZone, totals, sessions };
  }

  async getActivitySessionPatterns(user: RequestUser, query: UserStatisticsFilterQueryDto): Promise<ActivitySessionPatternsResponse> {
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const today = toDateKeyInTimeZone(new Date(), timeZone);
    const startDay = addDateKeyDays(today, -(ACTIVITY_DETAILS_WINDOW_DAYS - 1));
    const key = this.buildUserCacheKey('activity-session-patterns', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      timeZone,
      today,
    });

    return this.cache.get(String(user.id), key, async () => {
      const libraryIds = await this.repo.resolveActivityLibraryIds(user.id, user.isSuperuser, query.libraryIds);
      const range = getDayRangeForDateKeys([startDay, today], timeZone)!;
      const durations: number[] = [];
      const bucketTotals = new Map<ActivitySessionDurationBucket, { sessionsCount: number; totalSeconds: number }>();
      const weekTotals = new Map<string, { sessionsCount: number; totalSeconds: number }>();

      await this.forEachActivitySession(user.id, libraryIds, range.start, range.end, (session) => {
        const localDay = toDateKeyInTimeZone(session.startedAt, timeZone);
        if (localDay < startDay || localDay > today || session.durationSeconds <= 0) return;
        const duration = session.durationSeconds;
        const bucket: ActivitySessionDurationBucket = duration < 900 ? 'short' : duration < 1800 ? 'medium' : duration < 3600 ? 'long' : 'extended';
        const bucketValue = bucketTotals.get(bucket) ?? { sessionsCount: 0, totalSeconds: 0 };
        bucketValue.sessionsCount += 1;
        bucketValue.totalSeconds += duration;
        bucketTotals.set(bucket, bucketValue);

        const week = this.weekStart(localDay);
        const weekValue = weekTotals.get(week) ?? { sessionsCount: 0, totalSeconds: 0 };
        weekValue.sessionsCount += 1;
        weekValue.totalSeconds += duration;
        weekTotals.set(week, weekValue);
        durations.push(duration);
      });

      durations.sort((a, b) => a - b);
      const durationBuckets: ActivitySessionPatternsResponse['durationBuckets'] = (
        ['short', 'medium', 'long', 'extended'] as ActivitySessionDurationBucket[]
      ).map((bucket) => ({ bucket, ...(bucketTotals.get(bucket) ?? { sessionsCount: 0, totalSeconds: 0 }) }));
      const weeks: ActivitySessionPatternsResponse['weeks'] = [];
      for (let cursor = this.weekStart(startDay); cursor <= this.weekStart(today); cursor = addDateKeyDays(cursor, 7)) {
        weeks.push({ weekStart: cursor, ...(weekTotals.get(cursor) ?? { sessionsCount: 0, totalSeconds: 0 }) });
      }
      const activeWeeks = weeks.filter((week) => week.sessionsCount > 0).length;

      return {
        generatedAt: new Date().toISOString(),
        timezone: timeZone,
        windowDays: ACTIVITY_DETAILS_WINDOW_DAYS,
        sampleCount: durations.length,
        typicalDurationSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
        medianDurationSeconds: this.percentile(durations, 50),
        sessionsPerActiveWeek: activeWeeks ? Number((durations.length / activeWeeks).toFixed(1)) : null,
        durationBuckets,
        weeks,
      };
    });
  }

  async getActivityCompletionSpeed(user: RequestUser, query: ActivityCompletionSpeedQueryDto): Promise<ActivityCompletionSpeedResponse> {
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const today = toDateKeyInTimeZone(new Date(), timeZone);
    const startDay = addDateKeyDays(today, -(ACTIVITY_DETAILS_LONG_WINDOW_DAYS - 1));
    const selectedFormat = query.format?.trim().toUpperCase() || null;
    const key = this.buildUserCacheKey('activity-completion-speed', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      timeZone,
      today,
      format: selectedFormat ?? '',
    });

    return this.cache.get(String(user.id), key, async () => {
      const libraryIds = await this.repo.resolveActivityLibraryIds(user.id, user.isSuperuser, query.libraryIds);
      const range = getDayRangeForDateKeys([startDay, today], timeZone)!;
      const rows = await this.repo.getActivityCompletionSpeedRows(user.id, libraryIds, range.start);
      const availableFormats = [...new Set(rows.map((row) => row.format.toUpperCase()))].sort();
      const values = rows
        .filter((row) => selectedFormat == null || row.format.toUpperCase() === selectedFormat)
        .map((row) => this.dateKeyDifference(toDateKeyInTimeZone(row.firstStartedAt, timeZone), toDateKeyInTimeZone(row.completedAt, timeZone)))
        .sort((a, b) => a - b);
      const bucketCounts = new Map<ActivityCompletionSpeedBucket, number>();
      for (const value of values) {
        const bucket: ActivityCompletionSpeedBucket =
          value <= 7
            ? 'up_to_7'
            : value <= 30
              ? '8_to_30'
              : value <= 90
                ? '31_to_90'
                : value <= 180
                  ? '91_to_180'
                  : value <= 365
                    ? '181_to_365'
                    : 'over_365';
        bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
      }
      const buckets = (['up_to_7', '8_to_30', '31_to_90', '91_to_180', '181_to_365', 'over_365'] as ActivityCompletionSpeedBucket[]).map(
        (bucket) => ({ bucket, completionsCount: bucketCounts.get(bucket) ?? 0 }),
      );

      return {
        generatedAt: new Date().toISOString(),
        timezone: timeZone,
        windowDays: ACTIVITY_DETAILS_LONG_WINDOW_DAYS,
        selectedFormat,
        availableFormats,
        sampleCount: values.length,
        medianDays: this.percentile(values, 50),
        percentile75Days: this.percentile(values, 75),
        percentile90Days: this.percentile(values, 90),
        buckets,
      };
    });
  }

  async getActivityGenreTime(user: RequestUser, query: UserStatisticsFilterQueryDto): Promise<ActivityGenreTimeResponse> {
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const today = toDateKeyInTimeZone(new Date(), timeZone);
    const startDay = addDateKeyDays(today, -(ACTIVITY_DETAILS_WINDOW_DAYS - 1));
    const key = this.buildUserCacheKey('activity-genre-time', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      timeZone,
      today,
    });

    return this.cache.get(String(user.id), key, async () => {
      const libraryIds = await this.repo.resolveActivityLibraryIds(user.id, user.isSuperuser, query.libraryIds);
      const range = getDayRangeForDateKeys([startDay, today], timeZone)!;
      const rows = await this.repo.getActivityGenreTimeRows(user.id, libraryIds, range.start);
      const genres: ActivityGenreTimeResponse['genres'] = [];
      for (const row of rows) {
        let genre = genres.find((item) => item.genre === row.genre);
        if (!genre) {
          genre = { genre: row.genre, totalSeconds: Number(row.genreTotalSeconds), authors: [] };
          genres.push(genre);
        }
        let author = genre.authors.find((item) => item.author === row.author);
        if (!author) {
          author = { author: row.author, totalSeconds: Number(row.authorTotalSeconds), books: [] };
          genre.authors.push(author);
        }
        author.books.push({ bookId: Number(row.bookId), title: row.bookTitle, totalSeconds: Number(row.bookTotalSeconds) });
      }

      return {
        generatedAt: new Date().toISOString(),
        timezone: timeZone,
        windowDays: ACTIVITY_DETAILS_WINDOW_DAYS,
        totalSeconds: genres.reduce((sum, genre) => sum + genre.totalSeconds, 0),
        genres,
      };
    });
  }

  async getActivityPaceDetail(user: RequestUser, query: ActivityPaceQueryDto): Promise<ActivityPaceDetailResponse> {
    const timeZone = resolveTimeZone(user.settings?.timezone, 'UTC');
    const today = toDateKeyInTimeZone(new Date(), timeZone);
    const startDay = addDateKeyDays(today, -(ACTIVITY_DETAILS_LONG_WINDOW_DAYS - 1));
    const selectedFormat = query.format?.trim().toUpperCase() || null;
    const selectedMedia = query.media ?? null;
    const key = this.buildUserCacheKey('activity-pace-detail', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      timeZone,
      today,
      format: selectedFormat ?? '',
      media: selectedMedia ?? '',
    });

    return this.cache.get(String(user.id), key, async () => {
      const libraryIds = await this.repo.resolveActivityLibraryIds(user.id, user.isSuperuser, query.libraryIds);
      const range = getDayRangeForDateKeys([startDay, today], timeZone)!;
      const detail = await this.repo.getActivityPaceBands(user.id, libraryIds, range.start, selectedFormat ?? undefined, selectedMedia ?? undefined);
      const byBand = new Map(detail.bands.map((item) => [item.band, item]));
      const bands = (['under_15', '15_to_30', '30_to_60', '60_to_120', '120_to_240'] as ActivityPaceDurationBand[]).map((band) => ({
        band,
        medianProgressDelta: byBand.get(band)?.medianProgressDelta ?? null,
        sampleCount: byBand.get(band)?.sampleCount ?? 0,
      }));

      return {
        generatedAt: new Date().toISOString(),
        timezone: timeZone,
        windowDays: ACTIVITY_DETAILS_LONG_WINDOW_DAYS,
        selectedFormat,
        selectedMedia,
        availableFormats: detail.availableFormats,
        sampleCount: bands.reduce((sum, band) => sum + band.sampleCount, 0),
        bands,
      };
    });
  }

  async getSummary(user: RequestUser, query: UserStatisticsFilterQueryDto): Promise<UserStatisticsSummary> {
    const key = this.buildUserCacheKey('summary', user, { libraries: this.normalizeLibraryIds(query.libraryIds) });
    return this.cache.get(String(user.id), key, async () => {
      const summary = await this.repo.getSummary(user.id, user.isSuperuser, query.libraryIds);
      return {
        ...summary,
        meanProgressPercent: Number(summary.meanProgressPercent.toFixed(2)),
      };
    });
  }

  async getDailyReading(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserDailyReadingStat[]> {
    const days = query.days ?? 365;
    const key = this.buildUserCacheKey('daily-reading', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const items = await this.repo.getDailyReadingStats(user.id, user.isSuperuser, query.libraryIds, days);
      return items.map((item) => ({
        ...item,
        progressDelta: this.roundProgressDelta(item.progressDelta),
      }));
    });
  }

  async getReadingHeatmap(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserDailyReadingStat[]> {
    const days = query.days ?? HEATMAP_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('reading-heatmap', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const items = await this.repo.getDailyReadingStats(user.id, user.isSuperuser, query.libraryIds, days);
      const bySourceRows = await this.repo.getDailyReadingSecondsBySource(user.id, user.isSuperuser, query.libraryIds, days);
      const byDay = new Map(items.map((item) => [item.day, item]));
      const bySourceByDay = new Map<string, Record<ReadingSessionSourceBucket, number>>();
      for (const row of bySourceRows) {
        let record = bySourceByDay.get(row.day);
        if (!record) {
          record = emptySourceBucketRecord();
          bySourceByDay.set(row.day, record);
        }
        record[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }
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
          bySource: bySourceByDay.get(day) ?? emptySourceBucketRecord(),
        });
      }

      return result;
    });
  }

  async getReadingSourceDistribution(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserReadingSourceDistribution> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('source-distribution', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const rows = await this.repo.getDailyReadingSecondsBySource(user.id, user.isSuperuser, query.libraryIds, days);
      const totals = emptySourceBucketRecord();
      for (const row of rows) {
        totals[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }
      const slices = READING_SESSION_SOURCE_BUCKETS.filter((bucket) => totals[bucket] > 0).map((bucket) => ({
        bucket,
        readingSeconds: totals[bucket],
      }));
      const totalSeconds = slices.reduce((sum, slice) => sum + slice.readingSeconds, 0);
      return { totalSeconds, slices };
    });
  }

  async getPeakReadingHours(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserPeakHourStat[]> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const timeZone = resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC');
    const key = this.buildUserCacheKey('peak-hours', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days, timeZone });
    return this.cache.get(String(user.id), key, async () => {
      const rows = await this.repo.getPeakReadingHours(user.id, user.isSuperuser, query.libraryIds, days, timeZone);

      const byHour = new Map<
        number,
        { readingSeconds: number; eventsCount: number; byFormat: Record<string, number>; bySource: Record<ReadingSessionSourceBucket, number> }
      >();
      for (const row of rows) {
        if (!byHour.has(row.hour)) {
          byHour.set(row.hour, { readingSeconds: 0, eventsCount: 0, byFormat: {}, bySource: emptySourceBucketRecord() });
        }
        const entry = byHour.get(row.hour)!;
        entry.readingSeconds += row.readingSeconds;
        entry.eventsCount += row.eventsCount;
        // Grouping now splits each hour by (format, source), so accumulate rather than assign.
        entry.byFormat[row.format] = (entry.byFormat[row.format] ?? 0) + row.readingSeconds;
        entry.bySource[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }

      return Array.from({ length: 24 }, (_, hour) => {
        const entry = byHour.get(hour);
        return {
          hour,
          readingSeconds: entry?.readingSeconds ?? 0,
          eventsCount: entry?.eventsCount ?? 0,
          byFormat: entry?.byFormat ?? {},
          bySource: entry?.bySource ?? emptySourceBucketRecord(),
        };
      });
    });
  }

  async getFavoriteReadingDays(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserFavoriteDayStat[]> {
    const days = query.days ?? BEHAVIOR_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('favorite-days', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const rows = await this.repo.getFavoriteReadingDays(user.id, user.isSuperuser, query.libraryIds, days);
      const byDay = new Map<
        number,
        { readingSeconds: number; eventsCount: number; byFormat: Record<string, number>; bySource: Record<ReadingSessionSourceBucket, number> }
      >();
      for (const row of rows) {
        let entry = byDay.get(row.dayOfWeek);
        if (!entry) {
          entry = { readingSeconds: 0, eventsCount: 0, byFormat: {}, bySource: emptySourceBucketRecord() };
          byDay.set(row.dayOfWeek, entry);
        }
        entry.readingSeconds += row.readingSeconds;
        entry.eventsCount += row.eventsCount;
        entry.byFormat[row.format] = (entry.byFormat[row.format] ?? 0) + row.readingSeconds;
        entry.bySource[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }

      return Array.from({ length: 7 }, (_, dayOfWeek) => {
        const entry = byDay.get(dayOfWeek);
        return {
          dayOfWeek,
          readingSeconds: entry?.readingSeconds ?? 0,
          eventsCount: entry?.eventsCount ?? 0,
          byFormat: entry?.byFormat ?? {},
          bySource: entry?.bySource ?? emptySourceBucketRecord(),
        };
      });
    });
  }

  private toTimelineItem(row: {
    sessionId: number;
    bookId: number;
    bookTitle: string | null;
    bookFormat: string | null;
    source: ReadingSessionSource | null;
    startedAt: Date;
    endedAt: Date;
    durationSeconds: number;
  }): UserReadingSessionTimelineItem {
    return {
      sessionId: row.sessionId,
      bookId: row.bookId,
      bookTitle: row.bookTitle,
      bookFormat: row.bookFormat,
      bookSource: toReadingSessionSourceBucket(row.source),
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

    const key = this.buildUserCacheKey('session-timeline', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      year,
      week,
    });

    return this.cache.get(String(user.id), key, async () => {
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
      existing.endedAt,
      startedAt,
      endedAt,
      proposedDuration,
      resolveTimeZone((user.settings as { timezone?: unknown } | undefined)?.timezone, 'UTC'),
    );
    if (moveResult.conflict) {
      const conflictStart = moveResult.conflict.startedAt.toISOString();
      throw new ConflictException(`Session overlaps with #${moveResult.conflict.sessionId} starting at ${conflictStart}`);
    }
    if (!moveResult.updated) {
      throw new NotFoundException('Reading session not found');
    }

    this.cache.clearForScope(String(user.id));

    return this.toTimelineItem(moveResult.updated);
  }

  async getCompletionTimeline(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserCompletionTimelinePoint[]> {
    const days = query.days ?? COMPLETION_TIMELINE_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('completion-timeline', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
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
    const key = this.buildUserCacheKey('goal-trajectory', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      days,
      goalBooks,
    });
    return this.cache.get(String(user.id), key, async () => {
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
    const key = this.buildUserCacheKey('progress-funnel', user, {
      libraries: this.normalizeLibraryIds(query.libraryIds),
      days,
      comparePrevious: comparePrevious ? 1 : 0,
    });

    return this.cache.get(String(user.id), key, async () => {
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
    const key = this.buildUserCacheKey('completion-latency', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const values = await this.repo.getCompletionLatencyDays(user.id, user.isSuperuser, query.libraryIds, days);
      const sorted = [...values].sort((a, b) => a - b);

      const buckets = [
        { label: '0-7d', minDays: 0, maxDays: 7, count: 0 },
        { label: '8-30d', minDays: 8, maxDays: 30, count: 0 },
        { label: '31-90d', minDays: 31, maxDays: 90, count: 0 },
        { label: '91-180d', minDays: 91, maxDays: 180, count: 0 },
        { label: '181-365d', minDays: 181, maxDays: 365, count: 0 },
        { label: '366-730d', minDays: 366, maxDays: 730, count: 0 },
        { label: '731d+', minDays: 731, maxDays: null, count: 0 },
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
    const key = this.buildUserCacheKey('reading-survival', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
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
    const key = this.buildUserCacheKey('completion-race', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
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
    const key = this.buildUserCacheKey('session-archetypes', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, () => this.repo.getSessionArchetypePoints(user.id, user.isSuperuser, query.libraryIds, days));
  }

  async getGenreReadingTime(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserGenreReadingTimeItem[]> {
    const days = query.days ?? GENRE_READING_TIME_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('genre-reading-time', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, async () => {
      const rows = await this.repo.getGenreReadingTime(user.id, user.isSuperuser, query.libraryIds, days);
      const byGenre = new Map<string, { readingSeconds: number; bySource: Record<ReadingSessionSourceBucket, number> }>();
      for (const row of rows) {
        let entry = byGenre.get(row.genre);
        if (!entry) {
          entry = { readingSeconds: 0, bySource: emptySourceBucketRecord() };
          byGenre.set(row.genre, entry);
        }
        entry.readingSeconds += row.readingSeconds;
        entry.bySource[toReadingSessionSourceBucket(row.source)] += row.readingSeconds;
      }

      return Array.from(byGenre, ([genre, entry]) => ({ genre, readingSeconds: entry.readingSeconds, bySource: entry.bySource }))
        .sort((a, b) => b.readingSeconds - a.readingSeconds)
        .slice(0, 30);
    });
  }

  async getReadingPace(user: RequestUser, query: UserDailyReadingQueryDto): Promise<UserReadingPacePoint[]> {
    const days = query.days ?? READING_PACE_DEFAULT_DAYS;
    const key = this.buildUserCacheKey('reading-pace', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, () => this.repo.getReadingPacePoints(user.id, user.isSuperuser, query.libraryIds, days));
  }

  async getAuthorGenreChord(user: RequestUser, query: UserDailyReadingQueryDto): Promise<ChordDiagramData> {
    const days = query.days ?? 1825;
    const key = this.buildUserCacheKey('author-genre-chord', user, { libraries: this.normalizeLibraryIds(query.libraryIds), days });
    return this.cache.get(String(user.id), key, () => this.repo.getAuthorGenreChord(user.id, user.isSuperuser, query.libraryIds, days));
  }

  async recomputeRecentDailyStats(days = 2) {
    const result = await this.repo.recomputeRecentDailyStats(days);
    this.cache.clear();
    return result;
  }

  listUserIdsWithReadingHistory() {
    return this.repo.listUserIdsWithReadingHistory();
  }

  getUserTimeZone(userId: number) {
    return this.repo.getUserTimeZone(userId);
  }

  async rebuildDailyStatsForUser(userId: number, timeZone: string) {
    const result = await this.repo.rebuildDailyStatsForUser(userId, timeZone);
    this.cache.clearForScope(String(userId));
    return result;
  }
}
