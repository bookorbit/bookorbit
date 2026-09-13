import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import type { AuthorSummary } from '@bookorbit/types'
import type { AuthorListSort, SortDirection } from '../types/author'
import AuthorsView from './AuthorsView.vue'
import AuthorFilterChips from '../components/AuthorFilterChips.vue'

class MockIntersectionObserver {
  observe = vi.fn<(target: Element) => void>()
  unobserve = vi.fn<(target: Element) => void>()
  disconnect = vi.fn<() => void>()
  takeRecords = vi.fn<() => IntersectionObserverEntry[]>(() => [])
}

function author(id: number, name: string, extra: Partial<AuthorSummary> = {}): AuthorSummary {
  return { id, name, sortName: null, bookCount: 1, lastAddedAt: null, coverBookId: null, ...extra }
}

const mocks = vi.hoisted(() => ({
  route: { params: {} as Record<string, string>, query: {} as Record<string, unknown>, fullPath: '/authors' },
  routerPush: vi.fn<(to: unknown) => Promise<void>>(),
  routerReplace: vi.fn<(to: unknown) => Promise<void>>(),
  fetchLibraries: vi.fn<() => Promise<void>>(),
  load: vi.fn<(reset?: boolean) => Promise<void>>(),
  loadThrough: vi.fn<(index: number) => Promise<boolean>>(),
  items: null as unknown as { value: AuthorSummary[] },
  q: null as unknown as { value: string },
  sort: null as unknown as { value: AuthorListSort },
  order: null as unknown as { value: SortDirection },
  libraryId: null as unknown as { value: number | null },
  hasPhoto: null as unknown as { value: boolean | null },
  hasSortName: null as unknown as { value: boolean | null },
  addedWithinDays: null as unknown as { value: number | null },
  minBookCount: null as unknown as { value: number | null },
  viewMode: null as unknown as { value: string },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
  useRouter: () => ({ push: mocks.routerPush, replace: mocks.routerReplace }),
}))

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>(), warning: vi.fn<(message: string) => void>() },
}))

vi.mock('@/composables/useDisplaySettings', () => ({
  useDisplaySettings: () => ({
    gridGap: ref(16),
    viewMode: mocks.viewMode,
    authorCoverSize: ref(120),
    authorCoverShape: ref('circle'),
    authorRowDensity: ref('comfortable'),
    authorCoverFallback: ref(false),
    showJumpRails: ref(true),
  }),
}))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries: ref([]), fetchLibraries: mocks.fetchLibraries }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true, isDemoRestrictedAccount: ref(false), isSuperuser: ref(false) }),
}))

vi.mock('../composables/useAuthorJumpRail', () => ({
  useAuthorJumpRail: () => ({
    buckets: ref([]),
    visible: ref(false),
    template: ref([]),
    activeKey: ref(null),
    gutterReserved: ref(false),
    releaseGutter: vi.fn<() => void>(),
    syncActiveKey: vi.fn<() => void>(),
    handleJump: vi.fn<() => Promise<void>>(),
  }),
}))

vi.mock('../composables/useAuthorsList', () => ({
  useAuthorsList: () => ({
    items: mocks.items,
    total: ref(0),
    loading: ref(false),
    error: ref(null),
    hasMore: ref(false),
    q: mocks.q,
    sort: mocks.sort,
    order: mocks.order,
    libraryId: mocks.libraryId,
    hasPhoto: mocks.hasPhoto,
    hasSortName: mocks.hasSortName,
    addedWithinDays: mocks.addedWithinDays,
    minBookCount: mocks.minBookCount,
    filterParams: () => ({}),
    load: mocks.load,
    loadThrough: mocks.loadThrough,
  }),
}))

vi.mock('../composables/useAuthorSelection', () => ({
  useAuthorSelection: () => ({
    selectionMode: ref(false),
    selectedIds: ref<number[]>([]),
    selectedCount: ref(0),
    enterSelectionMode: vi.fn<() => void>(),
    exitSelectionMode: vi.fn<() => void>(),
    toggleAuthor: vi.fn<(id: number) => void>(),
    rangeSelectTo: vi.fn<(id: number, ids: number[]) => void>(),
    selectAll: vi.fn<(ids: number[]) => void>(),
    isSelected: () => false,
  }),
}))

vi.mock('../composables/useRefreshingAuthors', () => ({
  useRefreshingAuthors: () => ({
    markRefreshing: vi.fn<(id: number) => void>(),
    clearRefreshing: vi.fn<(id: number) => void>(),
    isRefreshing: () => false,
  }),
}))

async function mountView() {
  const wrapper = shallowMount(AuthorsView)
  await flushPromises()
  return wrapper
}

describe('AuthorsView', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
    mocks.route.query = {}
    mocks.routerPush.mockResolvedValue()
    mocks.routerReplace.mockResolvedValue()
    mocks.fetchLibraries.mockResolvedValue()
    mocks.load.mockResolvedValue()
    mocks.loadThrough.mockResolvedValue(true)
    mocks.items = ref([])
    mocks.q = ref('')
    mocks.sort = ref('name')
    mocks.order = ref('asc')
    mocks.libraryId = ref(null)
    mocks.hasPhoto = ref(null)
    mocks.hasSortName = ref(null)
    mocks.addedWithinDays = ref(null)
    mocks.minBookCount = ref(null)
    mocks.viewMode = ref('list')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('keeps the filter chips outside the scrolling <main> so they stay anchored', async () => {
    const wrapper = await mountView()

    expect(wrapper.find('main').exists()).toBe(true)
    const chips = wrapper.findComponent(AuthorFilterChips)
    expect(chips.exists()).toBe(true)
    // Regression guard for #326: filters must NOT live inside the scroll container.
    expect(chips.element.closest('main')).toBeNull()
  })

  it('hydrates a quick filter from the route into the matching list filters', async () => {
    mocks.route.query = { filter: 'noPortrait' }
    await mountView()

    expect(mocks.hasPhoto.value).toBe(false)
    expect(mocks.minBookCount.value).toBeNull()
    expect(mocks.addedWithinDays.value).toBeNull()
    expect(mocks.hasSortName.value).toBeNull()
  })

  it('treats the quick filters as mutually exclusive', async () => {
    mocks.route.query = { filter: 'multipleBooks' }
    const wrapper = await mountView()

    expect(mocks.minBookCount.value).toBe(2)

    wrapper.findComponent(AuthorFilterChips).vm.$emit('update:quickFilter', 'recentlyAdded')
    await flushPromises()

    expect(mocks.minBookCount.value).toBeNull()
    expect(mocks.addedWithinDays.value).toBe(7)
  })

  it('groups authors into one section per letter when sorted alphabetically', async () => {
    mocks.items = ref([author(1, 'Alan Glynn'), author(2, 'Amy Tan'), author(3, 'Blake Crouch')])
    const wrapper = await mountView()

    const headings = wrapper.findAll('[data-letter]')
    expect(headings.map((heading) => heading.attributes('data-letter'))).toEqual(['A', 'B'])
  })

  it('drops the letter sections when the sort is not alphabetical', async () => {
    mocks.items = ref([author(1, 'Alan Glynn'), author(2, 'Blake Crouch')])
    // The view hydrates sort from the route on mount, so drive it from there.
    mocks.route.query = { sort: 'bookCount' }
    const wrapper = await mountView()

    expect(wrapper.findAll('[data-letter]')).toHaveLength(0)
  })
})
