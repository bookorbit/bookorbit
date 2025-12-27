<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, Minus, Plus, Maximize2, AlignJustify } from 'lucide-vue-next'
import { usePdf, type ZoomMode } from '../composables/usePdf'
import { useReaderProgress } from '../composables/useReaderProgress'
import { useVisibility } from '../composables/useVisibility'

const props = defineProps<{ bookId: number; fileId: number }>()

const router = useRouter()
const { pdfDoc, totalPages, loading, error, load, renderPageToCanvas, getPageViewport } = usePdf()
const progress = useReaderProgress(props.bookId, props.fileId)
const { headerVisible, showHeader } = useVisibility()

// ── Layout ────────────────────────────────────────────────────────────────────
const scrollRef = ref<HTMLElement | null>(null)
const currentPage = ref(1)
const zoomMode = ref<ZoomMode>('fit-width')
const customScale = ref(1.0)
const PAGE_GAP = 12 // px between pages

// Page dimension cache: pageNum → { width, height } at scale=1
const pageDims = ref<{ width: number; height: number }[]>([])

// ── Scale computation ─────────────────────────────────────────────────────────
const containerWidth = ref(0)
const containerHeight = ref(0)

const scale = computed(() => {
  const first = pageDims.value[0]
  if (!first) return 1
  if (zoomMode.value === 'fit-width') return (containerWidth.value - 32) / first.width
  if (zoomMode.value === 'fit-page') {
    const sw = (containerWidth.value - 32) / first.width
    const sh = (containerHeight.value - 48) / first.height
    return Math.min(sw, sh)
  }
  return customScale.value
})

const zoomPercent = computed(() => Math.round(scale.value * 100))

// ── Page placeholder heights at current scale ─────────────────────────────────
const pageHeights = computed(() => pageDims.value.map((d) => Math.round(d.height * scale.value)))

// ── Canvas render tracking ────────────────────────────────────────────────────
const canvasRefs = ref<(HTMLCanvasElement | null)[]>([])
const rendered = new Set<number>() // 1-based page numbers already rendered
let renderQueue: number[] = []
let rendering = false

async function flushQueue() {
  if (rendering || renderQueue.length === 0) return
  rendering = true
  while (renderQueue.length > 0) {
    const pageNum = renderQueue.shift()!
    if (!pdfDoc.value) break
    const canvas = canvasRefs.value[pageNum - 1]
    if (!canvas) continue
    await renderPageToCanvas(pdfDoc.value as Parameters<typeof renderPageToCanvas>[0], pageNum, canvas, scale.value)
    rendered.add(pageNum)
  }
  rendering = false
}

function enqueuePage(pageNum: number) {
  if (rendered.has(pageNum) || renderQueue.includes(pageNum)) return
  renderQueue.push(pageNum)
  flushQueue()
}

// When scale changes, clear rendered cache and re-render visible pages.
watch(scale, () => {
  rendered.clear()
  renderQueue = []
  rendering = false
  nextTick(() => observerCallback(currentObserverEntries))
})

// ── IntersectionObserver — detects visible pages ──────────────────────────────
let currentObserverEntries: IntersectionObserverEntry[] = []
let observer: IntersectionObserver | null = null

function observerCallback(entries: IntersectionObserverEntry[]) {
  currentObserverEntries = entries
  for (const entry of entries) {
    if (!entry.isIntersecting) continue
    const idx = Number((entry.target as HTMLElement).dataset.page)
    enqueuePage(idx)
    // Preload adjacent pages
    if (idx > 1) enqueuePage(idx - 1)
    if (idx < totalPages.value) enqueuePage(idx + 1)
  }
}

function setupObserver() {
  observer?.disconnect()
  observer = new IntersectionObserver(observerCallback, {
    root: scrollRef.value,
    rootMargin: '200px',
    threshold: 0,
  })
  nextTick(() => {
    const items = scrollRef.value?.querySelectorAll('[data-page]') ?? []
    items.forEach((el) => observer!.observe(el))
  })
}

// ── Scroll → current page tracking ───────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null

