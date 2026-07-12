import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref, type Ref } from 'vue'
import type { GlobalSearchResult } from '@/features/book/composables/useGlobalSearch'
import AppHeader from '../AppHeader.vue'

const mocks = vi.hoisted(() => ({
  routerPush: vi.fn<(to: unknown) => void>(),
  results: null as unknown as Ref<GlobalSearchResult[]>,
  total: null as unknown as Ref<number>,
  loading: null as unknown as Ref<boolean>,
  loadingMore: null as unknown as Ref<boolean>,
  settled: null as unknown as Ref<boolean>,
  hasMore: null as unknown as Ref<boolean>,
  user: null as unknown as Ref<{ provisioningMethod: string; settings?: { achievementPreferences?: { enabled?: boolean } } }>,
  loadMore: vi.fn<() => Promise<void>>(),
  clearGlobalSearch: vi.fn<() => void>(),
}))

vi.mock('vue-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-router')>()
  return {
    ...actual,
    useRouter: () => ({ push: mocks.routerPush }),
    useRoute: () => ({ name: 'dashboard' }),
  }
})

vi.mock('@/features/book/composables/useGlobalSearch', () => ({
  useGlobalSearch: () => ({
    results: mocks.results,
    total: mocks.total,
    loading: mocks.loading,
    loadingMore: mocks.loadingMore,
    settled: mocks.settled,
    hasMore: mocks.hasMore,
    loadMore: mocks.loadMore,
    clear: mocks.clearGlobalSearch,
  }),
}))

vi.mock('@/features/auth/composables/useAuth', async () => {
  return {
    useAuth: () => ({
      user: mocks.user,
      logout: vi.fn<() => void>(),
    }),
  }
})

vi.mock('@/composables/useChangePasswordDialog', () => ({
  useChangePasswordDialog: () => ({ open: vi.fn<() => void>() }),
}))

vi.mock('@/features/auth/composables/usePermissions', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    usePermissions: () => ({
      hasPermission: () => false,
      isDemoRestrictedAccount: vueRef(false),
    }),
  }
})

vi.mock('@/features/library/composables/useLibraryUploadEvents', () => ({
  useLibraryUploadEvents: () => ({ onLibraryUploadCompleted: () => vi.fn<() => void>() }),
}))

vi.mock('@/features/book-dock/composables/useBookDockSummary', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useBookDockSummary: () => ({
      summary: vueRef({ pending: 0, ready: 0, error: 0, total: 0, paused: false }),
      fetchSummary: vi.fn<() => void>(),
      subscribe: vi.fn<() => void>(),
    }),
  }
})

vi.mock('@/features/notifications/composables/useNotifications', () => ({
  useNotifications: () => ({ subscribe: vi.fn<() => void>() }),
}))

vi.mock('@/features/whats-new/composables/useWhatsNew', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useWhatsNew: () => ({ hasUnseen: vueRef(false) }),
  }
})

vi.mock('@/stores/theme', () => ({
  useThemeStore: () => ({ radius: 'rounded' }),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarTrigger: { name: 'SidebarTrigger', template: '<button type="button"><slot /></button>' },
}))

vi.mock('@/components/ui/separator', () => ({
  Separator: { name: 'Separator', template: '<div><slot /></div>' },
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: { name: 'Popover', template: '<div><slot /></div>' },
  PopoverContent: { name: 'PopoverContent', template: '<div><slot /></div>' },
  PopoverTrigger: { name: 'PopoverTrigger', template: '<div><slot /></div>' },
}))

vi.mock('@/components/ui/button', () => ({
  Button: { name: 'Button', template: '<button type="button"><slot /></button>' },
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: { name: 'DropdownMenu', template: '<div><slot /></div>' },
  DropdownMenuContent: { name: 'DropdownMenuContent', template: '<div><slot /></div>' },
  DropdownMenuItem: { name: 'DropdownMenuItem', template: '<button type="button"><slot /></button>' },
  DropdownMenuLabel: { name: 'DropdownMenuLabel', template: '<div><slot /></div>' },
  DropdownMenuSeparator: { name: 'DropdownMenuSeparator', template: '<div />' },
  DropdownMenuTrigger: { name: 'DropdownMenuTrigger', template: '<div><slot /></div>' },
  DropdownMenuSub: { name: 'DropdownMenuSub', template: '<div><slot /></div>' },
  DropdownMenuSubContent: { name: 'DropdownMenuSubContent', template: '<div><slot /></div>' },
  DropdownMenuSubTrigger: { name: 'DropdownMenuSubTrigger', template: '<button type="button"><slot /></button>' },
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { name: 'Tooltip', template: '<div><slot /></div>' },
  TooltipContent: { name: 'TooltipContent', template: '<div><slot /></div>' },
  TooltipTrigger: { name: 'TooltipTrigger', template: '<div><slot /></div>' },
}))

vi.mock('@/features/book/components/BookCoverImage.vue', () => ({
  default: { name: 'BookCoverImage', template: '<img alt="" />' },
}))

