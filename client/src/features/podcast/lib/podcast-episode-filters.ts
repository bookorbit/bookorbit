import type { PodcastEpisodeFilter, PodcastEpisodeSort } from '@bookorbit/types'

export const PODCAST_EPISODE_FILTER_OPTIONS = [
  { id: 'latest', labelKey: 'podcast.library.latest' },
  { id: 'downloaded', labelKey: 'podcast.status.downloaded' },
  { id: 'in_progress', labelKey: 'podcast.library.inProgress' },
  { id: 'unplayed', labelKey: 'podcast.library.unplayed' },
  { id: 'finished', labelKey: 'podcast.library.finished' },
  { id: 'pinned', labelKey: 'podcast.library.pinned' },
] as const satisfies ReadonlyArray<{ id: PodcastEpisodeFilter; labelKey: string }>

export const PODCAST_EPISODE_FILTER_IDS = new Set<PodcastEpisodeFilter>(PODCAST_EPISODE_FILTER_OPTIONS.map((option) => option.id))

/** Every sort the episode list endpoint accepts, in menu order. Shared by both episode surfaces and the playlist editor. */
export const PODCAST_EPISODE_SORT_OPTIONS = [
  { id: 'newest', labelKey: 'podcast.show.newestFirst' },
  { id: 'oldest', labelKey: 'podcast.show.oldestFirst' },
  { id: 'shortest', labelKey: 'podcast.sort.shortest' },
  { id: 'longest', labelKey: 'podcast.sort.longest' },
  { id: 'recently_listened', labelKey: 'podcast.sort.recentlyListened' },
] as const satisfies ReadonlyArray<{ id: PodcastEpisodeSort; labelKey: string }>

export const PODCAST_EPISODE_SORT_IDS = new Set<PodcastEpisodeSort>(PODCAST_EPISODE_SORT_OPTIONS.map((option) => option.id))

export function parsePodcastEpisodeSort(value: unknown): PodcastEpisodeSort {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && PODCAST_EPISODE_SORT_IDS.has(candidate as PodcastEpisodeSort) ? (candidate as PodcastEpisodeSort) : 'newest'
}
