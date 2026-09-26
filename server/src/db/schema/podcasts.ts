import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import type {
  PodcastAcquisitionPolicy,
  PodcastChapter,
  PodcastDownloadCleanup,
  PodcastNotificationMode,
  PodcastOrigin,
  PodcastTranscriptRef,
} from '@bookorbit/types';
import { users } from './auth';
import { libraries } from './libraries';

export const podcastLibrarySettings = pgTable(
  'podcast_library_settings',
  {
    libraryId: integer('library_id')
      .primaryKey()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'bigint' })
      .notNull()
      .default(sql`107374182400`),
    minimumFreeSpaceBytes: bigint('minimum_free_space_bytes', { mode: 'bigint' })
      .notNull()
      .default(sql`5368709120`),
    defaultRefreshIntervalMinutes: integer('default_refresh_interval_minutes').notNull().default(60),
    completionRemainingSeconds: integer('completion_remaining_seconds').notNull().default(60),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    check('podcast_library_storage_quota_nonnegative_chk', sql`${t.storageQuotaBytes} >= 0`),
    check('podcast_library_free_space_nonnegative_chk', sql`${t.minimumFreeSpaceBytes} >= 0`),
    check('podcast_library_refresh_positive_chk', sql`${t.defaultRefreshIntervalMinutes} > 0`),
    check('podcast_library_completion_nonnegative_chk', sql`${t.completionRemainingSeconds} >= 0`),
  ],
);