function onScroll() {
  const el = scrollRef.value
  if (!el || !pageHeights.value.length) return

  let offset = el.scrollTop
  let pg = 1
  for (let i = 0; i < pageHeights.value.length; i++) {
    const h = (pageHeights.value[i] ?? 0) + PAGE_GAP
    if (offset < h) {
      pg = i + 1
      break
    }
    offset -= h
    pg = i + 2
  }
  currentPage.value = Math.min(pg, totalPages.value)

  // Debounced progress save
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    progress.pageNumber.value = currentPage.value
    progress.percentage.value = (currentPage.value / totalPages.value) * 100
    progress.save()
  }, 2000)
}

// ── Keyboard navigation ───────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if (!scrollRef.value) return
  const pageH = pageHeights.value[currentPage.value - 1] ?? containerHeight.value
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    e.preventDefault()
    scrollRef.value.scrollBy({ top: pageH + PAGE_GAP, behavior: 'smooth' })
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault()
    scrollRef.value.scrollBy({ top: -(pageH + PAGE_GAP), behavior: 'smooth' })
  } else if (e.key === 'Home') {
    goToPage(1)
  } else if (e.key === 'End') {
    goToPage(totalPages.value)
  }
}

// ── Navigation helpers ────────────────────────────────────────────────────────
function goToPage(n: number) {
  const el = scrollRef.value
  if (!el) return
  const clamped = Math.max(1, Math.min(n, totalPages.value))
  let top = 0
  for (let i = 0; i < clamped - 1; i++) top += (pageHeights.value[i] ?? 0) + PAGE_GAP
  el.scrollTo({ top, behavior: 'smooth' })
}

const pageInput = ref(1)
watch(currentPage, (v) => {
  pageInput.value = v
})

function onPageInputCommit() {
  const n = parseInt(String(pageInput.value))
  if (!isNaN(n)) goToPage(n)
}

// ── Zoom helpers ──────────────────────────────────────────────────────────────
function setZoom(mode: ZoomMode) {
  zoomMode.value = mode
  if (mode !== 'custom') return
}

function adjustZoom(delta: number) {
  const next = Math.max(0.25, Math.min(4, (zoomMode.value === 'custom' ? customScale.value : scale.value) + delta))
  customScale.value = Math.round(next * 20) / 20 // snap to 5% increments
  zoomMode.value = 'custom'
}

// ── Resize observer ───────────────────────────────────────────────────────────
let resizeObserver: ResizeObserver | null = null

function measureContainer() {
  if (!scrollRef.value) return
  containerWidth.value = scrollRef.value.clientWidth
  containerHeight.value = scrollRef.value.clientHeight
}

// ── Initialisation ────────────────────────────────────────────────────────────
onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)

  await progress.load()
  await load(props.fileId)
  if (!pdfDoc.value) return

  // Fetch all page natural dimensions (scale=1) upfront
  const dims: { width: number; height: number }[] = []
  for (let i = 1; i <= totalPages.value; i++) {
    const vp = await getPageViewport(i, 1)
    dims.push(vp ? { width: vp.width, height: vp.height } : { width: 595, height: 842 })
  }
  pageDims.value = dims
  canvasRefs.value = new Array(totalPages.value).fill(null)

  await nextTick()
  measureContainer()

  resizeObserver = new ResizeObserver(() => {
    measureContainer()
    rendered.clear()
    renderQueue = []
    rendering = false
    nextTick(() => observerCallback(currentObserverEntries))
  })
  if (scrollRef.value) resizeObserver.observe(scrollRef.value)

  setupObserver()

  // Restore saved page
  if (progress.pageNumber.value && progress.pageNumber.value > 1) {
    await nextTick()
    goToPage(progress.pageNumber.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  observer?.disconnect()
  resizeObserver?.disconnect()
  if (saveTimer) clearTimeout(saveTimer)
})

// ── Derived ───────────────────────────────────────────────────────────────────
const progressPercent = computed(() => (totalPages.value ? Math.round((currentPage.value / totalPages.value) * 100) : 0))
</script>

