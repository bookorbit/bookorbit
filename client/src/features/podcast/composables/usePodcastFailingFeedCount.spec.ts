// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { PodcastRefreshCompleteEvent } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastFailingFeedCount } from './usePodcastFailingFeedCount'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

const refreshCallbacks = new Set<(event: PodcastRefreshCompleteEvent) => void>()
vi.mock('./usePodcastEvents', () => ({
  usePodcastEvents: () => ({
    onRefreshComplete: (callback: (event: PodcastRefreshCompleteEvent) => void) => {
      refreshCallbacks.add(callback)
      return () => refreshCallbacks.delete(callback)
    },
  }),
}))

const apiMock = vi.mocked(api)

function activity(failingFeeds: number): Response {
  const body = { jobs: { queued: 0, processing: 0, failed: 0 }, importScan: null, downloads: {}, failingFeeds }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

/** Runs the composable in its own scope so the event registration is cleaned up between tests. */
function mount(libraryId = 13, enabled = true) {
  const scope = effectScope()
  const result = scope.run(() => usePodcastFailingFeedCount(ref(libraryId), ref(enabled)))!
  return { ...result, stop: () => scope.stop() }
}

beforeEach(() => {
  apiMock.mockReset()
  refreshCallbacks.clear()
  vi.useRealTimers()
})

describe('usePodcastFailingFeedCount', () => {
  it('counts across the whole library rather than a loaded page of shows', async () => {
    apiMock.mockResolvedValue(activity(1))

    const { hasFailingFeeds, stop } = mount()
    await vi.waitFor(() => expect(hasFailingFeeds.value).toBe(true))

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-libraries/13/activity', undefined)
    stop()
  })

  it('reports nothing wrong when no feed is failing', async () => {
    apiMock.mockResolvedValue(activity(0))

    const { hasFailingFeeds, stop } = mount()
    await nextTick()
    await nextTick()

    expect(hasFailingFeeds.value).toBe(false)
    stop()
  })

  it('does not request the count without permission to read it', async () => {
    const { hasFailingFeeds, stop } = mount(13, false)
    await nextTick()

    expect(apiMock).not.toHaveBeenCalled()
    expect(hasFailingFeeds.value).toBe(false)
    stop()
  })

  it('recounts once for a burst of refresh events in the watched library', async () => {
    apiMock.mockResolvedValue(activity(0))
    const { stop } = mount()
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1))

    apiMock.mockResolvedValue(activity(2))
    for (const podcastId of [1, 2, 3]) {
      for (const callback of refreshCallbacks) callback({ libraryId: 13, podcastId, consecutiveFailures: 1 } as PodcastRefreshCompleteEvent)
    }
    for (const callback of refreshCallbacks) callback({ libraryId: 99, podcastId: 4, consecutiveFailures: 1 } as PodcastRefreshCompleteEvent)

    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
    stop()
  })

  it('stays silent when the count cannot be read', async () => {
    apiMock.mockResolvedValue(new Response(null, { status: 403 }))

    const { hasFailingFeeds, stop } = mount()
    await nextTick()
    await nextTick()

    expect(hasFailingFeeds.value).toBe(false)
    stop()
  })
})
