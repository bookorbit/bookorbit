<script setup lang="ts">
import { type Component, computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlignJustify,
  ArrowDownUp,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  BookOpen,
  Circle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Image as ImageIcon,
  Info,
  Layers,
  LayoutGrid,
  Maximize,
  Moon,
  ScanLine,
  Settings,
  Sun,
} from 'lucide-vue-next'
import { useVisibility } from '../shared/composables/useVisibility'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useCbz } from './composables/useCbz'
import { useCbzSettings } from './composables/useCbzSettings'
import type { BgColor, Direction, FitMode, ScrollMode, SpreadAlignment, ViewMode, WidePageSingletonMode } from './composables/useCbzSettings'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import type { CbxReaderSettings } from '@projectx/types'
import { DEFAULT_WIDE_PAGE_RATIO_THRESHOLD, createCbzSpreadLayout } from './lib/spread-layout'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TWO_PAGE_BREAKPOINT = 900

const props = defineProps<{ bookId: number; fileId: number }>()
const router = useRouter()

const progress = useReaderProgress(props.bookId, props.fileId)
const { headerVisible, footerVisible, handleMiddleTap, showHeader, showFooter, setVisibilityLock } = useVisibility()

const { onActivity } = useReadingSession(props.fileId, () => ({
  percentage: progress.percentage.value,
  pageNumber: progress.pageNumber.value,
}))
const { pageCount, bookTitle, loading, error, pageUrl, load } = useCbz(props.fileId, props.bookId)
const { fitMode, viewMode, scrollMode, direction, spreadAlignment, forceTwoPage, widePageSingletonMode, bgColor, bgValue, imgFitClass } =
  useCbzSettings()
const bookSettings = useReaderSettings(props.fileId, 'cbz')

const currentPage = ref(0)
const showSettings = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)
const viewportWidth = ref(0)
const currentImageLoaded = ref(false)
const pendingImageLoads = ref(0)
const loadedImageCount = ref(0)
const pageRatios = ref<number[]>([])
const highlightForceTwoPage = ref(false)
const forceTwoPageToggleButton = ref<HTMLButtonElement | null>(null)
let forceToggleHighlightTimer: ReturnType<typeof setTimeout> | null = null

watch(showSettings, (open) => setVisibilityLock(open))

// ── Settings options ───────────────────────────────────────────────────────────
const FIT_OPTIONS: { value: FitMode; label: string; icon: Component }[] = [
  { value: 'fit-page', label: 'Page Fit', icon: Maximize },
  { value: 'fit-width', label: 'Page Width', icon: ArrowLeftRight },
  { value: 'fit-height', label: 'Page Height', icon: ArrowDownUp },
  { value: 'actual', label: 'Actual Size', icon: ImageIcon },
]
const VIEW_OPTIONS: { value: ViewMode; label: string; icon: Component }[] = [
  { value: 'single', label: 'Single', icon: BookOpen },
  { value: 'two-page', label: 'Two-page', icon: LayoutGrid },
]
const SCROLL_OPTIONS: { value: ScrollMode; label: string; icon: Component }[] = [
  { value: 'paginated', label: 'Paginated', icon: ScanLine },
  { value: 'infinite', label: 'Infinite', icon: Layers },
  { value: 'long-strip', label: 'Long strip', icon: AlignJustify },
]
const DIRECTION_OPTIONS: { value: Direction; label: string; icon: Component }[] = [
  { value: 'ltr', label: 'L to R', icon: ArrowRight },
  { value: 'rtl', label: 'R to L', icon: ArrowLeft },
]
const SPREAD_ALIGNMENT_OPTIONS: { value: SpreadAlignment; label: string; icon: Component }[] = [
  { value: 'normal', label: 'Normal', icon: LayoutGrid },
  { value: 'shifted', label: 'Shifted', icon: BookOpen },
]
const WIDE_PAGE_OPTIONS: { value: WidePageSingletonMode; label: string; icon: Component }[] = [
  { value: 'auto', label: 'Auto singleton', icon: ImageIcon },
  { value: 'disable', label: 'Keep in spreads', icon: LayoutGrid },
]
const BG_OPTIONS: { value: BgColor; label: string; icon: Component }[] = [
  { value: 'black', label: 'Black', icon: Moon },
  { value: 'gray', label: 'Gray', icon: Circle },
  { value: 'white', label: 'White', icon: Sun },
]

