<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useMediaQuery } from '@vueuse/core'
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Maximize, Minimize, Minus, Plus, Settings } from '@lucide/vue'
import { useVisibility } from '../shared/composables/useVisibility'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useCbz } from './composables/useCbz'
import { useCbzSettings } from './composables/useCbzSettings'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import { useFullscreen } from '../shared/composables/useFullscreen'
import type { CbxReaderSettings } from '@bookorbit/types'
import { DEFAULT_WIDE_PAGE_RATIO_THRESHOLD, createCbzSpreadLayout } from './lib/spread-layout'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import CbzSettingsPanel from './components/CbzSettingsPanel.vue'

const TWO_PAGE_BREAKPOINT = 900
const MIN_ZOOM_SCALE = 0.5
const MAX_ZOOM_SCALE = 3
const ZOOM_STEP = 0.25

const { t } = useI18n()

const props = defineProps<{ bookId: number; fileId: number; peekMode?: boolean }>()
const route = useRoute()
const router = useRouter()
const trackingEnabled = computed(() => !props.peekMode)

const { headerVisible, footerVisible, handleMiddleTap, showHeader, showFooter, setVisibilityLock } = useVisibility()
const { isFullscreen, toggleFullscreen } = useFullscreen()

const { onActivity, elapsedMinutes } = useReadingSession(
  props.fileId,
  () => ({
    percentage: progress.percentage.value,
    pageNumber: progress.pageNumber.value,
  }),
  { trackingEnabled },
)
const progress = useReaderProgress(props.bookId, props.fileId, elapsedMinutes, 0, { trackingEnabled })
const { pageCount, bookTitle, loading, error, pageUrl, load } = useCbz(props.fileId, props.bookId)
const { fitMode, viewMode, scrollMode, direction, spreadAlignment, spreadGap, forceTwoPage, widePageSingletonMode, bgColor, bgValue, imgFitClass } =
  useCbzSettings()
const bookSettings = useReaderSettings(props.fileId, 'cbz')

const currentPage = ref(0)
const showSettings = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)
const paginatedViewport = ref<HTMLElement | null>(null)
const viewportWidth = ref(0)
const viewportHeight = ref(0)
const currentImageLoaded = ref(false)
const pendingImageLoads = ref(0)
const loadedImageCount = ref(0)
const pageRatios = ref<number[]>([])
const pageDimensions = ref<Array<{ width: number; height: number } | undefined>>([])
const stripImagesReady = ref(false)
const zoomScale = ref(1)

watch(showSettings, setVisibilityLock)

// The settings surface is one panel in two containers: an anchored popover where there
// is room beside the page, a bottom sheet where the thumb is and the page must stay visible.
const isCompact = useMediaQuery('(max-width: 639px)')

const panelSettings = computed<CbxReaderSettings>(() => ({
  fitMode: fitMode.value,
  viewMode: viewMode.value,
  scrollMode: scrollMode.value,
  direction: direction.value,
  spreadAlignment: spreadAlignment.value,
  spreadGap: spreadGap.value,
  forceTwoPage: forceTwoPage.value,
  widePageSingletonMode: widePageSingletonMode.value,
  bgColor: bgColor.value,
}))

// Persists here rather than via watches on the refs, so applySettings can restore
// load-time or reset values without immediately re-recording them as book overrides.
function applyPanelUpdate(partial: Partial<CbxReaderSettings>) {
  if (partial.fitMode !== undefined) fitMode.value = partial.fitMode
  if (partial.viewMode !== undefined) viewMode.value = partial.viewMode
  if (partial.scrollMode !== undefined) scrollMode.value = partial.scrollMode
  if (partial.direction !== undefined) direction.value = partial.direction
  if (partial.spreadAlignment !== undefined) spreadAlignment.value = partial.spreadAlignment
  if (partial.spreadGap !== undefined) spreadGap.value = partial.spreadGap
  if (partial.forceTwoPage !== undefined) forceTwoPage.value = partial.forceTwoPage
  if (partial.widePageSingletonMode !== undefined) widePageSingletonMode.value = partial.widePageSingletonMode
  if (partial.bgColor !== undefined) bgColor.value = partial.bgColor
  bookSettings.updateBookSettings(partial)
}

function onSettingsOpenChange(open: boolean) {
  showSettings.value = open
}

function openSettings() {
  showSettings.value = true
}

