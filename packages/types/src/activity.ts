import type { ReadingSessionSourceBucket } from "./reading-session-source-bucket";
import type { UserProgressFunnelComparison } from "./user-statistics";

export const ACTIVITY_MEDIA_BUCKETS = ["reading", "listening"] as const;
export type ActivityMediaBucket = (typeof ACTIVITY_MEDIA_BUCKETS)[number];

export type ActivityGoalStatus = "ahead" | "on_pace" | "behind";

export interface ActivityDurationBreakdown {
  totalSeconds: number;
  readingSeconds: number;
  listeningSeconds: number;
}

export interface ActivityDayPoint extends ActivityDurationBreakdown {
  day: string;
  sessionsCount: number;
  bySource: Record<ReadingSessionSourceBucket, number>;
}

export interface ActivityOverviewResponse {
  generatedAt: string;
  timezone: string;
  libraryIds: number[];
  achievementsEnabled: boolean;
  snapshot: {
    today: ActivityDurationBreakdown;
    lastSevenDays: ActivityDurationBreakdown;
    previousSevenDays: ActivityDurationBreakdown;
    currentStreak: number;
    longestStreak: number;
    completedBooksYtd: number;
  };
  dailyActivity: {
    days: ActivityDayPoint[];
  };
  calendar: ActivityCalendarResponse;
  goal: {
    year: number;
    goalBooks: number | null;
    completedBooks: number;
    projectedBooks: number;
    status: ActivityGoalStatus | null;
    points: Array<{
      month: number;
      actualCumulative: number;
      targetCumulative: number | null;
    }>;
  };
  rhythm: {
    windowDays: number;
    sessionsCount: number;
    weekdays: Array<{
      dayOfWeek: number;
      averageSeconds: number;
      averageReadingSeconds: number;
      averageListeningSeconds: number;
      sessionsCount: number;
      averageBySource: Record<ReadingSessionSourceBucket, number>;
    }>;
    hours: Array<
      ActivityDurationBreakdown & {
        hour: number;
        sessionsCount: number;
        bySource: Record<ReadingSessionSourceBucket, number>;
      }
    >;
    favoriteDayOfWeek: number | null;
    peakHour: number | null;
  };
  completion: {
    availableSince: string | null;
    months: Array<{ year: number; month: number; count: number }>;
    funnel: UserProgressFunnelComparison;
  };
  sources: {
    windowDays: number;
    totals: ActivityDurationBreakdown;
    slices: Array<{
      bucket: ReadingSessionSourceBucket;
      totalSeconds: number;
    }>;
  };
  pace: {
    eligibleSessions: number;
    medianDurationSeconds: number | null;
    medianProgressDelta: number | null;
    byMedia: Array<{
      bucket: ActivityMediaBucket;
      eligibleSessions: number;
      medianDurationSeconds: number | null;
      medianProgressDelta: number | null;
    }>;
  };
}

export interface ActivityCalendarResponse {
  year: number;
  availableYears: number[];
  days: ActivityDayPoint[];
}

export interface ActivityDayDetailResponse {
  day: string;
  timezone: string;
  totals: ActivityDayPoint;
  sessions: Array<{
    id: number;
    bookId: number;
    bookFileId: number | null;
    bookTitle: string | null;
    hasCover: boolean;
    coverVersion: string | null;
    format: string | null;
    mediaBucket: ActivityMediaBucket;
    sourceBucket: ReadingSessionSourceBucket;
    startedAt: string;
    endedAt: string;
    durationOnDaySeconds: number;
    progressDelta: number | null;
  }>;
}

export const ACTIVITY_SESSION_DURATION_BUCKETS = ["short", "medium", "long", "extended"] as const;
export type ActivitySessionDurationBucket = (typeof ACTIVITY_SESSION_DURATION_BUCKETS)[number];

export interface ActivitySessionPatternsResponse {
  generatedAt: string;
  timezone: string;
  windowDays: number;
  sampleCount: number;
  typicalDurationSeconds: number | null;
  medianDurationSeconds: number | null;
  sessionsPerActiveWeek: number | null;
  durationBuckets: Array<{
    bucket: ActivitySessionDurationBucket;
    sessionsCount: number;
    totalSeconds: number;
  }>;
  weeks: Array<{
    weekStart: string;
    sessionsCount: number;
    totalSeconds: number;
  }>;
}

export const ACTIVITY_COMPLETION_SPEED_BUCKETS = ["up_to_7", "8_to_30", "31_to_90", "91_to_180", "181_to_365", "over_365"] as const;
export type ActivityCompletionSpeedBucket = (typeof ACTIVITY_COMPLETION_SPEED_BUCKETS)[number];

export interface ActivityCompletionSpeedResponse {
  generatedAt: string;
  timezone: string;
  windowDays: number;
  selectedFormat: string | null;
  availableFormats: string[];
  sampleCount: number;
  medianDays: number | null;
  percentile75Days: number | null;
  percentile90Days: number | null;
  buckets: Array<{
    bucket: ActivityCompletionSpeedBucket;
    completionsCount: number;
  }>;
}

export interface ActivityGenreTimeResponse {
  generatedAt: string;
  timezone: string;
  windowDays: number;
  totalSeconds: number;
  genres: Array<{
    genre: string;
    totalSeconds: number;
    authors: Array<{
      author: string | null;
      totalSeconds: number;
      books: Array<{
        bookId: number;
        title: string | null;
        totalSeconds: number;
      }>;
    }>;
  }>;
}

export const ACTIVITY_PACE_DURATION_BANDS = ["under_15", "15_to_30", "30_to_60", "60_to_120", "120_to_240"] as const;
export type ActivityPaceDurationBand = (typeof ACTIVITY_PACE_DURATION_BANDS)[number];

export interface ActivityPaceDetailResponse {
  generatedAt: string;
  timezone: string;
  windowDays: number;
  selectedFormat: string | null;
  selectedMedia: ActivityMediaBucket | null;
  availableFormats: string[];
  sampleCount: number;
  bands: Array<{
    band: ActivityPaceDurationBand;
    medianProgressDelta: number | null;
    sampleCount: number;
  }>;
}
