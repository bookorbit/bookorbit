import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { AuthorSummary, BookCard, SeriesSummary } from '@bookorbit/types'
import { useCommandPaletteResults, type PaletteTab } from '../useCommandPaletteResults'

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  books: null as unknown as import('vue').Ref<BookCard[]>,
  bookTotal: null as unknown as import('vue').Ref<number>,
  fetchAuthors: vi.fn<(params: unknown) => Promise<unknown>>(),
  fetchSeries: vi.fn<(params: unknown) => Promise<unknown>>(),
  api: vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(),
  toggleTheme: vi.fn<() => void>(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string, params?: { count?: number }) => (params?.count != null ? `${key}:${params.count}` : key) }),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

vi.mock('@/composables/useSidebarNav', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useSidebarNav: () => ({
      zones: vueRef([
        {
          id: 'primary',
          entries: [{ id: 'dashboard', label: 'Dashboard', icon: {}, to: { name: 'dashboard' }, isActive: false, badge: null }],
        },
        {
          id: 'reading',
          entries: [{ id: 'statistics', label: 'Statistics', icon: {}, to: { name: 'statistics' }, isActive: false, badge: null }],
        },
      ]),
    }),
  }
})

vi.mock('@/composables/useSidebarSections', () => ({
  SIDEBAR_SECTIONS: [
    { kind: 'library', icon: {}, routeName: 'library' },
    { kind: 'smartScope', icon: {}, routeName: 'smartScope' },
    { kind: 'collection', icon: {}, routeName: 'collection' },
  ],
}))

vi.mock('@/features/library/composables/useLibraries', async () => {
  const { ref: vueRef } = await import('vue')
  const libraries = vueRef([
    { id: 1, name: 'Novels', bookCount: 454 },
    { id: 2, name: 'Comics', bookCount: 10 },
  ])
  return { useLibraries: () => ({ libraries }) }
})

vi.mock('@/features/smart-scope/composables/useSmartScopes', async () => {
  const { ref: vueRef } = await import('vue')
  return { useSmartScopes: () => ({ smartScopes: vueRef([{ id: 2, name: 'Kobo', bookCount: 172 }]) }) }
})

vi.mock('@/features/collection/composables/useCollections', async () => {
  const { ref: vueRef } = await import('vue')
  return { useCollections: () => ({ collections: vueRef([{ id: 8, name: 'Autumn Reads', bookCount: 2 }]) }) }
})

vi.mock('@/features/auth/composables/usePermissions', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    usePermissions: () => ({
      hasPermission: (name: string) => mocks.permissions.has(name),
      isSuperuser: vueRef(true),
      userPermissions: vueRef([]),
      isDemoRestrictedAccount: vueRef(false),
    }),
  }
})

vi.mock('@/features/book-requests/composables/useBookRequestVisibility', async () => {
  const { ref: vueRef } = await import('vue')
  return { useBookRequestVisibility: () => ({ showBookRequests: vueRef(true) }) }
})

vi.mock('@/features/book/composables/useGlobalSearch', async () => {
  const { computed, ref: vueRef } = await import('vue')
  return {
    useGlobalSearch: () => ({
      results: mocks.books,
      total: mocks.bookTotal,
      loading: vueRef(false),
      loadingMore: vueRef(false),
      settled: vueRef(true),
      hasMore: computed(() => mocks.books.value.length < mocks.bookTotal.value),
      loadMore: vi.fn<() => Promise<void>>(),
      clear: vi.fn<() => void>(),
    }),
  }
})

vi.mock('@/features/author/api/author', () => ({ fetchAuthors: mocks.fetchAuthors }))
vi.mock('@/features/series/api/series', () => ({ fetchSeries: mocks.fetchSeries }))
vi.mock('@/stores/theme', () => ({ useThemeStore: () => ({ resolvedTheme: 'dark', toggleTheme: mocks.toggleTheme }) }))

function book(id: number, title: string): BookCard {
  return { id, title, authors: [], files: [], coverVersion: null } as unknown as BookCard
}

function setup() {
  const query = ref('')
  const tab = ref<PaletteTab>('all')
  const isOpen = ref(false)
  const handlers = { openUpload: vi.fn<() => void>(), navigate: vi.fn<(to: unknown) => void>() }
  const results = useCommandPaletteResults(query, tab, isOpen, handlers)
  return { query, tab, isOpen, handlers, ...results }
}

