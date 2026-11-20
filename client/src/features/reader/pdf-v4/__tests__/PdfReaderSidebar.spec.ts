import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type { AnnotationItem } from '@bookorbit/types'

type PageRef = { kind: 'objectNumber'; objectNumber: number }
type Hit = {
  page: PageRef
  pageIndex: number
  start: number
  count: number
  segments: []
  snippet?: { before: string; match: string; after: string }
}
type Outline = { ref: PageRef; parent: PageRef | null; title: string; target: { kind: 'goto'; destination: { kind: 'fit'; page: PageRef } } | null }

const searchApi = {
  search: vi.fn<(query: { text: string; matchCase?: boolean; wholeWord?: boolean }) => Promise<unknown>>(),
  clear: vi.fn<() => void>(),
  goToHit: vi.fn<(index: number) => void>(),
}
const searchState = {
  query: ref<{ text: string } | null>(null),
  status: ref('idle'),
  hitCount: ref(0),
  activeHitIndex: ref(-1),
  progress: ref({ pagesSearched: 0, pageCount: 10 }),
}
const hits = ref<Hit[]>([])
const outlineApi = { activate: vi.fn<(ref: PageRef) => void>() }
const outlineState = { items: ref<Outline[]>([]), status: ref('ready') }
const pages = ref(Array.from({ length: 100 }, (_, index) => ({ index, ref: pageRef(index), size: { width: 600, height: 800 }, rotation: 0 })))

function pageRef(pageIndex: number): PageRef {
  return { kind: 'objectNumber', objectNumber: 1000 + pageIndex }
}

vi.mock('@embedpdf/vue/search', () => ({
  useSearch: () => searchApi,
  useSearchState: () => searchState,
  useSearchHits: () => hits,
}))

vi.mock('@embedpdf/vue/outline', () => ({
  useOutline: () => outlineApi,
  useOutlineState: () => outlineState,
}))

vi.mock('@embedpdf/vue/runtime', () => ({ usePageList: () => pages }))

vi.mock('@embedpdf/vue/page-view', async () => {
  const { defineComponent: define, h: create } = await import('vue')
  return {
    PageView: define({
      setup:
        (_, { slots }) =>
        () =>
          create('div', slots.default?.()),
    }),
  }
})

