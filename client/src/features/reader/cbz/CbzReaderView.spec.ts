import { computed, nextTick, ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CbzReaderView from './CbzReaderView.vue'
import CbzSettingsPanel from './components/CbzSettingsPanel.vue'
import NextIssueCard from './components/NextIssueCard.vue'

const NEXT_BOOK = { bookId: 91, fileId: 501, format: 'cbz', title: 'Issue 10', seriesIndex: '10' }

const mocks = vi.hoisted(() => ({
  savedMode: 'infinite' as 'paginated' | 'infinite' | 'long-strip',
  savedViewMode: 'single' as 'single' | 'two-page',
  savedSpreadGap: 0,
  pageCount: 10_000,
  savedPageNumber: 9_000,
  savedAutoAdvance: false,
  seriesId: 42 as number | null,
  nextBook: null as { bookId: number; fileId: number; format: string; title: string; seriesIndex: string } | null,
  loadNextBook: vi.fn<(seriesId: number | null, bookId: number) => Promise<void>>().mockResolvedValue(undefined),
  routerPush: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  onBeforeRouteLeave: vi.fn<(guard: () => Promise<void>) => void>(),
  pageUrl: vi.fn<(page: number) => string>((page) => `/api/v1/cbz/files/22/pages/${page}`),
  progressSave: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  scrollToIndex: vi.fn<(index: number, options: { align: string }) => void>(),
  updateBookSettings: vi.fn<(patch: unknown) => void>(),
  resetBookSettings: vi.fn<() => void>(),
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { bookId: '11', fileId: '22' }, query: {} }),
  useRouter: () => ({ back: vi.fn<() => void>(), push: mocks.routerPush, replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
  onBeforeRouteLeave: mocks.onBeforeRouteLeave,
}))

vi.mock('@tanstack/vue-virtual', () => ({
  useVirtualizer: (options: { value: { count: number } }) => {
    const center = ref(0)
    return computed(() => ({
      getVirtualItems: () => {
        const count = options.value.count
        if (count === 0) return []
        const start = Math.max(0, center.value - 2)
        const end = Math.min(count - 1, center.value + 2)
        return Array.from({ length: end - start + 1 }, (_, offset) => {
          const index = start + offset
          return { key: index, index, start: index * 1_000, end: (index + 1) * 1_000, size: 1_000, lane: 0 }
        })
      },
      getTotalSize: () => options.value.count * 1_000,
      measureElement: vi.fn<(element?: unknown) => void>(),
      scrollToIndex: (index: number, scrollOptions: { align: string }) => {
        center.value = index
        mocks.scrollToIndex(index, scrollOptions)
      },
    }))
  },
}))

vi.mock('./composables/useCbz', () => ({
  useCbz: () => {
    const pageCount = ref(0)
    return {
      pageCount,
      bookTitle: ref('Large comic'),
      loading: ref(false),
      error: ref(null),
      seriesId: ref(mocks.seriesId),
      pageUrl: mocks.pageUrl,
      load: async () => {
        pageCount.value = mocks.pageCount
      },
    }
  },
}))

vi.mock('../shared/composables/useSeriesNextBook', () => ({
  useSeriesNextBook: () => ({ nextBook: computed(() => mocks.nextBook), load: mocks.loadNextBook }),
}))

vi.mock('./composables/useCbzSettings', () => ({
  useCbzSettings: () => ({
    fitMode: ref('fit-page'),
    viewMode: ref('single'),
    scrollMode: ref('paginated'),
    direction: ref('ltr'),
    spreadAlignment: ref('normal'),
    spreadGap: ref(0),
    forceTwoPage: ref(false),
    widePageSingletonMode: ref('auto'),
    bgColor: ref('black'),
    autoAdvance: ref(false),
    bgValue: computed(() => '#000'),
    imgFitClass: computed(() => 'object-contain'),
  }),
}))

vi.mock('../shared/composables/useReaderSettings', () => ({
  useReaderSettings: () => ({
    effective: computed(() => ({
      fitMode: 'fit-page',
      viewMode: mocks.savedViewMode,
      scrollMode: mocks.savedMode,
      direction: 'ltr',
      spreadAlignment: 'normal',
      spreadGap: mocks.savedSpreadGap,
      forceTwoPage: false,
      widePageSingletonMode: 'auto',
      bgColor: 'black',
      autoAdvance: mocks.savedAutoAdvance,
    })),
    isCustomized: ref(false),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    updateBookSettings: mocks.updateBookSettings,
    resetBookSettings: mocks.resetBookSettings,
  }),
}))

vi.mock('../shared/composables/useReaderProgress', () => ({
  useReaderProgress: () => ({
    pageNumber: ref(mocks.savedPageNumber),
    percentage: ref(90),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    save: mocks.progressSave,
  }),
}))

vi.mock('../shared/composables/useReadingSession', () => ({
  useReadingSession: () => ({ onActivity: vi.fn<() => void>(), elapsedMinutes: ref(0) }),
}))

vi.mock('../shared/composables/useVisibility', () => ({
  useVisibility: () => ({
    headerVisible: ref(false),
    footerVisible: ref(false),
    handleMiddleTap: vi.fn<() => void>(),
    showHeader: vi.fn<() => void>(),
    showFooter: vi.fn<() => void>(),
    setVisibilityLock: vi.fn<(locked: boolean) => void>(),
  }),
}))

vi.mock('../shared/composables/useFullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: ref(false), toggleFullscreen: vi.fn<() => void>() }),
}))

