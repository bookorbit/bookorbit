import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastQueueItem } from '@bookorbit/types'
import PodcastEpisodeRow from './PodcastEpisodeRow.vue'
import PodcastQueueList from './PodcastQueueList.vue'
import { createPodcastEpisodeActionsStub, provideEpisodeActions } from '../test/episode-action-stubs'

const queueMock = vi.hoisted(() => ({ reorder: vi.fn<(episodeIds: number[]) => Promise<void>>(async () => undefined) }))
const toastMocks = vi.hoisted(() => ({ success: vi.fn<() => void>(), error: vi.fn<() => void>() }))

vi.mock('vue-sonner', () => ({ toast: toastMocks }))
vi.mock('../composables/usePodcastQueue', () => ({ usePodcastQueue: () => queueMock, notifyEpisodesDequeued: vi.fn<() => void>() }))

describe('PodcastQueueList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders full episode rows with reordering and selection for the library tab', () => {
    const wrapper = mountList({ reorderable: true, selectable: true, selectedIds: new Set([2]) })

    expect(wrapper.findAllComponents(PodcastEpisodeRow)).toHaveLength(2)
    expect(wrapper.findAll('button[aria-label^="Reorder"]')).toHaveLength(2)
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect((checkboxes[1]!.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.findAll('[data-testid="podcast-queue-position"]').map((position) => position.text())).toEqual(['1', '2'])
  })

  it('reports selection changes without owning the selected set', async () => {
    const wrapper = mountList({ reorderable: true, selectable: true, selectedIds: new Set() })

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)

    expect(wrapper.emitted('toggleSelect')).toEqual([[1, true]])
  })

  it('updates position numbers immediately during keyboard reordering', async () => {
    const wrapper = mountList({ reorderable: true })
    const firstGrip = wrapper.findAll('button[aria-label^="Reorder"]')[0]!

    await firstGrip.trigger('keydown', { key: ' ' })
    await firstGrip.trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.findAllComponents(PodcastEpisodeRow).map((row) => row.props('episode').id)).toEqual([2, 1])
    expect(wrapper.findAll('[data-testid="podcast-queue-position"]').map((position) => position.text())).toEqual(['1', '2'])
  })

  it('persists a move to the top as one bulk reorder request', async () => {
    const wrapper = mountList({ reorderable: true })

    wrapper.findAllComponents(PodcastEpisodeRow)[1]!.vm.$emit('moveTop', queueItem(2))
    await flushPromises()

    expect(queueMock.reorder).toHaveBeenCalledTimes(1)
    expect(queueMock.reorder).toHaveBeenCalledWith([2, 1])
  })

  it('restores the previous order and offers a retry when persistence fails', async () => {
    queueMock.reorder.mockRejectedValueOnce(new Error('nope'))
    const wrapper = mountList({ reorderable: true })

    wrapper.findAllComponents(PodcastEpisodeRow)[1]!.vm.$emit('moveTop', queueItem(2))
    await flushPromises()

    expect(toastMocks.error).toHaveBeenCalledWith('nope')
    expect(wrapper.findAllComponents(PodcastEpisodeRow).map((row) => row.props('episode').id)).toEqual([1, 2])
  })

  it('renders the dense up-next list the players share, with positions and the next marker', () => {
    const wrapper = mountList({ density: 'compact', showPosition: true, nextPosition: 1 })

    expect(wrapper.findAllComponents(PodcastEpisodeRow)).toHaveLength(0)
    expect(wrapper.findAll('button[aria-label^="Reorder"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Next')
    expect(wrapper.text()).toContain('Episode 1')
    expect(wrapper.text()).toContain('Episode 2')
  })

  it('drives play and unqueue from the dense list', async () => {
    const actions = createPodcastEpisodeActionsStub()
    const wrapper = mountList({ density: 'compact' }, actions)

    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.get('button[aria-label="Remove Episode 1 from queue"]').trigger('click')

    expect(actions.play).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
    expect(actions.unqueue).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })

  it('renders nothing when the queue is empty', () => {
    const wrapper = mount(PodcastQueueList, { props: { items: [], canDownload: true } })

    expect(wrapper.find('div').exists()).toBe(false)
  })
})

function mountList(props: Record<string, unknown> = {}, actions = createPodcastEpisodeActionsStub()) {
  return mount(PodcastQueueList, {
    props: { items: [queueItem(1), queueItem(2)], canDownload: true, ...props },
    global: { provide: provideEpisodeActions(actions) },
  })
}

function queueItem(id: number): PodcastQueueItem {
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
    publishedAt: '2026-07-20T00:00:00.000Z',
    durationSeconds: 1_200,
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
  }
}
