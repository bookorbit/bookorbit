import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import type { BookCard, GroupRule, SortSpec } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { useBookListPage, type BookListPage, type BookListPageOptions } from './useBookListPage'

const mocks = vi.hoisted(() => ({
  windowOptions: null as null | Record<string, unknown>,
  reset: vi.fn<() => void>(),
  refreshBuckets: vi.fn<() => void>(),
  handleBookAction: vi.fn<(book: BookCard, action: string) => void>(),
  setPreference: vi.fn<(ctx: unknown, value: boolean | null) => Promise<void>>(),
  getEffectivePreference: vi.fn<(ctx: unknown) => boolean>(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn<(...args: unknown[]) => void>() }), useRoute: () => ({ params: {}, query: {} }) }))

vi.mock('./useBookViewWindow', async () => {
  const { computed, ref } = await import('vue')
  return {
    useBookViewWindow: (options: Record<string, unknown>) => {
      mocks.windowOptions = options
      const books = ref<BookCard[]>([])
      return {
        booksProxy: books,
        slots: books,
        total: ref(0),
        bookTotal: ref(3),
        loading: ref(false),
        initialized: ref(true),
        error: ref<string | null>(null),
        filter: ref<GroupRule | undefined>(undefined),
        sort: ref<SortSpec[]>([{ field: 'title', dir: 'asc' }]),
        randomSortActive: computed(() => false),
        reshuffle: vi.fn<(...args: unknown[]) => void>(),
        reset: mocks.reset,
        contiguousPrefix: books,
        hasMorePrefix: ref(false),
        loadMorePrefix: vi.fn<(...args: unknown[]) => void>(),
        handleRange: vi.fn<(...args: unknown[]) => void>(),
        handleFirstVisibleIndex: vi.fn<(...args: unknown[]) => void>(),
        registerScroller: vi.fn<(...args: unknown[]) => void>(),
        handleJump: vi.fn<(...args: unknown[]) => void>(),
        buckets: ref([]),
        bucketKind: ref('letter'),
        primarySortField: ref('title'),
        temporalGranularity: ref(null),
        railCapacity: ref(20),
        refreshBuckets: mocks.refreshBuckets,
        railVisible: ref(false),
        activeBucketKey: ref(null),
        letterTemplate: ref([]),
        railGutterReserved: ref(false),
        releaseRailGutter: vi.fn<(...args: unknown[]) => void>(),
      }
    },
  }
})

vi.mock('./useBookTableShell', async () => {
  const { computed, ref } = await import('vue')
  return {
    useBookTableShell: ({ selectionMode }: { selectionMode: { value: boolean } }) => {
      const selectedIds = ref(new Set<number>())
      return {
        tableRef: ref(null),
        selectedIds,
        selectedCount: computed(() => selectedIds.value.size),
        selectionMode,
        selectAll: vi.fn<(...args: unknown[]) => void>(),
        deselectAll: vi.fn<(...args: unknown[]) => void>(),
        exitSelectionMode: vi.fn<(...args: unknown[]) => void>(),
        handleImportPresetBackup: vi.fn<(...args: unknown[]) => void>(),
        bulkEditOpen: ref(false),
        quickViewBookId: ref<number | null>(null),
        quickViewOpen: ref(false),
        addToCollectionOpen: ref(false),
        sendBookOpen: ref(false),
        handleBookAction: mocks.handleBookAction,
      }
    },
  }
})

vi.mock('./useSeriesCollapsePreference', async () => {
  const { ref } = await import('vue')
  return {
    useSeriesCollapsePreference: () => ({
      getEffectivePreference: mocks.getEffectivePreference,
      setPreference: mocks.setPreference,
      prefs: ref({}),
    }),
  }
})

vi.mock('./useBookViewContext', () => ({ useBookViewContext: vi.fn<(...args: unknown[]) => void>() }))
vi.mock('./useScrollRestoreOnActivate', () => ({ useScrollRestoreOnActivate: vi.fn<(...args: unknown[]) => void>() }))
vi.mock('./useBookProgressRefresh', () => ({ useBookProgressRefresh: vi.fn<(...args: unknown[]) => void>() }))
vi.mock('./useBookLinkSync', () => ({ useBookLinkSync: () => ({ scheduleRefresh: vi.fn<(...args: unknown[]) => void>() }) }))
vi.mock('./useBookMergeSync', () => ({ useBookMergeSync: () => ({ applyMerged: vi.fn<(...args: unknown[]) => void>() }) }))
vi.mock('./useBulkEditMetadata', async () => {
  const { ref } = await import('vue')
  return { useBulkEditMetadata: () => ({ submit: vi.fn<(...args: unknown[]) => void>(), submitting: ref(false), selectedCount: ref(0) }) }
})
vi.mock('@/features/auth/composables/usePermissions', async () => {
  const { ref } = await import('vue')
  return { usePermissions: () => ({ hasPermission: () => true, isDemoRestrictedAccount: ref(false) }) }
})
vi.mock('@/composables/useInfiniteScrollSentinel', async () => {
  const { ref } = await import('vue')
  return { useInfiniteScrollSentinel: () => ({ sentinel: ref(null) }) }
})

