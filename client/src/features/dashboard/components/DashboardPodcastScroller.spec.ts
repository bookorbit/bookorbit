import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import { api } from '@/lib/api'
import DashboardPodcastScroller from './DashboardPodcastScroller.vue'

const playerState = vi.hoisted(() => ({
  episode: undefined as Ref<{ id: number; finished: boolean } | null> | undefined,
  playInline: vi.fn<(episodeId: number) => Promise<void>>(),
  togglePlayback: vi.fn<() => void>(),
}))

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string) => Promise<Response>>() }))
vi.mock('@/features/podcast/composables/usePodcastPlayer', async () => {
  const { ref: createRef } = await import('vue')
  playerState.episode = createRef(null)
  return {
    usePodcastPlayer: () => ({
      episode: playerState.episode,
      playInline: playerState.playInline,
      togglePlayback: playerState.togglePlayback,
    }),
  }
})

const apiMock = vi.mocked(api)
const wrappers: VueWrapper[] = []

describe('DashboardPodcastScroller', () => {
  beforeEach(() => {
    apiMock.mockReset()
    playerState.episode!.value = null
    playerState.playInline.mockReset()
    playerState.togglePlayback.mockReset()
  })

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  })

  it('loads the cross-library resume feed and renders each episode', async () => {
    apiMock.mockImplementation(() => Promise.resolve(jsonResponse([episode(1), episode(2)])))
    const wrapper = mountScroller()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-episodes/continue?size=20')
    expect(wrapper.findAll('button[aria-label^="Resume "]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Orbit Radio')
    expect(wrapper.text()).toContain('50m left')
  })

  it('clamps the requested size to the endpoint maximum', async () => {
    apiMock.mockImplementation(() => Promise.resolve(jsonResponse([])))
    mountScroller(500)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-episodes/continue?size=50')
  })

  it('resumes an episode that is not loaded and toggles the one that is', async () => {
    apiMock.mockImplementation(() => Promise.resolve(jsonResponse([episode(1)])))
    const wrapper = mountScroller()
    await flushPromises()

    await wrapper.get('button[aria-label="Resume Episode 1"]').trigger('click')
    expect(playerState.playInline).toHaveBeenCalledWith(1)
    expect(playerState.togglePlayback).not.toHaveBeenCalled()

    playerState.episode!.value = { id: 1, finished: false }
    await nextTick()
    await wrapper.get('button[aria-label="Resume Episode 1"]').trigger('click')

    expect(playerState.playInline).toHaveBeenCalledTimes(1)
    expect(playerState.togglePlayback).toHaveBeenCalledTimes(1)
  })

  it('reloads once the active episode finishes so it drops out of the shelf', async () => {
    apiMock.mockResolvedValueOnce(jsonResponse([episode(1)])).mockResolvedValueOnce(jsonResponse([episode(2)]))
    const wrapper = mountScroller()
    await flushPromises()

    playerState.episode!.value = { id: 1, finished: true }
    await nextTick()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Episode 2')
    expect(wrapper.text()).not.toContain('Episode 1')
  })

  it('shows the empty state when nothing is in progress', async () => {
    apiMock.mockImplementation(() => Promise.resolve(jsonResponse([])))
    const wrapper = mountScroller()
    await flushPromises()

    expect(wrapper.findAll('button[aria-label^="Resume "]')).toHaveLength(0)
    expect(wrapper.text()).toContain('No podcast episodes in progress yet')
  })

  it('offers a retry after a failed request', async () => {
    apiMock.mockResolvedValueOnce(new Response(null, { status: 500 })).mockResolvedValueOnce(jsonResponse([episode(1)]))
    const wrapper = mountScroller()
    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load.')

    await wrapper.get('button.text-primary').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('button[aria-label^="Resume "]')).toHaveLength(1)
  })
})

function mountScroller(limit = 20) {
  const wrapper = mount(DashboardPodcastScroller, { props: { title: 'Continue Podcasts', limit } })
  wrappers.push(wrapper)
  return wrapper
}

function jsonResponse(items: PodcastEpisodeListItem[]) {
  return new Response(JSON.stringify(items), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function episode(id: number): PodcastEpisodeListItem {
  return {
    id,
    libraryId: 7,
    origin: 'feed',
    podcastId: 12,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: `Episode ${id}`,
    season: null,
    episode: null,
    explicit: false,
    inFeed: true,
    publishedAt: '2026-07-29T00:00:00.000Z',
    durationSeconds: 3_600,
    audioFormat: null,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 600,
    progressPercent: 16.67,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: '2026-07-29T01:00:00.000Z',
  }
}