vi.mock('@embedpdf/vue/render', async () => {
  const { defineComponent: define, h: create } = await import('vue')
  return { RenderLayer: define({ setup: () => () => create('div') }) }
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
    props: { activeTab: 'search', currentPage: 1, totalPages: 10, annotations: [], ...props },
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

function makeHit(snippet = true): Hit {
  return {
    page: pageRef(4),
    pageIndex: 4,
    start: 10,
    count: 4,
    segments: [],
    ...(snippet ? { snippet: { before: 'before', match: 'term', after: 'after' } } : {}),
  }
}

function completeWith(results: Hit[], activeHitIndex = -1) {
  hits.value = results
  searchState.hitCount.value = results.length
  searchState.activeHitIndex.value = activeHitIndex
  searchState.status.value = 'complete'
}

function outlineItem(objectNumber: number, title: string, pageIndex: number | null, parent?: number): Outline {
  return {
    ref: { kind: 'objectNumber', objectNumber },
    parent: parent === undefined ? null : { kind: 'objectNumber', objectNumber: parent },
    title,
    target: pageIndex === null ? null : { kind: 'goto', destination: { kind: 'fit', page: pageRef(pageIndex) } },
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
    highlightedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    pdf: { page: 2, rect: { x: 10, y: 20, width: 30, height: 8 }, rects: [{ x: 10, y: 20, width: 30, height: 8 }] },
    ...overrides,
  }
}

describe('PdfReaderSidebar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    searchApi.search.mockResolvedValue({ status: 'complete', hitCount: 0 })
    searchState.query.value = null
    searchState.status.value = 'idle'
    searchState.hitCount.value = 0
    searchState.activeHitIndex.value = -1
    searchState.progress.value = { pagesSearched: 0, pageCount: 10 }
    hits.value = []
    outlineState.items.value = []
    outlineState.status.value = 'ready'
  })

  it('debounces full-document searches and clears superseded work', async () => {
    const wrapper = mountSidebar()
    const input = wrapper.get('input[type="search"]')
    searchApi.clear.mockClear()

    await input.setValue('dis')
    await input.setValue('distance')

    expect(searchApi.clear).toHaveBeenCalledTimes(2)
    expect(searchApi.search).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(249)
    expect(searchApi.search).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(searchApi.search).toHaveBeenCalledExactlyOnceWith({ text: 'distance', matchCase: false, wholeWord: false })
  })

  it('does not search for a single character', async () => {
    const wrapper = mountSidebar()
    searchApi.clear.mockClear()

    await wrapper.get('input[type="search"]').setValue('a')
    await vi.runAllTimersAsync()

    expect(searchApi.clear).toHaveBeenCalledOnce()
    expect(searchApi.search).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Enter at least 2 characters')
  })

  it('searches again with the match options when they change', async () => {
    const wrapper = mountSidebar()
    await wrapper.get('input[type="search"]').setValue('distance')
    await vi.advanceTimersByTimeAsync(250)

    await wrapper.get('button[aria-pressed="false"]').trigger('click')
    await vi.advanceTimersByTimeAsync(250)

    expect(searchApi.search).toHaveBeenLastCalledWith({ text: 'distance', matchCase: true, wholeWord: false })
    expect(searchApi.search).toHaveBeenCalledTimes(2)
  })

  it('keeps virtual results bounded and reveals a chosen result', async () => {
    completeWith([makeHit()])
    const wrapper = mountSidebar()

    expect(wrapper.get('aside').classes()).toContain('overflow-hidden')
    expect(wrapper.get('[data-testid="search-results"]').classes()).toContain('overflow-x-hidden')

    await wrapper.get('[data-testid="search-results"] button').trigger('click')

    expect(searchApi.goToHit).toHaveBeenCalledWith(0)
  })

  it('labels a run of results with its page only once', () => {
    completeWith([makeHit(), makeHit()])
    const wrapper = mountSidebar()

    const headings = wrapper.findAll('[data-testid="search-results"] p')
    expect(headings).toHaveLength(1)
    expect(headings[0]!.text()).toBe('Page 5')
  })

  it('names the page for a result the document does not let it quote', () => {
    completeWith([makeHit(false)])
    const wrapper = mountSidebar()

    expect(wrapper.get('[data-testid="search-results"] button').text()).toBe('Page 5')
  })

  it('reports full-document search progress', () => {
    searchState.status.value = 'searching'
    searchState.progress.value = { pagesSearched: 4, pageCount: 10 }

    const wrapper = mountSidebar()

    expect(wrapper.text()).toContain('Searching page 5 of 10')
  })

  it('uses Enter and Shift+Enter to navigate search results', async () => {
    completeWith([makeHit(), makeHit()], 0)
    const wrapper = mountSidebar()
    const input = wrapper.get('input[type="search"]')

    await input.trigger('keydown', { key: 'Enter' })
    expect(searchApi.goToHit).toHaveBeenLastCalledWith(1)

    searchState.activeHitIndex.value = 1
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(searchApi.goToHit).toHaveBeenLastCalledWith(0)

    searchState.activeHitIndex.value = 0
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(searchApi.goToHit).toHaveBeenLastCalledWith(1)
  })

  it('clears the query and the search', async () => {
    const wrapper = mountSidebar()
    const input = wrapper.get('input[type="search"]')
    await input.setValue('distance')
    searchApi.clear.mockClear()

    await wrapper.get('button[aria-label="Clear search"]').trigger('click')

    expect((input.element as HTMLInputElement).value).toBe('')
    expect(searchApi.clear).toHaveBeenCalled()
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
    outlineState.items.value = [outlineItem(1, 'Chapter five', 50), outlineItem(2, 'Chapter six', 73), outlineItem(3, 'Aggregates', 78, 2)]

    const wrapper = mountSidebar({ activeTab: 'contents', currentPage: 74, totalPages: 100 })
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
    outlineState.items.value = [outlineItem(1, 'Chapter one', 4), outlineItem(2, 'Nested topic', 6, 1)]

    const wrapper = mountSidebar({ activeTab: 'contents' })
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('Nested topic')

    await wrapper.get('button[aria-label="Collapse Chapter one"]').trigger('click')
    expect(wrapper.text()).not.toContain('Nested topic')
  })

  it('filters the outline and shows page numbers', async () => {
    outlineState.items.value = [outlineItem(1, 'Installing Docker', 19), outlineItem(2, 'Quick Recap', 27)]

    const wrapper = mountSidebar({ activeTab: 'contents' })
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('20')

    await wrapper.get('input[aria-label="Filter outline"]').setValue('recap')

    expect(wrapper.text()).toContain('Quick Recap')
    expect(wrapper.text()).not.toContain('Installing Docker')
  })

  it('follows an outline entry to where it points', async () => {
    outlineState.items.value = [outlineItem(1, 'Installing Docker', 19)]

    const wrapper = mountSidebar({ activeTab: 'contents' })
    await wrapper.vm.$nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Installing Docker'))!
      .trigger('click')

    expect(outlineApi.activate).toHaveBeenCalledExactlyOnceWith({ kind: 'objectNumber', objectNumber: 1 })
  })

  it('shows a loading state until the outline is read', () => {
    outlineState.status.value = 'loading'

    const wrapper = mountSidebar({ activeTab: 'contents' })

    expect(wrapper.find('[role="status"]').exists()).toBe(true)
  })

  it('offers a jump-to-page field on the pages destination', () => {
    const wrapper = mountSidebar({ activeTab: 'thumbnails' })

    expect(wrapper.find('input[aria-label="Jump to page"]').exists()).toBe(true)
  })

  it('asks the reader to go to a thumbnail page', async () => {
    const wrapper = mountSidebar({ activeTab: 'thumbnails' })

    await wrapper.get('input[aria-label="Jump to page"]').setValue('7')
    await wrapper.get('input[aria-label="Jump to page"]').trigger('change')

    expect(wrapper.emitted('selectPage')).toEqual([[6]])
  })

  it('prompts for a query instead of showing an empty search list', () => {
    const wrapper = mountSidebar()

    expect(wrapper.text()).toContain('Type a term to search this PDF.')
    expect(wrapper.find('[data-testid="search-results"]').exists()).toBe(false)
  })
})
