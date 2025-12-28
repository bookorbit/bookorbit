<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AlignJustify, ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Minus, Plus, RotateCw, Search, X } from 'lucide-vue-next'
import { usePdf } from '../composables/usePdf'
import { useReaderProgress } from '../composables/useReaderProgress'
import { useVisibility } from '../composables/useVisibility'
import type { PageDim } from '../composables/usePdf'

const props = defineProps<{ bookId: number; fileId: number }>()
const router = useRouter()

const { pdfDoc, totalPages, loading, error, load, getAllPageDims, renderPage, getTextContent } = usePdf()
const progress = useReaderProgress(props.bookId, props.fileId)
const { headerVisible, showHeader } = useVisibility()

// ── State ─────────────────────────────────────────────────────────────────────
const scrollRef = ref<HTMLElement | null>(null)
const currentPage = ref(1)
const pageInput = ref(1)
const rotation = ref<0 | 90 | 180 | 270>(0)
const spread = ref<'none' | 'odd' | 'even'>('none')
const showFind = ref(false)
const findQuery = ref('')
const findMatches = ref(0)
const PAGE_GAP = 16

// ── Page dimensions ───────────────────────────────────────────────────────────
const pageDims = ref<PageDim[]>([])

// After rotation, swap width/height for 90°/270°.
const effectiveDims = computed(() =>
  pageDims.value.map((d) => (rotation.value === 90 || rotation.value === 270 ? { width: d.height, height: d.width } : d)),
)

// ── Container size ────────────────────────────────────────────────────────────
const containerW = ref(0)
const containerH = ref(0)

// ── Zoom ──────────────────────────────────────────────────────────────────────
type ZoomMode = 'fit-width' | 'fit-page' | 'custom'
const zoomMode = ref<ZoomMode>('fit-width')
const customScale = ref(1.0)

const scale = computed(() => {
  const first = effectiveDims.value[0]
  if (!first || !containerW.value) return 1
  if (spread.value !== 'none') {
    // Two-page spread: fit two pages side by side
    const sw = (containerW.value - 48) / (first.width * 2 + PAGE_GAP)
    if (zoomMode.value === 'fit-page') return Math.min(sw, (containerH.value - 48) / first.height)
    if (zoomMode.value === 'fit-width') return sw
  }
  if (zoomMode.value === 'fit-width') return (containerW.value - 32) / first.width
  if (zoomMode.value === 'fit-page') return Math.min((containerW.value - 32) / first.width, (containerH.value - 48) / first.height)
  return customScale.value
})

const zoomPct = computed(() => Math.round(scale.value * 100))

function adjustZoom(delta: number) {
  customScale.value = Math.round(Math.max(0.25, Math.min(4, (zoomMode.value === 'custom' ? customScale.value : scale.value) + delta) * 20) / 20)
  zoomMode.value = 'custom'
}

// ── Spread pages into rows ────────────────────────────────────────────────────
// Returns array of rows, each row = [pageNum] or [pageNum, pageNum+1]
const pageRows = computed<number[][]>(() => {
  const rows: number[][] = []
  const total = totalPages.value
  if (spread.value === 'none') {
    for (let i = 1; i <= total; i++) rows.push([i])
    return rows
  }
  // 'odd' spread: page 1 alone, then pairs [2,3], [4,5]...
  // 'even' spread: pairs [1,2], [3,4]...
  let i = spread.value === 'odd' ? 1 : 0
  if (spread.value === 'odd' && total >= 1) {
    rows.push([1])
    i = 2
  }
  while (i < total) {
    const a = i + 1
    const b = i + 2
    rows.push(b <= total ? [a, b] : [a])
    i += 2
  }
  return rows
})

// Height of each row in px
const rowHeights = computed(() =>
  pageRows.value.map((row) => {
    const maxH = Math.max(...row.map((n) => Math.round((effectiveDims.value[n - 1]?.height ?? 842) * scale.value)))
    return maxH
  }),
)

// ── Canvas / text-layer tracking ──────────────────────────────────────────────
const canvasMap = ref(new Map<number, HTMLCanvasElement>())
const textLayerMap = ref(new Map<number, HTMLElement>())
const rendered = new Set<number>()
let renderQueue: number[] = []
let isRendering = false

async function flushQueue() {
  if (isRendering) return
  isRendering = true
  while (renderQueue.length > 0) {
    const pageNum = renderQueue.shift()!
    if (!pdfDoc.value) break
    const canvas = canvasMap.value.get(pageNum)
    if (!canvas) continue
    await renderPage(pageNum, canvas, scale.value)
    rendered.add(pageNum)
    // Text layer
    await renderTextLayer(pageNum)
  }
  isRendering = false
}

