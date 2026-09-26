import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastDownloadBatch } from '@bookorbit/types'
import PodcastDownloadWidget from './PodcastDownloadWidget.vue'

const mockUsePodcastDownloadBatches = vi.hoisted(() => vi.fn<() => unknown>())
const batches = ref<PodcastDownloadBatch[]>([])
const start = vi.fn<() => void>()
const stop = vi.fn<() => void>()
const dismiss = vi.fn<(batchId: string) => void>()

vi.mock('../composables/usePodcastDownloadBatches', () => ({
  usePodcastDownloadBatches: mockUsePodcastDownloadBatches,
}))

describe('PodcastDownloadWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    batches.value = []
    mockUsePodcastDownloadBatches.mockReturnValue({ batches, loading: ref(false), start, stop, dismiss })
  })

  it('stays absent without bulk work and owns the global event lifecycle', () => {
    const wrapper = mount(PodcastDownloadWidget)

    expect(wrapper.find('[data-testid="podcast-download-widget"]').exists()).toBe(false)
    expect(start).toHaveBeenCalledOnce()

    wrapper.unmount()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('shows aggregate progress and expands into bounded per-episode detail', async () => {
    batches.value = [batch()]
    const wrapper = mount(PodcastDownloadWidget)

    expect(wrapper.text()).toContain('1 of 2 downloaded')
    expect(wrapper.find('[data-testid="download-batch-list"]').exists()).toBe(false)
    expect(wrapper.get('[role="progressbar"]').attributes('aria-valuenow')).toBe('50')

    await wrapper.get('button[aria-label="Expand download progress"]').trigger('click')

    expect(wrapper.get('[data-testid="download-batch-list"]').text()).toContain('Orbit Radio')
    expect(wrapper.text()).toContain('Launch')
    expect(wrapper.text()).toContain('Landing')
    const episodeProgress = wrapper.get('[role="progressbar"][aria-label="Download progress for Landing"]')
    expect(episodeProgress.attributes('aria-valuenow')).toBeUndefined()
  })

  it('keeps failures visible and offers a translated accessible dismiss action', async () => {
    const failed = batch()
    failed.items[1]!.status = 'failed'
    failed.downloading = 0
    failed.failed = 1
    batches.value = [failed]
    const wrapper = mount(PodcastDownloadWidget)

    expect(wrapper.text()).toContain('1 of 2 downloaded; 1 failed')
    await wrapper.get('button[aria-label="Expand download progress"]').trigger('click')
    await wrapper.get('button[aria-label="Dismiss download progress"]').trigger('click')

    expect(dismiss).toHaveBeenCalledWith(BATCH_ID)
  })
})

const BATCH_ID = '0f31ea6f-03f0-4e3d-ae5c-1467ae7ec115'

function batch(): PodcastDownloadBatch {
  return {
    id: BATCH_ID,
    libraryId: 7,
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    total: 2,
    queued: 0,
    downloading: 1,
    completed: 1,
    failed: 0,
    cancelled: 0,
    receivedBytes: 125,
    totalBytes: null,
    createdAt: '2026-08-01T12:00:00.000Z',
    updatedAt: '2026-08-01T12:02:00.000Z',
    items: [
      { episodeId: 42, title: 'Launch', status: 'completed', receivedBytes: 100, totalBytes: 100 },
      { episodeId: 43, title: 'Landing', status: 'downloading', receivedBytes: 25, totalBytes: null },
    ],
  }
}