function applySettings(s: CbxReaderSettings) {
  fitMode.value = s.fitMode
  viewMode.value = s.viewMode
  scrollMode.value = s.scrollMode
  direction.value = s.direction
  spreadAlignment.value = s.spreadAlignment
  spreadGap.value = s.spreadGap
  forceTwoPage.value = s.forceTwoPage
  widePageSingletonMode.value = s.widePageSingletonMode
  bgColor.value = s.bgColor
}

function resetBookViewSettings() {
  bookSettings.resetBookSettings()
  applySettings(bookSettings.effective.value as CbxReaderSettings)
  if (scrollMode.value === 'paginated' && isTwoPageEffective.value) {
    currentPage.value = spreadLayout.value.anchorForPage(currentPage.value)
  }
}

// ── Layout engine ──────────────────────────────────────────────────────────────
const isTwoPagePreferred = computed(() => viewMode.value === 'two-page' && scrollMode.value === 'paginated')
const isTwoPageEffective = computed(() => isTwoPagePreferred.value && (forceTwoPage.value || viewportWidth.value >= TWO_PAGE_BREAKPOINT))

const spreadLayout = computed(() =>
  createCbzSpreadLayout({
    pageCount: pageCount.value,
    isTwoPageEffective: isTwoPageEffective.value,
    direction: direction.value,
    spreadAlignment: spreadAlignment.value,
    widePageSingletonMode: widePageSingletonMode.value,
    isWidePage: (page) => (pageRatios.value[page] ?? 0) >= DEFAULT_WIDE_PAGE_RATIO_THRESHOLD,
  }),
)

const currentSpread = computed(() => spreadLayout.value.spreadForPage(currentPage.value))

const renderSpread = computed(() => currentSpread.value?.kind === 'spread')
const renderSinglePage = computed(() => (currentSpread.value?.kind === 'single' ? currentSpread.value.singlePage : null))
const renderLeftPage = computed(() => (currentSpread.value?.kind === 'spread' ? currentSpread.value.leftPage : null))
const renderRightPage = computed(() => (currentSpread.value?.kind === 'spread' ? currentSpread.value.rightPage : null))
const spreadContainerStyle = computed(() => ({ columnGap: `${spreadGap.value}px` }))
const renderKey = computed(() => {
  const spread = currentSpread.value
  if (!spread) return 'none'
  if (spread.kind === 'single') return `single:${spread.singlePage ?? -1}`
  return `spread:${spread.leftPage ?? 'blank'}:${spread.rightPage ?? 'blank'}`
})

const pageLabel = computed(() => {
  const spread = currentSpread.value
  if (!spread || pageCount.value <= 0) return '0 / 0'
  const start = spread.pages[0]
  if (start === undefined) return `0 / ${pageCount.value}`
  if (spread.pages.length === 2) {
    const end = spread.pages[1]
    if (end !== undefined) return `${start + 1}-${end + 1} / ${pageCount.value}`
  }
  return `${start + 1} / ${pageCount.value}`
})

const fullscreenLabel = computed(() => (isFullscreen.value ? 'Exit fullscreen' : 'Enter fullscreen'))
const zoomPercent = computed(() => Math.round(zoomScale.value * 100))
const canZoomOut = computed(() => zoomScale.value > MIN_ZOOM_SCALE)
const canZoomIn = computed(() => zoomScale.value < MAX_ZOOM_SCALE)

const paginatedStageStyle = computed(() => {
  const stageScale = Math.max(1, zoomScale.value)
  return {
    width: `${stageScale * 100}%`,
    height: `${stageScale * 100}%`,
  }
})

const paginatedContentStyle = computed(() => {
  const stageScale = Math.max(1, zoomScale.value)
  return {
    width: `${100 / stageScale}%`,
    height: `${100 / stageScale}%`,
    transform: `scale(${zoomScale.value})`,
  }
})

const progressPageIndex = computed(() => {
  const spread = currentSpread.value
  if (!spread || spread.pages.length === 0) return currentPage.value
  return spread.pages[spread.pages.length - 1] ?? currentPage.value
})

const progressPercent = computed(() => {
  if (pageCount.value <= 0) return 0
  return ((Math.max(0, Math.min(progressPageIndex.value, pageCount.value - 1)) + 1) / pageCount.value) * 100
})

const sliderFillPercent = computed(() => {
  const max = Math.max(0, pageCount.value - 1)
  if (max === 0) return 0
  return (Math.max(0, Math.min(currentPage.value, max)) / max) * 100
})

const stripFrameClass = computed(() => {
  if (fitMode.value === 'fit-height' || fitMode.value === 'fit-page') {
    return 'flex items-center justify-center overflow-hidden'
  }
  return 'flex justify-center'
})