export const podcasts = pgTable(
  'podcasts',
  {
    id: serial('id').primaryKey(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 1000 }).notNull(),
    author: varchar('author', { length: 1000 }),
    description: text('description'),
    /** Where the show came from. A `local` show has no feed, so nothing about it is ever refreshed. */
    origin: varchar('origin', { length: 10 }).$type<PodcastOrigin>().notNull().default('feed'),
    feedUrlEncrypted: text('feed_url_encrypted'),
    feedUrlHash: varchar('feed_url_hash', { length: 64 }),
    /** Absolute folder a local show was built from, and the key a re-import resolves it by. Null for feed shows. */
    localFolderPath: varchar('local_folder_path', { length: 4096 }),
    imageUrlEncrypted: text('image_url_encrypted'),
    siteUrl: text('site_url'),
    language: varchar('language', { length: 100 }),
    podcastType: varchar('podcast_type', { length: 50 }),
    explicit: boolean('explicit').notNull().default(false),
    categories: jsonb('categories').$type<string[]>().notNull().default([]),
    acquisitionPolicy: varchar('acquisition_policy', { length: 20 }).$type<PodcastAcquisitionPolicy>().notNull().default('remote_only'),
    autoDownloadLimit: integer('auto_download_limit'),
    autoDownloadWindowDays: integer('auto_download_window_days'),
    downloadCleanup: varchar('download_cleanup', { length: 20 }).$type<PodcastDownloadCleanup>().notNull().default('keep'),
    downloadCleanupDelayHours: integer('download_cleanup_delay_hours').notNull().default(24),
    refreshIntervalMinutes: integer('refresh_interval_minutes').notNull().default(60),
    nextRefreshAt: timestamp('next_refresh_at', { withTimezone: true }).notNull().defaultNow(),
    lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
    lastRefreshSuccessAt: timestamp('last_refresh_success_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastError: varchar('last_error', { length: 2000 }),
    lastHttpStatus: integer('last_http_status'),
    etag: varchar('etag', { length: 1000 }),
    lastModified: varchar('last_modified', { length: 1000 }),
    lockedFields: jsonb('locked_fields').$type<string[]>().notNull().default([]),
    /** Set while a custom artwork file exists on disk; doubles as the artwork cache-busting token. */
    customArtworkAt: timestamp('custom_artwork_at', { withTimezone: true }),
    /** When the stored copy of the feed XML was last written. Null until a refresh returns a body to store. */
    feedSnapshotAt: timestamp('feed_snapshot_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /**
     * Set while a local show's folder is gone from disk. The row is kept rather than deleted so an
     * unmounted drive does not cost listening history; the folder reappearing clears this again.
     */
    missingAt: timestamp('missing_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('podcasts_library_feed_hash_uidx')
      .on(t.libraryId, t.feedUrlHash)
      .where(sql`${t.feedUrlHash} is not null`),
    uniqueIndex('podcasts_library_local_folder_uidx')
      .on(t.libraryId, t.localFolderPath)
      .where(sql`${t.localFolderPath} is not null`),
    index('podcasts_library_archived_title_idx').on(t.libraryId, t.archivedAt, t.title),
    index('podcasts_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('podcasts_author_trgm_idx').using('gin', t.author.op('gin_trgm_ops')),
    // Local shows have nothing to refresh, so they are kept out of the index the scheduler scans
    // rather than filtered out of every scan.
    index('podcasts_due_refresh_idx')
      .on(t.nextRefreshAt)
      .where(sql`${t.archivedAt} is null and ${t.origin} = 'feed'`),
    // Cleanup is opt-in and rare, so the retention pass reaches its shows through this partial index
    // rather than scanning every show in the library.
    index('podcasts_library_cleanup_idx')
      .on(t.libraryId)
      .where(sql`${t.downloadCleanup} <> 'keep'`),
    check('podcasts_origin_chk', sql`${t.origin} in ('feed', 'local')`),
    check('podcasts_feed_origin_requires_feed_chk', sql`${t.origin} = 'local' or ${t.feedUrlHash} is not null`),
    check('podcasts_acquisition_policy_chk', sql`${t.acquisitionPolicy} in ('remote_only', 'manual', 'newest', 'window')`),
    check('podcasts_download_cleanup_chk', sql`${t.downloadCleanup} in ('keep', 'after_finished')`),
    check('podcasts_download_cleanup_delay_chk', sql`${t.downloadCleanupDelayHours} >= 0`),
    check('podcasts_refresh_interval_positive_chk', sql`${t.refreshIntervalMinutes} > 0`),
    check('podcasts_failures_nonnegative_chk', sql`${t.consecutiveFailures} >= 0`),
    check('podcasts_auto_download_limit_chk', sql`${t.autoDownloadLimit} is null or ${t.autoDownloadLimit} > 0`),
    check('podcasts_auto_download_window_chk', sql`${t.autoDownloadWindowDays} is null or ${t.autoDownloadWindowDays} > 0`),
  ],
);

export const podcastFeedAliases = pgTable(
  'podcast_feed_aliases',
  {
    id: serial('id').primaryKey(),
    podcastId: integer('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 64 }).notNull(),
    urlEncrypted: text('url_encrypted').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('podcast_feed_aliases_podcast_hash_uidx').on(t.podcastId, t.urlHash), index('podcast_feed_aliases_hash_idx').on(t.urlHash)],
);

export const podcastEpisodes = pgTable(
  'podcast_episodes',
  {
    id: serial('id').primaryKey(),
    podcastId: integer('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    /**
     * `sha256(<feed identity>)` for a feed episode, `sha256('local:' || <file sha256>)` for a local
     * one. The two spaces cannot collide, so re-importing a file is a no-op on the unique index.
     */
    identityHash: varchar('identity_hash', { length: 64 }).notNull(),
    /** Matches the show's origin. A `local` episode has no enclosure: its only copy is the file on disk. */
    origin: varchar('origin', { length: 10 }).$type<PodcastOrigin>().notNull().default('feed'),
    guid: text('guid'),
    title: varchar('title', { length: 2000 }).notNull(),
    subtitle: text('subtitle'),
    description: text('description'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    season: varchar('season', { length: 100 }),
    episode: varchar('episode', { length: 100 }),
    episodeType: varchar('episode_type', { length: 50 }),
    durationSeconds: real('duration_seconds'),
    explicit: boolean('explicit').notNull().default(false),
    enclosureUrlEncrypted: text('enclosure_url_encrypted'),
    enclosureUrlHash: varchar('enclosure_url_hash', { length: 64 }),
    enclosureType: varchar('enclosure_type', { length: 255 }),
    enclosureSizeBytes: bigint('enclosure_size_bytes', { mode: 'number' }),
    chapters: jsonb('chapters').$type<PodcastChapter[]>().notNull().default([]),
    transcripts: jsonb('transcripts').$type<PodcastTranscriptRef[]>().notNull().default([]),
    lockedFields: jsonb('locked_fields').$type<string[]>().notNull().default([]),
    inFeed: boolean('in_feed').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    unavailableAt: timestamp('unavailable_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('podcast_episodes_podcast_identity_uidx').on(t.podcastId, t.identityHash),
    index('podcast_episodes_podcast_id_idx').on(t.podcastId, t.id),
    index('podcast_episodes_podcast_created_idx').on(t.podcastId, t.createdAt),
    index('podcast_episodes_podcast_published_id_idx').on(t.podcastId, sql`${t.publishedAt} desc nulls last`, sql`${t.id} desc`),
    index('podcast_episodes_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    // Smart playlists filter and order library-wide on duration, which the per-podcast indexes cannot serve.
    index('podcast_episodes_duration_idx').on(t.durationSeconds),
    index('podcast_episodes_enclosure_hash_idx').on(t.enclosureUrlHash),
    index('podcast_episodes_in_feed_idx').on(t.podcastId, t.inFeed),
    check('podcast_episodes_origin_chk', sql`${t.origin} in ('feed', 'local')`),
    check('podcast_episodes_feed_origin_requires_enclosure_chk', sql`${t.origin} = 'local' or ${t.enclosureUrlHash} is not null`),
    check('podcast_episodes_duration_nonnegative_chk', sql`${t.durationSeconds} is null or ${t.durationSeconds} >= 0`),
    check('podcast_episodes_size_nonnegative_chk', sql`${t.enclosureSizeBytes} is null or ${t.enclosureSizeBytes} >= 0`),
  ],
);

export const podcastEpisodeMedia = pgTable(
  'podcast_episode_media',
  {
    episodeId: integer('episode_id')
      .primaryKey()
      .references(() => podcastEpisodes.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('remote'),
    localPath: varchar('local_path', { length: 4096 }),
    fileName: varchar('file_name', { length: 1000 }),
    format: varchar('format', { length: 30 }),
    mimeType: varchar('mime_type', { length: 255 }),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    checksum: varchar('checksum', { length: 64 }),
    lastError: varchar('last_error', { length: 2000 }),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
    lastRemoteValidatedAt: timestamp('last_remote_validated_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('podcast_episode_media_status_idx').on(t.status),
    index('podcast_episode_media_downloaded_idx').on(t.downloadedAt),
    check('podcast_episode_media_status_chk', sql`${t.status} in ('remote', 'queued', 'downloading', 'local', 'failed', 'unavailable')`),
    check('podcast_episode_media_size_nonnegative_chk', sql`${t.sizeBytes} is null or ${t.sizeBytes} >= 0`),
  ],
);

export const userPodcastFollows = pgTable(
  'user_podcast_follows',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    podcastId: integer('podcast_id')
      .notNull()
      .references(() => podcasts.id, { onDelete: 'cascade' }),
    notificationMode: varchar('notification_mode', { length: 20 }).$type<PodcastNotificationMode>().notNull().default('off'),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.podcastId] }),
    index('user_podcast_follows_podcast_idx').on(t.podcastId, t.userId),
    index('user_podcast_follows_due_digest_idx')
      .on(t.notificationMode, t.lastNotifiedAt, t.userId, t.podcastId)
      .where(sql`${t.notificationMode} in ('daily', 'weekly')`),
    check('user_podcast_follows_notification_chk', sql`${t.notificationMode} in ('off', 'immediate', 'daily', 'weekly')`),
  ],
);

export const userPodcastEpisodeState = pgTable(
  'user_podcast_episode_state',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id')
      .notNull()
      .references(() => podcastEpisodes.id, { onDelete: 'cascade' }),
    positionSeconds: real('position_seconds').notNull().default(0),
    progressPercent: real('progress_percent').notNull().default(0),
    finished: boolean('finished').notNull().default(false),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    pinned: boolean('pinned').notNull().default(false),
    lastListenedAt: timestamp('last_listened_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.episodeId] }),
    index('user_podcast_episode_state_user_finished_idx').on(t.userId, t.finished, sql`${t.updatedAt} desc`),
    index('user_podcast_episode_state_episode_active_idx').on(t.episodeId, t.finished, t.positionSeconds),
    check('user_podcast_episode_state_position_chk', sql`${t.positionSeconds} >= 0`),
    check('user_podcast_episode_state_progress_chk', sql`${t.progressPercent} >= 0 and ${t.progressPercent} <= 100`),
  ],
);

export const userPodcastQueue = pgTable(
  'user_podcast_queue',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id')
      .notNull()
      .references(() => podcastEpisodes.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.episodeId] }),
    uniqueIndex('user_podcast_queue_user_position_uidx').on(t.userId, t.position),
    check('user_podcast_queue_position_nonnegative_chk', sql`${t.position} >= 0`),
  ],
);

export const podcastBookmarks = pgTable(
  'podcast_bookmarks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id')
      .notNull()
      .references(() => podcastEpisodes.id, { onDelete: 'cascade' }),
    positionSeconds: real('position_seconds').notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    index('podcast_bookmarks_user_episode_idx').on(t.userId, t.episodeId),
    index('podcast_bookmarks_user_episode_position_idx').on(t.userId, t.episodeId, t.positionSeconds),
    check('podcast_bookmarks_position_nonnegative_chk', sql`${t.positionSeconds} >= 0`),
  ],
);

export const podcastListeningSessions = pgTable(
  'podcast_listening_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id')
      .notNull()
      .references(() => podcastEpisodes.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 64 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    endPositionSeconds: real('end_position_seconds').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('podcast_sessions_user_session_uidx').on(t.userId, t.sessionId),
    index('podcast_sessions_user_started_idx').on(t.userId, sql`${t.startedAt} desc`),
    index('podcast_sessions_episode_started_idx').on(t.episodeId, sql`${t.startedAt} desc`),
    check('podcast_sessions_duration_nonnegative_chk', sql`${t.durationSeconds} >= 0`),
    check('podcast_sessions_position_nonnegative_chk', sql`${t.endPositionSeconds} >= 0`),
    check('podcast_sessions_time_order_chk', sql`${t.endedAt} >= ${t.startedAt}`),
  ],
);

