import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type { PdfReaderSettings } from '@bookorbit/types'

type LayoutReadyEvent = { documentId: string; isInitial: boolean; pageNumber: number; totalPages: number }
type PageChangeEvent = { documentId: string; pageNumber: number; totalPages: number }

const mocks = vi.hoisted(() => ({
  layoutReadyListener: null as ((event: LayoutReadyEvent) => void) | null,
  pageChangeListener: null as ((event: PageChangeEvent) => void) | null,
  totalPages: 10,
  scrollToPage: vi.fn<(options: { pageNumber: number; behavior?: ScrollBehavior }) => void>(),
}))

vi.mock('@embedpdf/plugin-scroll/vue', async () => {
  const { ScrollStrategy } = await import('@embedpdf/plugin-scroll')
  return {
    ScrollStrategy,
    useScroll: () => ({
      state: ref({ currentPage: 1, totalPages: mocks.totalPages }),
      provides: ref({
        // EmbedPDF reports the target page synchronously when a programmatic page change starts.
        scrollToPage: (options: { pageNumber: number; behavior?: ScrollBehavior }) => {
          mocks.scrollToPage(options)
          mocks.pageChangeListener?.({ documentId: 'document-1', pageNumber: options.pageNumber, totalPages: mocks.totalPages })
        },
        getSpreadPagesWithRotatedSize: () => [],
        getPageChangeState: () => ({ isChanging: false }),
      }),
    }),
    useScrollCapability: () => ({
      provides: ref({
        onLayoutReady: (listener: (event: LayoutReadyEvent) => void) => {
          mocks.layoutReadyListener = listener
          return () => {}
        },
        onPageChange: (listener: (event: PageChangeEvent) => void) => {
          mocks.pageChangeListener = listener
          return () => {}
        },
      }),
    }),
  }
})

vi.mock('@embedpdf/plugin-zoom/vue', async () => {
  const { ZoomMode } = await import('@embedpdf/plugin-zoom')
  return { ZoomMode, useZoom: () => ({ state: ref({ currentZoomLevel: 1, zoomLevel: ZoomMode.FitPage }), provides: ref(null) }) }
})

vi.mock('@embedpdf/plugin-spread/vue', async () => {
  const { SpreadMode } = await import('@embedpdf/plugin-spread')
  return { SpreadMode, useSpread: () => ({ provides: ref(null) }) }
})

vi.mock('@embedpdf/plugin-rotate/vue', () => ({ useRotate: () => ({ rotation: ref(0), provides: ref(null) }) }))
vi.mock('@embedpdf/plugin-selection/vue', () => ({ useSelectionCapability: () => ({ provides: ref(null) }) }))
vi.mock('@embedpdf/plugin-annotation/vue', () => ({ useAnnotationCapability: () => ({ provides: ref(null) }) }))
vi.mock('@embedpdf/plugin-document-manager/vue', () => ({
  DocumentContent: defineComponent({ name: 'DocumentContent', props: ['documentId'], setup: () => () => h('div') }),
}))

vi.mock('../composables/usePdfInteractionMode', () => ({
  usePdfInteractionMode: () => ({ isPanning: ref(false), togglePan: vi.fn<() => void>(), activateTextSelection: vi.fn<() => void>() }),
}))
vi.mock('../composables/usePdfResponsiveSpread', () => ({ usePdfResponsiveSpread: () => ({ apply: vi.fn<() => void>() }) }))
vi.mock('../../shared/composables/useFullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: ref(false), isFullscreenSupported: ref(false), toggleFullscreen: vi.fn<() => void>() }),
}))
vi.mock('../composables/usePdfHighlights', () => ({
  usePdfHighlights: () => ({
    renderAll: vi.fn<() => void>(),
    annotations: ref([]),
    loadError: ref(null),
    loading: ref(false),
    loadingMore: ref(false),
    hasMore: ref(false),
    popupVisible: ref(false),
    popupPosition: ref({ x: 0, y: 0 }),
    popupShowBelow: ref(false),
    selectedText: ref(''),
    overlappingAnnotationId: ref(null),
    isSaving: ref(false),
    showNoteDialog: ref(false),
    noteText: ref(''),
  }),
}))

const { default: PdfReaderContent } = await import('../components/PdfReaderContent.vue')

const settings: PdfReaderSettings = { scrollMode: 'page', spread: 'none', zoomMode: 'fit-page', customScale: 1, rotation: 0 }

function mountContent(initialPage: number | null, initialPercentage?: number) {
  return shallowMount(PdfReaderContent, {
    props: { documentId: 'document-1', bookId: 42, fileId: 101, initialPage, initialPercentage, settings },
  })
}

function layoutReady() {
  mocks.layoutReadyListener?.({ documentId: 'document-1', isInitial: true, pageNumber: 1, totalPages: mocks.totalPages })
}

describe('PdfReaderContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.layoutReadyListener = null
    mocks.pageChangeListener = null
    mocks.totalPages = 10
  })

  it.each([
    { initialPage: null, percentage: 37.5, expected: 4 },
    { initialPage: null, percentage: 100, expected: 10 },
    { initialPage: null, percentage: 0.4, expected: 1 },
    { initialPage: null, percentage: 0, expected: 1 },
    { initialPage: 3, percentage: 90, expected: 3 },
    { initialPage: 25, percentage: 10, expected: 10 },
  ])('opens $initialPage / $percentage% of 10 pages at page $expected', ({ initialPage, percentage, expected }) => {
    mountContent(initialPage, percentage)
    layoutReady()

    // Page 1 is where the document already is, so the reader only scrolls for a later page.
    expect(mocks.scrollToPage.mock.calls[0]?.[0].pageNumber ?? 1).toBe(expected)
    expect(mocks.scrollToPage.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('restores the opening page with an instant scroll', () => {
    mountContent(7)
    layoutReady()

    // A smooth scroll that has not started is cancelled by the fit zoom's refit on the first
    // viewport resize, which leaves the reader on page 1.
    expect(mocks.scrollToPage).toHaveBeenCalledExactlyOnceWith({ pageNumber: 7, behavior: 'instant' })
  })

  it('marks the opening page as restored and later turns as moves', () => {
    const wrapper = mountContent(null, 37.5)
    layoutReady()
    mocks.pageChangeListener?.({ documentId: 'document-1', pageNumber: 5, totalPages: 10 })

    expect(wrapper.emitted('pageChange')).toEqual([
      [4, 10, true],
      [5, 10, false],
    ])
  })
})
