import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastFeedHealth } from '@bookorbit/types'
import { api } from '@/lib/api'
import PodcastHealthPanel from './PodcastHealthPanel.vue'

const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

const apiMock = vi.mocked(api)

function item(overrides: Partial<PodcastFeedHealth> = {}): PodcastFeedHealth {
  return {
    podcastId: 3,
    title: 'Orbit Radio',
    lastRefreshAt: null,
    lastRefreshSuccessAt: null,
    consecutiveFailures: 1,
    nextRefreshAt: '2026-08-01T00:00:00.000Z',
    lastError: 'Timeout',
    lastHttpStatus: null,
    ...overrides,
  }
}

describe('PodcastHealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it('renders the accessible empty state when no feeds are loaded', () => {
    const wrapper = mount(PodcastHealthPanel, { props: { items: [], refreshing: false } })

    expect(wrapper.text()).toContain('No feeds to monitor')
  })

  it('emits the selected show without owning route navigation', async () => {
    const wrapper = mount(PodcastHealthPanel, { props: { items: [item()], refreshing: false } })

    await wrapper.get('button[aria-label="Open Orbit Radio"]').trigger('click')

    expect(wrapper.emitted('open-show')).toEqual([[3]])
  })

  it('queues refreshes only for unhealthy loaded feeds', async () => {
    const wrapper = mount(PodcastHealthPanel, {
      props: { items: [item(), item({ podcastId: 4, title: 'Healthy Feed', consecutiveFailures: 0 })], refreshing: false },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Retry loaded failing feeds')!
      .trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/3/refresh', { method: 'POST' })
  })
})
