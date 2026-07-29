import { computed, nextTick, ref } from 'vue'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CbzReaderView from './CbzReaderView.vue'

const mocks = vi.hoisted(() => ({
  savedMode: 'infinite' as 'paginated' | 'infinite' | 'long-strip',
  savedViewMode: 'single' as 'single' | 'two-page',
  savedSpreadGap: 0,
  pageCount: 10_000,
  savedPageNumber: 9_000,
  onBeforeRouteLeave: vi.fn<(guard: () => Promise<void>) => void>(),
  pageUrl: vi.fn<(page: number) => string>((page) => `/api/v1/cbz/files/22/pages/${page}`),
  progressSave: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  scrollToIndex: vi.fn<(index: number, options: { align: string }) => void>(),
}))

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { bookId: '11', fileId: '22' }, query: {} }),
  useRouter: () => ({ back: vi.fn<() => void>(), replace: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) }),
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
      pageUrl: mocks.pageUrl,
      load: async () => {
        pageCount.value = mocks.pageCount
      },
    }
  },
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
    })),
    load: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    updateBookSettings: vi.fn<(patch: unknown) => void>(),
    resetBookSettings: vi.fn<() => void>(),
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
})
