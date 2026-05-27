export interface KoreaderCredentials {
  username: string;
  syncEnabled: boolean;
  createdAt: string;
}

export interface KoreaderDeviceInfo {
  device: string;
  deviceId: string;
  lastSyncAt: string;
  lastBookTitle: string | null;
}

export interface KoreaderBookProgress {
  device: string;
  deviceId: string;
  percentage: number;
  chapterIndex: number | null;
  chapterTitle: string | null;
  updatedAt: string;
}

export interface KoreaderSyncStatus {
  credentials: KoreaderCredentials | null;
  devices: KoreaderDeviceInfo[];
  totalSyncedBooks: number;
  lastSyncAt: string | null;
  booksWithStats: number;
  totalReadingSeconds: number;
}

export interface KoreaderBookSyncInfo {
  bookId: number;
  bookFileId: number;
  canonicalPercentage: number;
  canonicalChapterIndex: number | null;
  canonicalChapterTitle: string | null;
  canonicalSource: "koreader" | "web_reader";
  canonicalUpdatedAt: string;
  devices: KoreaderBookProgress[];
  fileModifiedSinceLastSync: boolean;
}

export interface CreateKoreaderCredentialsPayload {
  username: string;
  password: string;
}

export interface UpdateKoreaderCredentialsPayload {
  username?: string;
  password?: string;
  syncEnabled?: boolean;
}

export interface TestKoreaderConnectionResult {
  success: boolean;
  username: string;
  serverUrl: string;
}

export interface KoreaderReadingSession {
  id: number;
  page: number;
  startedAt: string;
  durationSeconds: number;
  totalPages: number;
}

export interface KoreaderBookStats {
  bookFileId: number;
  totalReadSecs: number;
  totalReadPages: number;
  highlightsCount: number;
  notesCount: number;
  lastOpenAt: string | null;
  updatedAt: string;
}

export interface KoreaderTabData {
  stats: KoreaderBookStats;
  sessions: KoreaderReadingSession[];
  dailySummary: { day: string; durationSeconds: number }[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KoreaderStatsResponse {
  processed: number;
  unmatched: number;
}
