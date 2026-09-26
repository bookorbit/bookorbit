import type { PodcastBookmark, PodcastEpisodeSummary } from '@bookorbit/types'
import { apiJson, apiSend, jsonBody } from '@/lib/api-json'
import { i18n } from '@/i18n'
import { formatPlaybackClock } from '../lib/podcast-format'
import { removeEpisodeDownload, requestEpisodeDownload, updateEpisodeState } from '../lib/podcast-episode-api'
import type { createPodcastPlayerState } from './podcast-player-state'

type PodcastPlayerState = ReturnType<typeof createPodcastPlayerState>

export interface PodcastPlayerActionDeps {
  state: PodcastPlayerState
  /** The player's episode-load token, read fresh so a swap mid-request is visible. */
  currentGeneration: () => number
  currentPosition: () => number
  seekTo: (seconds: number) => void
  onDownloadRequested: () => void
}

/**
 * Everything the player does *to* the episode it has loaded: progress, pinning, bookmarks and the
 * local file.
 *
 * Each one captures its episode before awaiting the server. The player is shared state, so a switch
 * while the request is open would otherwise stamp the previous episode's values, or a bookmark
 * belonging to it, onto whatever is loaded now.
 */
export function createPodcastPlayerActions(deps: PodcastPlayerActionDeps) {
  const { episode, bookmarks, bookmarkTitle, bookmarkNote, duration } = deps.state
  const t = i18n.global.t

  function isStillLoaded(activeEpisode: PodcastEpisodeSummary, activeGeneration: number): boolean {
    return activeGeneration === deps.currentGeneration() && episode.value?.id === activeEpisode.id
  }

  async function markPlayed(): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    const activeGeneration = deps.currentGeneration()
    const positionSeconds = duration.value || activeEpisode.durationSeconds || 0
    await updateEpisodeState(activeEpisode.id, { finished: true, positionSeconds }, 'podcast.errors.markPlayed')
    if (!isStillLoaded(activeEpisode, activeGeneration)) return
    episode.value = { ...activeEpisode, finished: true, positionSeconds, progressPercent: 100 }
  }

  async function restartEpisode(): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    const activeGeneration = deps.currentGeneration()
    await updateEpisodeState(activeEpisode.id, { finished: false, positionSeconds: 0 }, 'podcast.errors.restartEpisode')
    if (!isStillLoaded(activeEpisode, activeGeneration)) return
    deps.seekTo(0)
    episode.value = { ...activeEpisode, finished: false, positionSeconds: 0, progressPercent: 0 }
  }

  async function togglePinned(): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    const activeGeneration = deps.currentGeneration()
    const pinned = !activeEpisode.pinned
    await updateEpisodeState(activeEpisode.id, { pinned }, 'podcast.errors.updatePinned')
    if (!isStillLoaded(activeEpisode, activeGeneration)) return
    episode.value = { ...activeEpisode, pinned }
  }

  async function createBookmark(): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    const activeGeneration = deps.currentGeneration()
    const positionSeconds = deps.currentPosition()
    const title = bookmarkTitle.value.trim() || t('podcast.bookmarks.defaultTitle', { time: formatPlaybackClock(positionSeconds) })
    const created = await apiJson<PodcastBookmark>(
      `/api/v1/podcast-episodes/${activeEpisode.id}/bookmarks`,
      jsonBody('POST', { positionSeconds, title, note: bookmarkNote.value.trim() || undefined }),
      'podcast.errors.createBookmark',
    )
    if (!isStillLoaded(activeEpisode, activeGeneration)) return
    bookmarks.value.push(created)
    bookmarks.value.sort((left, right) => left.positionSeconds - right.positionSeconds)
    bookmarkTitle.value = ''
    bookmarkNote.value = ''
  }

  async function updateBookmark(bookmark: PodcastBookmark, title: string, note: string): Promise<void> {
    const activeEpisode = episode.value
    const activeGeneration = deps.currentGeneration()
    const updated = await apiJson<PodcastBookmark>(
      `/api/v1/podcast-bookmarks/${bookmark.id}`,
      jsonBody('PATCH', { title: title.trim(), note: note.trim() }),
      'podcast.errors.updateBookmark',
    )
    if (activeEpisode && !isStillLoaded(activeEpisode, activeGeneration)) return
    bookmarks.value = bookmarks.value.map((item) => (item.id === updated.id ? updated : item))
  }

  async function deleteBookmark(bookmark: PodcastBookmark): Promise<void> {
    const activeEpisode = episode.value
    const activeGeneration = deps.currentGeneration()
    await apiSend(`/api/v1/podcast-bookmarks/${bookmark.id}`, { method: 'DELETE' }, 'podcast.errors.deleteBookmark')
    if (activeEpisode && !isStillLoaded(activeEpisode, activeGeneration)) return
    bookmarks.value = bookmarks.value.filter((item) => item.id !== bookmark.id)
  }

  async function requestDownload(): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    const activeGeneration = deps.currentGeneration()
    await requestEpisodeDownload(activeEpisode.id)
    if (!isStillLoaded(activeEpisode, activeGeneration)) return
    episode.value = { ...activeEpisode, mediaStatus: 'queued' }
    deps.onDownloadRequested()
  }

  async function removeDownload(): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    const activeGeneration = deps.currentGeneration()
    await removeEpisodeDownload(activeEpisode.id)
    if (!isStillLoaded(activeEpisode, activeGeneration)) return
    episode.value = { ...activeEpisode, mediaStatus: 'remote', localSizeBytes: null }
  }

  return { markPlayed, restartEpisode, togglePinned, createBookmark, updateBookmark, deleteBookmark, requestDownload, removeDownload }
}