const stripGap = computed(() => (scrollMode.value === 'long-strip' ? 0 : 8))
const stripPadding = computed(() => (scrollMode.value === 'long-strip' ? 0 : 16))
const stripViewportWidth = computed(() => Math.max(1, viewportWidth.value - (scrollMode.value === 'long-strip' ? 0 : 16)))

const stripVirtualizer = useVirtualizer(
  computed(() => {
    const mode = scrollMode.value
    const fit = fitMode.value
    const height = Math.max(1, viewportHeight.value)
    const width = stripViewportWidth.value
    const scale = zoomScale.value
    const ratios = pageRatios.value

    return {
      count: mode === 'paginated' ? 0 : pageCount.value,
      getScrollElement: () => scrollContainer.value,
      estimateSize: (index: number) => {
        if (fit === 'fit-page' || fit === 'fit-height') return height * scale
        const ratio = ratios[index]
        if (fit === 'fit-width' && ratio && ratio > 0) return (width * scale) / ratio
        return height * scale
      },
      gap: stripGap.value,
      paddingStart: stripPadding.value,
      paddingEnd: stripPadding.value,
      overscan: 2,
      getItemKey: (index: number) => index,
    }
  }),
)

const virtualStripPages = computed(() => stripVirtualizer.value.getVirtualItems())
const virtualStripSize = computed(() => stripVirtualizer.value.getTotalSize())
const renderedStripPages = computed(() => (stripImagesReady.value ? virtualStripPages.value : []))

function measureStripPage(element: unknown) {
  if (element instanceof Element) stripVirtualizer.value.measureElement(element)
}

const stripImageClass = computed(() => {
  switch (fitMode.value) {
    case 'fit-width':
      return 'w-full h-auto max-w-full block'
    case 'fit-height':
      return 'h-full w-auto max-h-full block'
    case 'actual':
      return 'max-w-none max-h-none block'
    default: // fit-page
      return 'max-w-full max-h-full object-contain block'
  }
})

function stripFrameStyle(pageStart: number) {
  const scaledWidth = stripViewportWidth.value * zoomScale.value
  const frameHeight = fitMode.value === 'fit-height' || fitMode.value === 'fit-page' ? viewportHeight.value * zoomScale.value : undefined
  return {
    width: `${scaledWidth}px`,
    height: frameHeight === undefined ? undefined : `${frameHeight}px`,
    insetInlineStart: `${Math.max(0, (viewportWidth.value - scaledWidth) / 2)}px`,
    transform: `translateY(${pageStart}px)`,
  }
}

function stripImageStyle(pageIndex: number) {
  if (fitMode.value !== 'actual') return undefined
  const dimensions = pageDimensions.value[pageIndex]
  if (!dimensions) return undefined
  return {
    width: `${dimensions.width * zoomScale.value}px`,
    height: `${dimensions.height * zoomScale.value}px`,
  }
}

const canGoPrev = computed(() => {
  if (pageCount.value <= 0) return false
  if (isTwoPageEffective.value) return spreadLayout.value.prevAnchor(currentPage.value) !== currentPage.value
  return currentPage.value > 0
})

const canGoNext = computed(() => {
  if (pageCount.value <= 0) return false
  if (isTwoPageEffective.value) return spreadLayout.value.nextAnchor(currentPage.value) !== currentPage.value
  return currentPage.value < pageCount.value - 1
})

watch(renderKey, () => {
  const spread = currentSpread.value
  const expected = spread?.pages.length ?? 0
  pendingImageLoads.value = expected
  loadedImageCount.value = 0
  currentImageLoaded.value = expected === 0
})

// ── Preloading ─────────────────────────────────────────────────────────────────
const preloadCache = new Map<number, HTMLImageElement>()

function setPageRatio(pageIndex: number, width: number, height: number) {
  if (pageIndex < 0 || pageIndex >= pageCount.value || height <= 0 || width <= 0) return
  const ratio = width / height
  if (pageRatios.value[pageIndex] === ratio) return
  const next = [...pageRatios.value]
  next[pageIndex] = ratio
  pageRatios.value = next
  const nextDimensions = [...pageDimensions.value]
  nextDimensions[pageIndex] = { width, height }
  pageDimensions.value = nextDimensions
}

function preload(n: number) {
  if (n < 0 || n >= pageCount.value || preloadCache.has(n)) return
  const img = new Image()
  img.onload = () => setPageRatio(n, img.naturalWidth, img.naturalHeight)
  img.src = pageUrl(n)
  preloadCache.set(n, img)
}