function setFitMode(v: FitMode) {
  fitMode.value = v
}
function setViewMode(v: ViewMode) {
  viewMode.value = v
}
function setScrollMode(v: ScrollMode) {
  scrollMode.value = v
}
function setDirection(v: Direction) {
  direction.value = v
}
function setSpreadAlignment(v: SpreadAlignment) {
  spreadAlignment.value = v
}
function setWidePageMode(v: WidePageSingletonMode) {
  widePageSingletonMode.value = v
}
function setForceTwoPage(v: boolean) {
  forceTwoPage.value = v
}
function toggleForceTwoPage() {
  setForceTwoPage(!forceTwoPage.value)
}
function setBgColor(v: BgColor) {
  bgColor.value = v
}

function applySettings(s: CbxReaderSettings) {
  fitMode.value = s.fitMode
  viewMode.value = s.viewMode
  scrollMode.value = s.scrollMode
  direction.value = s.direction
  spreadAlignment.value = s.spreadAlignment
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

function confirmResetBookViewSettings() {
  if (!confirm('Reset view settings for this book to your global defaults?')) return
  resetBookViewSettings()
}

function focusForceTwoPageFromHint() {
  nextTick(() => {
    forceTwoPageToggleButton.value?.focus()
    highlightForceTwoPage.value = true
    if (forceToggleHighlightTimer) clearTimeout(forceToggleHighlightTimer)
    forceToggleHighlightTimer = setTimeout(() => {
      highlightForceTwoPage.value = false
    }, 1400)
  })
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
const renderKey = computed(() => {
  const spread = currentSpread.value
  if (!spread) return 'none'
  if (spread.kind === 'single') return `single:${spread.singlePage ?? -1}`
  return `spread:${spread.leftPage ?? 'blank'}:${spread.rightPage ?? 'blank'}`
})

const showSpreadAlignmentControl = computed(() => isTwoPageEffective.value)
const showAutoFallbackBadge = computed(() => isTwoPagePreferred.value && !isTwoPageEffective.value)
const showSpreadAlignmentHint = computed(() => isTwoPagePreferred.value && !isTwoPageEffective.value)

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

const progressPageIndex = computed(() => {
  const spread = currentSpread.value
  if (!spread || spread.pages.length === 0) return currentPage.value
  return spread.pages[spread.pages.length - 1] ?? currentPage.value
})

const progressPercent = computed(() => {
  if (pageCount.value <= 0) return 0
  return ((Math.max(0, Math.min(progressPageIndex.value, pageCount.value - 1)) + 1) / pageCount.value) * 100
})

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

// ── Wheel (paginated mode only) ────────────────────────────────────────────────
function onWheel(e: WheelEvent) {
  e.preventDefault()
  if (e.deltaY > 0) nextPage()
  else if (e.deltaY < 0) prevPage()
}

// ── Keyboard ───────────────────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if ((e.target as HTMLElement).tagName === 'INPUT') return
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
  }
}

// ── Infinite scroll page tracking ─────────────────────────────────────────────
let io: IntersectionObserver | null = null

function setupScrollObserver() {
  io?.disconnect()
  if (!scrollContainer.value) return

  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          currentPage.value = parseInt((entry.target as HTMLElement).dataset.page ?? '0')
        }
      }
    },
    { root: scrollContainer.value, threshold: 0.5 },
  )

  nextTick(() => {
    scrollContainer.value?.querySelectorAll('[data-page]').forEach((el) => io?.observe(el))
  })
}

watch(scrollMode, async (mode) => {
  if (mode !== 'paginated') {
    await nextTick()
    setupScrollObserver()
    scrollContainer.value?.querySelector(`[data-page="${currentPage.value}"]`)?.scrollIntoView()
  } else {
    io?.disconnect()
  }
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

watch(currentPage, (page) => {
  schedulePreload(page)
  onActivity()

  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    progress.pageNumber.value = page + 1
    progress.percentage.value = progressPercent.value
    progress.save()
  }, 2000)
})

