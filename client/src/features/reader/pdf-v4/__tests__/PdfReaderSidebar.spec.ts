import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { MatchFlag, type SearchResult } from '@embedpdf/models'

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
}))

vi.mock('@embedpdf/plugin-search/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    SearchLayer: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
    }),
    useSearch: () => ({ state: mocks.searchState, provides: { value: mocks.searchScope } }),
  }
})

vi.mock('@embedpdf/plugin-scroll/vue', () => ({
  useScroll: () => ({
    state: { __v_isRef: true, value: { currentPage: 1, totalPages: 10 } },
    provides: { value: mocks.scrollScope },
  }),
}))

vi.mock('@embedpdf/plugin-bookmark/vue', () => ({
  useBookmarkCapability: () => ({ provides: { value: null } }),
}))

vi.mock('@embedpdf/plugin-annotation/vue', () => ({
  useAnnotationCapability: () => ({ provides: { value: null } }),
}))

vi.mock('@embedpdf/plugin-thumbnail/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    ThumbImg: defineComponent({ setup: () => () => h('img') }),
    ThumbnailsPane: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h('div', slots.default?.()),
    }),
  }
})

vi.mock('vue-virtual-scroller', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    RecycleScroller: defineComponent({
      inheritAttrs: false,
      props: { items: { type: Array, required: true } },
      setup(props, { attrs, slots }) {
        return () =>
          h(
            'div',
            { ...attrs, 'data-testid': 'search-results' },
            props.items.map((item, index) => slots.default?.({ item, index })),
          )
      },
    }),
  }
})

import PdfReaderSidebar from '../components/PdfReaderSidebar.vue'

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
  })

  it('debounces full-document searches and cancels superseded work', async () => {
    const wrapper = mount(PdfReaderSidebar, { props: { documentId: 'doc-1', activeTab: 'search', headerVisible: true } })
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
    const wrapper = mount(PdfReaderSidebar, { props: { documentId: 'doc-1', activeTab: 'search', headerVisible: true } })
    mocks.searchScope.stopSearch.mockClear()

    await wrapper.get('input[type="search"]').setValue('a')
    await vi.runAllTimersAsync()

    expect(mocks.searchScope.stopSearch).toHaveBeenCalledOnce()
    expect(mocks.searchScope.searchAllPages).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Enter at least 2 characters')
  })

  it('lets the plugin restart an active search once when flags change', async () => {
    const wrapper = mount(PdfReaderSidebar, { props: { documentId: 'doc-1', activeTab: 'search', headerVisible: true } })

    await wrapper.get('input[type="checkbox"]').setValue(true)

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
    const wrapper = mount(PdfReaderSidebar, { props: { documentId: 'doc-1', activeTab: 'search', headerVisible: true } })

    expect(wrapper.get('aside').classes()).toContain('overflow-hidden')
    expect(wrapper.get('[data-testid="search-results"]').classes()).toContain('overflow-x-hidden')

    await wrapper.get('[data-testid="search-results"] button').trigger('click')

    expect(mocks.searchScope.goToResult).toHaveBeenCalledWith(0)
    expect(mocks.scrollScope.scrollToPage).toHaveBeenCalledWith({ pageNumber: 5 })
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

    const wrapper = mount(PdfReaderSidebar, { props: { documentId: 'doc-1', activeTab: 'search', headerVisible: true } })
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
    const wrapper = mount(PdfReaderSidebar, { props: { documentId: 'doc-1', activeTab: 'search', headerVisible: true } })
    const input = wrapper.get('input[type="search"]')

    await input.trigger('keydown', { key: 'Enter' })
    expect(mocks.searchScope.goToResult).toHaveBeenLastCalledWith(1)

    mocks.searchState.value.activeResultIndex = 1
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(mocks.searchScope.goToResult).toHaveBeenLastCalledWith(0)
  })

  it('clears the query, cancels search work, and restores input focus', async () => {
    const wrapper = mount(PdfReaderSidebar, {
      props: { documentId: 'doc-1', activeTab: 'search', headerVisible: true },
      attachTo: document.body,
    })
    const input = wrapper.get('input[type="search"]')
    await input.setValue('distance')
    mocks.searchScope.stopSearch.mockClear()

    await wrapper.get('button[aria-label="Clear search"]').trigger('click')

    expect((input.element as HTMLInputElement).value).toBe('')
    expect(mocks.searchScope.stopSearch).toHaveBeenCalled()
    expect(document.activeElement).toBe(input.element)
    wrapper.unmount()
  })
})
