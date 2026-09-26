import type { InjectionKey } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import {
  applyDownloadQueuedFields,
  applyDownloadRemovedFields,
  applyFinishedFields,
  removeEpisodeDownload as removeEpisodeDownloadRequest,
  requestEpisodeDownload,
  updateEpisodeState,
} from '../lib/podcast-episode-api'
import { usePodcastPlayer } from './usePodcastPlayer'
import { usePodcastQueue } from './usePodcastQueue'
import { usePodcastAnnouncer } from './usePodcastAnnouncer'

/**
 * Everything a rendered episode row can do, with the toast and announcement wrapping every
 * surface used to repeat by hand. Views provide the bits only they know: where a detail sheet
 * opens, and any list bookkeeping a queue change implies.
 */
export interface PodcastEpisodeListActionOptions {
  onOpenDetails?: (episode: PodcastEpisodeListItem) => void
  onOpenMetadataEditor?: (episode: PodcastEpisodeListItem) => void
  /** Overrides for a view that also keeps queue totals or a rendered queue list in step. */
  addToQueue?: (episode: PodcastEpisodeListItem) => Promise<void>
  removeFromQueue?: (episode: PodcastEpisodeListItem) => Promise<void>
}

export function usePodcastEpisodeListActions(options: PodcastEpisodeListActionOptions = {}) {
  const { t } = useI18n()
  const router = useRouter()
  const player = usePodcastPlayer()
  const queue = usePodcastQueue()
  const { announce } = usePodcastAnnouncer()

  /** One reporting rule for every row action: the failure is surfaced, the row is not left mid-edit. */
  async function attempt(fallbackKey: string, action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t(fallbackKey))
    }
  }

  async function play(episode: PodcastEpisodeListItem) {
    if (player.episode.value?.id === episode.id) {
      player.togglePlayback()
      return
    }
    await player.playInline(episode.id)
  }

  /** Named for the destination rather than "open": the quick view already has a boolean `open` model. */
  function openPlayer(episode: PodcastEpisodeListItem) {
    void router.push({ name: 'podcast-player', params: { episodeId: episode.id } })
  }

  function openDetails(episode: PodcastEpisodeListItem) {
    options.onOpenDetails?.(episode)
  }

  function openMetadataEditor(episode: PodcastEpisodeListItem) {
    options.onOpenMetadataEditor?.(episode)
  }

  function queueEpisode(episode: PodcastEpisodeListItem) {
    return attempt('podcast.errors.addToQueue', async () => {
      if (options.addToQueue) await options.addToQueue(episode)
      else {
        await queue.add(episode.id)
        episode.queued = true
      }
      void announce(t('podcast.announce.queued', { title: episode.title }))
    })
  }

  function queueNext(episode: PodcastEpisodeListItem) {
    return attempt('podcast.errors.queueNext', async () => {
      await player.queueEpisodeNext(episode.id)
      episode.queued = true
      void announce(t('podcast.announce.queuedNext', { title: episode.title }))
    })
  }

  function unqueue(episode: PodcastEpisodeListItem) {
    return attempt('podcast.errors.removeFromQueue', async () => {
      if (options.removeFromQueue) await options.removeFromQueue(episode)
      else {
        await queue.remove(episode.id)
        episode.queued = false
      }
      void announce(t('podcast.announce.unqueued', { title: episode.title }))
    })
  }

  function download(episode: PodcastEpisodeListItem) {
    return attempt('podcast.errors.queueDownload', async () => {
      await requestEpisodeDownload(episode.id)
      applyDownloadQueuedFields(episode)
      toast.success(t('podcast.messages.downloadQueued'))
    })
  }

  function removeDownload(episode: PodcastEpisodeListItem) {
    if (episode.origin === 'local') return Promise.resolve()
    return attempt('podcast.errors.removeDownload', async () => {
      await removeEpisodeDownloadRequest(episode.id)
      applyDownloadRemovedFields(episode)
      toast.success(t('podcast.messages.downloadRemoved'))
    })
  }

  function setFinished(episode: PodcastEpisodeListItem, finished: boolean) {
    return attempt('podcast.errors.updateEpisode', async () => {
      await updateEpisodeState(episode.id, { finished })
      applyFinishedFields(episode, finished)
    })
  }

  function setPinned(episode: PodcastEpisodeListItem, pinned: boolean) {
    const previous = episode.pinned
    episode.pinned = pinned
    return attempt('podcast.errors.updatePinned', async () => {
      try {
        await updateEpisodeState(episode.id, { pinned }, 'podcast.errors.updatePinned')
      } catch (reason) {
        episode.pinned = previous
        throw reason
      }
    })
  }

  return {
    play,
    openPlayer,
    openDetails,
    openMetadataEditor,
    queue: queueEpisode,
    queueNext,
    unqueue,
    download,
    removeDownload,
    finish: (episode: PodcastEpisodeListItem) => setFinished(episode, true),
    unfinish: (episode: PodcastEpisodeListItem) => setFinished(episode, false),
    pin: (episode: PodcastEpisodeListItem) => setPinned(episode, true),
    unpin: (episode: PodcastEpisodeListItem) => setPinned(episode, false),
  }
}

export type PodcastEpisodeListActions = ReturnType<typeof usePodcastEpisodeListActions>

/**
 * Rows reach their actions through this rather than re-emitting thirteen events up through every
 * panel between them and the view that owns the handlers.
 */
export const PODCAST_EPISODE_ACTIONS: InjectionKey<PodcastEpisodeListActions> = Symbol('podcastEpisodeActions')
