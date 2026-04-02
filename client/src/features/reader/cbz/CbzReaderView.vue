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
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Image as ImageIcon,
  LayoutGrid,
  Layers,
  Maximize,
  ScanLine,
  Settings,
} from 'lucide-vue-next'
import { useVisibility } from '../shared/composables/useVisibility'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useCbz } from './composables/useCbz'
import { useCbzSettings } from './composables/useCbzSettings'
import type { BgColor, Direction, FitMode, ScrollMode, ViewMode } from './composables/useCbzSettings'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import type { CbxReaderSettings } from '@projectx/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const props = defineProps<{ bookId: number; fileId: number }>()
const router = useRouter()

const progress = useReaderProgress(props.bookId, props.fileId)
const { headerVisible, footerVisible, handleMiddleTap, showHeader, showFooter, setVisibilityLock } = useVisibility()

const { onActivity } = useReadingSession(props.fileId, () => ({
  percentage: progress.percentage.value,
  pageNumber: progress.pageNumber.value,
}))
const { pageCount, bookTitle, loading, error, pageUrl, load } = useCbz(props.fileId, props.bookId)
const { fitMode, viewMode, scrollMode, direction, bgColor, bgValue, isTwoPage, imgFitClass } = useCbzSettings()
const bookSettings = useReaderSettings(props.fileId, 'cbz')

const currentPage = ref(0)
const currentImageLoaded = ref(false)
const showSettings = ref(false)
const scrollContainer = ref<HTMLElement | null>(null)

watch(showSettings, (open) => setVisibilityLock(open))

// ── Settings options ───────────────────────────────────────────────────────────
const FIT_OPTIONS: { value: FitMode; label: string; icon: Component }[] = [
  { value: 'fit-page', label: 'Page Fit', icon: Maximize },
  { value: 'fit-width', label: 'Page Width', icon: ArrowLeftRight },
  { value: 'fit-height', label: 'Page Height', icon: ArrowDownUp },
  { value: 'actual', label: 'Actual Size', icon: ImageIcon },
]
const VIEW_OPTIONS: { value: ViewMode; label: string; icon: Component }[] = [
  { value: 'single', label: 'Single Page', icon: BookOpen },
  { value: 'two-page', label: 'Two Page', icon: LayoutGrid },
]
const SCROLL_OPTIONS: { value: ScrollMode; label: string; icon: Component }[] = [
  { value: 'paginated', label: 'Paginated', icon: ScanLine },
  { value: 'infinite', label: 'Infinite Scroll', icon: Layers },
  { value: 'long-strip', label: 'Long Strip', icon: AlignJustify },
]
const DIRECTION_OPTIONS: { value: Direction; label: string; icon: Component }[] = [
  { value: 'ltr', label: 'Left to Right', icon: ArrowRight },
  { value: 'rtl', label: 'Right to Left', icon: ArrowLeft },
]
const BG_OPTIONS: { value: BgColor; label: string; color: string }[] = [
  { value: 'black', label: 'Black', color: 'bg-zinc-950' },
  { value: 'gray', label: 'Gray', color: 'bg-zinc-500' },
  { value: 'white', label: 'White', color: 'bg-white' },
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
function setBgColor(v: BgColor) {
  bgColor.value = v
}

// ── Derived ────────────────────────────────────────────────────────────────────
// Pages shown in paginated mode (1 or 2), in display order for RTL.
const visiblePages = computed(() => {
  if (!isTwoPage.value) return [currentPage.value]
  const a = currentPage.value
  const b = a + 1
  if (direction.value === 'ltr') return b < pageCount.value ? [a, b] : [a]
  return b < pageCount.value ? [b, a] : [a] // RTL: second page on left
})

// ── Preloading ─────────────────────────────────────────────────────────────────
const preloadCache = new Map<number, HTMLImageElement>()

function preload(n: number) {
  if (n < 0 || n >= pageCount.value || preloadCache.has(n)) return
  const img = new Image()
  img.src = pageUrl(n)
  preloadCache.set(n, img)
}

function schedulePreload(center: number) {
  for (let i = center - 2; i <= center + 4; i++) preload(i)
  for (const [k] of preloadCache) {
    if (Math.abs(k - center) > 8) preloadCache.delete(k)
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────────
function goToPage(n: number) {
  const target = Math.max(0, Math.min(n, pageCount.value - 1))
  if (target === currentPage.value) return
  currentPage.value = target
  currentImageLoaded.value = false
}

function nextPage() {
  goToPage(currentPage.value + (isTwoPage.value ? 2 : 1))
}

function prevPage() {
  goToPage(currentPage.value - (isTwoPage.value ? 2 : 1))
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
// Note: this handler is only attached on the paginated view div (v-if), so it is
// never active during infinite/long-strip modes — no need to guard with scrollMode check.
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
      goToPage(0)
      break
    case 'End':
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
    scrollContainer.value?.querySelectorAll('[data-page]').forEach((el) => io!.observe(el))
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
    progress.percentage.value = pageCount.value ? ((page + 1) / pageCount.value) * 100 : 0
    progress.save()
  }, 2000)
})

