import type { PodcastEpisodeListItem, PodcastEpisodeSummary } from '@bookorbit/types'
import { i18n } from '@/i18n'

export type PodcastStatusKind =
  'downloaded' | 'downloadQueued' | 'downloading' | 'failed' | 'unavailable' | 'played' | 'removedFromFeed' | 'nowPlaying' | 'paused' | 'inQueue'

type EpisodeNumbering = Pick<PodcastEpisodeListItem, 'season' | 'episode'>

/** "S2 E14", or whichever half of it the feed actually provides. */
export function episodeNumberLabel(episode: EpisodeNumbering): string | null {
  const t = i18n.global.t
  if (episode.season && episode.episode) return t('podcast.labels.seasonEpisode', { season: episode.season, episode: episode.episode })
  if (episode.season) return t('podcast.labels.season', { season: episode.season })
  if (episode.episode) return t('podcast.labels.episode', { episode: episode.episode })
  return null
}

/** Media state as the status chip names it. `remote` has no chip: it is the unremarkable case. */
export function episodeMediaStatusKind(episode: Pick<PodcastEpisodeListItem, 'mediaStatus'>): PodcastStatusKind | null {
  switch (episode.mediaStatus) {
    case 'local':
      return 'downloaded'
    case 'queued':
      return 'downloadQueued'
    case 'downloading':
      return 'downloading'
    case 'failed':
      return 'failed'
    case 'unavailable':
      return 'unavailable'
    default:
      return null
  }
}

/** Whether the status strip would render anything, so a host can skip its wrapper rather than leave an empty row. */
export function hasEpisodeStatusChips(
  episode: Pick<PodcastEpisodeListItem, 'mediaStatus' | 'finished' | 'inFeed' | 'queued'>,
  isActive: boolean,
): boolean {
  return isActive || episodeMediaStatusKind(episode) !== null || episode.finished || !episode.inFeed || episode.queued
}

export function episodeDownloadPercent(progress: { receivedBytes: number; totalBytes: number | null } | null | undefined): number | null {
  return progress?.totalBytes ? Math.min(100, (progress.receivedBytes / progress.totalBytes) * 100) : null
}

export function isPodcastEpisodeSummary(episode: PodcastEpisodeListItem | PodcastEpisodeSummary): episode is PodcastEpisodeSummary {
  return 'chapters' in episode
}
