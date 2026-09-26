import { effectScope } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastEpisodeListActions } from './usePodcastEpisodeListActions'

const playerMocks = vi.hoisted(() => ({
  episode: { value: null as { id: number } | null },
  togglePlayback: vi.fn<() => void>(),
  playInline: vi.fn<(episodeId: number) => Promise<void>>(async () => undefined),
  queueEpisodeNext: vi.fn<(episodeId: number) => Promise<void>>(async () => undefined),
}))
const queueMocks = vi.hoisted(() => ({
  add: vi.fn<(episodeId: number) => Promise<void>>(async () => undefined),
  remove: vi.fn<(episodeId: number) => Promise<void>>(async () => undefined),
}))
const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))
const push = vi.fn<() => void>()

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('./usePodcastPlayer', () => ({ usePodcastPlayer: () => playerMocks }))
vi.mock('./usePodcastQueue', () => ({ usePodcastQueue: () => queueMocks, notifyEpisodesDequeued: vi.fn<() => void>() }))
vi.mock('./usePodcastAnnouncer', () => ({ usePodcastAnnouncer: () => ({ announce: vi.fn<() => Promise<void>>(async () => undefined) }) }))

const apiMock = vi.mocked(api)

function actions(options: Parameters<typeof usePodcastEpisodeListActions>[0] = {}) {
  return effectScope().run(() => usePodcastEpisodeListActions(options))!
}

function episode(overrides: Partial<PodcastEpisodeListItem> = {}): PodcastEpisodeListItem {
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

describe('usePodcastEpisodeListActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    playerMocks.episode.value = null
    apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it('toggles playback for the episode already loaded and starts any other', async () => {
    const row = episode()
    await actions().play(row)
    expect(playerMocks.playInline).toHaveBeenCalledWith(42)

    playerMocks.episode.value = { id: 42 }
    await actions().play(row)

    expect(playerMocks.togglePlayback).toHaveBeenCalled()
  })

  it('queues a download and marks the row without waiting for the server to say so twice', async () => {
    const row = episode()

    await actions().download(row)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-episodes/42/download', { method: 'POST' })
    expect(row.mediaStatus).toBe('queued')
    expect(toastMocks.success).toHaveBeenCalledWith('podcast.messages.downloadQueued')
  })

  it('drops a cached feed copy but never touches a local episode file', async () => {
    const cached = episode({ mediaStatus: 'local', localSizeBytes: 2048 })

    await actions().removeDownload(cached)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-episodes/42/download', { method: 'DELETE' })
    expect(cached.mediaStatus).toBe('remote')
    expect(cached.localSizeBytes).toBeNull()

    apiMock.mockClear()
    await actions().removeDownload(episode({ origin: 'local', mediaStatus: 'local' }))

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('moves position and progress to the end when an episode is finished', async () => {
    const row = episode()

    await actions().finish(row)

    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body))).toEqual({ finished: true })
    expect(row).toMatchObject({ finished: true, positionSeconds: 300, progressPercent: 100 })
  })

  it('rolls a pin back and reports it when the server refuses', async () => {
    apiMock.mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), { status: 400 }))
    const row = episode()

    await actions().pin(row)

    expect(row.pinned).toBe(false)
    expect(toastMocks.error).toHaveBeenCalled()
  })

  it('prefers the caller queue handling when a view keeps its own totals', async () => {
    const addToQueue = vi.fn<(item: PodcastEpisodeListItem) => Promise<void>>(async () => undefined)
    const row = episode()

    await actions({ addToQueue }).queue(row)

    expect(addToQueue).toHaveBeenCalledWith(row)
    expect(queueMocks.add).not.toHaveBeenCalled()
  })

  it('falls back to the shared queue and flags the row when a view has nothing to keep', async () => {
    const row = episode()

    await actions().queue(row)

    expect(queueMocks.add).toHaveBeenCalledWith(42)
    expect(row.queued).toBe(true)
  })
})