function schedulePreload(anchorPage: number) {
  const layout = spreadLayout.value
  const centerSpreadIndex = layout.spreadIndexForPage(anchorPage)
  const pagesToPreload = new Set<number>()

  for (const offset of [-1, 0, 1, 2]) {
    const spread = layout.spreads[centerSpreadIndex + offset]
    if (!spread) continue
    for (const page of spread.pages) pagesToPreload.add(page)
  }

  for (const page of pagesToPreload) preload(page)

  for (const [page] of preloadCache) {
    if (Math.abs(page - anchorPage) > 12) preloadCache.delete(page)
  }
}

function onPaginatedImageLoad(pageIndex: number, e: Event) {
  const target = e.target
  if (!(target instanceof HTMLImageElement)) return
  setPageRatio(pageIndex, target.naturalWidth, target.naturalHeight)

  loadedImageCount.value += 1
  if (loadedImageCount.value >= pendingImageLoads.value) {
    currentImageLoaded.value = true
  }
}

function onStripImageLoad(pageIndex: number, e: Event) {
  const target = e.target
  if (!(target instanceof HTMLImageElement)) return
  setPageRatio(pageIndex, target.naturalWidth, target.naturalHeight)
}

// ── Navigation ─────────────────────────────────────────────────────────────────
function goToPage(n: number) {
  if (pageCount.value <= 0) return

  const clamped = Math.max(0, Math.min(n, pageCount.value - 1))
  const target = isTwoPageEffective.value ? spreadLayout.value.anchorForPage(clamped) : clamped
  if (scrollMode.value !== 'paginated') {
    currentPage.value = target
    void scrollContinuousToPage(target)
    return
  }
  if (target === currentPage.value) return

  currentPage.value = target
}

function nextPage() {
  if (pageCount.value <= 0) return
  if (isTwoPageEffective.value) {
    goToPage(spreadLayout.value.nextAnchor(currentPage.value))
    return
  }
  goToPage(currentPage.value + 1)
}

function prevPage() {
  if (pageCount.value <= 0) return
  if (isTwoPageEffective.value) {
    goToPage(spreadLayout.value.prevAnchor(currentPage.value))
    return
  }
  goToPage(currentPage.value - 1)
}

// ── Click zones (left / middle / right) ───────────────────────────────────────
function handleImageClick(e: MouseEvent) {
  const x = e.clientX / window.innerWidth
  if (x < 0.25) {
    if (direction.value === 'rtl') nextPage()
    else prevPage()
    return
  }
  if (x > 0.75) {
    if (direction.value === 'rtl') prevPage()
    else nextPage()
    return
  }
  handleMiddleTap()
}

// ── Touch / swipe ──────────────────────────────────────────────────────────────
let touchStartX = 0

function onTouchStart(e: TouchEvent) {
  if (e.touches[0]) touchStartX = e.touches[0].clientX
}

function onTouchEnd(e: TouchEvent) {
  const touch = e.changedTouches[0]
  if (!touch) return
  const dx = touch.clientX - touchStartX
  if (Math.abs(dx) < 50) return
  if (dx < 0) {
    if (direction.value === 'rtl') prevPage()
    else nextPage()
    return
  }
  if (direction.value === 'rtl') nextPage()
  else prevPage()
}

// ── Zoom / wheel navigation ────────────────────────────────────────────────────
interface ZoomFocalPoint {
  clientX: number
  clientY: number
}

function setZoomScale(nextScale: number, focalPoint?: ZoomFocalPoint) {
  const clampedScale = Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, nextScale))
  const previousScale = zoomScale.value
  if (clampedScale === previousScale) return

  const viewport = scrollMode.value === 'paginated' ? paginatedViewport.value : scrollContainer.value
  if (!viewport) {
    zoomScale.value = clampedScale
    return
  }

  const bounds = viewport.getBoundingClientRect()
  const anchorX = focalPoint ? Math.min(viewport.clientWidth, Math.max(0, focalPoint.clientX - bounds.left)) : viewport.clientWidth / 2
  const anchorY = focalPoint ? Math.min(viewport.clientHeight, Math.max(0, focalPoint.clientY - bounds.top)) : viewport.clientHeight / 2
  const previousHorizontalInset = previousScale < 1 ? (viewport.clientWidth * (1 - previousScale)) / 2 : 0
  const previousVerticalInset = scrollMode.value === 'paginated' && previousScale < 1 ? (viewport.clientHeight * (1 - previousScale)) / 2 : 0
  const contentX = (viewport.scrollLeft + anchorX - previousHorizontalInset) / previousScale
  const contentY = (viewport.scrollTop + anchorY - previousVerticalInset) / previousScale

  zoomScale.value = clampedScale
  void nextTick(() => {
    const nextHorizontalInset = clampedScale < 1 ? (viewport.clientWidth * (1 - clampedScale)) / 2 : 0
    const nextVerticalInset = scrollMode.value === 'paginated' && clampedScale < 1 ? (viewport.clientHeight * (1 - clampedScale)) / 2 : 0
    viewport.scrollLeft = Math.max(0, nextHorizontalInset + contentX * clampedScale - anchorX)
    viewport.scrollTop = Math.max(0, nextVerticalInset + contentY * clampedScale - anchorY)
  })
}

