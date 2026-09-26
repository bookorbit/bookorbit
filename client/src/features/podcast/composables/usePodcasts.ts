import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { PODCAST_PLAYLIST_QUEUE_LIMIT } from '@bookorbit/types'
import type {
  PodcastBulkActionResult,
  PodcastEpisodeFilter,
  PodcastEpisodeListItem,
  PodcastEpisodePage,
  PodcastEpisodeSort,
  PodcastEpisodeSummary,
  PodcastFeedHealth,
  PodcastListItem,
  PodcastPage,
  PodcastPlaylistRules,
  PodcastQueueItem,
  PodcastQueuePage,
  PodcastSort,
} from '@bookorbit/types'
import { apiJson, jsonBody } from '@/lib/api-json'
import { appendPlaylistRuleParams, playlistRuleBody } from '../lib/podcast-playlist-rules'
import { applyEpisodeMetadataFields, updateEpisodeState } from '../lib/podcast-episode-api'
import { createPodcastListLane } from './podcast-list-lane'
import { usePodcastQueue, type PodcastQueueChange } from './usePodcastQueue'
import { usePodcastEvents } from './usePodcastEvents'
import { usePodcastAnnouncer } from './usePodcastAnnouncer'

const PAGE_SIZE = 50

export function usePodcasts(libraryId: Ref<number>) {
  const { t } = useI18n()
  const podcastQueue = usePodcastQueue()
  const podcastEvents = usePodcastEvents()
  const { announce } = usePodcastAnnouncer()

  const filter = ref<PodcastEpisodeFilter>('latest')
  const showSort = ref<PodcastSort>('title')
  const episodeSort = ref<PodcastEpisodeSort>('newest')
  const search = ref('')
  const followedOnly = ref(false)
  const missingOnly = ref(false)
  const playlistRules = ref<PodcastPlaylistRules | null>(null)
  const queueDurationSeconds = ref(0)
  const episodeDurationSeconds = ref(0)

  const shows = createPodcastListLane<PodcastListItem>({
    fetchPage: async (page, size) => {
      const params = new URLSearchParams({ page: String(page), size: String(size), sort: showSort.value })
      if (missingOnly.value) params.set('missing', 'true')
      appendSearch(params)
      return apiJson<PodcastPage<PodcastListItem>>(
        `/api/v1/podcast-libraries/${libraryId.value}/podcasts?${params}`,
        undefined,
        'podcast.errors.loadPodcasts',
      )
    },
    fallbackKey: 'podcast.errors.loadPodcasts',
  })

  const episodes = createPodcastListLane<PodcastEpisodeListItem>({
    fetchPage: async (page, size) => {
      const result = await apiJson<PodcastEpisodePage>(
        `/api/v1/podcast-libraries/${libraryId.value}/episodes?${episodeQuery(page, size)}`,
        undefined,
        'podcast.errors.loadEpisodes',
      )
      episodeDurationSeconds.value = result.totalDurationSeconds ?? 0
      return result
    },
    fallbackKey: 'podcast.errors.loadEpisodes',
  })

  const queue = createPodcastListLane<PodcastQueueItem>({
    fetchPage: async (page, size) => {
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      appendSearch(params)
      const result = await apiJson<PodcastQueuePage>(`/api/v1/podcast-queue?${params}`, undefined, 'podcast.errors.loadQueue')
      queueDurationSeconds.value = result.totalDurationSeconds
      return result
    },
    fallbackKey: 'podcast.errors.loadQueue',
  })

  const health = createPodcastListLane<PodcastFeedHealth>({
    fetchPage: async (page, size) => {
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      appendSearch(params)
      return apiJson<PodcastPage<PodcastFeedHealth>>(
        `/api/v1/podcast-libraries/${libraryId.value}/health?${params}`,
        undefined,
        'podcast.errors.loadHealth',
      )
    },
    fallbackKey: 'podcast.errors.loadHealth',
  })

  const lanes = { shows, episodes, queue, health }

  function appendSearch(params: URLSearchParams): void {
    if (search.value.trim()) params.set('q', search.value.trim())
  }

  /** A playlist replaces the tab filters wholesale, so the two never contribute clauses to the same request. */
  function episodeQuery(requestedPage: number, size: number) {
    const params = new URLSearchParams({ page: String(requestedPage), size: String(size) })
    const rules = playlistRules.value
    if (rules) {
      appendPlaylistRuleParams(params, rules)
    } else {
      params.set('filter', filter.value)
      params.set('sort', episodeSort.value)
      params.set('followedOnly', String(followedOnly.value))
    }
    appendSearch(params)
    return params
  }

  /**
   * Realtime events name an episode by id and arrive continuously during a bulk download, so the
   * two lists that can hold it are indexed rather than re-scanned per event.
   */
  function findEpisodeRows(episodeId: number): Array<PodcastEpisodeListItem | PodcastQueueItem> {
    const rows: Array<PodcastEpisodeListItem | PodcastQueueItem> = []
    const listed = episodes.items.value.find((item) => item.id === episodeId)
    if (listed) rows.push(listed)
    const queued = queue.items.value.find((item) => item.id === episodeId)
    if (queued) rows.push(queued)
    return rows
  }

  podcastEvents.onDownloadProgress((event) => {
    if (event.libraryId !== libraryId.value) return
    for (const item of findEpisodeRows(event.episodeId)) item.mediaStatus = event.status
  })

  podcastEvents.onDownloadComplete((event) => {
    if (event.libraryId !== libraryId.value) return
    const rows = findEpisodeRows(event.episodeId)
    if (rows.length === 0) return
    const wasLocal = rows.some((item) => item.mediaStatus === 'local')
    for (const item of rows) {
      item.mediaStatus = event.mediaStatus
      item.localSizeBytes = event.localSizeBytes
    }
    const key = event.mediaStatus === 'local' ? 'podcast.announce.downloadReady' : 'podcast.announce.downloadFailed'
    void announce(t(key, { title: rows[0]!.title }))
    const show = shows.items.value.find((item) => item.id === event.podcastId)
    if (show) {
      if (event.mediaStatus === 'local' && !wasLocal) show.downloadedCount++
      else if (event.mediaStatus !== 'local' && wasLocal) show.downloadedCount = Math.max(0, show.downloadedCount - 1)
    }
  })

  // The server removed the file on its own, so the badge has to flip without a refetch: nothing the
  // user did will prompt one.
  podcastEvents.onRetentionEvicted((event) => {
    if (event.libraryId !== libraryId.value) return
    const evicted = findEpisodeRows(event.episodeId).filter((item) => item.mediaStatus === 'local')
    for (const item of evicted) {
      item.mediaStatus = 'remote'
      item.localSizeBytes = null
    }
    if (evicted.length > 0) {
      const key = event.reason === 'played' ? 'podcast.announce.evictedPlayed' : 'podcast.announce.evictedSpace'
      void announce(t(key, { title: evicted[0]!.title }))
    }
    const show = shows.items.value.find((item) => item.id === event.podcastId)
    if (show) show.downloadedCount = Math.max(0, show.downloadedCount - 1)
  })

  /**
   * A finished episode leaves the queue inside the state write, from the player or from a row menu
   * that knows nothing about this lane. Splicing keeps the loaded pages, the count and the duration
   * in step where a refetch would throw away every page after the first.
   */
  function applyDequeued(change?: PodcastQueueChange): void {
    if (!change || change.removedEpisodeIds.length === 0) return
    const removed = new Set(change.removedEpisodeIds)
    let stillQueued = 0
    for (const item of queue.items.value) {
      if (!removed.has(item.id)) continue
      stillQueued++
      queueDurationSeconds.value = Math.max(0, queueDurationSeconds.value - (item.durationSeconds ?? 0))
    }
    for (const item of episodes.items.value) {
      if (!removed.has(item.id)) continue
      // Counted here only when the queue lane did not already hold it, so a row rendered in both
      // lanes is not subtracted twice.
      if (item.queued && !queue.items.value.some((queued) => queued.id === item.id)) stillQueued++
      item.queued = false
    }
    if (stillQueued === 0) return
    queue.items.value = queue.items.value.filter((item) => !removed.has(item.id))
    queue.total.value = Math.max(0, queue.total.value - stillQueued)
  }

  const unsubscribeQueue = podcastQueue.subscribe(applyDequeued)
  if (getCurrentScope()) onScopeDispose(unsubscribeQueue)

  podcastEvents.onRefreshComplete((event) => {
    if (event.libraryId !== libraryId.value) return
    const healthItem = health.items.value.find((item) => item.podcastId === event.podcastId)
    if (healthItem) {
      healthItem.consecutiveFailures = event.consecutiveFailures
      healthItem.lastError = event.lastError
      if (event.consecutiveFailures === 0) healthItem.lastRefreshSuccessAt = new Date().toISOString()
    }
    const show = shows.items.value.find((item) => item.id === event.podcastId)
    if (show) {
      show.consecutiveFailures = event.consecutiveFailures
      show.episodeCount += event.newEpisodes
      show.unplayedCount += event.newEpisodes
    }
  })

  watch(
    libraryId,
    () => {
      podcastEvents.subscribeLibrary(libraryId.value)
      for (const lane of Object.values(lanes)) lane.reset()
      queueDurationSeconds.value = 0
      episodeDurationSeconds.value = 0
    },
    { immediate: true },
  )

  function loadShows(append = false) {
    return shows.load(append, PAGE_SIZE)
  }

  function loadEpisodes(append = false) {
    return episodes.load(append, PAGE_SIZE)
  }

  function loadQueue(append = false) {
    return queue.load(append, PAGE_SIZE)
  }

  function loadHealth(append = false) {
    return health.load(append, PAGE_SIZE)
  }

  /** Queues everything the active playlist matches in one bounded server call rather than one request per episode. */
  async function queuePlaylistEpisodes(rules: PodcastPlaylistRules, limit = PODCAST_PLAYLIST_QUEUE_LIMIT): Promise<PodcastBulkActionResult> {
    const body: Record<string, unknown> = { ...playlistRuleBody(rules), limit }
    if (search.value.trim()) body.q = search.value.trim()
    const result = await apiJson<PodcastBulkActionResult>(
      `/api/v1/podcast-libraries/${libraryId.value}/queue-episodes`,
      jsonBody('POST', body),
      'podcast.errors.queuePlaylist',
    )
    queue.total.value += result.completed
    return result
  }

  async function follow(show: PodcastListItem, notificationMode: PodcastListItem['notificationMode']) {
    await apiJson(`/api/v1/podcasts/${show.id}/follow`, jsonBody('POST', { notificationMode }), 'podcast.errors.follow')
    show.followed = true
    show.notificationMode = notificationMode
  }

  async function unfollow(show: PodcastListItem) {
    await apiJson(`/api/v1/podcasts/${show.id}/follow`, { method: 'DELETE' }, 'podcast.errors.unfollow')
    show.followed = false
    show.notificationMode = 'off'
  }

  async function addToQueue(episode: PodcastEpisodeListItem) {
    const wasQueued = episode.queued
    await podcastQueue.add(episode.id)
    episode.queued = true
    if (!wasQueued) queue.total.value++
  }

  async function removeFromQueue(episode: PodcastEpisodeListItem) {
    const wasQueued = episode.queued
    await podcastQueue.remove(episode.id)
    episode.queued = false
    const previousLength = queue.items.value.length
    queue.items.value = queue.items.value.filter((item) => item.id !== episode.id)
    if (wasQueued || previousLength !== queue.items.value.length) queue.total.value = Math.max(0, queue.total.value - 1)
  }

  async function setPinned(episode: PodcastEpisodeListItem, pinned: boolean) {
    const previous = episode.pinned
    episode.pinned = pinned
    try {
      await updateEpisodeState(episode.id, { pinned }, 'podcast.errors.updatePinned')
    } catch (reason) {
      episode.pinned = previous
      throw reason
    }
  }

  /** Keeps rendered rows in step with a metadata edit, so an open list does not need a refetch to show it. */
  function applyEpisodeMetadata(updated: PodcastEpisodeSummary) {
    for (const item of findEpisodeRows(updated.id)) applyEpisodeMetadataFields(item, updated)
  }

  return {
    lanes,
    shows: shows.items,
    episodes: episodes.items,
    queue: queue.items,
    health: health.items,
    downloadProgress: podcastEvents.downloadProgress,
    totalShows: shows.total,
    totalEpisodes: episodes.total,
    totalHealth: health.total,
    totalQueue: queue.total,
    queueDurationSeconds,
    episodeDurationSeconds,
    playlistRules,
    filter,
    showSort,
    episodeSort,
    search,
    followedOnly,
    missingOnly,
    hasMoreShows: shows.hasMore,
    hasMoreEpisodes: episodes.hasMore,
    hasMoreHealth: health.hasMore,
    hasMoreQueue: queue.hasMore,
    loadShows,
    loadEpisodes,
    loadQueue,
    loadHealth,
    queuePlaylistEpisodes,
    follow,
    unfollow,
    addToQueue,
    removeFromQueue,
    setPinned,
    applyEpisodeMetadata,
  }
}

export type PodcastLibraryLane = keyof ReturnType<typeof usePodcasts>['lanes']
