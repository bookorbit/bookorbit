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