function zoomIn() {
  setZoomScale(zoomScale.value + ZOOM_STEP)
}

function zoomOut() {
  setZoomScale(zoomScale.value - ZOOM_STEP)
}

function onWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const focalPoint = { clientX: e.clientX, clientY: e.clientY }
    if (e.deltaY < 0) setZoomScale(zoomScale.value + ZOOM_STEP, focalPoint)
    else if (e.deltaY > 0) setZoomScale(zoomScale.value - ZOOM_STEP, focalPoint)
    return
  }

  if (scrollMode.value !== 'paginated') return
  if (zoomScale.value > 1) return
  e.preventDefault()
  if (e.deltaY > 0) nextPage()
  else if (e.deltaY < 0) prevPage()
}

// ── Keyboard ───────────────────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  const target = (e.composedPath?.()[0] || e.target) as HTMLElement | null
  if (target?.tagName === 'INPUT') return
  const isRtl = direction.value === 'rtl'

  switch (e.key) {
    case 'ArrowRight':
    case 'PageDown':
      e.preventDefault()
      if (isRtl) prevPage()
      else nextPage()
      break
    case 'ArrowLeft':
    case 'PageUp':
      e.preventDefault()
      if (isRtl) nextPage()
      else prevPage()
      break
    case ' ':
      e.preventDefault()
      if (e.shiftKey) prevPage()
      else nextPage()
      break
    case 'Home':
      e.preventDefault()
      goToPage(0)
      break
    case 'End':
      e.preventDefault()
      goToPage(pageCount.value - 1)
      break
    case 'Escape':
      showSettings.value = false
      break
    case '+':
    case '=':
      e.preventDefault()
      zoomIn()
      break
    case '-':
      e.preventDefault()
      zoomOut()
      break
    case '0':
      e.preventDefault()
      setZoomScale(1)
      break
  }
}

let readerReady = false
let restoringContinuousPosition = false
let stripScrollFrame: number | null = null

function syncCurrentPageFromScroll() {
  stripScrollFrame = null
  if (restoringContinuousPosition || !scrollContainer.value) return

  const viewportStart = scrollContainer.value.scrollTop
  const viewportEnd = viewportStart + scrollContainer.value.clientHeight
  let visiblePage = currentPage.value
  let visiblePixels = -1

  for (const item of stripVirtualizer.value.getVirtualItems()) {
    const overlap = Math.max(0, Math.min(item.end, viewportEnd) - Math.max(item.start, viewportStart))
    if (overlap > visiblePixels) {
      visiblePage = item.index
      visiblePixels = overlap
    }
  }

  currentPage.value = visiblePage
}

function onStripScroll() {
  if (stripScrollFrame !== null) cancelAnimationFrame(stripScrollFrame)
  stripScrollFrame = requestAnimationFrame(syncCurrentPageFromScroll)
}

async function scrollContinuousToPage(page: number, restoring = false) {
  if (scrollMode.value === 'paginated' || pageCount.value <= 0) return
  restoringContinuousPosition = restoring
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      stripVirtualizer.value.scrollToIndex(page, { align: 'start' })
      resolve()
    })
  })
  if (restoring) {
    requestAnimationFrame(() => {
      restoringContinuousPosition = false
    })
  }
}

watch(scrollMode, async (mode) => {
  stripImagesReady.value = false
  if (mode === 'paginated' || !readerReady) return
  await scrollContinuousToPage(currentPage.value, true)
  stripImagesReady.value = true
})

watch(spreadLayout, (layout) => {
  if (scrollMode.value !== 'paginated' || !isTwoPageEffective.value || pageCount.value <= 0) return
  const anchored = layout.anchorForPage(currentPage.value)
  if (anchored !== currentPage.value) currentPage.value = anchored
})

