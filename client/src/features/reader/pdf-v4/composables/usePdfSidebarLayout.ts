import { computed, ref, watch } from 'vue'
import { breakpointsTailwind, useBreakpoints, useLocalStorage } from '@vueuse/core'

export type PdfSidebarTab = 'thumbnails' | 'contents' | 'search' | 'highlights'

/**
 * `sheet` is a phone bottom sheet, `overlay` floats above the page on tablets,
 * `dock` sits beside the page and reflows it on wide screens.
 */
export type PdfSidebarLayout = 'sheet' | 'overlay' | 'dock'

export const PDF_SIDEBAR_TABS: readonly PdfSidebarTab[] = ['thumbnails', 'contents', 'search', 'highlights']

export const PDF_SIDEBAR_MIN_WIDTH = 260
export const PDF_SIDEBAR_MAX_WIDTH = 520
const PDF_SIDEBAR_DEFAULT_WIDTH = 304

const WIDTH_KEY = 'reader:pdf:sidebarWidth'
const TAB_KEY = 'reader:pdf:sidebarTab'
const OPEN_KEY = 'reader:pdf:sidebarOpen'

function isSidebarTab(value: unknown): value is PdfSidebarTab {
  return typeof value === 'string' && (PDF_SIDEBAR_TABS as readonly string[]).includes(value)
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return PDF_SIDEBAR_DEFAULT_WIDTH
  return Math.min(Math.max(Math.round(width), PDF_SIDEBAR_MIN_WIDTH), PDF_SIDEBAR_MAX_WIDTH)
}

export function usePdfSidebarLayout() {
  const breakpoints = useBreakpoints(breakpointsTailwind)
  const isTabletUp = breakpoints.greaterOrEqual('md')
  const isDesktopUp = breakpoints.greaterOrEqual('lg')

  const layout = computed<PdfSidebarLayout>(() => {
    if (!isTabletUp.value) return 'sheet'
    return isDesktopUp.value ? 'dock' : 'overlay'
  })

  const storedWidth = useLocalStorage(WIDTH_KEY, PDF_SIDEBAR_DEFAULT_WIDTH)
  const storedTab = useLocalStorage<PdfSidebarTab>(TAB_KEY, 'thumbnails')
  const storedOpen = useLocalStorage(OPEN_KEY, false)

  const width = computed(() => clampSidebarWidth(storedWidth.value))
  const activeTab = computed<PdfSidebarTab>(() => (isSidebarTab(storedTab.value) ? storedTab.value : 'thumbnails'))

  // A remembered open panel is only restored where it does not cover the page.
  const open = ref(layout.value === 'dock' && storedOpen.value)

  function setOpen(next: boolean) {
    open.value = next
    if (layout.value === 'dock') storedOpen.value = next
  }

  function setTab(tab: PdfSidebarTab) {
    storedTab.value = tab
  }

  function selectTab(tab: PdfSidebarTab) {
    if (open.value && activeTab.value === tab) {
      setOpen(false)
      return
    }
    setTab(tab)
    setOpen(true)
  }

  function close() {
    setOpen(false)
  }

  function setWidth(next: number) {
    storedWidth.value = clampSidebarWidth(next)
  }

  // Collapsing the viewport must not leave an overlay stranded over the page.
  watch(layout, (next, previous) => {
    if (next === previous) return
    if (next === 'sheet') {
      open.value = false
      return
    }
    if (next === 'dock') open.value = storedOpen.value
  })

  return {
    layout,
    open,
    activeTab,
    width,
    setOpen,
    setTab,
    selectTab,
    close,
    setWidth,
  }
}
