import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, reactive, ref, type PropType } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookCard, SeriesDetail } from '@bookorbit/types'
import SeriesDetailView from './SeriesDetailView.vue'

type ViewMode = 'grid' | 'list' | 'table'

class MockIntersectionObserver {
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn<() => void>()
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => [])
}

const mocks = vi.hoisted(() => ({
  route: null as unknown as { params: { seriesName: string }; query: Record<string, unknown> },
  routerPush: vi.fn<(to: unknown) => Promise<void>>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
  setBookContext: vi.fn<(ids: number[], total: number) => void>(),
  loadBooks: vi.fn<(input?: unknown) => Promise<void>>(),
  seriesInfo: null as unknown as { value: SeriesDetail | null },
  items: null as unknown as { value: BookCard[] },
  total: null as unknown as { value: number },
  loading: null as unknown as { value: boolean },
  error: null as unknown as { value: string | null },
  notFound: null as unknown as { value: boolean },
  hasMore: null as unknown as { value: boolean },
  sort: null as unknown as { value: 'seriesIndex' | 'title' | 'addedAt' },
  order: null as unknown as { value: 'asc' | 'desc' },
  libraryId: null as unknown as { value: number | null },
  effectiveViewMode: null as unknown as { value: ViewMode },
  fetchSeriesBooks: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  api: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRoute: () => mocks.route,
    useRouter: () => ({ push: mocks.routerPush }),
  }
})

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))

vi.mock('@/features/book/composables/useBookNavigation', () => ({
  useBookNavigation: () => ({ setBookContext: mocks.setBookContext }),
}))

vi.mock('@/features/book/composables/useCoverVersions', () => ({
  useCoverVersions: () => ({ coverUrl: (bookId: number) => `/covers/${bookId}` }),
}))

vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => ({
    portraitCoverSize: ref(160),
    gridGap: ref(16),
    gridCardPrimaryLabel: ref('hidden'),
    gridCardSecondaryLabel: ref('hidden'),
  }),
}))

vi.mock('@/composables/useEffectiveViewMode', () => ({
  useEffectiveViewMode: () => ({
    effectiveViewMode: mocks.effectiveViewMode,
  }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([]),
    fetchLibraries: mocks.fetchLibraries,
  }),
}))

vi.mock('@/composables/usePageTitle', () => ({
  usePageTitle: () => undefined,
}))

vi.mock('@/features/book/composables/useSafeHtml', () => ({
  useSafeHtml: () => ref(''),
}))

vi.mock('../api/series', () => ({
  fetchSeriesBooks: (...args: unknown[]) => mocks.fetchSeriesBooks(...args),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mocks.api(...args),
}))

vi.mock('../composables/useSeriesDetail', () => ({
  useSeriesDetail: () => ({
    seriesInfo: mocks.seriesInfo,
    items: mocks.items,
    total: mocks.total,
    loading: mocks.loading,
    error: mocks.error,
    notFound: mocks.notFound,
    hasMore: mocks.hasMore,
    sort: mocks.sort,
    order: mocks.order,
    libraryId: mocks.libraryId,
    load: mocks.loadBooks,
  }),
}))

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'present',
    title: 'Series Book',
    authors: ['Author'],
    seriesName: 'The Series',
    seriesIndex: 1,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    ...overrides,
  }
}

function makeSeriesInfo(): SeriesDetail {
  return {
    name: 'The Series',
    bookCount: 1,
    readCount: 0,
    authors: ['Author'],
    possibleGaps: [],
  }
}

const VirtualBookGridStub = defineComponent({
  name: 'VirtualBookGrid',
  emits: ['action', 'update:book'],
  template: `
    <div>
      <button data-testid="grid-add-action" @click="$emit('action', { id: 42 }, 'add-to-collection')">add</button>
      <button data-testid="grid-quick-action" @click="$emit('action', { id: 42 }, 'quick-view')">quick</button>
    </div>
  `,
})

const BookListRowStub = defineComponent({
  name: 'BookListRow',
  props: {
    book: {
      type: Object as PropType<BookCard>,
      required: true,
    },
  },
  emits: ['action'],
  template: `<button data-testid="list-add-action" @click="$emit('action', 'add-to-collection')">{{ book.id }}</button>`,
})

const VirtualBookTableStub = defineComponent({
  name: 'VirtualBookTable',
  emits: ['action', 'update:sort', 'update:book'],
  template: `<button data-testid="table-add-action" @click="$emit('action', { id: 91 }, 'add-to-collection')">add</button>`,
})