async function renderTextLayer(pageNum: number) {
  const container = textLayerMap.value.get(pageNum)
  if (!container) return
  const result = await getTextContent(pageNum)
  if (!result) return
  const { content, viewport } = result
  const scaledVp = viewport.clone({ scale: scale.value, rotation: rotation.value })
  container.innerHTML = ''
  container.style.width = `${scaledVp.width}px`
  container.style.height = `${scaledVp.height}px`

  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    const [a, b, c, d, e, f] = item.transform
    const span = document.createElement('span')
    span.textContent = item.str
    const tx = pdfjsLib_scaleTransform([a, b, c, d, e, f], scale.value, scaledVp.height)
    span.style.cssText = `position:absolute;left:${tx[4]}px;top:${scaledVp.height - tx[5] - (item.height ?? 0) * scale.value}px;font-size:${Math.abs(tx[0]) || Math.abs(tx[1])}px;transform-origin:0% 0%;white-space:pre;color:transparent;cursor:text;`
    container.appendChild(span)
  }
}

// Scale a 2D transform matrix
function pdfjsLib_scaleTransform([a, b, c, d, e, f]: number[], s: number, _h: number) {
  return [a * s, b * s, c * s, d * s, e * s, f * s]
}

function enqueue(pageNum: number) {
  if (rendered.has(pageNum) || renderQueue.includes(pageNum)) return
  renderQueue.push(pageNum)
  flushQueue()
}

// Invalidate and re-render on zoom/rotation change
watch([scale, rotation], () => {
  rendered.clear()
  renderQueue = []
  isRendering = false
  nextTick(() => ioEntries.forEach((e) => ioCallback([e])))
})

// ── IntersectionObserver ──────────────────────────────────────────────────────
let ioEntries: IntersectionObserverEntry[] = []
let io: IntersectionObserver | null = null

function ioCallback(entries: IntersectionObserverEntry[]) {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    const nums = (e.target as HTMLElement).dataset.pages?.split(',').map(Number) ?? []
    for (const n of nums) {
      enqueue(n)
      if (n > 1) enqueue(n - 1)
      if (n < totalPages.value) enqueue(n + 1)
    }
  }
  ioEntries = entries
}

function setupIO() {
  io?.disconnect()
  io = new IntersectionObserver(ioCallback, { root: scrollRef.value, rootMargin: '300px', threshold: 0 })
  nextTick(() => scrollRef.value?.querySelectorAll('[data-pages]').forEach((el) => io!.observe(el)))
}

// ── Scroll → page tracking ────────────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null

function onScroll() {
  const el = scrollRef.value
  if (!el || !rowHeights.value.length) return

  let offset = el.scrollTop
  let rowIdx = 0
  for (let i = 0; i < rowHeights.value.length; i++) {
    const h = (rowHeights.value[i] ?? 0) + PAGE_GAP
    if (offset < h) {
      rowIdx = i
      break
    }
    offset -= h
    rowIdx = i + 1
  }
  const row = pageRows.value[rowIdx]
  currentPage.value = row?.[0] ?? totalPages.value

  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    progress.pageNumber.value = currentPage.value
    progress.percentage.value = (currentPage.value / totalPages.value) * 100
    progress.save()
  }, 2000)
}

watch(currentPage, (v) => {
  pageInput.value = v
})

// ── Navigation ────────────────────────────────────────────────────────────────
function goToPage(n: number) {
  const el = scrollRef.value
  if (!el) return
  const clamped = Math.max(1, Math.min(n, totalPages.value))
  // Find which row contains this page
  const rowIdx = pageRows.value.findIndex((row) => row.includes(clamped))
  if (rowIdx < 0) return
  let top = 0
  for (let i = 0; i < rowIdx; i++) top += (rowHeights.value[i] ?? 0) + PAGE_GAP
  el.scrollTo({ top, behavior: 'smooth' })
}

function onPageCommit() {
  const n = parseInt(String(pageInput.value))
  if (!isNaN(n)) goToPage(n)
}

