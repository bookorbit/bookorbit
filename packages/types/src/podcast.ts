/**
 * Where a show and its episodes came from. `feed` is a subscribed RSS feed and is refreshable;
 * `local` is content that only exists as files in the library folder, so it never refreshes, never
 * proxies a remote enclosure, and is never evicted to free space - deleting its file is data loss.
 *
 * There is deliberately no way to convert a local show into a feed show. If the feed turns up
 * later, subscribe to it as a new show and merge the local one into it: merge already moves
 * episodes, progress, bookmarks, and queue entries, and the two identity spaces cannot collide, so
 * the episodes the feed republishes and the files already on disk end up under one show.
 */
export type PodcastOrigin = "feed" | "local";

/**
 * Stable `errorCode` values on the responses that refuse a podcast operation. Client copy is keyed
 * off these, never off the server's English message.
 */
export const PODCAST_ERROR_CODES = {
  /** A local show has no feed to refresh or reparse. */
  localNoRefresh: "PODCAST_LOCAL_NO_REFRESH",
  /** A local episode has no enclosure to download; its file is already the only copy. */
  localNoDownload: "PODCAST_LOCAL_NO_DOWNLOAD",
  /** A local episode's file belongs to the user, so BookOrbit will not delete it on their behalf. */
  localFileNotRemovable: "PODCAST_LOCAL_FILE_NOT_REMOVABLE",
  /** A local episode's only copy is gone from disk. The media row is now `unavailable`. */
  localMediaMissing: "PODCAST_LOCAL_MEDIA_MISSING",
  /** A folder cannot become a local show because it holds no importable audio. */
  localFolderEmpty: "PODCAST_LOCAL_FOLDER_EMPTY",
  /** Retention could not free enough room, usually because local-origin files cannot be evicted. */
  storageFull: "PODCAST_STORAGE_FULL",
  /**
   * This library already holds the feed being added or previewed. The response carries
   * `podcastId`, so a client can offer to open the existing show instead of recovering its identity
   * from the message text.
   */
  duplicateFeed: "PODCAST_DUPLICATE_FEED",
} as const;

export type PodcastErrorCode = (typeof PODCAST_ERROR_CODES)[keyof typeof PODCAST_ERROR_CODES];

export type PodcastAcquisitionPolicy = "remote_only" | "manual" | "newest" | "window";
/**
 * What happens to a downloaded file once everyone who listened to the episode has finished it.
 * `keep` leaves eviction entirely to storage pressure, which is the behaviour every existing show has.
 */
export type PodcastDownloadCleanup = "keep" | "after_finished";
export type PodcastMediaStatus = "remote" | "queued" | "downloading" | "local" | "failed" | "unavailable";
export type PodcastEpisodeFilter = "latest" | "downloaded" | "in_progress" | "unplayed" | "finished" | "pinned";
export type PodcastEpisodeSort = "newest" | "oldest" | "shortest" | "longest" | "recently_listened";
/** Sort stored in a smart playlist's rules. Identical to the sorts every episode surface accepts. */
export type PodcastPlaylistSort = PodcastEpisodeSort;
export type PodcastSort = "title" | "recent" | "unplayed";
export const PODCAST_NOTIFICATION_MODES = ["off", "immediate", "daily", "weekly"] as const;

export type PodcastNotificationMode = (typeof PODCAST_NOTIFICATION_MODES)[number];
export type PodcastQueuePlacement = "end" | "next";

export interface PodcastPlaybackPreferences {
  defaultPlaybackRate: number;
  volume: number;
  skipBackwardSeconds: number;
  skipForwardSeconds: number;
  podcastPlaybackRates: Record<string, number>;
}

export interface PodcastChapter {
  title: string;
  startSeconds: number;
  endSeconds?: number;
  url?: string;
}

export interface PodcastTranscriptRef {
  url: string;
  type?: string;
  language?: string;
  rel?: string;
}

export interface PodcastPlaybackRecommendation {
  episodeId: number;
  title: string;
  positionSeconds: number;
  durationSeconds: number | null;
  kind: "resume" | "latest";
}

