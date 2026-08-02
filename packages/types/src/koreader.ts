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
  fileNamingPattern?: string | null;
  seriesFileNamingPattern?: string | null;
  standaloneFileNamingPattern?: string | null;
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
  fileNamingPattern?: string | null;
  seriesFileNamingPattern?: string | null;
  standaloneFileNamingPattern?: string | null;
}

export interface KoreaderPluginTotals {
  matchedBooks: number;
  trashedAnnotations: number;
  pendingDeletes: number;
  failedPositions: number;
  pageStatEvents: number;
  annotations: number;
  unmatchedBooks: number;
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

export interface KoreaderUnmatchedBook {
  hash: string;
  title: string | null;
  authors: string | null;
  lastOpen: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface KoreaderManualHashLink {
  hash: string;
  bookId: number;
  bookFileId: number;
  bookTitle: string | null;
  bookAuthors: string[];
  koreaderTitle: string | null;
  koreaderAuthors: string | null;
  koreaderLastOpen: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LinkKoreaderUnmatchedBookPayload {
  bookId: number;
}

export interface LinkKoreaderUnmatchedBookResult {
  hash: string;
  bookId: number;
  bookFileId: number;
}

export interface DismissKoreaderUnmatchedBookResult {
  hash: string;
}

export interface DismissAllKoreaderUnmatchedBooksResult {
  count: number;
}

export interface UpdateKoreaderManualHashLinkPayload {
  bookId: number;
}

export interface UnlinkKoreaderManualHashLinkResult {
  hash: string;
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
  "libraries" | "collections" | "smart-scopes" | "authors" | "series" | "search" | "recent" | "all-books" | "continue-reading";

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
  devicePath: string;
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
  /** When reading progress was last recorded, so the plugin can show recency. */
  lastReadAt: string | null;
  readStatus: string | null;
  formats: string[];
  hasCover: boolean;
  thumbnailUrl: string | null;
  detailUrl: string;
  addedAt: string;
  updatedAt: string;
}

export type KoreaderCatalogRelatedSectionId = "series" | "author" | "similar";

export interface KoreaderCatalogRelatedBook {
  id: number;
  title: string | null;
  authors: string[];
  seriesIndex: number | null;
  hasCover: boolean;
  thumbnailUrl: string | null;
  detailUrl: string;
  updatedAt: string | null;
  isAudiobook?: boolean;
  isComic?: boolean;
}

export interface KoreaderCatalogRelatedSection {
  id: KoreaderCatalogRelatedSectionId;
  title: string;
  books: KoreaderCatalogRelatedBook[];
}

export interface KoreaderCatalogBookDetail extends KoreaderCatalogBookListItem {
  subtitle: string | null;
  description: string | null;
  publisher: string | null;
  publishedDate: string | null;
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
  relatedSections: KoreaderCatalogRelatedSection[];
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

// The dashboard row below Continue reading is user-selectable. "random"
// reproduces the original Discover row and remains the default.
export const KOREADER_DASHBOARD_SECTION_TYPE = {
  RANDOM: "random",
  RECENTLY_ADDED: "recently-added",
  WANT_TO_READ: "want-to-read",
  UP_NEXT_IN_SERIES: "up-next-in-series",
  SMART_SCOPE: "smart-scope",
} as const;

export type KoreaderDashboardSectionType = (typeof KOREADER_DASHBOARD_SECTION_TYPE)[keyof typeof KOREADER_DASHBOARD_SECTION_TYPE];
export const KOREADER_DASHBOARD_SECTION_TYPES = Object.values(KOREADER_DASHBOARD_SECTION_TYPE) as ReadonlyArray<KoreaderDashboardSectionType>;

// Ordered so a later release can render more than one configurable row without
// a wire change. Only the first entry is honoured today.
export interface KoreaderDashboardSectionConfig {
  type: KoreaderDashboardSectionType;
  smartScopeId?: number;
}

export interface KoreaderCatalogDashboardSection {
  type: KoreaderDashboardSectionType;
  smartScopeId: number | null;
  books: KoreaderCatalogBookListItem[];
}

export interface KoreaderCatalogDashboardResponse {
  generatedAt: string;
  username: string;
  displayName: string;
  totalBooks: number;
  sections: KoreaderCatalogEntry[];
  continueReading: KoreaderCatalogBookListItem[];
  // Legacy Discover row. Populated only for requests that name no section, so a
  // plugin predating the section parameter keeps its original response and the
  // books are never carried twice.
  discover: KoreaderCatalogBookListItem[];
  section?: KoreaderCatalogDashboardSection;
  readingGoal: ReadingGoalWidgetData;
  readingStreak: ReadingStreakWidgetData;
  highlightOfTheDay: HighlightOfTheDayWidgetData | null;
}

export interface KoreaderCatalogDiscoverResponse {
  discover: KoreaderCatalogBookListItem[];
}

export interface KoreaderCatalogDashboardSectionResponse {
  section: KoreaderCatalogDashboardSection;
}

// Everything a bulk download needs per downloadable file, so no per-book detail
// request remains. `fileHash` is the KOReader partial MD5 of the exact bytes the
// download route streams, so it doubles as the restart-validation checksum and
// as the digest that keys local match state.
export interface KoreaderCatalogManifestFile {
  id: number;
  format: string;
  sizeBytes: number | null;
  contentVersion: string;
  fileHash: string | null;
  downloadUrl: string;
  devicePath: string;
}

export interface KoreaderCatalogManifestBook {
  id: number;
  title: string;
  authors: string[];
  seriesName: string | null;
  seriesIndex: number | null;
  formats: string[];
  files: KoreaderCatalogManifestFile[];
}

export interface KoreaderCatalogManifestPage {
  items: KoreaderCatalogManifestBook[];
  hasNext: boolean;
  // Opaque, bound to the user, the normalized filter and the manifest snapshot.
  nextCursor: string | null;
  manifestVersion: string;
  // Set when a supplied cursor was minted under a different cursor contract.
  // A library change during a run does not set it: the keyset orders by immutable
  // book id, so enumeration continues and only manifestVersion carries the change.
  // On a restart, already-published files are skipped by size and hash validation,
  // so no transfer work is repeated.
  restartRequired: boolean;
}

export type KoreaderPluginCapability = "catalogBulkManifest" | "catalogDashboardSections" | "bookmarkSync";

export interface KoreaderPluginVersionInfo {
  pluginVersion: string;
  serverVersion: string;
  capabilities: KoreaderPluginCapability[];
}

export interface KoreaderCatalogReadStatusResult {
  readStatus: KoreaderCatalogSettableReadStatus;
}

export interface KoreaderCatalogRatingResult {
  rating: number | null;
}
