import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, reactive, ref } from 'vue'
import type { PdfReaderSettings } from '@bookorbit/types'

type StageEventName = 'onPageChanged' | 'onZoomChanged' | 'onSettingsChanged'
type ZoomEvent = { level: number; previousLevel: number; mode: string }
type ZoomSetting = { mode: string } | { level: number }

const mocks = vi.hoisted(() => ({
  listeners: {} as Partial<Record<'onPageChanged' | 'onZoomChanged' | 'onSettingsChanged', (event: unknown) => void>>,
  currentPages: [0] as number[],
  goToPage: vi.fn<(page: number, options?: { behavior?: string }) => void>(),
  zoomTo: vi.fn<(level: number) => void>(),
}))

const document = reactive({ status: 'loading', pageCount: 10 })
const pages = ref<{ label: string | null }[]>([])
const stageState = {
  zoomLevel: ref(1),
  zoomMode: ref('fit-page'),
  currentPageIndex: ref(0),
  pageCount: ref(10),
  viewRotation: ref(0),
}

const stageSettings = { zoom: { mode: 'fit-page' } as ZoomSetting }

const stage = {
  goToPage: mocks.goToPage,
  zoomTo: mocks.zoomTo,
  getSettings: () => stageSettings,
  listCurrentPages: () => mocks.currentPages.map((index) => ({ index })),
}

vi.mock('@embedpdf/vue/stage', () => ({
  useStage: () => stage,
  useStageState: () => stageState,
  useStageEvent: (select: (capability: Record<StageEventName, StageEventName>) => StageEventName, handler: (event: unknown) => void) => {
    const name = select({ onPageChanged: 'onPageChanged', onZoomChanged: 'onZoomChanged', onSettingsChanged: 'onSettingsChanged' })
    mocks.listeners[name] = handler
  },
}))

vi.mock('@embedpdf/vue/runtime', () => ({
  DocumentGate: defineComponent({
    name: 'DocumentGate',
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.default?.()),
  }),
  useDocument: (select: (value: typeof document) => unknown) => computed(() => select(document)),
  usePageList: () => pages,
}))

vi.mock('@embedpdf/vue/selection', () => ({
  SelectionMenu: defineComponent({
    name: 'SelectionMenu',
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.default?.()),
  }),
}))

vi.mock('../composables/usePdfInteractionMode', () => ({
  usePdfInteractionMode: () => ({ isPanning: ref(false), togglePan: vi.fn<() => void>(), activateTextSelection: vi.fn<() => void>() }),
}))
vi.mock('../../shared/composables/useFullscreen', () => ({
  useFullscreen: () => ({ isFullscreen: ref(false), isFullscreenSupported: ref(false), toggleFullscreen: vi.fn<() => void>() }),
}))
vi.mock('../composables/usePdfHighlights', () => ({
  usePdfHighlights: () => ({
    annotations: ref([]),
    loadError: ref(null),
    loading: ref(false),
    loadingMore: ref(false),
    hasMore: ref(false),
    popupVisible: ref(false),
    selectedText: ref(''),
    overlappingAnnotationId: ref(null),
    isSaving: ref(false),
    showNoteDialog: ref(false),
    noteText: ref(''),
  }),
}))

const { default: PdfReaderContent } = await import('../components/PdfReaderContent.vue')

const settings: PdfReaderSettings = { scrollMode: 'page', spread: 'none', zoomMode: 'fit-page', customScale: 1, rotation: 0 }

const ToolbarStub = defineComponent({
  name: 'PdfReaderToolbar',
  props: { pageLabel: String },
  setup:
    (_, { slots }) =>
    () =>
      h('div', slots.settings?.()),
})

function mountContent(initialPage: number | null, initialPercentage?: number) {
  return shallowMount(PdfReaderContent, {
    props: { bookId: 42, fileId: 101, initialPage, initialPercentage, settings },
    global: { stubs: { PdfReaderToolbar: ToolbarStub } },
  })
}

function turnTo(...pageIndexes: number[]) {
  mocks.currentPages = pageIndexes
  stageState.currentPageIndex.value = pageIndexes[0] ?? 0
  mocks.listeners.onPageChanged?.({ pageIndex: pageIndexes[0] ?? 0 })
}

function zoom(event: ZoomEvent) {
  mocks.listeners.onZoomChanged?.(event)
}