// ── Mount / unmount ────────────────────────────────────────────────────────────
onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  await progress.load()
  await bookSettings.load()

  // Seed refs from effective (hardcoded fallback → format defaults → per-book delta)
  const s = bookSettings.effective.value as CbxReaderSettings
  fitMode.value = s.fitMode
  viewMode.value = s.viewMode
  scrollMode.value = s.scrollMode
  direction.value = s.direction
  bgColor.value = s.bgColor

  // Register per-field watches AFTER seeding so the assignments above don't trigger saves.
  // Each watch sends only the one changed field to keep the delta minimal.
  watch(fitMode, (v) => bookSettings.updateBookSettings({ fitMode: v }))
  watch(viewMode, (v) => bookSettings.updateBookSettings({ viewMode: v }))
  watch(scrollMode, (v) => bookSettings.updateBookSettings({ scrollMode: v }))
  watch(direction, (v) => bookSettings.updateBookSettings({ direction: v }))
  watch(bgColor, (v) => bookSettings.updateBookSettings({ bgColor: v }))

  await load()
  const saved = progress.pageNumber.value
  if (saved && saved > 1) currentPage.value = Math.min(saved - 1, pageCount.value - 1)
  schedulePreload(currentPage.value)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  io?.disconnect()
  if (saveTimer) clearTimeout(saveTimer)
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
          <span class="text-xs text-muted-foreground tabular-nums">{{ currentPage + 1 }} / {{ pageCount }}</span>
        </div>
        <DropdownMenu v-model:open="showSettings">
          <DropdownMenuTrigger as-child>
            <button class="viewer-btn" :class="showSettings ? '!bg-muted !text-foreground' : ''">
              <Settings :size="15" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-52">
            <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Fit Mode</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="fitMode">
              <DropdownMenuRadioItem
                v-for="opt in FIT_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                class="text-xs gap-2"
                @select.prevent="setFitMode(opt.value)"
              >
                <component :is="opt.icon" :size="13" />
                {{ opt.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />

            <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Pages</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="viewMode">
              <DropdownMenuRadioItem
                v-for="opt in VIEW_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                class="text-xs gap-2"
                @select.prevent="setViewMode(opt.value)"
              >
                <component :is="opt.icon" :size="13" />
                {{ opt.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />

            <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Scroll Mode</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="scrollMode">
              <DropdownMenuRadioItem
                v-for="opt in SCROLL_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                class="text-xs gap-2"
                @select.prevent="setScrollMode(opt.value)"
              >
                <component :is="opt.icon" :size="13" />
                {{ opt.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />

            <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Reading Direction</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="direction">
              <DropdownMenuRadioItem
                v-for="opt in DIRECTION_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                class="text-xs gap-2"
                @select.prevent="setDirection(opt.value)"
              >
                <component :is="opt.icon" :size="13" />
                {{ opt.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>

            <DropdownMenuSeparator />

            <DropdownMenuLabel class="text-muted-foreground text-xs px-2 py-1">Background</DropdownMenuLabel>
            <DropdownMenuRadioGroup :model-value="bgColor">
              <DropdownMenuRadioItem
                v-for="opt in BG_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                class="text-xs gap-2"
                @select.prevent="setBgColor(opt.value)"
              >
                <span class="size-3 rounded-full ring-1 ring-border shrink-0" :class="opt.color" />
                {{ opt.label }}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
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

      <div
        class="flex items-center justify-center h-full w-full"
        :class="isTwoPage ? 'gap-0.5' : ''"
        :style="isTwoPage && direction === 'rtl' ? { flexDirection: 'row-reverse' } : {}"
      >
        <img
          v-for="pg in visiblePages"
          :key="pg"
          :src="pageUrl(pg)"
          :class="[imgFitClass, 'pointer-events-none transition-opacity duration-150', currentImageLoaded ? 'opacity-100' : 'opacity-0']"
          :style="isTwoPage ? { maxWidth: '50%', maxHeight: '100%' } : {}"
          draggable="false"
          @load="currentImageLoaded = true"
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
        <button class="viewer-btn" :disabled="currentPage === 0" @click="prevPage"><ChevronLeft :size="16" /></button>

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

        <button class="viewer-btn" :disabled="currentPage >= pageCount - 1" @click="nextPage"><ChevronRight :size="16" /></button>
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
      <div class="h-full bg-primary/60 transition-all duration-300" :style="{ width: `${((currentPage + 1) / pageCount) * 100}%` }" />
    </div>
  </div>
</template>