function onResize() {
  viewportWidth.value = window.innerWidth
}

// ── Mount / unmount ────────────────────────────────────────────────────────────
onMounted(async () => {
  viewportWidth.value = window.innerWidth
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeyDown)

  await progress.load()
  await bookSettings.load()

  applySettings(bookSettings.effective.value as CbxReaderSettings)

  watch(fitMode, (v) => bookSettings.updateBookSettings({ fitMode: v }))
  watch(viewMode, (v) => bookSettings.updateBookSettings({ viewMode: v }))
  watch(scrollMode, (v) => bookSettings.updateBookSettings({ scrollMode: v }))
  watch(direction, (v) => bookSettings.updateBookSettings({ direction: v }))
  watch(spreadAlignment, (v) => bookSettings.updateBookSettings({ spreadAlignment: v }))
  watch(forceTwoPage, (v) => bookSettings.updateBookSettings({ forceTwoPage: v }))
  watch(widePageSingletonMode, (v) => bookSettings.updateBookSettings({ widePageSingletonMode: v }))
  watch(bgColor, (v) => bookSettings.updateBookSettings({ bgColor: v }))

  await load()
  const saved = progress.pageNumber.value
  if (saved && saved > 1) currentPage.value = Math.min(saved - 1, pageCount.value - 1)

  if (scrollMode.value === 'paginated' && isTwoPageEffective.value) {
    currentPage.value = spreadLayout.value.anchorForPage(currentPage.value)
  }

  schedulePreload(currentPage.value)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeyDown)
  io?.disconnect()
  if (saveTimer) clearTimeout(saveTimer)
  if (forceToggleHighlightTimer) clearTimeout(forceToggleHighlightTimer)
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
        <DropdownMenu v-model:open="showSettings">
          <DropdownMenuTrigger as-child>
            <button class="viewer-btn" :class="showSettings ? '!bg-muted !text-foreground' : ''">
              <Settings :size="15" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-80 p-2">
            <DropdownMenuLabel class="text-muted-foreground text-xs px-1 py-1">Reader Settings</DropdownMenuLabel>

            <div class="px-1 py-1.5 space-y-1.5">
              <p class="text-[11px] text-muted-foreground">Fit mode</p>
              <div class="grid grid-cols-2 gap-1">
                <button
                  v-for="opt in FIT_OPTIONS"
                  :key="opt.value"
                  class="h-7 px-2 rounded-md border text-[11px] transition-colors flex items-center justify-center gap-1"
                  :class="
                    fitMode === opt.value ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
                  "
                  @click.stop="setFitMode(opt.value)"
                >
                  <component :is="opt.icon" :size="11" />
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div class="px-1 py-1.5 space-y-1.5">
              <div class="flex items-center justify-between">
                <p class="text-[11px] text-muted-foreground">Page view</p>
                <span
                  v-if="showAutoFallbackBadge"
                  class="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  <Info :size="11" />
                  Auto-fallback active
                </span>
              </div>
              <div class="grid grid-cols-2 gap-1">
                <button
                  v-for="opt in VIEW_OPTIONS"
                  :key="opt.value"
                  class="h-7 px-2 rounded-md border text-xs transition-colors flex items-center justify-center gap-1"
                  :class="
                    viewMode === opt.value ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
                  "
                  @click.stop="setViewMode(opt.value)"
                >
                  <component :is="opt.icon" :size="11" />
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div class="px-1 py-1.5 space-y-1.5">
              <p class="text-[11px] text-muted-foreground">Reading direction</p>
              <div class="grid grid-cols-2 gap-1">
                <button
                  v-for="opt in DIRECTION_OPTIONS"
                  :key="opt.value"
                  class="h-7 px-2 rounded-md border text-xs transition-colors flex items-center justify-center gap-1"
                  :class="
                    direction === opt.value
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  "
                  @click.stop="setDirection(opt.value)"
                >
                  <component :is="opt.icon" :size="11" />
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div class="px-1 py-1.5 space-y-1.5">
              <p class="text-[11px] text-muted-foreground">Background</p>
              <div class="grid grid-cols-3 gap-1">
                <button
                  v-for="opt in BG_OPTIONS"
                  :key="opt.value"
                  class="h-7 px-2 rounded-md border text-xs transition-colors flex items-center justify-center gap-1"
                  :class="
                    bgColor === opt.value ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground'
                  "
                  @click.stop="setBgColor(opt.value)"
                >
                  <component :is="opt.icon" :size="11" />
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div v-if="showSpreadAlignmentControl" class="px-1 py-1.5 space-y-1.5">
              <p class="text-[11px] text-muted-foreground">Spread alignment</p>
              <div class="grid grid-cols-2 gap-1">
                <button
                  v-for="opt in SPREAD_ALIGNMENT_OPTIONS"
                  :key="opt.value"
                  class="h-7 px-2 rounded-md border text-xs transition-colors flex items-center justify-center gap-1"
                  :class="
                    spreadAlignment === opt.value
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  "
                  @click.stop="setSpreadAlignment(opt.value)"
                >
                  <component :is="opt.icon" :size="11" />
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <DropdownMenuItem v-if="showSpreadAlignmentHint" class="text-xs mt-1" @select.prevent="focusForceTwoPageFromHint">
              <Info :size="13" />
              Spread alignment unavailable in auto-fallback
              <span class="ml-auto text-[10px] text-muted-foreground">Focus toggle below</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator class="my-1" />

            <div class="px-1 py-1.5 space-y-1.5">
              <p class="text-[11px] text-muted-foreground">Scroll mode</p>
              <div class="grid grid-cols-3 gap-1">
                <button
                  v-for="opt in SCROLL_OPTIONS"
                  :key="opt.value"
                  class="h-7 px-2 rounded-md border text-[11px] transition-colors flex items-center justify-center gap-1"
                  :class="
                    scrollMode === opt.value
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  "
                  @click.stop="setScrollMode(opt.value)"
                >
                  <component :is="opt.icon" :size="11" />
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <div class="px-1 py-1.5 flex items-center justify-between">
              <div>
                <p class="text-[11px] text-muted-foreground">Force two-page (Bypass mobile fallback)</p>
              </div>
              <button
                ref="forceTwoPageToggleButton"
                class="h-7 px-3 rounded-md border text-xs transition-colors"
                :class="[
                  forceTwoPage ? 'border-primary text-primary bg-primary/10' : 'border-border text-muted-foreground hover:text-foreground',
                  highlightForceTwoPage ? 'ring-2 ring-primary/50' : '',
                ]"
                @click.stop="toggleForceTwoPage"
              >
                {{ forceTwoPage ? 'On' : 'Off' }}
              </button>
            </div>

            <div class="px-1 py-1.5 space-y-1.5">
              <p class="text-[11px] text-muted-foreground">Wide pages</p>
              <div class="grid grid-cols-2 gap-1">
                <button
                  v-for="opt in WIDE_PAGE_OPTIONS"
                  :key="opt.value"
                  class="h-7 px-2 rounded-md border text-[11px] transition-colors flex items-center justify-center gap-1"
                  :class="
                    widePageSingletonMode === opt.value
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  "
                  @click.stop="setWidePageMode(opt.value)"
                >
                  <component :is="opt.icon" :size="11" />
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <DropdownMenuSeparator class="my-1" />
            <DropdownMenuItem class="text-xs text-destructive focus:text-destructive" @select.prevent="confirmResetBookViewSettings">
              Reset book view settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <!-- ── Paginated view ──────────────────────────────────────────────────── -->
    <div
      v-if="scrollMode === 'paginated'"
      class="absolute inset-0 flex items-center justify-center overflow-hidden"
      @click="handleImageClick"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @wheel.prevent="onWheel"
    >
      <div v-if="!currentImageLoaded && !error" class="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <div class="w-8 h-8 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
      </div>

      <div class="flex items-center justify-center h-full w-full gap-0.5 px-1">
        <template v-if="renderSpread">
          <div class="h-full w-1/2 flex items-center justify-center">
            <img
              v-if="renderLeftPage !== null"
              :src="pageUrl(renderLeftPage)"
              :class="[imgFitClass, 'pointer-events-none transition-opacity duration-150', currentImageLoaded ? 'opacity-100' : 'opacity-0']"
              :style="{ maxWidth: '100%', maxHeight: '100%' }"
              draggable="false"
              @load="onPaginatedImageLoad(renderLeftPage, $event)"
            />
            <div v-else class="h-[92%] w-[92%] rounded-sm border border-border/60 bg-background/30" />
          </div>
          <div class="h-full w-1/2 flex items-center justify-center">
            <img
              v-if="renderRightPage !== null"
              :src="pageUrl(renderRightPage)"
              :class="[imgFitClass, 'pointer-events-none transition-opacity duration-150', currentImageLoaded ? 'opacity-100' : 'opacity-0']"
              :style="{ maxWidth: '100%', maxHeight: '100%' }"
              draggable="false"
              @load="onPaginatedImageLoad(renderRightPage, $event)"
            />
            <div v-else class="h-[92%] w-[92%] rounded-sm border border-border/60 bg-background/30" />
          </div>
        </template>

        <img
          v-else-if="renderSinglePage !== null"
          :src="pageUrl(renderSinglePage)"
          :class="[imgFitClass, 'pointer-events-none transition-opacity duration-150', currentImageLoaded ? 'opacity-100' : 'opacity-0']"
          draggable="false"
          @load="onPaginatedImageLoad(renderSinglePage, $event)"
        />
      </div>
    </div>

    <!-- ── Infinite / long-strip view ─────────────────────────────────────── -->
    <div
      v-else
      ref="scrollContainer"
      class="absolute inset-0 overflow-y-auto overflow-x-hidden"
      :class="scrollMode === 'long-strip' ? '' : 'flex flex-col items-center'"
    >
      <div :class="scrollMode === 'long-strip' ? '' : 'flex flex-col items-center w-full gap-2 py-4 px-2'">
        <img
          v-for="i in pageCount"
          :key="i - 1"
          :data-page="i - 1"
          :src="pageUrl(i - 1)"
          :class="scrollMode === 'long-strip' ? 'w-full block' : 'max-w-full'"
          loading="lazy"
          draggable="false"
          @load="onStripImageLoad(i - 1, $event)"
        />
      </div>
    </div>

    <!-- ── Footer ──────────────────────────────────────────────────────────── -->
    <div
      class="absolute bottom-0 inset-x-0 z-50 transition-all duration-300"
      :class="footerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-full pointer-events-none'"
    >
      <div class="h-14 flex items-center gap-3 px-4 bg-background/90 backdrop-blur-md border-t border-border">
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" @click="goToPage(0)"><ChevronsLeft :size="16" /></button>
          </TooltipTrigger>
          <TooltipContent>First page</TooltipContent>
        </Tooltip>
        <button class="viewer-btn" :disabled="!canGoPrev" @click="prevPage"><ChevronLeft :size="16" /></button>

        <div class="flex-1 flex flex-col justify-center gap-0.5">
          <input
            type="range"
            :min="0"
            :max="Math.max(0, pageCount - 1)"
            :value="currentPage"
            list="cbz-ticks"
            class="flex-1 w-full cursor-pointer"
            style="accent-color: var(--primary)"
            @input="goToPage(Number(($event.target as HTMLInputElement).value))"
          />
          <datalist id="cbz-ticks">
            <option v-for="t in sliderTicks" :key="t" :value="t" />
          </datalist>
        </div>

        <button class="viewer-btn" :disabled="!canGoNext" @click="nextPage"><ChevronRight :size="16" /></button>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" @click="goToPage(pageCount - 1)"><ChevronsRight :size="16" /></button>
          </TooltipTrigger>
          <TooltipContent>Last page</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <!-- Hover zones to reveal header / footer -->
    <div class="absolute top-0 inset-x-0 h-16 z-40 pointer-events-auto" @mouseenter="showHeader()" />
    <div class="absolute bottom-0 inset-x-0 h-16 z-40 pointer-events-auto" @mouseenter="showFooter()" />

    <!-- ── Loading / error overlays ─────────────────────────────────────────── -->
    <div v-if="loading" class="absolute inset-0 flex items-center justify-center z-50 bg-background">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p class="text-sm text-muted-foreground">Loading…</p>
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