describe('CbzReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.savedMode = 'infinite'
    mocks.savedViewMode = 'single'
    mocks.savedSpreadGap = 0
    mocks.pageCount = 10_000
    mocks.savedPageNumber = 9_000
    mocks.savedAutoAdvance = false
    mocks.seriesId = 42
    mocks.nextBook = null
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn<(handle: number) => void>())
  })

  it.each(['infinite', 'long-strip'] as const)('restores %s mode by index while rendering only a bounded page window', async (mode) => {
    mocks.savedMode = mode
    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    expect(mocks.scrollToIndex).toHaveBeenCalledWith(8_999, { align: 'start' })

    const renderedPages = wrapper.findAll('[data-page]').map((page) => Number(page.attributes('data-page')))
    expect(renderedPages).toEqual([8_997, 8_998, 8_999, 9_000, 9_001])
    expect(wrapper.findAll('img')).toHaveLength(5)
    expect(new Set(mocks.pageUrl.mock.calls.map(([page]) => page)).size).toBeLessThanOrEqual(5)
    expect(mocks.pageUrl).not.toHaveBeenCalledWith(0)

    wrapper.unmount()
  })

  it.each([0, 24])('anchors two-page images to the spine with a %ipx configurable gap', async (spreadGap) => {
    mocks.savedMode = 'paginated'
    mocks.savedViewMode = 'two-page'
    mocks.savedSpreadGap = spreadGap
    mocks.pageCount = 6
    mocks.savedPageNumber = 2
    window.innerWidth = 1_200

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
    })

    await flushPromises()
    await nextTick()

    expect(wrapper.get('[data-testid="cbz-paginated-pages"]').attributes('style')).toContain(`column-gap: ${spreadGap}px`)
    expect(wrapper.get('[data-spread-side="left"]').classes()).toContain('justify-end')
    expect(wrapper.get('[data-spread-side="right"]').classes()).toContain('justify-start')
    expect(wrapper.findAll('[data-spread-side] img')).toHaveLength(2)

    wrapper.unmount()
  })

  it('routes settings panel updates and reset through the per-book settings store', async () => {
    mocks.savedMode = 'paginated'
    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
      global: {
        stubs: {
          Popover: { template: '<div><slot /></div>' },
          PopoverTrigger: { template: '<div><slot /></div>' },
          PopoverContent: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()
    await nextTick()

    const panel = wrapper.getComponent(CbzSettingsPanel)
    expect(panel.props('settings')).toMatchObject({ fitMode: 'fit-page', bgColor: 'black' })

    panel.vm.$emit('update', { bgColor: 'white' })
    await nextTick()
    expect(mocks.updateBookSettings).toHaveBeenCalledWith({ bgColor: 'white' })

    panel.vm.$emit('reset')
    expect(mocks.resetBookSettings).toHaveBeenCalledOnce()

    wrapper.unmount()
  })

  it('zooms with desktop controls and Ctrl-wheel without turning the page', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 6
    mocks.savedPageNumber = 2

    const wrapper = shallowMount(CbzReaderView, {
      props: { bookId: 11, fileId: 22 },
      global: {
        stubs: {
          Tooltip: { template: '<div><slot /></div>' },
          TooltipTrigger: { template: '<div><slot /></div>' },
          TooltipContent: { template: '<div><slot /></div>' },
        },
      },
    })

    await flushPromises()
    await nextTick()

    const pages = wrapper.get('[data-testid="cbz-paginated-pages"]')
    const viewport = wrapper.get('[data-testid="cbz-paginated-viewport"]').element as HTMLElement
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 800 },
    })
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 1_000, height: 800 } as DOMRect)
    expect(pages.attributes('style')).toContain('scale(1)')

    await wrapper.get('button[aria-label="reader.cbz.zoomIn"]').trigger('click')
    await nextTick()
    expect(pages.attributes('style')).toContain('scale(1.25)')
    expect(viewport.scrollLeft).toBe(125)
    expect(viewport.scrollTop).toBe(100)

    const slider = wrapper.get('input[type="range"]')
    expect(slider.attributes('value')).toBe('1')

    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, clientX: 500, clientY: 400, deltaY: 100 }))
    await nextTick()

    expect(pages.attributes('style')).toContain('scale(1)')
    expect(viewport.scrollLeft).toBe(0)
    expect(viewport.scrollTop).toBe(0)
    expect(slider.attributes('value')).toBe('1')

    wrapper.unmount()
  })
  it('offers the next book of the series on the last page and opens it on request', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(mocks.loadNextBook).toHaveBeenCalledWith(42, 11)
    const card = wrapper.findComponent(NextIssueCard)
    expect(card.exists()).toBe(true)

    card.vm.$emit('open')
    await flushPromises()

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'reader', params: { bookId: 91, fileId: 501 }, query: { format: 'cbz' } })

    wrapper.unmount()
  })

  it('hides the next book until the last page is reached', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 2
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(false)

    wrapper.unmount()
  })

  it('leaves the page turn inert past the last page while auto-advance is off', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()

    expect(mocks.routerPush).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('crosses into the next book on a further page turn once auto-advance has settled on the last page', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.savedAutoAdvance = true
    mocks.nextBook = NEXT_BOOK

    const now = vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    // The turn that landed on the last page must not carry through into the next book.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()
    expect(mocks.routerPush).not.toHaveBeenCalled()

    now.mockReturnValue(11_000)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await flushPromises()

    expect(mocks.routerPush).toHaveBeenCalledWith({ name: 'reader', params: { bookId: 91, fileId: 501 }, query: { format: 'cbz' } })

    now.mockRestore()
    wrapper.unmount()
  })

  it('never crosses into another book while peeking', async () => {
    mocks.savedMode = 'paginated'
    mocks.pageCount = 3
    mocks.savedPageNumber = 3
    mocks.savedAutoAdvance = true
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22, peekMode: true } })
    await flushPromises()
    await nextTick()

    expect(mocks.loadNextBook).not.toHaveBeenCalled()
    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(false)

    wrapper.unmount()
  })

  it('places the next book after the last page in continuous modes', async () => {
    mocks.savedMode = 'long-strip'
    mocks.pageCount = 3
    mocks.savedPageNumber = 2
    mocks.nextBook = NEXT_BOOK

    const wrapper = shallowMount(CbzReaderView, { props: { bookId: 11, fileId: 22 } })
    await flushPromises()
    await nextTick()

    expect(wrapper.findComponent(NextIssueCard).exists()).toBe(true)

    wrapper.unmount()
  })
})
