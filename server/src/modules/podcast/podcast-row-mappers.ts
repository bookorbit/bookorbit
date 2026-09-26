import type {
  PodcastEpisodeListItem,
  PodcastEpisodeSummary,
  PodcastListItem,
  PodcastNotificationMode,
  PodcastPlaybackRecommendation,
  PodcastSummary,
} from '@bookorbit/types';
import { podcastEpisodeMedia, podcastEpisodes, podcasts, userPodcastEpisodeState } from '../../db/schema';

export function toPodcastListItem(
  podcast: Pick<
    typeof podcasts.$inferSelect,
    'id' | 'libraryId' | 'origin' | 'title' | 'author' | 'imageUrlEncrypted' | 'customArtworkAt' | 'archivedAt' | 'missingAt' | 'consecutiveFailures'
  >,
  counts: {
    episodeCount: number;
    unplayedCount: number;
    downloadedCount: number;
    latestPublishedAt: Date | string | null;
  },
  playbackRecommendation: PodcastPlaybackRecommendation | null,
  followed: boolean,
  notificationMode: PodcastNotificationMode,
): PodcastListItem {
  return {
    id: podcast.id,
    libraryId: podcast.libraryId,
    origin: podcast.origin,
    title: podcast.title,
    author: podcast.author,
    imageUrl: podcastArtworkUrl(podcast.id, podcast.imageUrlEncrypted, podcast.customArtworkAt),
    episodeCount: counts.episodeCount,
    unplayedCount: counts.unplayedCount,
    downloadedCount: counts.downloadedCount,
    latestPublishedAt: toIsoTimestamp(counts.latestPublishedAt),
    consecutiveFailures: podcast.consecutiveFailures,
    playbackRecommendation,
    followed,
    notificationMode,
    archivedAt: podcast.archivedAt?.toISOString() ?? null,
    missingAt: podcast.missingAt?.toISOString() ?? null,
  };
}

export function toPodcastSummary(
  podcast: typeof podcasts.$inferSelect,
  counts: { episodeCount: number; unplayedCount: number; downloadedCount: number },
  playbackRecommendation: PodcastPlaybackRecommendation | null,
  followed: boolean,
  notificationMode: PodcastNotificationMode,
): PodcastSummary {
  return {
    id: podcast.id,
    libraryId: podcast.libraryId,
    origin: podcast.origin,
    title: podcast.title,
    author: podcast.author,
    description: podcast.description,
    imageUrl: podcastArtworkUrl(podcast.id, podcast.imageUrlEncrypted, podcast.customArtworkAt),
    siteUrl: podcast.siteUrl,
    language: podcast.language,
    podcastType: podcast.podcastType,
    explicit: podcast.explicit,
    categories: podcast.categories,
    acquisitionPolicy: podcast.acquisitionPolicy,
    autoDownloadLimit: podcast.autoDownloadLimit,
    autoDownloadWindowDays: podcast.autoDownloadWindowDays,
    downloadCleanup: podcast.downloadCleanup,
    downloadCleanupDelayHours: podcast.downloadCleanupDelayHours,
    refreshIntervalMinutes: podcast.refreshIntervalMinutes,
    lockedFields: podcast.lockedFields ?? [],
    artworkUpdatedAt: podcast.customArtworkAt?.toISOString() ?? null,
    episodeCount: counts.episodeCount,
    unplayedCount: counts.unplayedCount,
    downloadedCount: counts.downloadedCount,
    playbackRecommendation,
    followed,
    notificationMode,
    archivedAt: podcast.archivedAt?.toISOString() ?? null,
    missingAt: podcast.missingAt?.toISOString() ?? null,
    lastRefreshAt: podcast.lastRefreshAt?.toISOString() ?? null,
    lastRefreshSuccessAt: podcast.lastRefreshSuccessAt?.toISOString() ?? null,
    feedSnapshotAt: podcast.feedSnapshotAt?.toISOString() ?? null,
    consecutiveFailures: podcast.consecutiveFailures,
    nextRefreshAt: podcast.nextRefreshAt.toISOString(),
    createdAt: podcast.createdAt.toISOString(),
    updatedAt: podcast.updatedAt.toISOString(),
  };
}

export function toEpisodeListItem(row: {
  episode: Pick<
    typeof podcastEpisodes.$inferSelect,
    'id' | 'podcastId' | 'origin' | 'title' | 'season' | 'episode' | 'explicit' | 'inFeed' | 'publishedAt' | 'durationSeconds' | 'enclosureType'
  >;
  podcastLibraryId: number;
  podcastTitle: string;
  podcastImageUrl: string | null;
  podcastCustomArtworkAt: Date | null;
  media: Pick<typeof podcastEpisodeMedia.$inferSelect, 'status' | 'sizeBytes' | 'format' | 'checksum'> | null;
  state: Pick<typeof userPodcastEpisodeState.$inferSelect, 'positionSeconds' | 'progressPercent' | 'finished' | 'pinned' | 'lastListenedAt'> | null;
  queuedEpisodeId: number | null;
}): PodcastEpisodeListItem {
  const { episode, media, state } = row;
  return {
    id: episode.id,
    libraryId: row.podcastLibraryId,
    podcastId: episode.podcastId,
    origin: episode.origin,
    podcastTitle: row.podcastTitle,
    podcastImageUrl: podcastArtworkUrl(episode.podcastId, row.podcastImageUrl, row.podcastCustomArtworkAt),
    title: episode.title,
    season: episode.season,
    episode: episode.episode,
    explicit: episode.explicit,
    inFeed: episode.inFeed,
    publishedAt: episode.publishedAt?.toISOString() ?? null,
    durationSeconds: episode.durationSeconds,
    // The summary's resolver, without its last resort. Decrypting one enclosure URL per row to
    // read a file extension is not worth it on a page of fifty; a row that only a URL could
    // identify reports null and the client asks for the summary instead.
    audioFormat: resolveListAudioFormat(episode.enclosureType, media?.format),
    mediaStatus: (media?.status ?? 'remote') as PodcastEpisodeListItem['mediaStatus'],
    localSizeBytes: media?.sizeBytes ?? null,
    // Same condition the summary uses. A checksum is only meaningful for a copy this server holds:
    // an episode still proxied from its origin has bytes nobody here has hashed.
    checksum: media?.status === 'local' ? (media.checksum ?? null) : null,
    positionSeconds: state?.positionSeconds ?? 0,
    progressPercent: state?.progressPercent ?? 0,
    finished: state?.finished ?? false,
    pinned: state?.pinned ?? false,
    queued: row.queuedEpisodeId !== null,
    lastListenedAt: state?.lastListenedAt?.toISOString() ?? null,
  };
}