/**
 * Show fields a user can pin against feed refreshes. Shared by the server DTO validation and the
 * client editor so both agree on which names the lock set may contain.
 */
export const PODCAST_LOCKED_FIELDS = [
  "title",
  "author",
  "description",
  "imageUrl",
  "siteUrl",
  "language",
  "podcastType",
  "explicit",
  "categories",
] as const;

export type PodcastLockedField = (typeof PODCAST_LOCKED_FIELDS)[number];

/** Show fields the metadata endpoint accepts. `podcastType` stays feed-owned and is lockable only. */
export const PODCAST_EDITABLE_FIELDS = ["title", "author", "description", "siteUrl", "language", "explicit", "categories"] as const;

export type PodcastEditableField = (typeof PODCAST_EDITABLE_FIELDS)[number];

export const PODCAST_MAX_CATEGORIES = 100;

/**
 * Episode fields a user can pin against feed refreshes. Exactly the fields the refresh upsert
 * guards per lock; `guid`, the enclosure fields and `transcripts` are identity and delivery data
 * that always take the feed value, so they are absent here on purpose.
 */
export const PODCAST_EPISODE_LOCKED_FIELDS = [
  "title",
  "subtitle",
  "description",
  "publishedAt",
  "season",
  "episode",
  "episodeType",
  "durationSeconds",
  "explicit",
  "chapters",
] as const;

export type PodcastEpisodeLockedField = (typeof PODCAST_EPISODE_LOCKED_FIELDS)[number];

/** The iTunes episode types. A feed may publish anything, but an edit has to pick one of these or clear the field. */
export const PODCAST_EPISODE_TYPES = ["full", "trailer", "bonus"] as const;

export type PodcastEpisodeType = (typeof PODCAST_EPISODE_TYPES)[number];

/** One year, the same ceiling the feed parser applies to a published duration. */
export const PODCAST_EPISODE_MAX_DURATION_SECONDS = 31_536_000;
export const PODCAST_EPISODE_MAX_CHAPTERS = 1000;

/**
 * Sparse update body for `PATCH /podcast-episodes/:episodeId/metadata`. Same lock-on-edit contract
 * as the show endpoint: the server stores `normalize(lockedFields ?? current) ∪ editedFields`, so
 * unlocking a field means sending `lockedFields` without it and without sending the field value.
 */
export interface PodcastEpisodeMetadataUpdateRequest {
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  publishedAt?: string | null;
  season?: string | null;
  episode?: string | null;
  episodeType?: PodcastEpisodeType | null;
  durationSeconds?: number | null;
  explicit?: boolean;
  chapters?: PodcastChapter[];
  lockedFields?: PodcastEpisodeLockedField[];
}

/**
 * Sparse update body for `PATCH /podcasts/:podcastId/metadata`. Only the properties present are
 * written, and every written property is added to the stored lock set, because an unlocked value
 * is overwritten by the next feed refresh. `lockedFields` is the authoritative final set *before*
 * that union: the server stores `normalize(lockedFields ?? current) ∪ editedFields`. To unlock a
 * field, send `lockedFields` without it and without sending the field value; the next refresh then
 * restores whatever the feed publishes.
 */
export interface PodcastMetadataUpdateRequest {
  title?: string;
  author?: string | null;
  description?: string | null;
  siteUrl?: string | null;
  language?: string | null;
  explicit?: boolean;
  categories?: string[];
  lockedFields?: PodcastLockedField[];
}

export interface PodcastMetadataUpdateResult {
  id: number;
  title: string;
  author: string | null;
  description: string | null;
  siteUrl: string | null;
  language: string | null;
  explicit: boolean;
  categories: string[];
  lockedFields: string[];
}

/** Result of every custom-artwork write. `imageUrl` already carries the cache-busting version. */
export interface PodcastArtworkResult {
  id: number;
  imageUrl: string | null;
  artworkUpdatedAt: string | null;
}

