export interface UserStatisticsSummary {
  trackedBooks: number;
  startedBooks: number;
  inProgressBooks: number;
  completedBooks: number;
  meanProgressPercent: number;
}

export interface UserDailyReadingStat {
  day: string;
  readingSeconds: number;
  progressDelta: number;
  eventsCount: number;
}

export interface UserPeakHourStat {
  hour: number;
  readingSeconds: number;
  eventsCount: number;
  byFormat: Record<string, number>;
}

export interface UserFavoriteDayStat {
  dayOfWeek: number;
  readingSeconds: number;
  eventsCount: number;
}

export interface UserCompletionTimelinePoint {
  year: number;
  month: number;
  count: number;
}

export interface UserGoalTrajectoryPoint {
  year: number;
  month: number;
  actualCumulative: number;
  targetCumulative: number;
}

export interface UserGoalTrajectory {
  goalBooks: number;
  points: UserGoalTrajectoryPoint[];
}

export interface UserProgressFunnel {
  started: number;
  reached25: number;
  reached50: number;
  reached75: number;
  completed: number;
}

export interface UserProgressFunnelComparison {
  days: number;
  current: UserProgressFunnel;
  previous: UserProgressFunnel | null;
}

export interface UserCompletionLatencyBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  count: number;
}

export interface UserCompletionLatencyDistribution {
  totalCompletions: number;
  medianDays: number | null;
  percentile75Days: number | null;
  percentile90Days: number | null;
  buckets: UserCompletionLatencyBucket[];
}

export interface UserGenreReadingTimeItem {
  genre: string;
  readingSeconds: number;
}

export interface UserReadingSessionTimelineItem {
  sessionId: number;
  bookId: number;
  bookTitle: string | null;
  bookFormat: string | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
}

export interface UserReadingSessionTimeline {
  year: number;
  week: number;
  weekStart: string;
  weekEnd: string;
  items: UserReadingSessionTimelineItem[];
}

export interface UserReadingPacePoint {
  durationSeconds: number;
  progressDelta: number;
}

export interface UserReadingSurvivalPoint {
  threshold: number;
  survivedCount: number;
  survivedPct: number;
}

export interface UserCompletionRacePoint {
  daysSinceStart: number;
  progress: number;
}

export interface UserCompletionRaceBook {
  bookId: number;
  title: string;
  points: UserCompletionRacePoint[];
}

export interface UserSessionArchetypePoint {
  hour: number;
  durationMinutes: number;
  dayOfWeek: number;
}

export interface ReadingTimeBreakdownBook {
  bookId: number;
  title: string;
  readingSeconds: number;
}

export interface ReadingTimeBreakdownAuthor {
  authorName: string;
  readingSeconds: number;
  books: ReadingTimeBreakdownBook[];
}

export interface ReadingTimeBreakdownGenre {
  genre: string;
  readingSeconds: number;
  authors: ReadingTimeBreakdownAuthor[];
}
