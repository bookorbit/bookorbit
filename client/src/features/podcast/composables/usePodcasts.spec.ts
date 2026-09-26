import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { PodcastEpisodeListItem, PodcastQueueItem } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcasts } from './usePodcasts'
import { usePodcastAnnouncer } from './usePodcastAnnouncer'
import { notifyEpisodesDequeued } from './usePodcastQueue'

const podcastEvents = await vi.hoisted(async () => {
  const { mockPodcastEvents } = await import('../test/stubs')
  return mockPodcastEvents()
})
const eventCallbacks = podcastEvents.callbacks
const subscribeLibrary = podcastEvents.subscribeLibrary

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('./usePodcastEvents', () => ({ usePodcastEvents: podcastEvents.usePodcastEvents }))

const apiMock = vi.mocked(api)
const episode = { id: 42, title: 'A stable row' } as PodcastEpisodeListItem

function pageResponse(items: PodcastEpisodeListItem[], total = items.length) {
  return new Response(JSON.stringify({ items, total, page: 1, size: 50 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((fulfill) => {
    resolve = fulfill
  })
  return { promise, resolve }
}

describe('usePodcasts loading state', () => {
  beforeEach(() => {
    apiMock.mockReset()
    subscribeLibrary.mockClear()
    eventCallbacks.downloadProgress = null
    eventCallbacks.downloadComplete = null
    eventCallbacks.refreshComplete = null
    eventCallbacks.retentionEvicted = null
  })

  it('patches loaded episode, queue, show, and health state from realtime events', () => {
    const podcast = usePodcasts(ref(6))
    podcast.episodes.value = [
      {
        ...episode,
        mediaStatus: 'remote',
        localSizeBytes: null,
      } as PodcastEpisodeListItem,
    ]
    podcast.queue.value = [
      {
        ...episode,
        mediaStatus: 'remote',
        localSizeBytes: null,
        queuePosition: 0,
      } as PodcastEpisodeListItem & { queuePosition: number },
    ]
    podcast.shows.value = [
      {
        id: 3,
        episodeCount: 10,
        unplayedCount: 4,
        downloadedCount: 0,
        consecutiveFailures: 1,
      } as (typeof podcast.shows.value)[number],
    ]
    podcast.health.value = [
      {
        podcastId: 3,
        consecutiveFailures: 1,
        lastError: 'timeout',
        lastRefreshSuccessAt: null,
      } as (typeof podcast.health.value)[number],
    ]

    eventCallbacks.downloadProgress?.({
      libraryId: 6,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      status: 'downloading',
      receivedBytes: 25,
      totalBytes: 100,
    })
    expect(podcast.episodes.value[0]!.mediaStatus).toBe('downloading')
    expect(podcast.queue.value[0]!.mediaStatus).toBe('downloading')

    eventCallbacks.downloadComplete?.({
      libraryId: 6,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 100,
    })
    expect(podcast.episodes.value[0]).toMatchObject({ mediaStatus: 'local', localSizeBytes: 100 })
    expect(podcast.shows.value[0]!.downloadedCount).toBe(1)

    eventCallbacks.refreshComplete?.({
      libraryId: 6,
      podcastId: 3,
      newEpisodes: 2,
      consecutiveFailures: 0,
      lastError: null,
    })
    expect(podcast.shows.value[0]).toMatchObject({ episodeCount: 12, unplayedCount: 6, consecutiveFailures: 0 })
    expect(podcast.health.value[0]).toMatchObject({ consecutiveFailures: 0, lastError: null })
    expect(podcast.health.value[0]!.lastRefreshSuccessAt).not.toBeNull()
  })

  it('announces download outcomes that produce no toast', async () => {
    const { message } = usePodcastAnnouncer()
    const podcast = usePodcasts(ref(6))
    podcast.episodes.value = [{ ...episode, mediaStatus: 'downloading', localSizeBytes: null } as PodcastEpisodeListItem]

    eventCallbacks.downloadComplete?.({
      libraryId: 6,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 100,
    })
    await nextTick()

    expect(message.value).toBe('podcast.announce.downloadReady')

    eventCallbacks.downloadComplete?.({
      libraryId: 6,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'failed',
      localSizeBytes: null,
    })
    await nextTick()

    expect(message.value).toBe('podcast.announce.downloadFailed')
  })

  it('flips an evicted download back to remote and announces why', async () => {
    const { message } = usePodcastAnnouncer()
    const podcast = usePodcasts(ref(6))
    podcast.episodes.value = [{ ...episode, mediaStatus: 'local', localSizeBytes: 100 } as PodcastEpisodeListItem]
    podcast.shows.value = [{ id: 3, downloadedCount: 2 } as (typeof podcast.shows.value)[number]]

    eventCallbacks.retentionEvicted?.({ libraryId: 6, podcastId: 3, episodeId: 42, reason: 'played' })
    await nextTick()

    expect(podcast.episodes.value[0]).toMatchObject({ mediaStatus: 'remote', localSizeBytes: null })
    expect(podcast.shows.value[0]!.downloadedCount).toBe(1)
    expect(message.value).toBe('podcast.announce.evictedPlayed')
  })

  it('announces a pressure eviction with its own reason', async () => {
    const { message } = usePodcastAnnouncer()
    const podcast = usePodcasts(ref(6))
    podcast.episodes.value = [{ ...episode, mediaStatus: 'local', localSizeBytes: 100 } as PodcastEpisodeListItem]

    eventCallbacks.retentionEvicted?.({ libraryId: 6, podcastId: 3, episodeId: 42, reason: 'space' })
    await nextTick()

    expect(message.value).toBe('podcast.announce.evictedSpace')
  })

  it('ignores an eviction for another library', async () => {
    const podcast = usePodcasts(ref(6))
    podcast.episodes.value = [{ ...episode, mediaStatus: 'local', localSizeBytes: 100 } as PodcastEpisodeListItem]

    eventCallbacks.retentionEvicted?.({ libraryId: 9, podcastId: 3, episodeId: 42, reason: 'played' })

    expect(podcast.episodes.value[0]!.mediaStatus).toBe('local')
  })

  it('ignores a download event for another library', async () => {
    const { message } = usePodcastAnnouncer()
    const podcast = usePodcasts(ref(6))
    podcast.episodes.value = [{ ...episode, mediaStatus: 'downloading', localSizeBytes: null } as PodcastEpisodeListItem]
    const announced = message.value

    eventCallbacks.downloadComplete?.({
      libraryId: 9,
      podcastId: 3,
      episodeId: 42,
      batchId: null,
      jobStatus: null,
      mediaStatus: 'local',
      localSizeBytes: 100,
    })
    await nextTick()

    expect(message.value).toBe(announced)
    expect(podcast.episodes.value[0]!.mediaStatus).toBe('downloading')
  })

  it('appends the next page onto the loaded episodes', async () => {
    apiMock.mockResolvedValueOnce(pageResponse([episode], 2))
    const podcast = usePodcasts(ref(6))

    await podcast.loadEpisodes()

    expect(podcast.hasMoreEpisodes.value).toBe(true)

    const nextPage = deferredResponse()
    apiMock.mockReturnValueOnce(nextPage.promise)
    const request = podcast.loadEpisodes(true)

    expect(podcast.lanes.episodes.loadingMore.value).toBe(true)
    expect(podcast.lanes.episodes.loading.value).toBe(false)
    expect(podcast.episodes.value).toEqual([episode])

    const second = { ...episode, id: 43 }
    nextPage.resolve(pageResponse([second], 2))
    await request

    expect(podcast.lanes.episodes.loadingMore.value).toBe(false)
    expect(podcast.episodes.value).toEqual([episode, second])
    expect(podcast.lanes.episodes.page.value).toBe(1)
    expect(podcast.hasMoreEpisodes.value).toBe(false)
  })

  it('treats an empty successful result as initialized during refresh', async () => {
    apiMock.mockResolvedValueOnce(pageResponse([]))
    const podcast = usePodcasts(ref(6))

    await podcast.loadEpisodes()

    const refresh = deferredResponse()
    apiMock.mockReturnValueOnce(refresh.promise)
    const request = podcast.loadEpisodes()

    expect(podcast.lanes.episodes.loading.value).toBe(true)
    expect(podcast.lanes.episodes.initialized.value).toBe(true)

    refresh.resolve(pageResponse([]))
    await request
  })

  it('clears initialized data when the library changes', async () => {
    apiMock.mockResolvedValueOnce(pageResponse([episode]))
    const libraryId = ref(6)
    const podcast = usePodcasts(libraryId)
    await podcast.loadEpisodes()

    libraryId.value = 7
    await nextTick()

    expect(podcast.episodes.value).toEqual([])
    expect(podcast.lanes.episodes.initialized.value).toBe(false)
    expect(podcast.totalEpisodes.value).toBe(0)
  })

  it('optimistically pins an episode and rolls back when the request fails', async () => {
    const pinnedEpisode = { ...episode, pinned: false }
    const pending = deferredResponse()
    apiMock.mockReturnValueOnce(pending.promise)
    const podcast = usePodcasts(ref(6))

    const request = podcast.setPinned(pinnedEpisode, true)
    expect(pinnedEpisode.pinned).toBe(true)

    pending.resolve(new Response(null, { status: 500 }))
    await expect(request).rejects.toThrow('Failed to update pinned state')
    expect(pinnedEpisode.pinned).toBe(false)
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-episodes/42/state',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ pinned: true }) }),
    )
  })
})

describe('usePodcasts dequeue notifications', () => {
  beforeEach(() => {
    apiMock.mockReset()
    subscribeLibrary.mockClear()
  })

  function queueItem(id: number, durationSeconds: number) {
    return { id, title: `Episode ${id}`, durationSeconds, queuePosition: id } as unknown as PodcastQueueItem
  }

  it('drops a finished episode from the loaded queue, the total and the duration', () => {
    const podcast = usePodcasts(ref(6))
    podcast.queue.value = [queueItem(1, 600), queueItem(2, 300)]
    podcast.totalQueue.value = 7
    podcast.queueDurationSeconds.value = 2400

    notifyEpisodesDequeued([2])

    expect(podcast.queue.value.map((item) => item.id)).toEqual([1])
    expect(podcast.totalQueue.value).toBe(6)
    expect(podcast.queueDurationSeconds.value).toBe(2100)
  })

  it('clears the queued flag on an episode row the queue lane is not rendering', () => {
    const podcast = usePodcasts(ref(6))
    const listed = { ...episode, queued: true } as PodcastEpisodeListItem
    podcast.episodes.value = [listed]
    podcast.totalQueue.value = 3

    notifyEpisodesDequeued([episode.id])

    expect(listed.queued).toBe(false)
    expect(podcast.totalQueue.value).toBe(2)
  })

  it('counts a row held by both lanes once', () => {
    const podcast = usePodcasts(ref(6))
    podcast.queue.value = [queueItem(42, 60)]
    podcast.episodes.value = [{ ...episode, queued: true } as PodcastEpisodeListItem]
    podcast.totalQueue.value = 5

    notifyEpisodesDequeued([42])

    expect(podcast.totalQueue.value).toBe(4)
  })

  it('leaves the total alone when the dequeued episode was not queued here', () => {
    const podcast = usePodcasts(ref(6))
    podcast.queue.value = [queueItem(1, 60)]
    podcast.totalQueue.value = 4

    notifyEpisodesDequeued([99])

    expect(podcast.queue.value.map((item) => item.id)).toEqual([1])
    expect(podcast.totalQueue.value).toBe(4)
  })
})
