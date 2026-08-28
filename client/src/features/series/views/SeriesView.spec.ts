import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import type { SeriesFacets, SeriesSummary } from '@bookorbit/types'
import en from '@/locales/en.json'
import { compileIcuCatalog } from '@/i18n/icu'
import type { CompletionStatus, SeriesListSort, SortDirection } from '../types/series'
import SeriesView from './SeriesView.vue'
import SeriesStatusTabs from '../components/SeriesStatusTabs.vue'
import SeriesGridCard from '../components/SeriesGridCard.vue'
import SeriesIndexTable from '../components/SeriesIndexTable.vue'

class MockIntersectionObserver {
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn<() => void>()
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => [])
}

class MockResizeObserver {
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn<() => void>()
}

const EMPTY_FACETS: SeriesFacets = { all: 0, notStarted: 0, inProgress: 0, complete: 0, hasGaps: 0 }

function makeSeries(overrides: Partial<SeriesSummary> = {}): SeriesSummary {
  return {
    id: 1,
    name: 'Discworld',
    bookCount: 3,
    readCount: 1,
    readingCount: 0,
    authors: ['Terry Pratchett'],
    coverBookIds: [10],
    lastAddedAt: null,
    libraryNames: ['Novels'],
    expectedBookCount: null,
    volumes: [
      { index: 1, bookId: 10, title: 'One', status: 'read' },
      { index: 2, bookId: null, title: null, status: 'missing' },
      { index: 3, bookId: 12, title: 'Three', status: 'unread' },
    ],
    volumesTruncated: false,
    gaps: [2],
    gapCount: 1,
    nextBookId: 12,
    nextIndex: '3',
    nextTitle: 'Three',
    ...overrides,
  }
}

const mocks = vi.hoisted(() => ({
  route: { params: {} as Record<string, string>, query: {} as Record<string, unknown>, fullPath: '/series' },
  routerPush: vi.fn<(to: unknown) => Promise<void>>(),
  routerReplace: vi.fn<(to: unknown) => Promise<void>>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
  load: vi.fn<(reset?: boolean) => Promise<void>>(),
  storageSet: vi.fn<(key: string, value: unknown) => void>(),
  storageValues: {} as Record<string, unknown>,
  items: null as unknown as { value: SeriesSummary[] },
  total: null as unknown as { value: number },
  facets: null as unknown as { value: SeriesFacets },
  q: null as unknown as { value: string },
  sort: null as unknown as { value: SeriesListSort },
  order: null as unknown as { value: SortDirection },
  libraryId: null as unknown as { value: number | null },
  completionStatus: null as unknown as { value: CompletionStatus | null },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.routerPush, replace: mocks.routerReplace }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([{ id: 5, name: 'Novels' }]), fetchLibraries: mocks.fetchLibraries }),
}))

vi.mock('../composables/useSeriesList', () => ({
  useSeriesList: () => ({
    items: mocks.items,
    total: mocks.total,
    facets: mocks.facets,
    loading: ref(false),
    error: ref(null),
    hasMore: ref(false),
    q: mocks.q,
    sort: mocks.sort,
    order: mocks.order,
    libraryId: mocks.libraryId,
    completionStatus: mocks.completionStatus,
    load: mocks.load,
  }),
}))

vi.mock('@/services/storage', () => ({
  storage: {
    get: (key: string, fallback: unknown) => mocks.storageValues[key] ?? fallback,
    set: (key: string, value: unknown) => mocks.storageSet(key, value),
    remove: vi.fn<(key: string) => void>(),
  },
}))

// Matches the app's own setup: the catalog carries ICU plurals, which vue-i18n's default
// compiler cannot parse.
const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en: compileIcuCatalog(en, 'en') },
})

async function mountView() {
  const wrapper = mount(SeriesView, {
    global: {
      plugins: [i18n],
      stubs: {
        ViewHeader: { template: '<div><slot name="toolbar" /></div>' },
        Popover: { template: '<div><slot /></div>' },
        PopoverTrigger: { template: '<div><slot /></div>' },
        PopoverContent: { template: '<div><slot /></div>' },
        BookCoverArtwork: true,
      },
    },
  })
  await flushPromises()
  return wrapper
}

describe('SeriesView', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    mocks.route.query = {}
    mocks.storageValues = {}
    mocks.routerPush.mockResolvedValue()
    mocks.routerReplace.mockResolvedValue()
    mocks.fetchLibraries.mockResolvedValue()
    mocks.load.mockResolvedValue()
    mocks.items = ref([makeSeries()])
    mocks.total = ref(1)
    mocks.facets = ref({ ...EMPTY_FACETS, all: 1, hasGaps: 1 })
    mocks.q = ref('')
    mocks.sort = ref('name')
    mocks.order = ref('asc')
    mocks.libraryId = ref(null)
    mocks.completionStatus = ref(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders the card view by default', async () => {
    const wrapper = await mountView()

    expect(wrapper.findComponent(SeriesGridCard).exists()).toBe(true)
    expect(wrapper.findComponent(SeriesIndexTable).exists()).toBe(false)
  })

  it('renders the list view when that is the stored preference', async () => {
    mocks.storageValues['bookorbit:seriesViewMode'] = 'list'
    const wrapper = await mountView()

    expect(wrapper.findComponent(SeriesIndexTable).exists()).toBe(true)
    expect(wrapper.findComponent(SeriesGridCard).exists()).toBe(false)
  })

  it('shows server-side facet counts on the status tabs rather than counting the loaded page', async () => {
    mocks.facets = ref({ all: 4182, notStarted: 3900, inProgress: 210, complete: 72, hasGaps: 41 })
    const wrapper = await mountView()

    const tabs = wrapper.findComponent(SeriesStatusTabs)
    expect(tabs.exists()).toBe(true)
    expect(tabs.text()).toContain('4,182')
    expect(tabs.text()).toContain('41')
  })

  it('reloads with the gaps filter when the gaps tab is chosen', async () => {
    const wrapper = await mountView()

    const gapsTab = wrapper.findComponent(SeriesStatusTabs).findAll('button').at(4)
    await gapsTab!.trigger('click')

    expect(mocks.completionStatus.value).toBe('has_gaps')
  })

  it('reads the completion filter back out of the route on mount', async () => {
    mocks.route.query = { completionStatus: 'has_gaps', libraryId: '5' }
    await mountView()

    expect(mocks.completionStatus.value).toBe('has_gaps')
    expect(mocks.libraryId.value).toBe(5)
  })

  it('ignores a completion status the API would reject', async () => {
    mocks.route.query = { completionStatus: 'nonsense' }
    await mountView()

    expect(mocks.completionStatus.value).toBeNull()
  })

  it('sorts by a list column when its header is clicked, and flips direction on a second click', async () => {
    mocks.storageValues['bookorbit:seriesViewMode'] = 'list'
    const wrapper = await mountView()

    const volumesHeader = wrapper
      .findComponent(SeriesIndexTable)
      .findAll('button')
      .find((button) => button.text().startsWith(en.series.index.columnVolumes))
    expect(volumesHeader).toBeDefined()

    await volumesHeader!.trigger('click')
    expect(mocks.sort.value).toBe('bookCount')
    expect(mocks.order.value).toBe('desc')

    await volumesHeader!.trigger('click')
    expect(mocks.order.value).toBe('asc')
  })

  it('keeps the empty state out of the way while the first page is still loading', async () => {
    mocks.items = ref([])
    mocks.total = ref(0)
    mocks.facets = ref({ ...EMPTY_FACETS })
    const wrapper = await mountView()

    expect(wrapper.text()).toContain(en.series.list.empty)
  })
})
