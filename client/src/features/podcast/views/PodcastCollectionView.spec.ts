import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import type { Collection, PodcastListItem, PodcastPage } from '@bookorbit/types'

const routeParams = ref<Record<string, string>>({ id: '5' })
const push = vi.fn<() => void>()

vi.mock('vue-router', () => ({
  useRoute: () => ({
    get params() {
      return routeParams.value
    },
  }),
  useRouter: () => ({ push }),
}))

const collections = ref<Collection[]>([])
const collectionsLoaded = ref(true)
const collectionsError = ref<string | null>(null)
const fetchCollectionPodcasts = vi.fn<(id: number, page?: number, size?: number) => Promise<PodcastPage<PodcastListItem>>>()
const removePodcastsFromCollection = vi.fn<(id: number, ids: number[]) => Promise<void>>()
const applyCollectionPodcastCount = vi.fn<(id: number, total: number) => void>()
const fetchCollections = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
const refreshCollections = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

vi.mock('@/features/collection/composables/useCollections', () => ({
  useCollections: () => ({
    collections,
    loaded: collectionsLoaded,
    error: collectionsError,
    fetchCollections,
    refreshCollections,
    fetchCollectionPodcasts,
    applyCollectionPodcastCount,
    removePodcastsFromCollection,
  }),
}))

const playInline = vi.fn<(episodeId: number) => Promise<void>>().mockResolvedValue(undefined)
vi.mock('@/features/podcast/composables/usePodcastPlayer', () => ({
  usePodcastPlayer: () => ({ playInline }),
}))

// vi.mock is hoisted above const declarations, so the spies have to be hoisted with it.
const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn<() => void>(), toastError: vi.fn<() => void>() }))
vi.mock('vue-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

vi.mock('@/composables/useInfiniteScrollSentinel', () => ({
  useInfiniteScrollSentinel: () => ({ sentinel: ref(null) }),
}))

vi.mock('@/i18n/formatters', () => ({ formatNumber: (value: number) => String(value) }))

import PodcastCollectionView from './PodcastCollectionView.vue'

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 5,
    userId: 7,
    mediaType: 'podcasts',
    name: 'Sci-fi podcasts',
    icon: 'FolderOpen',
    description: null,
    isPublic: false,
    isOwner: true,
    syncToKobo: false,
    displayOrder: 0,
    bookCount: 0,
    podcastCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makePage(items: PodcastListItem[], total = items.length): PodcastPage<PodcastListItem> {
  return { items, total, page: 1, size: 50 }
}

function makeShow(id: number, overrides: Partial<PodcastListItem> = {}): PodcastListItem {
  return {
    id,
    libraryId: 1,
    origin: 'feed',
    title: `Show ${id}`,
    author: null,
    imageUrl: null,
    episodeCount: 3,
    unplayedCount: 1,
    downloadedCount: 0,
    latestPublishedAt: null,
    consecutiveFailures: 0,
    playbackRecommendation: null,
    followed: true,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
    ...overrides,
  }
}

function mountView() {
  return mount(PodcastCollectionView, {
    global: {
      stubs: {
        EmptyState: { name: 'EmptyState', props: ['title', 'hint', 'icon'], template: '<div class="empty">{{ title }}</div>' },
        EntityNotFound: { name: 'EntityNotFound', props: ['entity'], template: '<div class="not-found">{{ entity }}</div>' },
        AppIcon: true,
        PodcastShowCard: {
          name: 'PodcastShowCard',
          props: ['show'],
          template: '<div class="show" @click="$emit(\'play\', show)">{{ show.title }}</div>',
        },
      },
    },
  })
}

describe('PodcastCollectionView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeParams.value = { id: '5' }
    collections.value = [makeCollection()]
    collectionsLoaded.value = true
    collectionsError.value = null
    fetchCollectionPodcasts.mockResolvedValue(makePage([makeShow(1), makeShow(2)]))
    removePodcastsFromCollection.mockResolvedValue(undefined)
  })

  it('loads the member shows for the routed collection', async () => {
    mountView()
    await flushPromises()

    expect(fetchCollections).toHaveBeenCalledTimes(1)
    expect(refreshCollections).not.toHaveBeenCalled()
    expect(fetchCollectionPodcasts).toHaveBeenCalledWith(5, 0, 50)
    expect(fetchCollectionPodcasts).toHaveBeenCalledTimes(1)
  })

  it('renders one card per member show', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('.show')).toHaveLength(2)
    expect(wrapper.text()).toContain('Sci-fi podcasts')
  })

  it('renders an empty state for a collection with no shows', async () => {
    fetchCollectionPodcasts.mockResolvedValue(makePage([]))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.empty').exists()).toBe(true)
  })

  it('surfaces a load failure', async () => {
    fetchCollectionPodcasts.mockRejectedValue(new Error('boom'))
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('reports a missing collection once the list has loaded', async () => {
    collections.value = []
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('.not-found').exists()).toBe(true)
  })

  it('refreshes sidebar state only after a stale routed collection fails', async () => {
    fetchCollectionPodcasts.mockRejectedValueOnce(new Error('HTTP 404'))
    refreshCollections.mockImplementationOnce(async () => {
      collections.value = []
    })
    const wrapper = mountView()
    await flushPromises()

    expect(fetchCollectionPodcasts).toHaveBeenCalledTimes(1)
    expect(refreshCollections).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.not-found').exists()).toBe(true)
  })

  it('does not flash the empty state while waiting for sidebar collection state', async () => {
    let finishFetch!: () => void
    fetchCollections.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishFetch = resolve
      }),
    )
    const wrapper = mountView()
    await nextTick()

    expect(wrapper.find('.empty').exists()).toBe(false)
    expect(fetchCollectionPodcasts).not.toHaveBeenCalled()

    finishFetch()
    await flushPromises()

    expect(fetchCollectionPodcasts).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.show')).toHaveLength(2)
  })

  it('does not send a books collection to the podcast membership endpoint', async () => {
    collections.value = [makeCollection({ mediaType: 'books' })]
    const wrapper = mountView()
    await flushPromises()

    expect(fetchCollectionPodcasts).not.toHaveBeenCalled()
    expect(wrapper.find('.not-found').exists()).toBe(true)
  })

  it('removes a show and drops it from the rendered list', async () => {
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('button')[0].trigger('click')
    await nextTick()

    expect(removePodcastsFromCollection).toHaveBeenCalledWith(5, [1])
    expect(wrapper.findAll('.show')).toHaveLength(1)
    // The sidebar badge is the collection cache's to update, not this view's.
    expect(applyCollectionPodcastCount).toHaveBeenLastCalledWith(5, 1)
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('keeps the show listed when removal fails', async () => {
    removePodcastsFromCollection.mockRejectedValue(new Error('nope'))
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('button')[0].trigger('click')
    await nextTick()

    expect(wrapper.findAll('.show')).toHaveLength(2)
    expect(toastError).toHaveBeenCalled()
  })

  it('plays a show from its resume recommendation, and does nothing without one', async () => {
    fetchCollectionPodcasts.mockResolvedValue(
      makePage([
        makeShow(1, { playbackRecommendation: { episodeId: 77, title: 'Ep', positionSeconds: 0, durationSeconds: null, kind: 'latest' } }),
        makeShow(2),
      ]),
    )
    const wrapper = mountView()
    await flushPromises()

    await wrapper.findAll('.show')[0].trigger('click')
    expect(playInline).toHaveBeenCalledWith(77)

    await wrapper.findAll('.show')[1].trigger('click')
    expect(playInline).toHaveBeenCalledTimes(1)
  })
})