describe('useCommandPaletteResults', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.permissions.clear()
    mocks.books = ref([])
    mocks.bookTotal = ref(0)
    mocks.fetchAuthors.mockResolvedValue({ items: [], total: 0, page: 0, size: 20 })
    mocks.fetchSeries.mockResolvedValue({ items: [], total: 0, page: 0, size: 20 })
    mocks.api.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [{ id: 'command-palette', books: [book(827, 'The Ocean at the End of the Lane')], failed: false }] }),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers Customize sidebar as an action that opens sidebar edit mode', async () => {
    const { useSidebarCustomizeMode } = await import('@/composables/useSidebarCustomizeMode')
    const { isCustomizing, stopCustomizing } = useSidebarCustomizeMode()
    stopCustomizing()
    const { sections } = setup()

    const action = sections.value.find((section) => section.id === 'actions')?.items.find((item) => item.key === 'action:customize-sidebar')
    expect(action?.kind === 'action' && action.label).toBe('components.sidebar.customize.open')
    if (action?.kind === 'action') action.run()

    expect(isCustomizing.value).toBe(true)
    stopCustomizing()
  })

  it('opens on continue reading, the book libraries and the actions', async () => {
    const { isOpen, sections } = setup()

    isOpen.value = true
    await nextTick()
    await vi.runAllTimersAsync()

    expect(sections.value.map((section) => section.id)).toEqual(['continue', 'goto', 'actions'])
    expect(sections.value[0]?.items.map((item) => item.key)).toEqual(['reading:827'])
    expect(sections.value[1]?.items.map((item) => item.key)).toEqual(['library:1', 'library:2'])
  })

  it('offers Upload only to users who may upload', () => {
    const withoutPermission = setup().sections.value.find((section) => section.id === 'actions')
    expect(withoutPermission?.items.map((item) => item.key)).not.toContain('action:upload')

    mocks.permissions.add('library_upload')
    const withPermission = setup().sections.value.find((section) => section.id === 'actions')
    expect(withPermission?.items[0]?.key).toBe('action:upload')
  })

  it('ranks title matches first, caps books at five and links to the full list', async () => {
    const { query, sections } = setup()
    mocks.books.value = [
      book(1, 'Bad Bishop'),
      book(2, 'Carrie'),
      book(3, 'King of Ashes'),
      book(4, 'King Sorrow'),
      book(5, 'The Kingdom of Copper'),
      book(6, 'This Kingdom Will Not Kill Me'),
    ]
    mocks.bookTotal.value = 15

    query.value = 'king'
    await nextTick()

    const books = sections.value.find((section) => section.id === 'books')
    expect(books?.count).toBe(15)
    expect(books?.items.map((item) => item.key)).toEqual(['book:3', 'book:4', 'book:5', 'book:6', 'book:1', 'more:books'])
  })

  it('loads authors and series after the debounce and folds the extras behind a link', async () => {
    const authors = [1, 2, 3, 4].map((id) => ({ id, name: `King ${id}`, bookCount: 1 }) as AuthorSummary)
    mocks.fetchAuthors.mockResolvedValue({ items: authors, total: 4, page: 0, size: 20 })
    mocks.fetchSeries.mockResolvedValue({ items: [{ id: 7, name: 'The Shepherd King' } as SeriesSummary], total: 1, page: 0, size: 20 })
    const { query, sections, tabs } = setup()

    query.value = 'king'
    await nextTick()
    expect(mocks.fetchAuthors).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    expect(mocks.fetchAuthors).toHaveBeenCalledWith({ q: 'king', page: 0, size: 20, sort: 'name', order: 'asc' })
    const authorSection = sections.value.find((section) => section.id === 'authors')
    expect(authorSection?.items.map((item) => item.key)).toEqual(['author:1', 'author:2', 'author:3', 'more:authors'])
    expect(tabs.value.map((option) => [option.id, option.count])).toEqual([
      ['all', 5],
      ['authors', 4],
      ['series', 1],
    ])
  })

  it('shows only the chosen kind on a tab', async () => {
    const { query, tab, sections } = setup()
    mocks.books.value = [book(1, 'King Sorrow'), book(2, 'Bad Bishop')]
    mocks.bookTotal.value = 2

    query.value = 'king'
    tab.value = 'books'
    await nextTick()

    expect(sections.value).toHaveLength(1)
    expect(sections.value[0]?.items.map((item) => item.key)).toEqual(['book:1', 'book:2'])
  })

  it('finds places by name and settings pages by keyword', async () => {
    const { query, sections } = setup()

    query.value = 'kobo'
    await nextTick()

    expect(sections.value.find((section) => section.id === 'goto')?.items.map((item) => item.key)).toEqual(['smartScope:2'])
    expect(sections.value.find((section) => section.id === 'settings')?.items.map((item) => item.key)).toContain('setting:kobo')
  })

  it('switches the theme through the action', () => {
    const { sections } = setup()
    const theme = sections.value.find((section) => section.id === 'actions')?.items.find((item) => item.key === 'action:theme')

    expect(theme?.kind).toBe('action')
    if (theme?.kind === 'action') theme.run()
    expect(mocks.toggleTheme).toHaveBeenCalledOnce()
  })
})