watch([scrollMode, isTwoPageEffective], ([mode, twoPage]) => {
  if (mode !== 'paginated' || !twoPage || pageCount.value <= 0) return
  const anchored = spreadLayout.value.anchorForPage(currentPage.value)
  if (anchored !== currentPage.value) currentPage.value = anchored
})

// ── Slider ticks (max 20, evenly spaced) ──────────────────────────────────────
const sliderTicks = computed(() => {
  const max = pageCount.value - 1
  if (max <= 0) return []
  const count = Math.min(20, max)
  const ticks = new Set<number>()
  for (let i = 0; i <= count; i++) ticks.add(Math.round((i / count) * max))
  return [...ticks]
})

// ── Progress save ──────────────────────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null
let progressSavePending = false

async function savePageProgress(page: number) {
  progress.pageNumber.value = page + 1
  progress.percentage.value = progressPercent.value
  progressSavePending = false
  await progress.save()
}

async function flushPendingProgress() {
  if (!progressSavePending) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await savePageProgress(currentPage.value)
}

watch(currentPage, (page) => {
  schedulePreload(page)
  onActivity()

  if (!readerReady || restoringContinuousPosition) return

  if (saveTimer) clearTimeout(saveTimer)
  progressSavePending = true
  saveTimer = setTimeout(() => {
    saveTimer = null
    void savePageProgress(page)
  }, 2000)
})

function onResize() {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
}

async function startTrackedReading() {
  const query = { ...route.query }
  delete query.mode
  await router.replace({ name: 'reader', params: route.params, query })
  await nextTick()
  progress.pageNumber.value = progressPageIndex.value + 1
  progress.percentage.value = progressPercent.value
  await progress.save()
  onActivity()
}

// ── Mount / unmount ────────────────────────────────────────────────────────────
onMounted(async () => {
  viewportWidth.value = window.innerWidth
  viewportHeight.value = window.innerHeight
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)

  await progress.load()
  await bookSettings.load()

  applySettings(bookSettings.effective.value as CbxReaderSettings)

  await load()
  const saved = progress.pageNumber.value
  if (saved && saved > 1) {
    currentPage.value = Math.min(saved - 1, pageCount.value - 1)
  } else if (progress.percentage.value > 0 && pageCount.value > 1) {
    const estimated = Math.round((progress.percentage.value / 100) * pageCount.value)
    currentPage.value = Math.max(0, Math.min(estimated - 1, pageCount.value - 1))
  }

  if (scrollMode.value === 'paginated' && isTwoPageEffective.value) {
    currentPage.value = spreadLayout.value.anchorForPage(currentPage.value)
  }

  readerReady = true
  if (scrollMode.value !== 'paginated') {
    await scrollContinuousToPage(currentPage.value, true)
    stripImagesReady.value = true
  }
  schedulePreload(currentPage.value)
})

onBeforeRouteLeave(async () => {
  await flushPendingProgress()
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeyDown)
  if (stripScrollFrame !== null) cancelAnimationFrame(stripScrollFrame)
  void flushPendingProgress()
})
</script>