<template>
  <div class="fixed inset-0 bg-[#404040] flex flex-col overflow-hidden" @mousemove="showHeader()">
    <!-- Header -->
    <div
      class="absolute top-0 left-0 right-0 z-50 h-12 flex items-center px-3 gap-1 transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
      style="background: rgba(30, 30, 30, 0.92); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255, 255, 255, 0.1)"
    >
      <!-- Back -->
      <button
        class="flex items-center justify-center w-8 h-8 rounded-md text-white/80 hover:text-white hover:bg-white/10 transition-colors shrink-0"
        @click="router.back()"
        title="Go back"
      >
        <ArrowLeft :size="18" />
      </button>

      <div class="w-px h-5 mx-1 bg-white/15 shrink-0" />

      <!-- Page navigation -->
      <div class="flex items-center gap-1.5">
        <button
          class="flex items-center justify-center w-7 h-7 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium disabled:opacity-30"
          :disabled="currentPage <= 1"
          @click="goToPage(currentPage - 1)"
        >
          ‹
        </button>
        <div class="flex items-center gap-1 text-sm text-white/80">
          <input
            v-model.number="pageInput"
            type="number"
            min="1"
            :max="totalPages"
            class="w-10 text-center bg-white/10 rounded px-1 py-0.5 text-white text-sm outline-none focus:bg-white/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            @keydown.enter="onPageInputCommit"
            @blur="onPageInputCommit"
          />
          <span class="text-white/50">/</span>
          <span>{{ totalPages }}</span>
        </div>
        <button
          class="flex items-center justify-center w-7 h-7 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors text-sm font-medium disabled:opacity-30"
          :disabled="currentPage >= totalPages"
          @click="goToPage(currentPage + 1)"
        >
          ›
        </button>
      </div>

      <div class="flex-1" />

      <!-- Zoom controls -->
      <div class="flex items-center gap-0.5">
        <button
          class="flex items-center justify-center w-7 h-7 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          @click="adjustZoom(-0.1)"
          title="Zoom out"
        >
          <Minus :size="14" />
        </button>
        <span class="w-12 text-center text-xs text-white/70 font-mono tabular-nums">{{ zoomPercent }}%</span>
        <button
          class="flex items-center justify-center w-7 h-7 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          @click="adjustZoom(0.1)"
          title="Zoom in"
        >
          <Plus :size="14" />
        </button>

        <div class="w-px h-4 mx-1 bg-white/15 shrink-0" />

        <button
          class="flex items-center justify-center w-7 h-7 rounded transition-colors text-xs font-bold"
          :class="zoomMode === 'fit-width' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'"
          @click="setZoom('fit-width')"
          title="Fit width"
        >
          <AlignJustify :size="14" />
        </button>
        <button
          class="flex items-center justify-center w-7 h-7 rounded transition-colors"
          :class="zoomMode === 'fit-page' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'"
          @click="setZoom('fit-page')"
          title="Fit page"
        >
          <Maximize2 :size="14" />
        </button>
      </div>
    </div>

    <!-- Hover zone to re-show header -->
    <div class="absolute top-0 left-0 right-0 z-40 h-16 pointer-events-auto" @mouseenter="showHeader()" />

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        <p class="text-sm text-white/60">Loading PDF…</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center p-8">
      <div class="text-center max-w-sm">
        <p class="text-sm font-medium text-white/90 mb-2">Failed to load PDF</p>
        <p class="text-xs text-white/50">{{ error }}</p>
      </div>
    </div>

    <!-- Pages -->
    <div v-else ref="scrollRef" class="flex-1 overflow-y-auto overflow-x-auto" @scroll="onScroll">
      <div class="flex flex-col items-center py-4" :style="{ gap: `${PAGE_GAP}px` }">
        <div
          v-for="n in totalPages"
          :key="n"
          :data-page="n"
          class="bg-white shadow-lg"
          :style="{
            width: `${Math.round((pageDims[n - 1]?.width ?? 595) * scale)}px`,
            height: `${pageHeights[n - 1] ?? 0}px`,
          }"
        >
          <canvas
            :ref="
              (el) => {
                canvasRefs[n - 1] = el as HTMLCanvasElement | null
              }
            "
            class="block"
          />
        </div>
      </div>
    </div>

    <!-- Footer progress bar -->
    <div v-if="!loading && !error && totalPages > 0" class="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
      <div class="h-full bg-white/40 transition-all duration-300" :style="{ width: `${progressPercent}%` }" />
    </div>
  </div>
</template>