function mountPage(overrides: Partial<BookListPageOptions> = {}) {
  let page!: BookListPage
  const Host = defineComponent({
    setup() {
      page = useBookListPage({
        viewType: 'genre',
        scopeId: shallowRef(31),
        listEndpoint: (id) => `/api/v1/genres/${id}/books/query`,
        bucketsEndpoint: (id) => `/api/v1/genres/${id}/books/jump-buckets`,
        collapseScope: () => ({ taxonomyPages: true }),
        backupFilePrefix: 'genre',
        ...overrides,
      })
      return () => h('div')
    },
  })
  mount(Host, { global: { plugins: [i18n] } })
  return page
}

describe('useBookListPage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mocks.getEffectivePreference.mockReturnValue(false)
    i18n.global.locale.value = 'en'
  })

  it('hands the endpoints and the gate to the book window', () => {
    const enabled = ref(false)
    mountPage({ enabled })

    expect((mocks.windowOptions!.listEndpoint as (id: number) => string)(31)).toBe('/api/v1/genres/31/books/query')
    expect((mocks.windowOptions!.bucketsEndpoint as (id: number) => string)(31)).toBe('/api/v1/genres/31/books/jump-buckets')
    expect(mocks.windowOptions!.enabled).toBe(enabled)
    expect(mocks.windowOptions!.collapseLinked).toBe(true)
  })

  it('reads and writes series collapse through the host scope', async () => {
    mocks.getEffectivePreference.mockReturnValue(true)
    const page = mountPage()

    expect(mocks.getEffectivePreference).toHaveBeenCalledWith({ taxonomyPages: true })
    expect(page.effectiveCollapseEnabled).toBe(true)

    await page.handleCollapseSeriesUpdate(false)

    expect(mocks.setPreference).toHaveBeenCalledWith({ taxonomyPages: true }, false)
    expect(page.effectiveCollapseEnabled).toBe(false)
  })

  it('counts the entity total until a search narrows it', () => {
    const page = mountPage()

    expect(page.countFact(12)).toBe('12 books')
    expect(page.countFact(undefined)).toBeNull()

    page.setFilter({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'x' }] } as GroupRule)

    expect(page.countFact(12)).toBe('3 of 12 books')
  })

  it('remembers a sort chosen through the setter under the view type', () => {
    const page = mountPage()

    page.setSortModel([{ field: 'addedAt', dir: 'desc' }])

    expect(page.tableSort).toEqual([{ field: 'addedAt', dir: 'desc' }])
    expect(JSON.parse(localStorage.getItem('bookorbit:sort:genre:31')!)).toEqual([{ field: 'addedAt', dir: 'desc' }])
  })

  it('clears search and filters for a different entity', () => {
    const page = mountPage()
    page.setSearchQuery('dune')
    page.setFilter({ type: 'group', join: 'AND', rules: [] } as GroupRule)

    page.resetNarrowing()

    expect(page.searchQuery).toBe('')
    expect(page.filter).toBeUndefined()
  })

  it('routes a quick view action to the book it shows', () => {
    const page = mountPage()

    page.handleQuickViewAction('delete')
    expect(mocks.handleBookAction).not.toHaveBeenCalled()

    page.quickViewBookId = 8
    page.handleQuickViewAction('delete')
    expect(mocks.handleBookAction).toHaveBeenCalledWith({ id: 8 }, 'delete')
  })

  it('reloads both the window and the jump rail', () => {
    const page = mountPage()

    page.reload()

    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(mocks.refreshBuckets).toHaveBeenCalledOnce()
  })

  it('opens and closes its sheets through setters', () => {
    const page = mountPage()

    page.openSendBook()
    page.openAddToCollection()
    page.setMetadataExportOpen(true)
    expect([page.sendBookOpen, page.addToCollectionOpen, page.metadataExportOpen]).toEqual([true, true, true])

    page.setSendBookOpen(false)
    page.setAddToCollectionOpen(false)
    page.setMetadataExportOpen(false)
    expect([page.sendBookOpen, page.addToCollectionOpen, page.metadataExportOpen]).toEqual([false, false, false])
  })
})
