import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeListItem, PodcastQueueItem } from '@bookorbit/types'
import PodcastQueueList from './PodcastQueueList.vue'
import PodcastQueuePanel from './PodcastQueuePanel.vue'

const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))
const apiMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 })))
vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: apiMock }))

function item(id: number, overrides: Partial<PodcastQueueItem> = {}): PodcastQueueItem {
  return {
    id,
    libraryId: 7,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: `Episode ${id}`,
    season: null,
    episode: null,
    explicit: false,
    inFeed: true,
    publishedAt: null,
    durationSeconds: 600,
    audioFormat: null,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: false,
    pinned: false,
    queued: true,
    lastListenedAt: null,
    queuePosition: id - 1,
    ...overrides,
  }
}

const passthrough = defineComponent({
  setup:
    (_props, { slots }) =>
    () =>
      h('div', [slots.default?.(), slots.content?.()]),
})

function mountPanel(overrides: Partial<InstanceType<typeof PodcastQueuePanel>['$props']> = {}) {
  const removeFromQueue = vi.fn<(episode: PodcastEpisodeListItem) => Promise<void>>(async () => undefined)
  const reload = vi.fn<() => Promise<void>>(async () => undefined)
  const wrapper = mount(PodcastQueuePanel, {
    props: {
      items: [item(1), item(2)],
      total: 2,
      durationSeconds: 1200,
      refreshing: false,
      hasSearchQuery: false,
      canDownload: true,
      selectionMode: true,
      activeEpisodeId: null,
      isPlaying: false,
      downloadProgress: new Map(),
      removeFromQueue,
      reload,
      ...overrides,
    },
    global: {
      stubs: {
        PodcastQueueList: true,
        SelectionActionBar: passthrough,
        Tooltip: passthrough,
        TooltipTrigger: passthrough,
        TooltipContent: passthrough,
      },
    },
  })
  return { wrapper, removeFromQueue, reload }
}

function stateWrites(): Array<[string, unknown]> {
  return apiMock.mock.calls
    .filter(([url, init]) => url.endsWith('/state') && init?.method === 'PATCH')
    .map(([url, init]) => [url, JSON.parse(String(init?.body)) as unknown])
}

describe('PodcastQueuePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  })

  it('marks only the selected unfinished episodes as played', async () => {
    const { wrapper } = mountPanel({ items: [item(1, { finished: true }), item(2)] })
    wrapper.findComponent(PodcastQueueList).vm.$emit('toggleSelect', 1, true)
    wrapper.findComponent(PodcastQueueList).vm.$emit('toggleSelect', 2, true)
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="podcast-bulk-mark-played"]').trigger('click')
    await flushPromises()

    expect(stateWrites()).toEqual([['/api/v1/podcast-episodes/2/state', { finished: true }]])
    expect(wrapper.get('[data-testid="podcast-bulk-outcome"]').text()).toContain('1')
  })

  it('reports the failures in a bulk update rather than claiming success', async () => {
    apiMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    const { wrapper } = mountPanel({ items: [item(1)] })
    wrapper.findComponent(PodcastQueueList).vm.$emit('toggleSelect', 1, true)
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="podcast-bulk-mark-played"]').trigger('click')
    await flushPromises()

    expect(toastMocks.error).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="podcast-bulk-outcome"]').text()).toContain('1')
  })

  it('downloads only the selected episodes that have no local file yet', async () => {
    const { wrapper } = mountPanel({ items: [item(1, { mediaStatus: 'local' }), item(2)] })
    wrapper.findComponent(PodcastQueueList).vm.$emit('toggleSelect', 1, true)
    wrapper.findComponent(PodcastQueueList).vm.$emit('toggleSelect', 2, true)
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="podcast-bulk-download"]').trigger('click')
    await flushPromises()

    expect(apiMock.mock.calls.filter(([url]) => url.endsWith('/download'))).toEqual([['/api/v1/podcast-episodes/2/download', { method: 'POST' }]])
  })

  it('removes a selected queue subset with bounded work and reloads the remaining rows', async () => {
    const { wrapper, removeFromQueue, reload } = mountPanel()
    wrapper.findComponent(PodcastQueueList).vm.$emit('toggleSelect', 1, true)
    wrapper.findComponent(PodcastQueueList).vm.$emit('toggleSelect', 2, true)
    await wrapper.vm.$nextTick()
    await wrapper.get('[data-testid="podcast-bulk-remove-from-queue"]').trigger('click')
    await flushPromises()

    expect(removeFromQueue).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('hides download controls when the user lacks download permission', () => {
    const { wrapper } = mountPanel({ canDownload: false })

    expect(wrapper.text()).not.toContain('Download selected')
    expect(wrapper.text()).not.toContain('Remove selected downloads')
  })

  it('offers route-level recovery actions for an empty queue', async () => {
    const { wrapper } = mountPanel({ items: [], total: 0, selectionMode: false })
    const buttons = wrapper.findAll('button')

    await buttons.find((button) => button.text().includes('Browse episodes'))!.trigger('click')
    await buttons.find((button) => button.text().includes('Browse shows'))!.trigger('click')

    expect(wrapper.emitted('browse-episodes')).toHaveLength(1)
    expect(wrapper.emitted('browse-shows')).toHaveLength(1)
  })
})
