import type { ReadingSessionSourceBucket } from "./reading-session-source-bucket";

export const READING_SESSION_SOURCES = ["web", "koreader", "manual", "kobo"] as const;
export type ReadingSessionSource = (typeof READING_SESSION_SOURCES)[number];

export interface BookReadingSession {
  id: number;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
  format: string | null;
  source: ReadingSessionSource | null;
}

export interface BookReadingSourceSlice {
  bucket: ReadingSessionSourceBucket;
  totalSeconds: number;
  totalSessions: number;
}

export interface BookReadingSessionStats {
  totalSessions: number;
  totalSeconds: number;
  avgDurationSeconds: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
  dailySummary: { day: string; totalMinutes: number }[];
  paceProgressDelta: number;
  paceDurationSeconds: number;
  progressSummary: { day: string; endProgress: number }[];
  // Reading time/sessions split across the 3 display buckets, ordered by
  // READING_SESSION_SOURCE_BUCKETS; only buckets with activity are included.
  bySource: BookReadingSourceSlice[];
}

export interface BookReadingSessionListResponse {
  items: BookReadingSession[];
  total: number;
  page: number;
  pageSize: number;
  stats: BookReadingSessionStats;
}