export interface PodcastSummary {
  id: number;
  libraryId: number;
  origin: PodcastOrigin;
  title: string;
  author: string | null;
  description: string | null;
  imageUrl: string | null;
  siteUrl: string | null;
  language: string | null;
  podcastType: string | null;
  explicit: boolean;
  categories: string[];
  acquisitionPolicy: PodcastAcquisitionPolicy;
  autoDownloadLimit: number | null;
  autoDownloadWindowDays: number | null;
  refreshIntervalMinutes: number;
  downloadCleanup: PodcastDownloadCleanup;
  /** How long after the last listener finished an episode its file survives. Ignored while cleanup is `keep`. */
  downloadCleanupDelayHours: number;
  /**
   * Metadata fields pinned against feed refreshes. Exposed on the summary so a client editing
   * metadata can show which fields are already locked instead of having to write one to find out.
   */
  lockedFields: string[];
  /**
   * When custom artwork was last uploaded, or null while the show still shows feed artwork. Also
   * the cache-busting token already baked into `imageUrl`, so a client can tell the two apart
   * without another request.
   */
  artworkUpdatedAt: string | null;
  episodeCount: number;
  unplayedCount: number;
  downloadedCount: number;
  playbackRecommendation: PodcastPlaybackRecommendation | null;
  followed: boolean;
  notificationMode: PodcastNotificationMode;
  archivedAt: string | null;
  /**
   * When a local show's folder was found gone from disk, or null while it is there. The show and its
   * episodes are kept either way, so this clears on its own once the folder comes back.
   */
  missingAt: string | null;
  lastRefreshAt: string | null;
  lastRefreshSuccessAt: string | null;
  /**
   * When the server last stored a copy of the feed body, or null while no copy exists. A show with
   * a stored copy can be reparsed without another request to the feed.
   */
  feedSnapshotAt: string | null;
  consecutiveFailures: number;
  nextRefreshAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PodcastListItem {
  id: number;
  libraryId: number;
  origin: PodcastOrigin;
  title: string;
  author: string | null;
  imageUrl: string | null;
  episodeCount: number;
  unplayedCount: number;
  downloadedCount: number;
  latestPublishedAt: string | null;
  consecutiveFailures: number;
  playbackRecommendation: PodcastPlaybackRecommendation | null;
  followed: boolean;
  notificationMode: PodcastNotificationMode;
  archivedAt: string | null;
  /** Set while a local show's folder is gone from disk. See `PodcastSummary.missingAt`. */
  missingAt: string | null;
}

export interface PodcastEpisodeSummary {
  id: number;
  libraryId: number;
  podcastId: number;
  origin: PodcastOrigin;
  podcastTitle: string;
  podcastImageUrl: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  publishedAt: string | null;
  season: string | null;
  episode: string | null;
  episodeType: string | null;
  durationSeconds: number | null;
  audioFormat: string | null;
  explicit: boolean;
  chapters: PodcastChapter[];
  transcripts: PodcastTranscriptRef[];
  /**
   * Metadata fields pinned against feed refreshes. Exposed on the summary so a client editing an
   * episode can show which fields are already locked instead of having to write one to find out.
   */
  lockedFields: string[];
  inFeed: boolean;
  mediaStatus: PodcastMediaStatus;
  localSizeBytes: number | null;
  /**
   * sha256 hex of the server's cached copy, non-null only while `mediaStatus` is `local`.
   * Clients that download an episode to a device verify the transfer against it; an
   * origin-proxied episode has no cached copy to hash, so the field stays null.
   */
  checksum: string | null;
  positionSeconds: number;
  progressPercent: number;
  finished: boolean;
  pinned: boolean;
  queued: boolean;
  lastListenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodcastEpisodeListItem {
  id: number;
  libraryId: number;
  podcastId: number;
  origin: PodcastOrigin;
  podcastTitle: string;
  podcastImageUrl: string | null;
  title: string;
  season: string | null;
  episode: string | null;
  explicit: boolean;
  inFeed: boolean;
  publishedAt: string | null;
  durationSeconds: number | null;
  /**
   * The audio container, resolved the same way `PodcastEpisodeSummary.audioFormat` resolves it,
   * minus the decrypt-the-enclosure-URL fallback that is too costly per page. Present because a
   * client that downloads straight from a list row has nothing else to name the file from, and
   * `AVURLAsset` on iOS decides a local file's type from its path extension: without this an m4a
   * episode was saved as `.mp3` and would not decode offline.
   */
  audioFormat: string | null;
  mediaStatus: PodcastMediaStatus;
  localSizeBytes: number | null;
  /**
   * sha256 of the server's cached copy, non-null only while `mediaStatus === 'local'`. The same
   * field `PodcastEpisodeSummary` carries, and it is here for the same reason `audioFormat` is: a
   * client that downloads straight from a list row has nothing else to verify the bytes against.
   *
   * Without it an iOS download started from a show's episode list carried no checksum at all, so
   * the exact comparison the server-cached path is built around never ran and a substituted body
   * was admitted by a signature sniff. Costs nothing to send: the media row is already joined for
   * `mediaStatus` and `localSizeBytes`.
   */
  checksum: string | null;
  positionSeconds: number;
  progressPercent: number;
  finished: boolean;
  pinned: boolean;
  queued: boolean;
  lastListenedAt: string | null;
}

export interface PodcastPage<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

export interface PodcastEpisodePage extends PodcastPage<PodcastEpisodeListItem> {
  totalDurationSeconds: number;
}

/** Rules a smart playlist evaluates against existing episode state. All fields narrow the match. */
export interface PodcastPlaylistRules {
  filter: PodcastEpisodeFilter;
  sort: PodcastPlaylistSort;
  maxDurationMinutes: number | null;
  minDurationMinutes: number | null;
  publishedWithinDays: number | null;
  podcastIds: number[];
  followedOnly: boolean;
}

/**
 * Podcast smart scopes persist exactly these rules, so the saved playlists that predate them
 * migrate without transformation. Kept as an alias rather than a copy so the editor, the query
 * builder, and the scope row can never drift apart.
 */
export type PodcastScopeRules = PodcastPlaylistRules;

export interface PodcastPlaylist {
  id: string;
  name: string;
  libraryId: number;
  rules: PodcastPlaylistRules;
}

export interface PodcastPlaylistPreferences {
  playlists: PodcastPlaylist[];
}

export const PODCAST_PLAYLIST_QUEUE_LIMIT = 100;
export const PODCAST_PLAYLIST_MAX_SHOWS = 50;
export const PODCAST_PLAYLIST_MAX_SAVED = 50;
/** A day is the longest episode worth expressing, and ten years the longest publication window. */
export const PODCAST_PLAYLIST_MAX_DURATION_MINUTES = 1_440;
export const PODCAST_PLAYLIST_MAX_PUBLISHED_WITHIN_DAYS = 3_650;
export const PODCAST_STATE_BATCH_LIMIT = 200;
export const PODCAST_DIRECTORY_SEARCH_MAX_RESULTS = 50;
export const PODCAST_DIRECTORY_SEARCH_MAX_QUERY = 200;

/**
 * One show from the public podcast directory, proxied by the server so no client needs a
 * directory credential or its own egress path. `feedUrl` is what the add-feed flow hands to
 * feed preview; `artworkUrl` points at the directory's own CDN rather than at BookOrbit,
 * because a show that is not in the library yet has no artwork endpoint to serve.
 */
export interface PodcastDirectoryResult {
  title: string;
  author: string | null;
  feedUrl: string;
  artworkUrl: string | null;
  genre: string | null;
  /**
   * The show this feed already resolves to in a library the caller can see, or null. Annotated per
   * request rather than cached with the directory row, because it differs by caller. The directory
   * publishes a show's origin feed, so a show followed through a redirect only matches once
   * BookOrbit has recorded the origin as an alias: a miss here is possible, a false hit is not.
   */
  existingPodcastId: number | null;
  existingLibraryId: number | null;
}

export interface PodcastFeedPreview {
  feedUrl: string;
  title: string;
  author: string | null;
  description: string | null;
  imageUrl: string | null;
  language: string | null;
  podcastType: string | null;
  explicit: boolean;
  categories: string[];
  episodeCount: number;
}

/**
 * `POST /podcast-libraries/:libraryId/podcasts`, for both sources. The show row exists as soon as
 * this returns; its episodes do not.
 *
 * A feed's episodes arrive on the first refresh, so `jobId` is null and `created` is always true.
 * A folder's episodes arrive with the import job named by `jobId`, and `created` is false when the
 * folder already was a local show and this run only adopts files that appeared since.
 */
export interface PodcastCreateResult {
  id: number;
  title: string;
  created: boolean;
  jobId: number | null;
}

/** Which way content enters a podcast library: subscribed from an address, or adopted from disk. */
export const PODCAST_CREATE_SOURCES = ["feed", "folder"] as const;

export type PodcastCreateSource = (typeof PODCAST_CREATE_SOURCES)[number];

/** `POST /podcasts/:podcastId/archive` and `/restore`. `archivedAt` is null once restored. */
export interface PodcastArchiveResult {
  id: number;
  archivedAt: string | null;
}

/**
 * `GET /podcasts/:podcastId/purge-preview`: what a permanent delete would remove from disk, so the
 * confirmation can name it before anything is destroyed. Counts cached media only; a show whose
 * episodes all stream has zero of both.
 */
export interface PodcastPurgePreview {
  files: number;
  bytes: number;
}

/** How many shows one bulk delete may name. Keeps a runaway selection from queueing unbounded work. */
export const PODCAST_BULK_DELETE_MAX_SHOWS = 200;

/**
 * `POST /podcast-libraries/:libraryId/shows/bulk-purge-preview`: the same accounting as
 * `PodcastPurgePreview` summed over a selection, plus how many of the named shows actually resolved.
 * The confirmation escalates to typed input only when `bytes` is above zero.
 */
export interface PodcastBulkPurgePreview extends PodcastPurgePreview {
  shows: number;
}

/**
 * `POST /podcast-libraries/:libraryId/opml/import`. `total` is how many subscriptions the file
 * held, `queued` how many became jobs: the difference is feeds the library already follows, which
 * are deduplicated rather than reported as failures.
 */
export interface PodcastOpmlImportResult {
  total: number;
  queued: number;
}

/** `POST /podcasts/:podcastId/follow`: the stored follow row. */
export interface PodcastFollowState {
  userId: number;
  podcastId: number;
  notificationMode: PodcastNotificationMode;
  lastNotifiedAt: string;
  createdAt: string;
}

export interface PodcastLibrarySettings {
  libraryId: number;
  storageQuotaBytes: string;
  minimumFreeSpaceBytes: string;
  defaultRefreshIntervalMinutes: number;
  completionRemainingSeconds: number;
  usedStorageBytes: string;
}

export interface PodcastQueueItem extends PodcastEpisodeListItem {
  queuePosition: number;
}

export interface PodcastQueuePage extends PodcastPage<PodcastQueueItem> {
  totalDurationSeconds: number;
}

/** Result of a queue clear. `previousEpisodeIds` is the pre-clear order, so an undo can restore it in one request. */
export interface PodcastQueueClearResult {
  removed: number;
  previousEpisodeIds: number[];
}

export interface PodcastQueueRestoreResult {
  restored: number;
}

/**
 * Body of `PATCH /podcast-queue/move`. `position` is a 0-based target index the server clamps to
 * the queue length. The single-row form carries no membership snapshot, so it cannot lose a race
 * against a concurrent edit the way the full-set reorder can.
 */
export interface PodcastQueueMoveRequest {
  episodeId: number;
  position: number;
}

export interface PodcastPlaybackContext {
  episode: PodcastEpisodeSummary;
  queue: {
    position: number | null;
    total: number;
    previous: PodcastQueueItem | null;
    upcoming: PodcastQueueItem[];
  };
  navigation: {
    source: "queue" | "podcast" | null;
    previous: PodcastEpisodeListItem | null;
    next: PodcastEpisodeListItem | null;
  };
}

/** Short-lived, single-episode grant that lets a player load `/stream?ticket=` without an auth header. */
export interface PodcastStreamTicket {
  ticket: string;
  expiresAt: string;
}

/** Per-user episode state as stored, returned by the state PATCH and the batch state read. */
export interface PodcastEpisodeStateRow {
  episodeId: number;
  positionSeconds: number;
  progressPercent: number;
  finished: boolean;
  finishedAt: string | null;
  pinned: boolean;
  lastListenedAt: string | null;
  updatedAt: string;
}

export interface PodcastBookmark {
  id: number;
  episodeId: number;
  positionSeconds: number;
  title: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PodcastJobStatus {
  queued: number;
  processing: number;
  failed: number;
}

export interface PodcastDownloadProgressEvent {
  libraryId: number;
  podcastId: number;
  episodeId: number;
  batchId: string | null;
  status: Extract<PodcastMediaStatus, "queued" | "downloading">;
  receivedBytes: number;
  totalBytes: number | null;
}

export interface PodcastDownloadCompleteEvent {
  libraryId: number;
  podcastId: number;
  episodeId: number;
  batchId: string | null;
  jobStatus: "queued" | "completed" | "failed" | "cancelled" | null;
  mediaStatus: PodcastMediaStatus;
  localSizeBytes: number | null;
}

export interface PodcastRefreshCompleteEvent {
  libraryId: number;
  podcastId: number;
  newEpisodes: number;
  consecutiveFailures: number;
  lastError: string | null;
}

/**
 * Progress for either import lane. `kind` exists because both lanes share one channel and a
 * client showing OPML progress must not count local-file scans, or the other way round.
 *
 * The job counts say how much work is outstanding; `processed` and `total` say how far the work
 * being done right now has got, so a bar can move rather than only a count changing. `total` is
 * null until the run has counted what it is about to do, which is a real state a UI has to render.
 */
export interface PodcastImportProgressEvent extends PodcastJobStatus {
  libraryId: number;
  kind: PodcastImportKind;
  processed: number;
  total: number | null;
}

export type PodcastImportKind = "opml" | "local_files";

/**
 * A show an import just brought into the library, announced as it happens so a long run fills the
 * grid rather than leaving it empty until the end. `episodes` is the count at the moment of the
 * event, so it climbs across several events for the same show while its files are still arriving.
 */
export interface PodcastShowDiscoveredEvent {
  libraryId: number;
  podcastId: number;
  title: string;
  episodes: number;
  /** False when the show already existed and this run only added newly seen files to it. */
  created: boolean;
}

/**
 * A downloaded file the server removed on its own. `space` is quota or free-space pressure,
 * `played` is the per-show cleanup rule firing after every listener finished the episode.
 */
export interface PodcastRetentionEvictedEvent {
  libraryId: number;
  podcastId: number;
  episodeId: number;
  reason: "space" | "played";
}

export interface PodcastBulkActionResult {
  completed: number;
  failed: number;
  skipped: number;
  firstEpisodeId?: number;
}

export interface PodcastBulkDownloadResult extends PodcastBulkActionResult {
  batchId: string | null;
}

export type PodcastDownloadBatchItemStatus = "queued" | "downloading" | "completed" | "failed" | "cancelled";

export interface PodcastDownloadBatchItem {
  episodeId: number | null;
  title: string | null;
  status: PodcastDownloadBatchItemStatus;
  receivedBytes: number;
  totalBytes: number | null;
}

export interface PodcastDownloadBatch {
  id: string;
  libraryId: number;
  podcastId: number | null;
  podcastTitle: string | null;
  total: number;
  queued: number;
  downloading: number;
  completed: number;
  failed: number;
  cancelled: number;
  receivedBytes: number;
  totalBytes: number | null;
  createdAt: string;
  updatedAt: string;
  items: PodcastDownloadBatchItem[];
}

/**
 * Local-file import. A file already inside the library folder is matched against the episodes a
 * subscribed feed already published, then adopted in place: nothing is copied, renamed, or moved,
 * and an episode row's identity still comes from its feed.
 */

/** Evidence that tied a file to an episode, strongest first. */
export type PodcastImportSignal = "episode_guid" | "episode_id_suffix" | "enclosure_file_name" | "title_and_date" | "title_and_duration" | "manual";

/** `exact` signals adopt on their own; `fuzzy` ones need a second agreeing signal. */
export type PodcastImportMatchTier = "exact" | "fuzzy";

/** How the file's show was resolved, before any episode was looked at. */
export type PodcastImportScope =
  | "request"
  | "folder_suffix"
  | "feed_url_tag"
  | "feed_sidecar"
  /** Weak: narrows which shows are searched, never enough to adopt on its own. */
  | "title_similarity"
  /** No show resolved, so only the library-wide exact signals were tried. */
  | "library";

/** Why a file was not adopted. Stable codes; the client owns the wording. */
export type PodcastImportSkipReason =
  | "show_unresolved"
  | "no_episode_candidate"
  | "single_fuzzy_signal"
  | "multiple_candidates"
  | "empty_file"
  | "unsupported_format"
  | "symlink"
  | "unreadable"
  | "outside_library_root"
  | "attach_conflict";

export type PodcastImportSuggestionSource = "feed_sidecar" | "metadata_json" | "feed_url_tag";

/** One of the episodes an ambiguous file could belong to, for the review UI's picker. */
export interface PodcastImportEpisodeCandidate {
  episodeId: number;
  podcastId: number;
  podcastTitle: string;
  episodeTitle: string;
  publishedAt: string | null;
  durationSeconds: number | null;
  signals: PodcastImportSignal[];
}

export interface PodcastImportFile {
  /** Path relative to the library folder. Absolute paths stay server-side. */
  path: string;
  fileName: string;
  sizeBytes: number;
}

export interface PodcastImportMatchedFile extends PodcastImportFile {
  episodeId: number;
  podcastId: number;
  podcastTitle: string;
  episodeTitle: string;
  tier: PodcastImportMatchTier;
  signals: PodcastImportSignal[];
  scope: PodcastImportScope;
  /** False during a dry run, and false when the apply pass lost a race for the episode. */
  attached: boolean;
}

export interface PodcastImportAmbiguousFile extends PodcastImportFile {
  scope: PodcastImportScope;
  reason: Extract<PodcastImportSkipReason, "single_fuzzy_signal" | "multiple_candidates">;
  candidates: PodcastImportEpisodeCandidate[];
}

export interface PodcastImportUnmatchedFile extends PodcastImportFile {
  reason: PodcastImportSkipReason;
  /** Set when the show resolved but no episode did, which is the more actionable half of a miss. */
  podcastId: number | null;
  podcastTitle: string | null;
}

export interface PodcastImportDuplicateFile extends PodcastImportFile {
  episodeId: number;
  podcastId: number;
  episodeTitle: string;
  /** True when the already-adopted copy's bytes differ, which usually means a re-edit or re-encode. */
  contentDiffers: boolean;
}

/** A folder holding audio that belongs to no subscribed show, but that names a feed BookOrbit could follow. */
export interface PodcastImportSuggestedFeed {
  folderPath: string;
  feedUrl: string;
  source: PodcastImportSuggestionSource;
  fileCount: number;
}

/**
 * A folder holding audio that belongs to no show and names no feed. Nothing can be adopted into it,
 * so the only way to make it playable is to turn it into a local show. The suggested fields are the
 * preview of what creating one would produce.
 */
export interface PodcastImportUnclaimedFolder {
  folderPath: string;
  suggestedTitle: string;
  suggestedAuthor: string | null;
  fileCount: number;
  /** Set when this folder is already a local show, so re-importing adds its new files instead of creating one. */
  existingPodcastId: number | null;
}

export interface PodcastImportSkippedFile {
  path: string;
  reason: PodcastImportSkipReason;
}

/** Adoption counts toward the library quota exactly like a download, so an apply that would exceed it is refused. */
export interface PodcastImportQuota {
  adoptBytes: string;
  headroomBytes: string;
  exceeded: boolean;
}

export interface PodcastImportCounts {
  matched: number;
  ambiguous: number;
  unmatched: number;
  duplicates: number;
  skipped: number;
  suggestedFeeds: number;
  unclaimedFolders: number;
}

/** How many entries each report group carries. The counts stay exact once a group is capped. */
export const PODCAST_IMPORT_REPORT_GROUP_LIMIT = 500;
export const PODCAST_IMPORT_MAX_RESOLUTIONS = 500;

export interface PodcastImportReport {
  libraryId: number;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  filesDiscovered: number;
  filesScanned: number;
  /** Candidates whose path a media row already claims, so the walk skipped them before any probing. */
  alreadyAdopted: number;
  attached: number;
  counts: PodcastImportCounts;
  matched: PodcastImportMatchedFile[];
  ambiguous: PodcastImportAmbiguousFile[];
  unmatched: PodcastImportUnmatchedFile[];
  duplicates: PodcastImportDuplicateFile[];
  suggestedFeeds: PodcastImportSuggestedFeed[];
  unclaimedFolders: PodcastImportUnclaimedFolder[];
  skipped: PodcastImportSkippedFile[];
  /** Folders the walk could not read, relative to the library folder. */
  unreadableFolders: string[];
  quota: PodcastImportQuota;
  /** Set when the apply pass refused to write anything. */
  blockedReason: "quota_exceeded" | null;
  /** True when at least one group holds fewer entries than its count. */
  truncated: boolean;
}

/** One review-UI decision: adopt this file as this episode, overriding whatever the matcher concluded. */
export interface PodcastImportResolution {
  path: string;
  episodeId: number;
}

export interface PodcastImportScanRequest {
  dryRun: boolean;
  podcastId?: number;
  resolutions?: PodcastImportResolution[];
}

export interface PodcastImportScanJob {
  id: number;
  status: string;
  dryRun: boolean;
  progressCurrent: number;
  progressTotal: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Body of `DELETE /podcast-episodes/:episodeId/download`, which drops a feed episode's cached copy
 * and returns it to `remote`. A local episode is refused with `PODCAST_LOCAL_FILE_NOT_REMOVABLE`:
 * that file is the user's own, not a cache. The episode row survives either way, so metadata,
 * progress, and bookmarks are never what this endpoint removes.
 */
export type PodcastRemoveDownloadRequest = Record<string, never>;

/** `GET /podcast-libraries/:libraryId/import-scan/latest`. Both halves are null before a first run. */
export interface PodcastImportScanStatus {
  job: PodcastImportScanJob | null;
  report: PodcastImportReport | null;
}

/**
 * `GET /podcast-libraries/:libraryId/jobs/:jobId`: the state of one queued job.
 *
 * The summary below counts everything in the library, which is the right answer for a status strip
 * and the wrong one for a client waiting on the job it just started: any unrelated refresh or cache
 * batch kept an OPML import's progress readout claiming it was still running. An enqueueing route
 * already returns a `jobId`; this is how that id is asked about.
 */
export interface PodcastJobState {
  id: number;
  type: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  /** Set when the job finished by failing. Written for a person, not parsed by clients. */
  lastError: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
}

/** `GET /podcast-libraries/:libraryId/jobs`: outstanding background work for the library. */
export interface PodcastJobSummary {
  queued: number;
  processing: number;
  failed: number;
}

/**
 * `GET /podcast-libraries/:libraryId/activity`. One cheap poll answering "what is this library
 * doing right now", deliberately counters only.
 *
 * The detail each counter summarises stays on its own endpoint and is fetched when a user actually
 * opens it: the import report from `import-scan/latest`, per-episode batch rows from
 * `podcast-download-batches`, per-feed errors from `health`. Folding those payloads in here would
 * make the polled response grow with the size of the library, which is the thing polling must not do.
 */
export interface PodcastLibraryActivity {
  jobs: PodcastJobSummary;
  importScan: PodcastImportScanJob | null;
  downloads: { batches: number; queued: number; downloading: number; failed: number };
  failingFeeds: number;
}

/**
 * How many local shows an OPML export left out. OPML carries one `xmlUrl` per show and a local show
 * has none, so the count travels in a response header rather than silently disappearing.
 */
export const PODCAST_OPML_OMITTED_HEADER = "x-podcast-local-shows-omitted";

export interface PodcastFeedHealth {
  podcastId: number;
  title: string;
  lastRefreshAt: string | null;
  lastRefreshSuccessAt: string | null;
  consecutiveFailures: number;
  nextRefreshAt: string;
  lastError: string | null;
  lastHttpStatus: number | null;
}