export const podcastJobs = pgTable(
  'podcast_jobs',
  {
    id: serial('id').primaryKey(),
    type: varchar('type', { length: 30 }).notNull(),
    dedupeKey: varchar('dedupe_key', { length: 255 }).notNull(),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    podcastId: integer('podcast_id').references(() => podcasts.id, { onDelete: 'set null' }),
    episodeId: integer('episode_id').references(() => podcastEpisodes.id, { onDelete: 'set null' }),
    requestedByUserId: integer('requested_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    downloadBatchId: uuid('download_batch_id'),
    status: varchar('status', { length: 20 }).notNull().default('queued'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    progressCurrent: bigint('progress_current', { mode: 'number' }).notNull().default(0),
    progressTotal: bigint('progress_total', { mode: 'number' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lastError: varchar('last_error', { length: 2000 }),
    cancelRequested: boolean('cancel_requested').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    uniqueIndex('podcast_jobs_active_dedupe_uidx')
      .on(t.dedupeKey)
      .where(sql`${t.status} in ('queued', 'processing')`),
    index('podcast_jobs_due_idx').on(t.status, t.nextAttemptAt, t.createdAt),
    index('podcast_jobs_library_status_idx').on(t.libraryId, t.status),
    index('podcast_jobs_status_updated_idx').on(t.status, t.updatedAt),
    index('podcast_jobs_download_batch_idx')
      .on(t.requestedByUserId, t.downloadBatchId, t.status)
      .where(sql`${t.type} = 'download' and ${t.downloadBatchId} is not null`),
    index('podcast_jobs_active_podcast_type_idx')
      .on(t.podcastId, t.type, t.requestedByUserId)
      .where(sql`${t.status} in ('queued', 'processing') and ${t.podcastId} is not null`),
    index('podcast_jobs_active_episode_type_idx')
      .on(t.episodeId, t.type)
      .where(sql`${t.status} in ('queued', 'processing') and ${t.episodeId} is not null`),
    check(
      'podcast_jobs_type_chk',
      sql`${t.type} in ('refresh', 'reparse', 'download', 'retention', 'purge', 'opml_import', 'import_scan', 'local_import', 'merge', 'digest', 'file_cleanup')`,
    ),
    check('podcast_jobs_status_chk', sql`${t.status} in ('queued', 'processing', 'completed', 'failed', 'cancelled')`),
    check('podcast_jobs_attempt_nonnegative_chk', sql`${t.attemptCount} >= 0`),
    check('podcast_jobs_progress_nonnegative_chk', sql`${t.progressCurrent} >= 0 and (${t.progressTotal} is null or ${t.progressTotal} >= 0)`),
  ],
);

export type Podcast = typeof podcasts.$inferSelect;
export type NewPodcast = typeof podcasts.$inferInsert;
export type PodcastEpisode = typeof podcastEpisodes.$inferSelect;
export type NewPodcastEpisode = typeof podcastEpisodes.$inferInsert;
export type PodcastEpisodeMedia = typeof podcastEpisodeMedia.$inferSelect;
export type PodcastJob = typeof podcastJobs.$inferSelect;