const AddToCollectionSheetStub = defineComponent({
  name: 'AddToCollectionSheet',
  props: {
    open: {
      type: Boolean,
      required: true,
    },
    bookIds: {
      type: Array as PropType<number[]>,
      required: true,
    },
  },
  emits: ['update:open'],
  template: `
    <div data-testid="collection-sheet" :data-open="open ? 'true' : 'false'" :data-book-ids="bookIds.join(',')">
      <button data-testid="collection-sheet-close" @click="$emit('update:open', false)">close</button>
    </div>
  `,
})

function mountView(mode: ViewMode) {
  mocks.effectiveViewMode.value = mode

  return mount(SeriesDetailView, {
    global: {
      stubs: {
        VirtualBookGrid: VirtualBookGridStub,
        BookListRow: BookListRowStub,
        VirtualBookTable: VirtualBookTableStub,
        AddToCollectionSheet: AddToCollectionSheetStub,
        EntityNotFound: true,
        SeriesCompletionBar: true,
        SeriesGapBanner: true,
      },
    },
  })
}

describe('SeriesDetailView', () => {
  beforeEach(() => {
    mocks.route = reactive({
      params: { seriesName: 'The%20Series' },
      query: {},
    })

    mocks.seriesInfo = ref(makeSeriesInfo())
    mocks.items = ref([makeBook({ id: 7 })])
    mocks.total = ref(1)
    mocks.loading = ref(false)
    mocks.error = ref<string | null>(null)
    mocks.notFound = ref(false)
    mocks.hasMore = ref(false)
    mocks.sort = ref('seriesIndex')
    mocks.order = ref('asc')
    mocks.libraryId = ref<number | null>(null)
    mocks.effectiveViewMode = ref('grid')

    mocks.routerPush.mockReset()
    mocks.routerPush.mockResolvedValue(undefined)
    mocks.fetchLibraries.mockReset()
    mocks.fetchLibraries.mockResolvedValue(undefined)
    mocks.setBookContext.mockReset()
    mocks.loadBooks.mockReset()
    mocks.loadBooks.mockResolvedValue(undefined)
    mocks.fetchSeriesBooks.mockReset()
    mocks.fetchSeriesBooks.mockResolvedValue({
      items: [makeBook({ id: 7, seriesIndex: 1 })],
      total: 1,
      page: 0,
      size: 8,
      seriesInfo: makeSeriesInfo(),
    })
    mocks.api.mockReset()
    mocks.api.mockResolvedValue({ ok: false })

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens AddToCollectionSheet with the clicked book id from grid actions', async () => {
    const wrapper = mountView('grid')
    await nextTick()

    await wrapper.get('[data-testid="grid-add-action"]').trigger('click')

    const sheet = wrapper.get('[data-testid="collection-sheet"]')
    expect(sheet.attributes('data-open')).toBe('true')
    expect(sheet.attributes('data-book-ids')).toBe('42')
  })

  it('opens AddToCollectionSheet with the clicked book id from table actions', async () => {
    const wrapper = mountView('table')
    await nextTick()

    await wrapper.get('[data-testid="table-add-action"]').trigger('click')

    const sheet = wrapper.get('[data-testid="collection-sheet"]')
    expect(sheet.attributes('data-open')).toBe('true')
    expect(sheet.attributes('data-book-ids')).toBe('91')
  })

  it('navigates on quick-view and closes the collection sheet state', async () => {
    const wrapper = mountView('grid')
    await nextTick()

    await wrapper.get('[data-testid="grid-add-action"]').trigger('click')
    await wrapper.get('[data-testid="grid-quick-action"]').trigger('click')

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'book-detail', params: { bookId: 42 } })
    const sheet = wrapper.get('[data-testid="collection-sheet"]')
    expect(sheet.attributes('data-open')).toBe('false')
    expect(sheet.attributes('data-book-ids')).toBe('')
  })

  it('clears selected ids when the collection sheet closes', async () => {
    const wrapper = mountView('grid')
    await nextTick()

    await wrapper.get('[data-testid="grid-add-action"]').trigger('click')
    await wrapper.get('[data-testid="collection-sheet-close"]').trigger('click')

    const sheet = wrapper.get('[data-testid="collection-sheet"]')
    expect(sheet.attributes('data-open')).toBe('false')
    expect(sheet.attributes('data-book-ids')).toBe('')
  })
})
