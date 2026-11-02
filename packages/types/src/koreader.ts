import type { ReadAloudDeliveryPreference, ReadAloudDeliveryVariant, DeliveryArtifactMetadata } from "./delivery";
import type { HighlightOfTheDayWidgetData, ReadingGoalWidgetData, ReadingStreakWidgetData } from "./dashboard";
import type { SeriesIndex } from "./series-index";
import type { AchievementRarity } from "./achievement";

export interface KoreaderCredentials {
  readAloudDelivery?: ReadAloudDeliveryPreference;
  username: string;
  syncEnabled: boolean;
  /** When true the plugin catalog leaves out books whose only content files are audio. */
  hideAudioOnlyBooks: boolean;
  createdAt: string;
}

export interface KoreaderDeviceInfo {
  readAloudDelivery?: ReadAloudDeliveryPreference;
  device: string;
  deviceId: string;
  lastSyncAt: string;
  lastBookTitle: string | null;
  /** Set when the device has been retired: its data is kept, but it is no longer treated as active. */
  retiredAt: string | null;
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
  readAloudDelivery?: ReadAloudDeliveryPreference;
  deviceId: string;
  deviceModel: string;
  pluginVersion: string | null;
  latestPluginVersion: string | null;
  updateAvailable: boolean | null;
  /**
   * The device runs a plugin too old to install its own updates, so the server
   * withholds the update offer and the user must install the zip by hand.
   */
  requiresManualUpdate: boolean;
  lastSweepAt: string;
  lastSweepBooksMatched: number;
  lastSweepPageStats: number;
  lastSweepAnnotations: number;
  retiredAt: string | null;
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
  /**
   * Devices sitting on a position the user reset away from. Their pushes are recorded but do
   * not move the book until the device takes the reset, so this is the state behind a device
   * and a book that visibly disagree.
   */
  heldByReset: KoreaderResetHeldDevice[];
}

