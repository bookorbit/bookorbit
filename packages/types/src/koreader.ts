import type { HighlightOfTheDayWidgetData, ReadingGoalWidgetData, ReadingStreakWidgetData } from "./dashboard";

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

export interface KoreaderDeviceSweepInfo {
  deviceId: string;
  deviceModel: string;
  pluginVersion: string | null;
  latestPluginVersion: string | null;
  updateAvailable: boolean | null;
  lastSweepAt: string;
  lastSweepBooksMatched: number;
  lastSweepPageStats: number;
  lastSweepAnnotations: number;
}

export interface KoreaderPluginTotals {
  matchedBooks: number;
  trashedAnnotations: number;
  pendingDeletes: number;
  failedPositions: number;
  pageStatEvents: number;
  annotations: number;
}

export interface KoreaderSyncStatus {
  credentials: KoreaderCredentials | null;
  devices: KoreaderDeviceInfo[];
  totalSyncedBooks: number;
  lastSyncAt: string | null;
  latestPluginVersion: string | null;
  pluginUpdateAvailable: boolean;
  sweeps: KoreaderDeviceSweepInfo[];
  pluginTotals: KoreaderPluginTotals;
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

export type KoreaderCatalogSection =
  | "libraries"
  | "collections"
  | "smart-scopes"
  | "authors"
  | "series"
  | "search"
  | "recent"
  | "all-books"
  | "continue-reading";

export type KoreaderCatalogSort = "title" | "author" | "recently_added" | "recently_updated" | "recently_read" | "series";

export type KoreaderCatalogSortOrder = "asc" | "desc";

export type KoreaderCatalogReadStatusFilter = "unread" | "reading" | "finished";

// Read statuses the catalog detail page can set on a book. A subset of the
// full ReadStatus enum, chosen for reading-device ergonomics.
export type KoreaderCatalogSettableReadStatus = "want_to_read" | "reading" | "on_hold" | "read" | "abandoned";

export interface KoreaderCatalogSeriesSummary {
  total: number;
  finished: number;
}

export interface KoreaderCatalogEntry {
  id: string;
  title: string;
  section: KoreaderCatalogSection;
  subtitle?: string | null;
  count?: number;
  icon?: string | null;
  seriesId?: number;
  href?: string;
  booksHref?: string;
}

export interface KoreaderCatalogFile {
  id: number;
  format: string;
  role: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
  downloadUrl: string;
}

export interface KoreaderCatalogProgress {
  fileId: number;
  percentage: number;
  koreaderProgress: string | null;
  updatedAt: string;
}

export interface KoreaderCatalogBookListItem {
  id: number;
  title: string;
  authors: string[];
  seriesId: number | null;
  seriesName: string | null;
  seriesIndex: number | null;
  progressPercentage: number | null;
  readStatus: string | null;
  formats: string[];
  hasCover: boolean;
  thumbnailUrl: string | null;
  detailUrl: string;
  addedAt: string;
  updatedAt: string;
}

export interface KoreaderCatalogBookDetail extends KoreaderCatalogBookListItem {
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  isbn10: string | null;
  isbn13: string | null;
  libraryId: number;
  libraryName: string;
  rating: number | null;
  pageCount: number | null;
  collections: { id: number; name: string }[];
  genres: string[];
  tags: string[];
  progress: KoreaderCatalogProgress | null;
  files: KoreaderCatalogFile[];
}

export interface KoreaderCatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  hasNext: boolean;
  hasPrevious: boolean;
  nextUrl: string | null;
  previousUrl: string | null;
  // Present when the page is scoped to a single series, summarising
  // read-through progress across the whole series.
  seriesSummary?: KoreaderCatalogSeriesSummary | null;
}

export interface KoreaderCatalogSectionResponse {
  section: KoreaderCatalogSection;
  items: KoreaderCatalogEntry[];
  // Pagination is only emitted for large sections (authors, series).
  page?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
  nextUrl?: string | null;
  previousUrl?: string | null;
  query?: string | null;
}

export interface KoreaderCatalogDashboardResponse {
  generatedAt: string;
  sections: KoreaderCatalogEntry[];
  continueReading: KoreaderCatalogBookListItem[];
  discover: KoreaderCatalogBookListItem[];
  readingGoal: ReadingGoalWidgetData;
  readingStreak: ReadingStreakWidgetData;
  highlightOfTheDay: HighlightOfTheDayWidgetData | null;
}

export interface KoreaderCatalogDiscoverResponse {
  discover: KoreaderCatalogBookListItem[];
}

export interface KoreaderCatalogReadStatusResult {
  readStatus: KoreaderCatalogSettableReadStatus;
}

export interface KoreaderCatalogRatingResult {
  rating: number | null;
}
