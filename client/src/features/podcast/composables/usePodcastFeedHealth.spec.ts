// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { PodcastFeedHealth } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastFeedHealth } from './usePodcastFeedHealth'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))

const apiMock = vi.mocked(api)

function health(overrides: Partial<PodcastFeedHealth> = {}): PodcastFeedHealth {
  return {
    podcastId: 3,
    title: 'Orbit Radio',
    lastRefreshAt: null,
    lastRefreshSuccessAt: null,
    consecutiveFailures: 2,
    nextRefreshAt: '2026-08-01T00:00:00.000Z',
    lastError: 'timeout',
    lastHttpStatus: null,
    ...overrides,
  }
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  toastMocks.success.mockClear()
  toastMocks.error.mockClear()
})

describe('usePodcastFeedHealth', () => {
  it('derives which rows a bulk retry covers from the list it was given', async () => {
    const items = ref([health(), health({ podcastId: 4, consecutiveFailures: 0 })])
    const feedHealth = usePodcastFeedHealth(items)

    expect(feedHealth.hasUnhealthyFeeds.value).toBe(true)

    await feedHealth.refreshUnhealthy()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/3/refresh', { method: 'POST' })
  })

  it('follows the list rather than a snapshot taken when it was created', async () => {
    const items = ref<PodcastFeedHealth[]>([health({ consecutiveFailures: 0 })])
    const feedHealth = usePodcastFeedHealth(items)
    expect(feedHealth.hasUnhealthyFeeds.value).toBe(false)

    items.value = [health({ podcastId: 9 })]

    expect(feedHealth.hasUnhealthyFeeds.value).toBe(true)
    await feedHealth.refreshUnhealthy()
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/9/refresh', { method: 'POST' })
  })

  it('reports partial failure of a bulk retry instead of claiming success', async () => {
    apiMock.mockImplementation(async (url) => new Response(null, { status: String(url).includes('/4/') ? 500 : 204 }))
    const feedHealth = usePodcastFeedHealth(ref([health(), health({ podcastId: 4 })]))

    await feedHealth.refreshUnhealthy()

    expect(toastMocks.error).toHaveBeenCalledWith('podcast.messages.bulkQueueActionFailed')
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(feedHealth.refreshingUnhealthy.value).toBe(false)
  })

  it('names the missing-snapshot case when a reparse has nothing to work from', async () => {
    apiMock.mockResolvedValue(new Response(null, { status: 404 }))
    const feedHealth = usePodcastFeedHealth(ref([health()]))

    await feedHealth.reparse(3)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/3/reparse', { method: 'POST' })
    expect(toastMocks.error).toHaveBeenCalledWith('podcast.errors.reparseNoSnapshot')
    expect(feedHealth.reparsingPodcastId.value).toBeNull()
  })

  it('does not fire a request when nothing in the list is failing', async () => {
    const feedHealth = usePodcastFeedHealth(ref([health({ consecutiveFailures: 0 })]))

    await feedHealth.refreshUnhealthy()

    expect(apiMock).not.toHaveBeenCalled()
  })
})
