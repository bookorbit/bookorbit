import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { MatchFlag, type SearchResult } from '@embedpdf/models'
import type { AnnotationItem } from '@bookorbit/types'

const mocks = vi.hoisted(() => ({
  searchState: {
    __v_isRef: true,
    value: {
      flags: [] as MatchFlag[],
      results: [] as SearchResult[],
      total: 0,
      activeResultIndex: -1,
      query: '',
      loading: false,
      active: false,
    },
  },
  searchScope: {
    searchAllPages: vi.fn<(query: string) => { onProgress: (callback: (progress: { page: number }) => void) => void } | undefined>(),
    stopSearch: vi.fn<() => void>(),
    setFlags: vi.fn<(flags: MatchFlag[]) => void>(),
    goToResult: vi.fn<(index: number) => void>(),
  },
  scrollScope: {
    scrollToPage: vi.fn<(options: Record<string, unknown>) => void>(),
  },
  scrollState: {
    __v_isRef: true,
    value: { currentPage: 1, totalPages: 10 },
  },
  bookmarkCapability: {
    __v_isRef: true,
    value: null as unknown,
  },
  documentState: {
    value: null as unknown,
  },
}))

vi.mock('@embedpdf/plugin-search/vue', async () => {
  const { defineComponent: define, h: create } = await import('vue')
  return {
    SearchLayer: define({
      setup:
        (_, { slots }) =>
        () =>
          create('div', slots.default?.()),
    }),
    useSearch: () => ({ state: mocks.searchState, provides: { value: mocks.searchScope } }),
  }
})

vi.mock('@embedpdf/plugin-scroll/vue', () => ({
  useScroll: () => ({
    state: mocks.scrollState,
    provides: { value: mocks.scrollScope },
  }),
}))

vi.mock('@embedpdf/plugin-bookmark/vue', () => ({
  useBookmarkCapability: () => ({ provides: mocks.bookmarkCapability }),
}))

vi.mock('@embedpdf/plugin-annotation/vue', () => ({
  useAnnotationCapability: () => ({ provides: { value: null } }),
}))

vi.mock('@embedpdf/core/vue', () => ({
  useDocumentState: () => mocks.documentState,
}))

vi.mock('@embedpdf/plugin-thumbnail/vue', async () => {
  const { defineComponent: define, h: create } = await import('vue')
  return {
    ThumbImg: define({ setup: () => () => create('img') }),
  }
})

vi.mock('vue-virtual-scroller', async () => {
  const { defineComponent: define, h: create } = await import('vue')
  const listStub = (fallbackTestId: string) =>
    define({
      inheritAttrs: false,
      props: { items: { type: Array, required: true } },
      setup(props, { attrs, slots }) {
        return () =>
          create(
            'div',
            { ...attrs, 'data-testid': attrs['data-testid'] ?? fallbackTestId },
            props.items.map((item, index) => slots.default?.({ item, index, active: true })),
          )
      },
    })
  return {
    RecycleScroller: listStub('recycle-scroller'),
    DynamicScroller: listStub('dynamic-scroller'),
    DynamicScrollerItem: define({
      setup:
        (_, { slots }) =>
        () =>
          create('div', slots.default?.()),
    }),
  }
})

import PdfReaderSidebar from '../components/PdfReaderSidebar.vue'

const passthrough = defineComponent({
  setup:
    (_, { slots }) =>
    () =>
      h('div', slots.default?.()),
})

const sheetStub = defineComponent({
  props: { open: { type: Boolean, default: false } },
  setup:
    (props, { slots }) =>
    () =>
      props.open ? h('div', { 'data-testid': 'bottom-sheet' }, slots.default?.()) : null,
})

function mountSidebar(props: Record<string, unknown> = {}) {
  return mount(PdfReaderSidebar, {
    props: { documentId: 'doc-1', activeTab: 'search', annotations: [], ...props },
    global: {
      stubs: {
        Tooltip: passthrough,
        TooltipTrigger: passthrough,
        TooltipContent: passthrough,
        ReaderBottomSheet: sheetStub,
      },
    },
  })
}