vi.mock('@/components/AccentPicker.vue', () => ({ default: { name: 'AccentPicker', template: '<div />' } }))
vi.mock('@/components/RadiusPicker.vue', () => ({ default: { name: 'RadiusPicker', template: '<div />' } }))
vi.mock('@/components/BackgroundPicker.vue', () => ({ default: { name: 'BackgroundPicker', template: '<div />' } }))
vi.mock('@/components/ThemePicker.vue', () => ({ default: { name: 'ThemePicker', template: '<div />' } }))
vi.mock('@/features/library/components/BookUploadModal.vue', () => ({ default: { name: 'BookUploadModal', template: '<div />' } }))
vi.mock('@/features/notifications/components/NotificationSheet.vue', () => ({ default: { name: 'NotificationSheet', template: '<div />' } }))
vi.mock('@/components/UserAvatar.vue', () => ({ default: { name: 'UserAvatar', template: '<div />' } }))

function makeResult(id: number, title = 'Prey'): GlobalSearchResult {
  return {
    id,
    status: 'present',
    title,
    authors: ['Author'],
    seriesId: null,
    seriesName: null,
    seriesIndex: null,
    files: [{ id: id * 10, format: 'epub', role: 'primary', sizeBytes: null }],
    publishedDate: null,
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
    customMetadata: [],
  }
}

function mountHeader() {
  return mount(AppHeader, {
    global: {
      stubs: {
        Transition: false,
      },
    },
  })
}

describe('AppHeader global search', () => {
  beforeEach(() => {
    mocks.routerPush.mockReset()
    mocks.loadMore.mockReset()
    mocks.loadMore.mockResolvedValue(undefined)
    mocks.clearGlobalSearch.mockReset()
    mocks.results = ref([makeResult(101), makeResult(102, 'Predator')])
    mocks.total = ref(42)
    mocks.loading = ref(false)
    mocks.loadingMore = ref(false)
    mocks.settled = ref(true)
    mocks.hasMore = ref(true)
    mocks.user = ref({ provisioningMethod: 'password', settings: {} })
  })

  it('does not leave the dropdown for a separate search route on Enter when no result is selected', async () => {
    const wrapper = mountHeader()
    const input = wrapper.get('input[placeholder="Search all books..."]')

    await input.trigger('focus')
    await input.setValue('  Prey  ')
    await input.trigger('keydown', { key: 'Enter' })

    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  it('keeps Enter-to-open behavior when a result is selected', async () => {
    const wrapper = mountHeader()
    const input = wrapper.get('input[placeholder="Search all books..."]')

    await input.trigger('focus')
    await input.setValue('Prey')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'book-detail', params: { bookId: 101 } })
  })

  it('loads more results from the dropdown footer', async () => {
    const wrapper = mountHeader()
    const input = wrapper.get('input[placeholder="Search all books..."]')

    await input.trigger('focus')
    await input.setValue('Prey')

    const loadMore = wrapper.findAll('button').find((button) => button.text() === 'Load more (2/42)')
    expect(loadMore).toBeDefined()
    if (!loadMore) throw new Error('Expected load more search results button')
    await loadMore.trigger('click')

    expect(mocks.loadMore).toHaveBeenCalledOnce()
  })

  it('loads more results when the dropdown scroll reaches the end', async () => {
    const wrapper = mountHeader()
    const input = wrapper.get('input[placeholder="Search all books..."]')

    await input.trigger('focus')
    await input.setValue('Prey')

    const dropdown = wrapper.get('[data-testid="global-search-dropdown"]')
    Object.defineProperty(dropdown.element, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(dropdown.element, 'clientHeight', { configurable: true, value: 240 })
    Object.defineProperty(dropdown.element, 'scrollTop', { configurable: true, value: 680 })

    await dropdown.trigger('scroll')

    expect(mocks.loadMore).toHaveBeenCalledOnce()
  })

  it('renders only the visible virtual slice of loaded dropdown results', async () => {
    mocks.results = ref(Array.from({ length: 60 }, (_, index) => makeResult(index + 1, `Prey ${index + 1}`)))
    mocks.total = ref(60)
    mocks.hasMore = ref(false)
    const wrapper = mountHeader()
    const input = wrapper.get('input[placeholder="Search all books..."]')

    await input.trigger('focus')
    await input.setValue('Prey')

    const renderedResults = wrapper.findAll('button').filter((button) => button.text().startsWith('Prey '))
    expect(renderedResults.length).toBeGreaterThan(0)
    expect(renderedResults.length).toBeLessThan(60)
    expect(wrapper.text()).toContain('Prey 1')
    expect(wrapper.text()).not.toContain('Prey 60')

    const dropdown = wrapper.get('[data-testid="global-search-dropdown"]')
    Object.defineProperty(dropdown.element, 'scrollTop', { configurable: true, value: 4704 })
    await dropdown.trigger('scroll')
    await nextTick()

    expect(wrapper.text()).not.toContain('Prey 1')
    expect(wrapper.text()).toContain('Prey 60')
  })

  it('hides achievement entry points when achievements are disabled', () => {
    mocks.user = ref({ provisioningMethod: 'password', settings: { achievementPreferences: { enabled: false } } })

    const wrapper = mountHeader()

    expect(wrapper.text()).not.toContain('Achievements')
  })

  it('navigates to annotations from the mobile overflow menu', async () => {
    const wrapper = mountHeader()
    const annotationsItem = wrapper.findAllComponents({ name: 'DropdownMenuItem' }).find((item) => item.text().trim() === 'Annotations')

    expect(annotationsItem).toBeDefined()
    if (!annotationsItem) throw new Error('Expected annotations overflow menu item')

    await annotationsItem.trigger('click')

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'annotations' })
  })
})