export interface KoreaderResetHeldDevice {
  device: string;
  deviceId: string;
  percentage: number;
  updatedAt: string;
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
  /**
   * False when the device copy's bytes differ from the linked library file: reading status, rating, reading time
   * and progress (as a percentage) sync; highlights, bookmarks and exact positions do not.
   */
  positionCompatible: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A library book whose title and authors equal an unmatched KOReader book's, offered for the user to confirm. */
export interface KoreaderLinkSuggestionCandidate {
  bookId: number;
  title: string | null;
  subtitle: string | null;
  authors: string[];
  /** Format of the book's primary file, which is what a link targets. */
  format: string | null;
  language: string | null;
  publishedYear: number | null;
  libraryName: string | null;
}

export interface KoreaderUnmatchedBookSuggestion {
  hash: string;
  candidates: KoreaderLinkSuggestionCandidate[];
  /** More library books share the title than were checked, so none of the candidates may be presented as the only match. */
  moreCandidates: boolean;
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
  readAloudDelivery?: ReadAloudDeliveryPreference;
  username: string;
  password: string;
}

export interface UpdateKoreaderCredentialsPayload {
  readAloudDelivery?: ReadAloudDeliveryPreference;
  username?: string;
  password?: string;
  syncEnabled?: boolean;
  hideAudioOnlyBooks?: boolean;
}

export interface TestKoreaderConnectionResult {
  success: boolean;
  username: string;
  serverUrl: string;
}

export type KoreaderCatalogSection =
  "libraries" | "collections" | "smart-scopes" | "authors" | "series" | "search" | "recent" | "all-books" | "continue-reading";

export type KoreaderCatalogSort = "title" | "author" | "published" | "recently_added" | "recently_updated" | "recently_read" | "series";

export type KoreaderCatalogSortOrder = "asc" | "desc";

export type KoreaderCatalogReadStatusFilter = "unread" | "reading" | "finished";

// Read statuses the catalog detail page can set on a book. A subset of the
// full ReadStatus enum, chosen for reading-device ergonomics. "unread" is the
// default state, so it has to stay settable or a device write becomes a one-way
// door that only the web dashboard can undo.
export type KoreaderCatalogSettableReadStatus = "unread" | "want_to_read" | "reading" | "on_hold" | "read" | "abandoned";

export interface KoreaderCatalogSeriesSummary {
  total: number;
  finished: number;
  /** Books of the series in the reading bucket. Absent from servers that predate it. */
  reading?: number;
}

// Requested only once the server advertises the catalogListsV2 capability: an
// older server rejects the parameters as unknown.
export type KoreaderCatalogSectionSort = "name" | "name_desc" | "books";

export type KoreaderCatalogSectionFilter = "reading" | "finished";

export type KoreaderCatalogMemberState = "finished" | "reading" | "unread";

export interface KoreaderCatalogPreviewBook {
  id: number;
  title: string;
  hasCover: boolean;
  thumbnailUrl: string | null;
  seriesIndex: SeriesIndex | null;
  progressPercentage: number | null;
  readStatus: string | null;
  lastReadAt: string | null;
  addedAt: string;
  updatedAt: string;
}

/** `key` is "A" to "Z" or "#"; `index` is the 0-based offset of the first entry with that key in the list's current order. */
export interface KoreaderCatalogJumpBucket {
  key: string;
  index: number;
}

export interface KoreaderCatalogAuthorSummary {
  id: number;
  name: string;
  description: string | null;
  birthYear: number | null;
  deathYear: number | null;
  hasPhoto: boolean;
  photoUrl: string | null;
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
  // List-page extras. Optional so a plugin reading an older server renders plain rows.
  authorId?: number;
  hasPhoto?: boolean;
  photoUrl?: string | null;
  previewBooks?: KoreaderCatalogPreviewBook[];
  readingCount?: number;
  finishedCount?: number;
  seriesName?: string | null;
  authorNames?: string[];
  memberStates?: KoreaderCatalogMemberState[];
  expectedCount?: number | null;
  /** Jump-bucket key of this entry's sort key, identical to the key its bucket carries. */
  letter?: string;
}

export interface KoreaderCatalogFile {
  fileHash?: string | null;
  sourceMediaOverlayAvailable?: boolean;
  narrationPlaybackAvailable?: boolean;
  selection?: string;
  delivery?: DeliveryArtifactMetadata;
  requestedVariant?: "original" | "audioless_epub";
  contentVersion?: string;
  id: number;
  format: string;
  role: string;
  downloadVariant: "original" | "audioless_epub";
  sizeBytes: number | null;
  /**
   * The stored file's size, for display. sizeBytes is the size of what the
   * download will be and stays null for a variant built on request; this lets
   * a reader see roughly how big a plain EPUB is. Absent from older servers.
   */
  sourceSizeBytes?: number | null;
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
  seriesIndex: SeriesIndex | null;
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
  /** Only on the dashboard's finishedThisYear entries: the reader's local day the book was finished. */
  finishedOn?: string | null;
}

export type KoreaderCatalogRelatedSectionId = "series" | "author" | "similar";

export interface KoreaderCatalogRelatedBook {
  id: number;
  title: string | null;
  authors: string[];
  seriesIndex: SeriesIndex | null;
  hasCover: boolean;
  thumbnailUrl: string | null;
  detailUrl: string;
  updatedAt: string | null;
  isAudiobook?: boolean;
  isComic?: boolean;
}

/** One book of the series, for the detail page's series path. */
export interface KoreaderCatalogSeriesMember {
  id: number;
  title: string | null;
  seriesIndex: SeriesIndex | null;
  readStatus: string | null;
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
  /**
   * Every book of the series the reader can see, this one included, with its
   * read status. The series related section stays capped for its covers; this
   * list is not. Absent from servers that predate it.
   */
  seriesMembers?: KoreaderCatalogSeriesMember[];
}

export interface KoreaderCatalogPage<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  // The first item's position, echoed when the request paged by offset.
  offset?: number;
  hasNext: boolean;
  hasPrevious: boolean;
  nextUrl: string | null;
  previousUrl: string | null;
  // Present when the page is scoped to a single series, summarising
  // read-through progress across the whole series.
  seriesSummary?: KoreaderCatalogSeriesSummary | null;
  // Sent only for `buckets=1` on a title or author sort.
  buckets?: KoreaderCatalogJumpBucket[];
  // Present when the page is filtered by author; null when no visible author has that name.
  authorSummary?: KoreaderCatalogAuthorSummary | null;
}

