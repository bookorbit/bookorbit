import type { PodcastEpisodeListItem, PodcastEpisodeSummary, PodcastListItem, PodcastQueueItem, PodcastSummary } from '@bookorbit/types'

/**
 * One place for the podcast shapes every spec needs. Hand-pasting a 35-field `PodcastSummary` is
 * how a type change turns into a dozen identical edits, and how two specs end up disagreeing about
 * what a "default" episode looks like.
 */

export function makeShow(overrides: Partial<PodcastSummary> = {}): PodcastSummary {
  return {
    id: 12,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: 'Orbit',
    description: null,
    imageUrl: null,
    siteUrl: null,
    language: null,
    podcastType: null,
    explicit: false,
    categories: [],
    acquisitionPolicy: 'remote_only',
    autoDownloadLimit: null,
    autoDownloadWindowDays: null,
    downloadCleanup: 'keep',
    downloadCleanupDelayHours: 24,
    refreshIntervalMinutes: 60,
    lockedFields: [],
    artworkUpdatedAt: null,
    episodeCount: 4,
    unplayedCount: 4,
    downloadedCount: 0,
    playbackRecommendation: null,
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
    lastRefreshAt: null,
    lastRefreshSuccessAt: null,
    feedSnapshotAt: null,
    consecutiveFailures: 0,
    nextRefreshAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeListItem(overrides: Partial<PodcastListItem> = {}): PodcastListItem {
  return {
    id: 12,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: 'Orbit',
    imageUrl: null,
    episodeCount: 4,
    unplayedCount: 4,
    downloadedCount: 0,
    latestPublishedAt: null,
    consecutiveFailures: 0,
    playbackRecommendation: null,
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
    ...overrides,
  }
}

export function makeEpisodeSummary(overrides: Partial<PodcastEpisodeSummary> = {}): PodcastEpisodeSummary {
  return {
    id: 42,
    libraryId: 7,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'First episode',
    subtitle: null,
    description: null,
    publishedAt: null,
    season: null,
    episode: null,
    episodeType: null,
    durationSeconds: 300,
    audioFormat: 'mp3',
    explicit: false,
    chapters: [],
    transcripts: [],
    lockedFields: [],
    inFeed: true,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 30,
    progressPercent: 10,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  }
}

export function makeEpisodeListItem(overrides: Partial<PodcastEpisodeListItem> = {}): PodcastEpisodeListItem {
  return {
    id: 42,
    libraryId: 7,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'First episode',
    season: null,
    episode: null,
    explicit: false,
    inFeed: true,
    publishedAt: null,
    durationSeconds: 300,
    audioFormat: null,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 30,
    progressPercent: 10,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    ...overrides,
  }
}

export function makeQueueItem(overrides: Partial<PodcastQueueItem> = {}): PodcastQueueItem {
  return { ...makeEpisodeListItem(), queued: true, queuePosition: 0, ...overrides }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