// ── Keyboard ──────────────────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if (showFind.value && (e.target as HTMLElement)?.tagName === 'INPUT') return
  const el = scrollRef.value
  if (!el) return
  const ph = (rowHeights.value[pageRows.value.findIndex((r) => r.includes(currentPage.value))] ?? containerH.value) + PAGE_GAP
  if (e.key === 'ArrowDown' || e.key === 'PageDown') {
    e.preventDefault()
    el.scrollBy({ top: ph, behavior: 'smooth' })
  } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
    e.preventDefault()
    el.scrollBy({ top: -ph, behavior: 'smooth' })
  } else if (e.key === 'Home') goToPage(1)
  else if (e.key === 'End') goToPage(totalPages.value)
  else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault()
    showFind.value = true
  } else if (e.key === 'Escape') showFind.value = false
}

// ── Rotation ──────────────────────────────────────────────────────────────────
function rotate() {
  rotation.value = ((rotation.value + 90) % 360) as 0 | 90 | 180 | 270
}

// ── Find ──────────────────────────────────────────────────────────────────────
watch(findQuery, (q) => {
  if (!q.trim()) {
    findMatches.value = 0
    return
  }
  // Naive: count rendered text spans containing query
  let count = 0
  scrollRef.value?.querySelectorAll('[data-text-layer] span').forEach((el) => {
    if (el.textContent?.toLowerCase().includes(q.toLowerCase())) count++
  })
  findMatches.value = count
})

// ── Resize ────────────────────────────────────────────────────────────────────
let ro: ResizeObserver | null = null

function measure() {
  if (!scrollRef.value) return
  containerW.value = scrollRef.value.clientWidth
  containerH.value = scrollRef.value.clientHeight
}

// ── Mount ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)

  await progress.load()
  await load(props.fileId)
  if (!pdfDoc.value) return

  pageDims.value = await getAllPageDims()
  canvasMap.value = new Map()
  textLayerMap.value = new Map()

  await nextTick()
  measure()

  ro = new ResizeObserver(() => {
    measure()
    rendered.clear()
    renderQueue = []
    isRendering = false
    nextTick(() => ioEntries.forEach((e) => ioCallback([e])))
  })
  if (scrollRef.value) ro.observe(scrollRef.value)

  setupIO()

  if (progress.pageNumber.value && progress.pageNumber.value > 1) {
    await nextTick()
    goToPage(progress.pageNumber.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  io?.disconnect()
  ro?.disconnect()
  if (saveTimer) clearTimeout(saveTimer)
})

// ── Derived ───────────────────────────────────────────────────────────────────
const progressPct = computed(() => (totalPages.value ? Math.round((currentPage.value / totalPages.value) * 100) : 0))
</script>

