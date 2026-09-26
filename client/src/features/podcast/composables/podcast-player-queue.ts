import type { PodcastQueuePlacement } from '@bookorbit/types'
import type { createPodcastPlayerState } from './podcast-player-state'
import type { createPodcastPlayerPersistence } from './podcast-player-persistence'
import { notifyEpisodesDequeued, type usePodcastQueue } from './usePodcastQueue'

type PodcastPlayerState = ReturnType<typeof createPodcastPlayerState>
type PodcastPlayerPersistence = ReturnType<typeof createPodcastPlayerPersistence>
type PodcastQueue = ReturnType<typeof usePodcastQueue>

export interface PodcastPlayerQueueDeps {
  state: PodcastPlayerState
  queue: PodcastQueue
  persistence: PodcastPlayerPersistence
  refreshPlaybackContext: () => Promise<void>
  loadEpisode: (episodeId: number, autoplay?: boolean) => Promise<void>
}

/**
 * The player's half of the queue: mutations it issues for the loaded episode, and the context
 * re-read that follows any queue change from anywhere in the app.
 */
export function createPodcastPlayerQueue(deps: PodcastPlayerQueueDeps) {
  const { episode, previousQueueItem, nextQueueItem } = deps.state
  let refreshPromise: Promise<void> | null = null
  let refreshRequested = false

  /**
   * Coalesces bursts of queue changes into one context read, and keeps reading while more arrive so
   * the last change is always reflected rather than dropped alongside an in-flight request.
   */
  function scheduleQueueContextRefresh(): Promise<void> {
    refreshRequested = true
    if (refreshPromise) return refreshPromise
    refreshPromise = (async () => {
      while (refreshRequested) {
        refreshRequested = false
        if (episode.value) await deps.refreshPlaybackContext()
      }
    })().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  async function waitForQueueContextRefresh(): Promise<void> {
    await refreshPromise?.catch(() => undefined)
  }

  async function addToQueue(placement: PodcastQueuePlacement = 'end'): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    await deps.queue.add(activeEpisode.id, placement)
    await waitForQueueContextRefresh()
  }

  async function queueEpisodeNext(episodeId: number): Promise<void> {
    const activeEpisode = episode.value
    await deps.queue.addNext(episodeId, activeEpisode ? { episodeId: activeEpisode.id, queued: activeEpisode.queued } : undefined)
    await waitForQueueContextRefresh()
  }

  async function removeFromQueue(episodeId = episode.value?.id): Promise<void> {
    if (!episodeId) return
    await deps.queue.remove(episodeId)
    await waitForQueueContextRefresh()
  }

  async function playPrevious(): Promise<void> {
    const previousEpisode = previousQueueItem.value
    if (!previousEpisode) return
    await deps.loadEpisode(previousEpisode.id, true)
  }

  async function playNext(): Promise<void> {
    const nextEpisode = nextQueueItem.value
    if (!nextEpisode) return
    await deps.loadEpisode(nextEpisode.id, true)
  }

  async function advanceAfterPlaybackEnd(): Promise<void> {
    const nextEpisode = nextQueueItem.value
    const finishedEpisodeId = episode.value?.id
    // The finished-state PATCH dequeues the completed episode server-side, so the next context
    // read has to wait for that write to land or it would still count the finished entry.
    await deps.persistence.waitForStateWrites()
    // Advancing into an episode whose media is gone strands the player on a load error that no
    // retry can clear, and the mini player carries it to every route. Nobody asked for this
    // episode, so stopping on the finished one is the better end state than a dead player.
    if (nextEpisode && nextEpisode.mediaStatus !== 'unavailable') await deps.loadEpisode(nextEpisode.id, true)
    else if (episode.value) await deps.refreshPlaybackContext().catch(() => undefined)
    // Announced after the player has re-read its own context, so a rendered queue elsewhere drops
    // the finished row too. This write goes straight to the state endpoint, so nothing else sees it.
    if (finishedEpisodeId !== undefined) notifyEpisodesDequeued([finishedEpisodeId])
  }

  return {
    scheduleQueueContextRefresh,
    waitForQueueContextRefresh,
    addToQueue,
    queueEpisodeNext,
    removeFromQueue,
    playPrevious,
    playNext,
    advanceAfterPlaybackEnd,
  }
}