<template>
  <div class="fixed inset-0 select-none overflow-hidden" :style="{ background: bgValue }">
    <!-- ── Header ──────────────────────────────────────────────────────────── -->
    <div
      class="absolute top-0 inset-x-0 z-50 transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
    >
      <div class="h-12 flex items-center gap-1 px-3 bg-background/90 backdrop-blur-md border-b border-border">
        <button class="viewer-btn" @click="router.back()"><ArrowLeft :size="16" /></button>
        <div class="flex-1 min-w-0 flex flex-col justify-center px-2">
          <span v-if="bookTitle" class="text-sm font-serif text-foreground truncate leading-tight">{{ bookTitle }}</span>
          <span class="text-xs text-muted-foreground tabular-nums">{{ pageLabel }}</span>
        </div>
        <div v-if="props.peekMode" class="flex h-7 items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 text-primary">
          <span class="hidden text-[11px] font-medium sm:inline">{{ t('reader.peek.badge') }}</span>
          <button
            class="h-5 rounded-sm bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground hover:bg-primary/90"
            @click="startTrackedReading"
          >
            {{ t('reader.peek.startReading') }}
          </button>
        </div>
        <div class="hidden items-center md:flex" :aria-label="t('reader.cbz.zoomControls')" role="group">
          <Tooltip>
            <TooltipTrigger as-child>
              <button class="viewer-btn" :disabled="!canZoomOut" :aria-label="t('reader.cbz.zoomOut')" @click="zoomOut">
                <Minus :size="15" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('reader.cbz.zoomOut') }}</TooltipContent>
          </Tooltip>
          <span class="min-w-12 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">{{ zoomPercent }}%</span>
          <Tooltip>
            <TooltipTrigger as-child>
              <button class="viewer-btn" :disabled="!canZoomIn" :aria-label="t('reader.cbz.zoomIn')" @click="zoomIn">
                <Plus :size="15" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('reader.cbz.zoomIn') }}</TooltipContent>
          </Tooltip>
        </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" :aria-label="fullscreenLabel" @click="toggleFullscreen">
              <Minimize v-if="isFullscreen" :size="15" />
              <Maximize v-else :size="15" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ fullscreenLabel }}</TooltipContent>
        </Tooltip>

        <template v-if="isCompact">
          <button
            class="viewer-btn"
            :class="showSettings ? '!bg-muted !text-foreground' : ''"
            :title="t('reader.settings.title')"
            :aria-label="t('reader.settings.ariaLabel')"
            @click="openSettings"
          >
            <Settings :size="15" />
          </button>
          <Sheet :open="showSettings" @update:open="onSettingsOpenChange">
            <SheetContent
              side="bottom"
              hide-close
              class="max-h-[85vh] gap-0 rounded-t-2xl border-border bg-card p-0"
              :aria-label="t('reader.settings.ariaLabel')"
            >
              <div class="flex shrink-0 justify-center pt-2.5 pb-1">
                <div class="h-1 w-9 rounded-full bg-border" />
              </div>
              <CbzSettingsPanel
                :settings="panelSettings"
                :can-reset="bookSettings.isCustomized.value"
                :is-spread-active="isTwoPageEffective"
                @update="applyPanelUpdate"
                @reset="resetBookViewSettings"
              />
            </SheetContent>
          </Sheet>
        </template>

        <Popover v-else :open="showSettings" @update:open="onSettingsOpenChange">
          <PopoverTrigger as-child>
            <button
              class="viewer-btn"
              :class="showSettings ? '!bg-muted !text-foreground' : ''"
              :title="t('reader.settings.title')"
              :aria-label="t('reader.settings.ariaLabel')"
            >
              <Settings :size="15" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            side="bottom"
            :side-offset="10"
            class="flex max-h-[min(80vh,40rem)] w-[21rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border-border bg-card p-0 shadow-2xl"
          >
            <CbzSettingsPanel
              :settings="panelSettings"
              :can-reset="bookSettings.isCustomized.value"
              :is-spread-active="isTwoPageEffective"
              @update="applyPanelUpdate"
              @reset="resetBookViewSettings"
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>

    <!-- ── Paginated view ──────────────────────────────────────────────────── -->
    <div
      v-if="scrollMode === 'paginated'"
      ref="paginatedViewport"
      data-testid="cbz-paginated-viewport"
      class="absolute inset-0 overflow-auto"
      @click="handleImageClick"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @wheel="onWheel"
    >
      <div v-if="!currentImageLoaded && !error" class="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div class="w-8 h-8 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
      </div>

      <div class="flex min-h-full min-w-full items-center justify-center" :style="paginatedStageStyle">
        <div
          data-testid="cbz-paginated-pages"
          class="flex shrink-0 items-center justify-center px-1 origin-center"
          :style="[paginatedContentStyle, renderSpread ? spreadContainerStyle : undefined]"
        >
          <template v-if="renderSpread">
            <div data-spread-side="left" class="flex h-full min-w-0 flex-1 items-center justify-end">
              <img
                v-if="renderLeftPage !== null"
                :src="pageUrl(renderLeftPage)"
                :class="[imgFitClass, 'pointer-events-none transition-opacity duration-150', currentImageLoaded ? 'opacity-100' : 'opacity-0']"
                :style="{ maxWidth: '100%', maxHeight: '100%' }"
                alt=""
                draggable="false"
                @load="onPaginatedImageLoad(renderLeftPage, $event)"
              />
              <div v-else aria-hidden="true" class="h-[92%] w-[92%] rounded-sm border border-border/60 bg-background/30" />
            </div>
            <div data-spread-side="right" class="flex h-full min-w-0 flex-1 items-center justify-start">
              <img
                v-if="renderRightPage !== null"
                :src="pageUrl(renderRightPage)"
                :class="[imgFitClass, 'pointer-events-none transition-opacity duration-150', currentImageLoaded ? 'opacity-100' : 'opacity-0']"
                :style="{ maxWidth: '100%', maxHeight: '100%' }"
                alt=""
                draggable="false"
                @load="onPaginatedImageLoad(renderRightPage, $event)"
              />
              <div v-else aria-hidden="true" class="h-[92%] w-[92%] rounded-sm border border-border/60 bg-background/30" />
            </div>
          </template>

          <img
            v-else-if="renderSinglePage !== null"
            :src="pageUrl(renderSinglePage)"
            :class="[imgFitClass, 'pointer-events-none transition-opacity duration-150', currentImageLoaded ? 'opacity-100' : 'opacity-0']"
            alt=""
            draggable="false"
            @load="onPaginatedImageLoad(renderSinglePage, $event)"
          />
        </div>
      </div>
    </div>

    <!-- ── Infinite / long-strip view ─────────────────────────────────────── -->
    <div v-else ref="scrollContainer" class="absolute inset-0 overflow-auto" @scroll.passive="onStripScroll" @wheel="onWheel">
      <div class="relative w-full" :style="{ height: `${virtualStripSize}px` }">
        <div
          v-for="page in renderedStripPages"
          :key="String(page.key)"
          :ref="measureStripPage"
          :data-index="page.index"
          :data-page="page.index"
          class="absolute start-0 top-0"
          :class="[stripFrameClass, scrollMode === 'long-strip' ? '' : 'px-2']"
          :style="stripFrameStyle(page.start)"
        >
          <img
            :src="pageUrl(page.index)"
            :class="stripImageClass"
            :style="stripImageStyle(page.index)"
            alt=""
            decoding="async"
            draggable="false"
            @load="onStripImageLoad(page.index, $event)"
          />
        </div>
      </div>
    </div>

    <!-- ── Footer ──────────────────────────────────────────────────────────── -->
    <div
      class="absolute bottom-0 inset-x-0 z-50 transition-all duration-300"
      :class="footerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'"
    >
      <div class="h-12 sm:h-14 flex items-center gap-1.5 px-2 sm:gap-3 sm:px-4 bg-background/90 backdrop-blur-md border-t border-border">
        <div class="hidden sm:block">
          <Tooltip>
            <TooltipTrigger as-child>
              <button class="viewer-btn" @click="goToPage(0)"><ChevronsLeft :size="16" /></button>
            </TooltipTrigger>
            <TooltipContent>{{ t('reader.cbz.firstPage') }}</TooltipContent>
          </Tooltip>
        </div>
        <button class="viewer-btn" :disabled="!canGoPrev" @click="prevPage"><ChevronLeft :size="16" /></button>

        <div class="relative flex-1 min-w-0 flex items-center h-6">
          <input
            type="range"
            :min="0"
            :max="Math.max(0, pageCount - 1)"
            :value="currentPage"
            list="cbz-ticks"
            class="w-full h-1 rounded-full cursor-pointer"
            :style="{
              accentColor: 'var(--primary)',
              background: `linear-gradient(to right, var(--primary) ${sliderFillPercent}%, var(--border) ${sliderFillPercent}%)`,
            }"
            @input="goToPage(Number(($event.target as HTMLInputElement).value))"
          />
          <datalist id="cbz-ticks">
            <option v-for="t in sliderTicks" :key="t" :value="t" />
          </datalist>
        </div>

        <button class="viewer-btn" :disabled="!canGoNext" @click="nextPage"><ChevronRight :size="16" /></button>
        <div class="hidden sm:block">
          <Tooltip>
            <TooltipTrigger as-child>
              <button class="viewer-btn" @click="goToPage(pageCount - 1)"><ChevronsRight :size="16" /></button>
            </TooltipTrigger>
            <TooltipContent>{{ t('reader.cbz.lastPage') }}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>

    <!-- Hover zones to reveal header / footer -->
    <div class="absolute top-0 inset-x-0 h-16 z-40 pointer-events-auto" @mouseenter="showHeader()" />
    <div class="absolute bottom-0 inset-x-0 h-16 z-40 pointer-events-auto" @mouseenter="showFooter()" />

    <!-- ── Loading / error overlays ─────────────────────────────────────────── -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-50 bg-background">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
      </div>
    </div>

    <div v-if="error" class="absolute inset-0 flex items-center justify-center z-50 p-8 text-center bg-background">
      <p class="text-sm text-foreground">{{ error }}</p>
    </div>

    <!-- Progress bar -->
    <div v-if="!loading && !error && pageCount > 0" class="absolute bottom-0 left-0 right-0 h-0.5 bg-border z-30">
      <div class="h-full bg-primary/60 transition-all duration-300" :style="{ width: `${progressPercent}%` }" />
    </div>
  </div>
</template>