function makeResult(rects: SearchResult['rects'] = []): SearchResult {
  return {
    pageIndex: 4,
    charIndex: 10,
    charCount: 4,
    rects,
    context: {
      before: 'before',
      match: 'term',
      after: 'after',
      truncatedLeft: false,
      truncatedRight: false,
    },
  }
}

function makeAnnotation(id: number, overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id,
    bookId: 9,
    cfi: null,
    jumpFileId: 33,
    pageno: 3,
    text: `Selection ${id}`,
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    pdf: { page: 2, rect: { x: 10, y: 20, width: 30, height: 8 }, rects: [{ x: 10, y: 20, width: 30, height: 8 }] },
    ...overrides,
  }
}

function outlineCapability(bookmarks: unknown[]) {
  return {
    forDocument: () => ({
      getBookmarks: () => ({
        wait: (resolve: (value: { bookmarks: unknown[] }) => void) => resolve({ bookmarks }),
      }),
    }),
  }
}

function destination(pageIndex: number) {
  return { type: 'destination', destination: { pageIndex, zoom: { mode: 2 }, view: [] } }
}

describe('PdfReaderSidebar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.searchScope.searchAllPages.mockReset()
    mocks.searchState.value = {
      flags: [],
      results: [],
      total: 0,
      activeResultIndex: -1,
      query: '',
      loading: false,
      active: false,
    }
    mocks.scrollState.value = { currentPage: 1, totalPages: 10 }
    mocks.bookmarkCapability.value = null
    mocks.documentState.value = null
  })

  it('debounces full-document searches and cancels superseded work', async () => {
    const wrapper = mountSidebar()
    const input = wrapper.get('input[type="search"]')
    mocks.searchScope.stopSearch.mockClear()

    await input.setValue('dis')
    await input.setValue('distance')

    expect(mocks.searchScope.stopSearch).toHaveBeenCalledTimes(2)
    expect(mocks.searchScope.searchAllPages).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(249)
    expect(mocks.searchScope.searchAllPages).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.searchScope.searchAllPages).toHaveBeenCalledTimes(1)
    expect(mocks.searchScope.searchAllPages).toHaveBeenCalledWith('distance')
  })

  it('does not search for a single character', async () => {
    const wrapper = mountSidebar()
    mocks.searchScope.stopSearch.mockClear()

    await wrapper.get('input[type="search"]').setValue('a')
    await vi.runAllTimersAsync()

    expect(mocks.searchScope.stopSearch).toHaveBeenCalledOnce()
    expect(mocks.searchScope.searchAllPages).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Enter at least 2 characters')
  })

  it('lets the plugin restart an active search once when flags change', async () => {
    const wrapper = mountSidebar()

    await wrapper.get('button[aria-pressed="false"]').trigger('click')

    expect(mocks.searchScope.setFlags).toHaveBeenCalledWith([MatchFlag.MatchCase])
    expect(mocks.searchScope.searchAllPages).not.toHaveBeenCalled()
  })

  it('keeps virtual results bounded and navigates results without rectangles safely', async () => {
    mocks.searchState.value = {
      ...mocks.searchState.value,
      results: [makeResult()],
      total: 1,
      active: true,
    }
    const wrapper = mountSidebar()

    expect(wrapper.get('aside').classes()).toContain('overflow-hidden')
    expect(wrapper.get('[data-testid="search-results"]').classes()).toContain('overflow-x-hidden')

    await wrapper.get('[data-testid="search-results"] button').trigger('click')

    expect(mocks.searchScope.goToResult).toHaveBeenCalledWith(0)
    expect(mocks.scrollScope.scrollToPage).toHaveBeenCalledWith({ pageNumber: 5 })
  })

  it('labels a run of results with its page only once', () => {
    mocks.searchState.value = {
      ...mocks.searchState.value,
      results: [makeResult(), makeResult()],
      total: 2,
      active: true,
    }
    const wrapper = mountSidebar()

    const headings = wrapper.findAll('[data-testid="search-results"] p')
    expect(headings).toHaveLength(1)
    expect(headings[0]!.text()).toBe('Page 5')
  })

  it('reports full-document search progress', async () => {
    mocks.searchState.value = {
      ...mocks.searchState.value,
      query: 'distance',
      loading: true,
    }
    mocks.searchScope.searchAllPages.mockReturnValue({
      onProgress: (callback: (progress: { page: number }) => void) => callback({ page: 4 }),
    })

    const wrapper = mountSidebar()
    await vi.advanceTimersByTimeAsync(250)

    expect(wrapper.text()).toContain('Searching page 5 of 10')
  })

  it('uses Enter and Shift+Enter to navigate search results', async () => {
    mocks.searchState.value = {
      ...mocks.searchState.value,
      results: [makeResult(), makeResult()],
      total: 2,
      activeResultIndex: 0,
      active: true,
    }
    const wrapper = mountSidebar()
    const input = wrapper.get('input[type="search"]')

    await input.trigger('keydown', { key: 'Enter' })
    expect(mocks.searchScope.goToResult).toHaveBeenLastCalledWith(1)

    mocks.searchState.value.activeResultIndex = 1
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(mocks.searchScope.goToResult).toHaveBeenLastCalledWith(0)
  })

  it('clears the query and cancels search work', async () => {
    const wrapper = mountSidebar()
    const input = wrapper.get('input[type="search"]')
    await input.setValue('distance')
    mocks.searchScope.stopSearch.mockClear()

    await wrapper.get('button[aria-label="Clear search"]').trigger('click')

    expect((input.element as HTMLInputElement).value).toBe('')
    expect(mocks.searchScope.stopSearch).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows an accessible retry state instead of an empty highlight list after load failure', async () => {
    const wrapper = mountSidebar({ activeTab: 'highlights', loadError: true })

    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load highlights')
    expect(wrapper.text()).not.toContain('No highlights yet')
    await wrapper.get('[role="alert"] button').trigger('click')
    expect(wrapper.emitted('retryHighlights')).toHaveLength(1)
  })

  it('virtualizes highlight rows and keeps delete available without hover', () => {
    const wrapper = mountSidebar({ activeTab: 'highlights', annotations: [makeAnnotation(1)] })

    const deleteButton = wrapper.get('button[aria-label="Delete highlight"]')
    expect(deleteButton.classes()).toContain('opacity-100')
    expect(wrapper.find('[data-testid="pdf-notes-list"]').exists()).toBe(true)
  })

  it('sizes highlight rows to their content instead of a fixed row height', () => {
    const wrapper = mountSidebar({ activeTab: 'highlights', annotations: [makeAnnotation(1)] })

    expect(wrapper.get('[data-testid="pdf-notes-list"]').attributes('min-item-size')).toBe('72')
    expect(wrapper.find('[class*="h-[120px]"]').exists()).toBe(false)
  })

  it('filters highlights down to the ones carrying a note', async () => {
    const wrapper = mountSidebar({
      activeTab: 'highlights',
      annotations: [makeAnnotation(1), makeAnnotation(2, { color: '#4ADE80', note: 'keep this' })],
    })

    expect(wrapper.text()).toContain('Selection 1')

    await wrapper.get('button[aria-pressed="false"][class*="rounded-full"]:last-of-type').trigger('click')

    expect(wrapper.text()).toContain('Selection 2')
    expect(wrapper.text()).not.toContain('Selection 1')
  })

  it('exposes rail destinations as a labelled tablist wired to the visible panel', () => {
    const wrapper = mountSidebar()

    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(4)
    expect(tabs.map((tab) => tab.attributes('aria-label'))).toEqual(['Pages', 'Contents', 'Search', 'Notes'])

    const active = tabs[2]!
    expect(active.attributes('aria-selected')).toBe('true')
    expect(active.attributes('tabindex')).toBe('0')
    expect(tabs[0]!.attributes('tabindex')).toBe('-1')

    const panel = wrapper.get('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe(active.attributes('aria-controls'))
    expect(panel.attributes('aria-labelledby')).toBe(active.attributes('id'))
  })

  it('moves between rail destinations with arrow keys', async () => {
    const wrapper = mountSidebar()
    const tabList = wrapper.get('[role="tablist"]')

    await tabList.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('update:activeTab')?.at(-1)).toEqual(['highlights'])

    await tabList.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.emitted('update:activeTab')?.at(-1)).toEqual(['contents'])

    await tabList.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:activeTab')?.at(-1)).toEqual(['thumbnails'])

    await tabList.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:activeTab')?.at(-1)).toEqual(['highlights'])

    await tabList.trigger('keydown', { key: 'a' })
    expect(wrapper.emitted('update:activeTab')).toHaveLength(4)
  })

  it('keeps the rail available while the panel is closed', () => {
    const wrapper = mountSidebar({ open: false })

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(4)
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(wrapper.get('[role="tab"][aria-label="Search"]').attributes('aria-selected')).toBe('false')
  })

  it('shows a highlight count badge on the notes destination', () => {
    const wrapper = mountSidebar({ annotations: [makeAnnotation(1), makeAnnotation(2)] })

    expect(wrapper.get('[role="tab"][aria-label="Notes"]').text()).toBe('2')
  })

  it('swaps the rail for a bottom sheet on phones', () => {
    const wrapper = mountSidebar({ layout: 'sheet', activeTab: 'highlights' })

    expect(wrapper.find('aside').exists()).toBe(false)
    expect(wrapper.find('[data-testid="bottom-sheet"]').exists()).toBe(true)
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['Pages', 'Contents', 'Search', 'Notes'])
  })

  it('resizes the docked panel with the keyboard within its bounds', async () => {
    const wrapper = mountSidebar({ width: 300 })
    const grip = wrapper.get('[role="separator"]')

    await grip.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:width')?.at(-1)).toEqual([316])

    await grip.trigger('keydown', { key: 'ArrowLeft', shiftKey: true })
    expect(wrapper.emitted('update:width')?.at(-1)).toEqual([260])
  })

  it('highlights and reveals the outline entry containing the current page', async () => {
    const scrollIntoView = vi.fn<() => void>()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    mocks.scrollState.value = { currentPage: 74, totalPages: 100 }
    mocks.bookmarkCapability.value = outlineCapability([
      { title: 'Chapter five', target: destination(50) },
      {
        title: 'Chapter six',
        target: destination(73),
        children: [{ title: 'Aggregates', target: destination(78) }],
      },
    ])

    const wrapper = mountSidebar({ activeTab: 'contents' })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const active = wrapper.get('[data-pdf-active-bookmark]')
    expect(active.text()).toContain('Chapter six')
    expect(active.attributes('aria-current')).toBe('location')
    expect(active.classes()).toContain('bg-primary/10')
    const inactive = wrapper.findAll('button').find((button) => button.text().includes('Chapter five'))
    expect(inactive?.classes()).toContain('text-foreground')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'nearest' })
  })

  it('collapses an outline branch and hides its descendants', async () => {
    mocks.bookmarkCapability.value = outlineCapability([
      {
        title: 'Chapter one',
        target: destination(4),
        children: [{ title: 'Nested topic', target: destination(6) }],
      },
    ])

    const wrapper = mountSidebar({ activeTab: 'contents' })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Nested topic')

    await wrapper.get('button[aria-label="Collapse Chapter one"]').trigger('click')
    expect(wrapper.text()).not.toContain('Nested topic')
  })

  it('filters the outline and shows page numbers', async () => {
    mocks.bookmarkCapability.value = outlineCapability([
      { title: 'Installing Docker', target: destination(19) },
      { title: 'Quick Recap', target: destination(27) },
    ])

    const wrapper = mountSidebar({ activeTab: 'contents' })
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('20')

    await wrapper.get('input[aria-label="Filter outline"]').setValue('recap')

    expect(wrapper.text()).toContain('Quick Recap')
    expect(wrapper.text()).not.toContain('Installing Docker')
  })

  it('offers a jump-to-page field on the pages destination', () => {
    const wrapper = mountSidebar({ activeTab: 'thumbnails' })

    expect(wrapper.find('input[aria-label="Jump to page"]').exists()).toBe(true)
  })

  it('prompts for a query instead of showing an empty search list', () => {
    const wrapper = mountSidebar()

    expect(wrapper.text()).toContain('Type a term to search this PDF.')
    expect(wrapper.find('[data-testid="search-results"]').exists()).toBe(false)
  })
})