export interface KoreaderCatalogSectionResponse {
  section: KoreaderCatalogSection;
  items: KoreaderCatalogEntry[];
  // Pagination is only emitted for large sections (authors, series).
  page?: number;
  // The first entry's position, echoed when the request paged by offset.
  offset?: number;
  hasNext?: boolean;
  hasPrevious?: boolean;
  nextUrl?: string | null;
  previousUrl?: string | null;
  query?: string | null;
  total?: number;
  size?: number;
  // Sent for the name sorts only; the count sort has no letter order to jump through.
  buckets?: KoreaderCatalogJumpBucket[];
  sort?: KoreaderCatalogSectionSort;
  filter?: KoreaderCatalogSectionFilter | null;
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

// Totals behind the dashboard's Browse tiles. Optional so a plugin reading an
// older server simply renders the tiles without badges. There is deliberately
// no not-on-device total: which books are on a device is local KOReader state
// the server never sees.
export interface KoreaderCatalogBrowseCounts {
  inProgress: number;
  libraries: number;
  authors: number;
  series: number;
  collections: number;
  smartScopes: number;
}

// Minutes read per local day in the reader's time zone, oldest first and
// ending today. Feeds the KOReader dashboard's year heatmap and week chart.
export interface KoreaderReadingYear {
  startDate: string;
  minutes: number[];
}

// The book read most in the four weeks around this day a year ago.
export interface KoreaderYearAgo {
  book: KoreaderCatalogBookListItem;
  minutes: number;
  days: number;
  endProgress: number | null;
  firstDay: string;
  lastDay: string;
}

// One badge as the device board's Next badge widget draws it. groupKey names a
// tiered family (hours_read, pages_read, books_finished, ...) so a client can
// tell what the progress counts; it is null for one-off badges.
export interface KoreaderAchievementBadge {
  key: string;
  groupKey: string | null;
  name: string;
  description: string;
  rarity: AchievementRarity;
  iconName: string;
  threshold: number | null;
  currentProgress: number | null;
  awardedAt: string | null;
}

// The reader's badges at a glance: how many are earned, the unearned badge
// with the most progress, and the badge earned most recently.
export interface KoreaderAchievementSummary {
  earned: number;
  total: number;
  next: KoreaderAchievementBadge | null;
  latest: KoreaderAchievementBadge | null;
}

export interface KoreaderCatalogDashboardResponse {
  generatedAt: string;
  username: string;
  displayName: string;
  totalBooks: number;
  browseCounts?: KoreaderCatalogBrowseCounts;
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
  // Optional so plugins and servers predating them keep working.
  readingYear?: KoreaderReadingYear;
  yearAgo?: KoreaderYearAgo | null;
  // Books finished this local year, most recently finished first.
  finishedThisYear?: KoreaderCatalogBookListItem[];
  // Null when the reader has turned achievements off.
  achievements?: KoreaderAchievementSummary | null;
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
  selection?: string;
  delivery?: DeliveryArtifactMetadata;
  requestedVariant?: "original" | "audioless_epub";
  sourceMediaOverlayAvailable?: boolean;
  narrationPlaybackAvailable?: boolean;
  id: number;
  format: string;
  downloadVariant: "original" | "audioless_epub";
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
  seriesIndex: SeriesIndex | null;
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

export type KoreaderPluginCapability =
  | "catalogBulkManifest"
  | "catalogDashboardSections"
  | "bookmarkSync"
  | "readAloudDeliveryVariants"
  | "readAloudDeliverySettings"
  | "catalogListsV2"
  | "catalogPublishedSort"
  | "sidecarState"
  | "annotationPendingBooks";

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

export interface KoreaderDeliverySettings {
  readAloudDelivery: ReadAloudDeliveryVariant;
  credentialDefault: ReadAloudDeliveryPreference;
  deviceOverride: ReadAloudDeliveryPreference;
  deviceConfigured: boolean;
}

export interface UpdateKoreaderDeliverySettingsPayload {
  readAloudDelivery: ReadAloudDeliveryPreference;
}
