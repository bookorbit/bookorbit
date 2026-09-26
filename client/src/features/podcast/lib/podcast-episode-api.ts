import type { PodcastEpisodeListItem, PodcastEpisodeSummary } from '@bookorbit/types'
import { apiSend, jsonBody } from '@/lib/api-json'
import { notifyEpisodesDequeued } from '../composables/usePodcastQueue'

/**
 * The `/podcast-episodes/:id` surface in one place. Every episode row, the queue, and the player
 * drive the same endpoints, and keeping the URLs and the local field updates together is what
 * stops the three from drifting apart.
 */

export interface PodcastEpisodeStatePatch {
  finished?: boolean
  pinned?: boolean
  positionSeconds?: number
  progressPercent?: number
}

/** The progress fields both the list row and the player summary carry. */
type EpisodeProgressFields = Pick<PodcastEpisodeListItem, 'finished' | 'positionSeconds' | 'progressPercent' | 'durationSeconds'>
type EpisodeMediaFields = Pick<PodcastEpisodeListItem, 'mediaStatus' | 'localSizeBytes'>

export async function updateEpisodeState(
  episodeId: number,
  patch: PodcastEpisodeStatePatch,
  fallbackKey = 'podcast.errors.updateEpisode',
): Promise<void> {
  await apiSend(`/api/v1/podcast-episodes/${episodeId}/state`, jsonBody('PATCH', patch), fallbackKey)
  // The same write drops the episode from the queue server-side.
  if (patch.finished === true) notifyEpisodesDequeued([episodeId])
}

export function requestEpisodeDownload(episodeId: number): Promise<void> {
  return apiSend(`/api/v1/podcast-episodes/${episodeId}/download`, { method: 'POST' }, 'podcast.errors.queueDownload')
}

export function removeEpisodeDownload(episodeId: number): Promise<void> {
  return apiSend(`/api/v1/podcast-episodes/${episodeId}/download`, { method: 'DELETE' }, 'podcast.errors.removeDownload')
}

/** Finishing an episode moves its position to the end; unfinishing sends it back to the start. */
export function applyFinishedFields<T extends EpisodeProgressFields>(episode: T, finished: boolean): void {
  episode.finished = finished
  episode.positionSeconds = finished ? (episode.durationSeconds ?? episode.positionSeconds) : 0
  episode.progressPercent = finished ? 100 : 0
}

export function applyDownloadQueuedFields<T extends Pick<PodcastEpisodeListItem, 'mediaStatus'>>(episode: T): void {
  episode.mediaStatus = 'queued'
}

export function applyDownloadRemovedFields<T extends EpisodeMediaFields>(episode: T): void {
  episode.mediaStatus = 'remote'
  episode.localSizeBytes = null
}

/**
 * A local episode's file is the user's own, so BookOrbit never deletes it on their behalf. The
 * server refuses it too; this keeps the action hidden rather than failing after the click.
 */
export function canRemoveEpisodeDownload(episode: Pick<PodcastEpisodeListItem, 'mediaStatus' | 'origin'>, canDownload: boolean): boolean {
  return canDownload && episode.mediaStatus === 'local' && episode.origin !== 'local'
}

/**
 * A local-origin episode has no feed enclosure to fetch, so the server answers any download with
 * `PODCAST_LOCAL_NO_DOWNLOAD`. Its media going missing changes the status but never gives it a
 * source, so the action has to be gated on origin rather than on status alone.
 */
export function canQueueEpisodeDownload(episode: Pick<PodcastEpisodeListItem, 'mediaStatus' | 'origin'>, canDownload: boolean): boolean {
  return canDownload && episode.origin !== 'local' && episode.mediaStatus !== 'local'
}

/** Keeps a rendered row in step with a metadata edit without refetching the list. */
export function applyEpisodeMetadataFields(row: PodcastEpisodeListItem, updated: PodcastEpisodeSummary): void {
  row.title = updated.title
  row.season = updated.season
  row.episode = updated.episode
  row.explicit = updated.explicit
  row.publishedAt = updated.publishedAt
  row.durationSeconds = updated.durationSeconds
}