// The Stage reports a settings change synchronously, from inside the call that made it.
function changeSettings(patch: { zoom?: ZoomSetting; padding?: number }) {
  const changedKeys = Object.keys(patch).filter((key) => key !== 'zoom' || JSON.stringify(patch.zoom) !== JSON.stringify(stageSettings.zoom))
  if (patch.zoom) stageSettings.zoom = patch.zoom
  if (changedKeys.length) mocks.listeners.onSettingsChanged?.({ settings: { ...stageSettings }, changedKeys })
}

describe('PdfReaderContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners = {}
    mocks.currentPages = [0]
    document.status = 'ready'
    document.pageCount = 10
    pages.value = []
    stageState.pageCount.value = 10
    stageState.currentPageIndex.value = 0
    stageSettings.zoom = { mode: 'fit-page' }
    mocks.zoomTo.mockImplementation((level) => changeSettings({ zoom: { level } }))
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

    // Page 1 is where the document already opens, so the reader only navigates for a later page.
    expect((mocks.goToPage.mock.calls[0]?.[0] ?? 0) + 1).toBe(expected)
    expect(mocks.goToPage.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('restores the opening page without animating once the document is ready', async () => {
    document.status = 'loading'
    mountContent(7)
    expect(mocks.goToPage).not.toHaveBeenCalled()

    document.status = 'ready'
    await nextTick()

    expect(mocks.goToPage).toHaveBeenCalledExactlyOnceWith(6, { behavior: 'instant' })
  })

  it('marks the opening page as restored and later turns as moves', () => {
    const wrapper = mountContent(null, 37.5)
    turnTo(3)
    turnTo(4)

    expect(wrapper.emitted('pageChange')).toEqual([
      [4, 10, true],
      [5, 10, false],
    ])
  })

  it('reports the last page of a spread as the reading position', () => {
    const wrapper = mountContent(1)
    turnTo(0)
    turnTo(1, 2)

    expect(wrapper.emitted('pageChange')?.at(-1)).toEqual([3, 10, false])
  })

  it('passes PDF labels to the toolbar while emitting physical page numbers', async () => {
    const wrapper = mountContent(1)
    const toolbar = wrapper.findComponent(ToolbarStub)
    pages.value = [{ label: 'i' }, { label: null }, { label: '24' }, { label: '4' }]
    await nextTick()
    expect(toolbar.props('pageLabel')).toBe('i')

    turnTo(1, 2)
    await nextTick()
    expect(toolbar.props('pageLabel')).toBe('2–24')
    expect(wrapper.emitted('pageChange')?.at(-1)).toEqual([3, 10, false])

    turnTo(3)
    await nextTick()
    expect(toolbar.props('pageLabel')).toBeNull()
  })

  it('saves a level as a custom scale and a fit mode as the mode, ignoring the saved mode and other settings', () => {
    const wrapper = mountContent(1)

    changeSettings({ zoom: { level: 1.5 } })
    changeSettings({ zoom: { mode: 'fit-width' } })
    changeSettings({ zoom: { mode: 'fit-page' } })
    changeSettings({ padding: 4 })

    expect(wrapper.emitted('settingsChange')).toEqual([[{ zoomMode: 'custom', customScale: 1.5 }], [{ zoomMode: 'fit-width' }]])
  })

  it('saves a step zoom out of a fit mode, which the zoom event still names as the fit mode', () => {
    const wrapper = mountContent(1)

    zoom({ level: 1.25, previousLevel: 1.08, mode: 'fit-page' })
    expect(wrapper.emitted('settingsChange')).toBeUndefined()

    changeSettings({ zoom: { level: 1.25 } })
    expect(wrapper.emitted('settingsChange')).toEqual([[{ zoomMode: 'custom', customScale: 1.25 }]])
  })

  it('saves a slider zoom once when it is committed, not while it previews', () => {
    const wrapper = mountContent(1)
    const panel = wrapper.findComponent({ name: 'PdfReaderSettingsPanel' })

    panel.vm.$emit('previewZoom', 1.75)
    expect(wrapper.emitted('settingsChange')).toBeUndefined()

    panel.vm.$emit('setZoom', 'custom', 1.75)
    expect(mocks.zoomTo).toHaveBeenLastCalledWith(1.75)
    expect(wrapper.emitted('settingsChange')).toEqual([[{ zoomMode: 'custom', customScale: 1.75 }]])
  })
})
