import type { ReadingSessionSourceBucket } from "./reading-session-source-bucket";

export const READING_SESSION_SOURCES = ["web", "koreader", "manual", "kobo"] as const;
export type ReadingSessionSource = (typeof READING_SESSION_SOURCES)[number];

export interface BookReadingSession {
  id: number;
  bookFileId: number | null;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
  format: string | null;
  source: ReadingSessionSource | null;
  // The reading attempt this session was recorded against, when one was open at the time.
  // Sessions logged before attempts existed, or outside any attempt, carry null.
  attemptId: number | null;
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
  // endProgress of the most recently ended session that recorded one, or null when no
  // session has. Unlike every other field here it ignores the list filters, because it
  // feeds the book's progress ring rather than a summary of the filtered rows.
  latestEndProgress: number | null;
  // Reading time/sessions split across the 3 display buckets, ordered by
  // READING_SESSION_SOURCE_BUCKETS; only buckets with activity are included.
  bySource: BookReadingSourceSlice[];
  // Longest single session in the filtered window. The client only ever holds one page of
  // sessions, so it cannot find this itself once a book has more sessions than a page.
  longestSessionSeconds: number;
  longestSessionAt: string | null;
  // Sessions whose progress went backwards by more than a rounding error: a reread of an
  // earlier chapter, or a device that resynchronised to an older position.
  backtrackCount: number;
}

export interface BookReadingSessionListResponse {
  items: BookReadingSession[];
  total: number;
  page: number;
  pageSize: number;
  stats: BookReadingSessionStats;
}
