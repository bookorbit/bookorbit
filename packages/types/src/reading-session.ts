export interface BookReadingSession {
  id: number;
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
  format: string | null;
}

export interface KoboReadingSessionEntry {
  progressPercent: number | null;
  lastModified: string | null;
  status: string | null;
}

export interface BookReadingSessionStats {
  totalSessions: number;
  totalSeconds: number;
  avgDurationSeconds: number;
  firstSessionAt: string | null;
  lastSessionAt: string | null;
  dailySummary: { day: string; totalMinutes: number }[];
}

export interface BookReadingSessionListResponse {
  items: BookReadingSession[];
  total: number;
  page: number;
  pageSize: number;
  stats: BookReadingSessionStats;
  koboReadingState: KoboReadingSessionEntry | null;
}