export function toEpisodeSummary(
  row: {
    episode: typeof podcastEpisodes.$inferSelect;
    podcastLibraryId: number;
    podcastTitle: string;
    podcastImageUrl: string | null;
    podcastCustomArtworkAt: Date | null;
    media: typeof podcastEpisodeMedia.$inferSelect | null;
    state: typeof userPodcastEpisodeState.$inferSelect | null;
    queuedEpisodeId: number | null;
  },
  decryptEnclosureUrl: (encryptedUrl: string) => string,
): PodcastEpisodeSummary {
  const { episode, media, state } = row;
  return {
    id: episode.id,
    libraryId: row.podcastLibraryId,
    podcastId: episode.podcastId,
    origin: episode.origin,
    podcastTitle: row.podcastTitle,
    podcastImageUrl: podcastArtworkUrl(episode.podcastId, row.podcastImageUrl, row.podcastCustomArtworkAt),
    title: episode.title,
    subtitle: episode.subtitle,
    description: episode.description,
    publishedAt: episode.publishedAt?.toISOString() ?? null,
    season: episode.season,
    episode: episode.episode,
    episodeType: episode.episodeType,
    durationSeconds: episode.durationSeconds,
    audioFormat: resolveAudioFormat(episode.enclosureType, media?.format, episode.enclosureUrlEncrypted, decryptEnclosureUrl),
    explicit: episode.explicit,
    chapters: episode.chapters,
    transcripts: episode.transcripts,
    lockedFields: episode.lockedFields ?? [],
    inFeed: episode.inFeed,
    mediaStatus: (media?.status ?? 'remote') as PodcastEpisodeSummary['mediaStatus'],
    localSizeBytes: media?.sizeBytes ?? null,
    checksum: media?.status === 'local' ? (media.checksum ?? null) : null,
    positionSeconds: state?.positionSeconds ?? 0,
    progressPercent: state?.progressPercent ?? 0,
    finished: state?.finished ?? false,
    pinned: state?.pinned ?? false,
    queued: row.queuedEpisodeId !== null,
    lastListenedAt: state?.lastListenedAt?.toISOString() ?? null,
    createdAt: episode.createdAt.toISOString(),
    updatedAt: episode.updatedAt.toISOString(),
  };
}

export function podcastArtworkUrl(podcastId: number, imageUrlEncrypted: string | null, customArtworkAt: Date | null): string | null {
  if (customArtworkAt) return `/api/v1/podcasts/${podcastId}/artwork?v=${customArtworkAt.getTime()}`;
  return imageUrlEncrypted ? `/api/v1/podcasts/${podcastId}/artwork` : null;
}

function toIsoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The MIME half of `resolveAudioFormat`, shared so a list row and a summary cannot disagree. */
function resolveListAudioFormat(enclosureType: string | null, localFormat: string | null | undefined): string | null {
  const normalizedLocal = normalizeAudioFormat(localFormat);
  if (normalizedLocal) return normalizedLocal;
  return audioFormatByMime(enclosureType);
}

function audioFormatByMime(enclosureType: string | null): string | null {
  const mimeFormats: Record<string, string> = {
    'audio/aac': 'aac',
    'audio/flac': 'flac',
    'audio/mp4': 'm4a',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/x-m4a': 'm4a',
  };
  if (!enclosureType) return null;
  return mimeFormats[enclosureType.split(';')[0]!.trim().toLowerCase()] ?? null;
}

function resolveAudioFormat(
  enclosureType: string | null,
  localFormat: string | null | undefined,
  encryptedUrl: string | null,
  decryptEnclosureUrl: (encryptedUrl: string) => string,
): string | null {
  const shared = resolveListAudioFormat(enclosureType, localFormat);
  if (shared) return shared;
  if (!encryptedUrl) return null;
  try {
    const pathname = new URL(decryptEnclosureUrl(encryptedUrl)).pathname.toLowerCase();
    return normalizeAudioFormat(pathname.slice(pathname.lastIndexOf('.') + 1));
  } catch {
    return null;
  }
}

function normalizeAudioFormat(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/^\./, '');
  if (normalized === 'm4b' || normalized === 'mp4') return 'm4a';
  if (normalized === 'oga') return 'ogg';
  return ['aac', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav'].includes(normalized) ? normalized : null;
}