<template>
  <div class="fixed inset-0 bg-[#525659] flex flex-col overflow-hidden select-none" @mousemove="showHeader()">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div
      class="absolute top-0 left-0 right-0 z-50 flex flex-col transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
    >
      <!-- Main toolbar -->
      <div
        class="h-12 flex items-center px-2 gap-0.5"
        style="background: rgba(50, 54, 57, 0.96); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255, 255, 255, 0.08)"
      >
        <button class="pdf-btn" @click="router.back()" title="Back"><ArrowLeft :size="16" /></button>
        <div class="w-px h-5 mx-1 bg-white/15 shrink-0" />

        <!-- Page nav -->
        <button class="pdf-btn" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)"><ChevronLeft :size="16" /></button>
        <div class="flex items-center gap-1 text-sm text-white/80">
          <input
            v-model.number="pageInput"
            type="number"
            min="1"
            :max="totalPages"
            class="w-10 text-center bg-white/10 rounded px-1 py-0.5 text-white text-sm outline-none focus:bg-white/20 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            @keydown.enter="onPageCommit"
            @blur="onPageCommit"
          />
          <span class="text-white/40">/</span>
          <span class="tabular-nums">{{ totalPages }}</span>
        </div>
        <button class="pdf-btn" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)"><ChevronRight :size="16" /></button>

        <div class="w-px h-5 mx-1 bg-white/15 shrink-0" />

        <!-- Zoom -->
        <button class="pdf-btn" @click="adjustZoom(-0.1)" title="Zoom out"><Minus :size="14" /></button>
        <span class="w-12 text-center text-xs text-white/60 font-mono tabular-nums">{{ zoomPct }}%</span>
        <button class="pdf-btn" @click="adjustZoom(0.1)" title="Zoom in"><Plus :size="14" /></button>
        <button class="pdf-btn" :class="zoomMode === 'fit-width' ? 'bg-white/20 text-white' : ''" @click="zoomMode = 'fit-width'" title="Fit width">
          <AlignJustify :size="14" />
        </button>
        <button class="pdf-btn" :class="zoomMode === 'fit-page' ? 'bg-white/20 text-white' : ''" @click="zoomMode = 'fit-page'" title="Fit page">
          <Maximize2 :size="14" />
        </button>

        <div class="w-px h-5 mx-1 bg-white/15 shrink-0" />

        <!-- Rotation -->
        <button class="pdf-btn" @click="rotate" title="Rotate 90°"><RotateCw :size="14" /></button>

        <!-- Spread -->
        <div class="flex items-center gap-0.5 ml-0.5">
          <button
            v-for="s in [
              ['none', '▬'],
              ['odd', '▬▬'],
              ['even', '▬▬'],
            ] as const"
            :key="s[0]"
            class="pdf-btn text-[10px] font-bold px-1.5"
            :class="spread === s[0] ? 'bg-white/20 text-white' : ''"
            :title="s[0] === 'none' ? 'Single page' : s[0] === 'odd' ? 'Spread (cover)' : 'Spread'"
            @click="spread = s[0]"
          >
            {{ s[1] }}
          </button>
        </div>

        <div class="flex-1" />

        <!-- Find -->
        <button class="pdf-btn" :class="showFind ? 'bg-white/20 text-white' : ''" @click="showFind = !showFind" title="Find (⌘F)">
          <Search :size="14" />
        </button>
      </div>

      <!-- Find bar -->
      <div
        v-if="showFind"
        class="flex items-center gap-2 px-3 py-2"
        style="background: rgba(50, 54, 57, 0.98); border-bottom: 1px solid rgba(255, 255, 255, 0.08)"
      >
        <Search :size="13" class="text-white/40 shrink-0" />
        <input
          v-model="findQuery"
          type="text"
          placeholder="Find in document…"
          class="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          autofocus
          @keydown.escape="showFind = false"
        />
        <span v-if="findQuery" class="text-xs text-white/40 tabular-nums shrink-0">{{ findMatches }} match{{ findMatches !== 1 ? 'es' : '' }}</span>
        <button
          class="pdf-btn w-6 h-6"
          @click="
            showFind = false
            findQuery = ''
          "
        >
          <X :size="12" />
        </button>
      </div>
    </div>

    <!-- Hover zone -->
    <div class="absolute top-0 left-0 right-0 z-40 h-16 pointer-events-auto" @mouseenter="showHeader()" />

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
        <p class="text-sm text-white/50">Loading PDF…</p>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center p-8 text-center">
      <div>
        <p class="text-sm font-medium text-white/80 mb-1">Failed to load PDF</p>
        <p class="text-xs text-white/40">{{ error }}</p>
      </div>
    </div>

    <!-- ── Pages ─────────────────────────────────────────────────────────── -->
    <div v-else ref="scrollRef" class="flex-1 overflow-auto" @scroll.passive="onScroll">
      <div class="flex flex-col items-center py-4" :style="{ gap: `${PAGE_GAP}px`, paddingTop: '56px' }">
        <!-- Each row = one or two pages side-by-side -->
        <div
          v-for="(row, ri) in pageRows"
          :key="ri"
          :data-pages="row.join(',')"
          class="flex gap-1 items-start"
          :style="{ height: `${rowHeights[ri] ?? 0}px` }"
        >
          <div
            v-for="pageNum in row"
            :key="pageNum"
            class="relative bg-white shadow-xl overflow-hidden"
            :style="{
              width: `${Math.round((effectiveDims[pageNum - 1]?.width ?? 595) * scale)}px`,
              height: `${Math.round((effectiveDims[pageNum - 1]?.height ?? 842) * scale)}px`,
            }"
          >
            <!-- Canvas -->
            <canvas
              class="block"
              :ref="
                (el) => {
                  if (el) canvasMap.set(pageNum, el as HTMLCanvasElement)
                }
              "
            />
            <!-- Text layer (for selection / find highlight) -->
            <div
              data-text-layer
              class="absolute inset-0 overflow-hidden"
              style="pointer-events: none"
              :ref="
                (el) => {
                  if (el) textLayerMap.set(pageNum, el as HTMLElement)
                }
              "
            />
            <!-- Find highlight overlay -->
            <div v-if="showFind && findQuery" class="absolute inset-0 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>

    <!-- Progress bar -->
    <div v-if="!loading && !error && totalPages > 0" class="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
      <div class="h-full bg-blue-400/60 transition-all duration-500" :style="{ width: `${progressPct}%` }" />
    </div>
  </div>
</template>

<style scoped>
.pdf-btn {
  @apply flex items-center justify-center w-7 h-7 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed;
}
</style>
