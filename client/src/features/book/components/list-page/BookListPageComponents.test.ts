import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import type { BookListPage } from '@/features/book/composables/useBookListPage'
import BookListContent from './BookListContent.vue'
import BookListDialogs from './BookListDialogs.vue'
import BookListToolbar from './BookListToolbar.vue'

const BOOK = { id: 4, title: 'Dune' }

function fakePage(overrides: Record<string, unknown> = {}) {
  return reactive({
    viewType: 'genre',
    viewMode: 'grid',
    effectiveViewMode: 'grid',
    searchQuery: '',
    filterTokens: [],
    isNarrowed: false,
    sortLabel: 'Title',
    sortDirection: 'asc',
    isDefaultSort: true,
    tableSortModel: [],
    randomSortActive: false,
    filterOpen: false,
    filterRuleCount: 0,
    filter: undefined,
    selectionMode: false,
    coverSize: 160,
    gridGap: 28,
    showJumpRails: true,
    effectiveCollapseEnabled: false,
    tableRef: null,
    books: [BOOK],
    slots: [BOOK],
    contiguousPrefix: [BOOK],
    loading: false,
    hasMorePrefix: false,
    bookTotal: 1,
    total: 1,
    booksInitialized: true,
    selectedIds: new Set<number>(),
    selectedCount: 0,
    linkBookIds: [],
    mergeBookIds: [],
    deleteBookId: null,
    isSelected: () => false,
    setSearchQuery: vi.fn<(...args: unknown[]) => void>(),
    clearAll: vi.fn<(...args: unknown[]) => void>(),
    setViewMode: vi.fn<(...args: unknown[]) => void>(),
    handleSelect: vi.fn<(...args: unknown[]) => void>(),
    handleBookAction: vi.fn<(...args: unknown[]) => void>(),
    bindGrid: vi.fn<(...args: unknown[]) => void>(),
    bindTable: vi.fn<(...args: unknown[]) => void>(),
    bindSentinel: vi.fn<(...args: unknown[]) => void>(),
    ...overrides,
  }) as unknown as BookListPage
}

function stub(name: string, emits: string[] = []) {
  return {
    name,
    props: { modelValue: null, books: null, viewMode: null, book: null },
    emits,
    template: `<div data-stub="${name}"><slot /><slot name="footer" /></div>`,
  }
}

const stubs = {
  BrowseSearchField: stub('BrowseSearchField', ['update:modelValue', 'clear']),
  BrowseSortControl: stub('BrowseSortControl'),
  BrowseFilterControl: stub('BrowseFilterControl'),
  BrowseViewControls: stub('BrowseViewControls', ['update:viewMode']),
  BookSortBuilder: stub('BookSortBuilder'),
  BookFilterBuilder: stub('BookFilterBuilder'),
  BookShuffleButton: stub('BookShuffleButton'),
  VirtualBookGrid: stub('VirtualBookGrid'),
  VirtualBookTable: stub('VirtualBookTable'),
  BookListRow: stub('BookListRow', ['select', 'action']),
  JumpRail: stub('JumpRail'),
}

describe('BookListToolbar', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('writes the search and view mode through the page setters', async () => {
    const page = fakePage()
    const wrapper = mount(BookListToolbar, { props: { page }, global: { plugins: [i18n], stubs } })

    await wrapper.findComponent({ name: 'BrowseSearchField' }).vm.$emit('update:modelValue', 'dune')
    await wrapper.findComponent({ name: 'BrowseSearchField' }).vm.$emit('clear')
    await wrapper.findComponent({ name: 'BrowseViewControls' }).vm.$emit('update:viewMode', 'list')

    expect(page.setSearchQuery).toHaveBeenCalledWith('dune')
    expect(page.clearAll).toHaveBeenCalledOnce()
    expect(page.setViewMode).toHaveBeenCalledWith('list')
  })

  it('puts the host extras between the filters and the view controls', () => {
    const wrapper = mount(BookListToolbar, {
      props: { page: fakePage() },
      slots: { extras: '<span data-test="extras">Library</span>' },
      global: { plugins: [i18n], stubs },
    })

    const html = wrapper.html()
    expect(html.indexOf('data-stub="BrowseFilterControl"')).toBeLessThan(html.indexOf('data-test="extras"'))
    expect(html.indexOf('data-test="extras"')).toBeLessThan(html.indexOf('data-stub="BrowseViewControls"'))
  })

  it('leaves sorting to the table headers in table view', () => {
    const wrapper = mount(BookListToolbar, {
      props: { page: fakePage({ effectiveViewMode: 'table' }) },
      global: { plugins: [i18n], stubs },
    })

    expect(wrapper.find('[data-stub="BrowseSortControl"]').exists()).toBe(false)
  })
})

describe('BookListContent', () => {
  it.each([
    ['grid', 'VirtualBookGrid'],
    ['list', 'BookListRow'],
    ['table', 'VirtualBookTable'],
  ])('renders the %s view', (mode, component) => {
    const wrapper = mount(BookListContent, {
      props: { page: fakePage({ effectiveViewMode: mode }) },
      global: { plugins: [i18n], stubs },
    })

    expect(wrapper.find(`[data-stub="${component}"]`).exists()).toBe(true)
    for (const other of ['VirtualBookGrid', 'BookListRow', 'VirtualBookTable'].filter((name) => name !== component)) {
      expect(wrapper.find(`[data-stub="${other}"]`).exists()).toBe(false)
    }
  })

  it('passes the row and its event to the page handlers in list view', async () => {
    const page = fakePage({ effectiveViewMode: 'list' })
    const wrapper = mount(BookListContent, { props: { page }, global: { plugins: [i18n], stubs } })

    await wrapper.findComponent({ name: 'BookListRow' }).vm.$emit('action', 'quick-view')
    await wrapper.findComponent({ name: 'BookListRow' }).vm.$emit('select', true)

    expect(page.handleBookAction).toHaveBeenCalledWith(BOOK, 'quick-view')
    expect(page.handleSelect).toHaveBeenCalledWith(4, true)
  })

  it('reports that every book has loaded at the end of the list', () => {
    const wrapper = mount(BookListContent, {
      props: { page: fakePage({ effectiveViewMode: 'list' }) },
      global: { plugins: [i18n], stubs },
    })

    expect(wrapper.text()).toContain('All 1 books loaded')
    expect(wrapper.find('[data-stub="JumpRail"]').exists()).toBe(true)
  })
})

describe('BookListDialogs', () => {
  it('forwards a remove-from-collection request to the host', async () => {
    const wrapper = mount(BookListDialogs, {
      props: { page: fakePage(), inCollection: true },
      global: {
        plugins: [i18n],
        stubs: {
          SelectionActionBar: stub('SelectionActionBar', ['remove-from-collection']),
          BookQuickView: true,
          MetadataExportDialog: true,
          AddToCollectionSheet: true,
          MoveToLibrarySheet: true,
          BulkEditMetadataDialog: true,
          SendBookDialog: true,
          DeleteBookDialog: true,
        },
      },
    })

    await wrapper.findComponent({ name: 'SelectionActionBar' }).vm.$emit('remove-from-collection')

    expect(wrapper.emitted('removeFromCollection')).toHaveLength(1)
  })
})
