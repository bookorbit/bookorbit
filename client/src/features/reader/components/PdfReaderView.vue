<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ChevronLeft, ChevronRight, LayoutGrid, Maximize, Minimize, Minus, Plus, RotateCw, Search, X } from 'lucide-vue-next'
import { usePdf } from '../composables/usePdf'
import { usePdfZoom, ZOOM_PRESETS } from '../composables/usePdfZoom'
import { usePdfLayout, PAGE_GAP } from '../composables/usePdfLayout'
import { usePdfRenderer } from '../composables/usePdfRenderer'
import { useReaderProgress } from '../composables/useReaderProgress'
import { useVisibility } from '../composables/useVisibility'
import type { PageDim } from '../composables/usePdf'

const props = defineProps<{ bookId: number; fileId: number }>()
const router = useRouter()

const { pdfDoc, totalPages, loading, error, load, getPageDim, renderPage, getTextContent } = usePdf()
const progress = useReaderProgress(props.bookId, props.fileId)
const { headerVisible, showHeader } = useVisibility()

// ── Container & scroll ────────────────────────────────────────────────────────
const scrollRef = ref<HTMLElement | null>(null)
const containerW = ref(0)
const containerH = ref(0)

function measure() {
  if (!scrollRef.value) return
  containerW.value = scrollRef.value.clientWidth
  containerH.value = scrollRef.value.clientHeight
}

// ── Page dims + rotation ──────────────────────────────────────────────────────
const pageDims = ref<PageDim[]>([])
const rotation = ref<0 | 90 | 180 | 270>(0)

// Swap width/height for 90°/270° rotations.
const effectiveDims = computed(() =>
  pageDims.value.map((d) => (rotation.value === 90 || rotation.value === 270 ? { width: d.height, height: d.width } : d)),
)

function rotate() {
  rotation.value = ((rotation.value + 90) % 360) as 0 | 90 | 180 | 270
}

// ── Spread (owned here; passed to both zoom and layout) ───────────────────────
const spread = ref<'none' | 'odd' | 'even'>('none')

// ── Composables ───────────────────────────────────────────────────────────────
const zoom = usePdfZoom(containerW, containerH, effectiveDims, spread)
const { scale, zoomMode, customScale, zoomLabel, adjustZoom, applyZoomPreset } = zoom

const layout = usePdfLayout(scrollRef, totalPages, effectiveDims, scale, containerH, spread)
const { scrollMode, currentPage, pageInput, pageRows, rowHeights, goToPage, onScroll } = layout

function onDimUpdate(pageNum: number, dim: PageDim) {
  const prev = pageDims.value[pageNum - 1]
  if (prev && prev.width === dim.width && prev.height === dim.height) return
  pageDims.value = pageDims.value.map((d, i) => (i === pageNum - 1 ? dim : d))
}

const renderer = usePdfRenderer(renderPage, getTextContent, scale, rotation, totalPages, onDimUpdate)
const { canvasMap, textLayerMap, invalidate, setupIO, reset, destroy } = renderer

// ── Invalidation ──────────────────────────────────────────────────────────────
watch([scale, rotation], invalidate)

// Spread/scrollMode change alters DOM structure — rebuild IO observers after re-render.
watch([spread, scrollMode], async () => {
  invalidate()
  await nextTick()
  if (scrollRef.value) setupIO(scrollRef.value)
})

// ── Progress: debounced save on page change ───────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(currentPage, (page) => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    progress.pageNumber.value = page
    progress.percentage.value = (page / totalPages.value) * 100
    progress.save()
  }, 2000)
})

// ── Fullscreen ────────────────────────────────────────────────────────────────
const isFullscreen = ref(false)

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.()
  } else {
    document.documentElement.requestFullscreen?.()
  }
}

// ── Find ──────────────────────────────────────────────────────────────────────
const showFind = ref(false)
const findQuery = ref('')
const findMatches = ref(0)

watch(findQuery, (q) => {
  if (!q.trim()) { findMatches.value = 0; return }
  let count = 0
  scrollRef.value?.querySelectorAll('[data-text-layer] span').forEach((el) => {
    if (el.textContent?.toLowerCase().includes(q.toLowerCase())) count++
  })
  findMatches.value = count
})

function closeFind() {
  showFind.value = false
  findQuery.value = ''
}

// ── Menus (zoom + view dropdowns) ────────────────────────────────────────────
const showZoomMenu = ref(false)
const showViewMenu = ref(false)
const zoomBtnRef = ref<HTMLElement | null>(null)
const viewBtnRef = ref<HTMLElement | null>(null)
const zoomMenuStyle = ref({ top: '0px', left: '0px' })
const viewMenuStyle = ref({ top: '0px', right: '0px' })

function openZoomMenu() {
  if (zoomBtnRef.value) {
    const r = zoomBtnRef.value.getBoundingClientRect()
    zoomMenuStyle.value = { top: `${r.bottom + 4}px`, left: `${r.left + r.width / 2}px` }
  }
  showZoomMenu.value = !showZoomMenu.value
  showViewMenu.value = false
}

function openViewMenu() {
  if (viewBtnRef.value) {
    const r = viewBtnRef.value.getBoundingClientRect()
    viewMenuStyle.value = { top: `${r.bottom + 4}px`, right: `${window.innerWidth - r.right}px` }
  }
  showViewMenu.value = !showViewMenu.value
  showZoomMenu.value = false
}

function closeAllMenus() {
  showZoomMenu.value = false
  showViewMenu.value = false
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
  } else if (e.key === 'Home') {
    goToPage(1)
  } else if (e.key === 'End') {
    goToPage(totalPages.value)
  } else if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault()
    showFind.value = true
  } else if (e.key === 'Escape') {
    closeFind()
    closeAllMenus()
  }
}

function onPageCommit() {
  const n = parseInt(String(pageInput.value))
  if (!isNaN(n)) goToPage(n)
}

// ── Mount / unmount ───────────────────────────────────────────────────────────
onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  const onFsChange = () => { isFullscreen.value = !!document.fullscreenElement }
  document.addEventListener('fullscreenchange', onFsChange)
  onUnmounted(() => document.removeEventListener('fullscreenchange', onFsChange))

  await progress.load()
  await load(props.fileId)
  if (!pdfDoc.value) return

  // Load only page 1 to establish initial layout dims. All pages are seeded with
  // page 1's size (uniform assumption). onDimUpdate corrects individual pages
  // lazily as they are rendered — no upfront full-document traversal.
  const firstDim = await getPageDim(1)
  pageDims.value = Array.from({ length: totalPages.value }, () => ({ ...firstDim }))
  reset()

  await nextTick()
  measure()

  let ro: ResizeObserver | null = new ResizeObserver(async () => {
    measure()
    invalidate()
    await nextTick()
    if (scrollRef.value) setupIO(scrollRef.value)
  })
  if (scrollRef.value) {
    ro.observe(scrollRef.value)
    setupIO(scrollRef.value)
  }
  onUnmounted(() => { ro?.disconnect(); ro = null })

  if (progress.pageNumber.value && progress.pageNumber.value > 1) {
    await nextTick()
    goToPage(progress.pageNumber.value)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  destroy()
  if (saveTimer) clearTimeout(saveTimer)
})

const progressPct = computed(() => (totalPages.value ? Math.round((currentPage.value / totalPages.value) * 100) : 0))
</script>

<template>
  <div class="fixed inset-0 bg-[#525659] flex flex-col overflow-hidden select-none" @mousemove="showHeader()" @click="closeAllMenus()">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div
      class="absolute top-0 left-0 right-0 z-50 flex flex-col transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
    >
      <!-- Toolbar -->
      <div
        class="h-12 flex items-center px-2 gap-0.5"
        style="background: rgba(50, 54, 57, 0.96); backdrop-filter: blur(8px); border-bottom: 1px solid rgba(255, 255, 255, 0.08)"
      >
        <button class="pdf-btn" @click="router.back()" title="Back"><ArrowLeft :size="16" /></button>
        <div class="sep" />

        <button class="pdf-btn" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)" title="Previous page">
          <ChevronLeft :size="16" />
        </button>
        <div class="flex items-center gap-1 text-sm text-white/80 shrink-0">
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
        <button class="pdf-btn" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)" title="Next page">
          <ChevronRight :size="16" />
        </button>
        <div class="sep" />

        <button class="pdf-btn" @click.stop="adjustZoom(-0.1)" title="Zoom out"><Minus :size="14" /></button>
        <div class="shrink-0">
          <button
            ref="zoomBtnRef"
            class="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors min-w-[72px] justify-center font-mono"
            @click.stop="openZoomMenu"
            title="Zoom level"
          >
            {{ zoomLabel }}
            <span class="text-white/30 text-[10px]">▾</span>
          </button>
        </div>
        <button class="pdf-btn" @click.stop="adjustZoom(0.1)" title="Zoom in"><Plus :size="14" /></button>
        <div class="sep" />

        <div class="shrink-0">
          <button
            ref="viewBtnRef"
            class="flex items-center gap-1 px-2 py-1 rounded text-xs text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            @click.stop="openViewMenu"
            title="View options"
          >
            <LayoutGrid :size="14" />
            <span class="text-white/30 text-[10px]">▾</span>
          </button>
        </div>
        <div class="sep" />

        <button class="pdf-btn" :class="showFind ? 'bg-white/20 text-white' : ''" @click="showFind = !showFind" title="Find (⌘F)">
          <Search :size="14" />
        </button>
        <div class="sep" />

        <button class="pdf-btn" @click="toggleFullscreen" :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'">
          <Minimize v-if="isFullscreen" :size="14" />
          <Maximize v-else :size="14" />
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
        <button class="pdf-btn w-6 h-6" @click="closeFind"><X :size="12" /></button>
      </div>
    </div>

    <!-- Hover zone to reveal header -->
    <div class="absolute top-0 left-0 right-0 z-40 h-16 pointer-events-auto" @mouseenter="showHeader()" />

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="flex flex-col items-center gap-3">
        <div class="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
        <p class="text-sm text-white/50">Loading PDF…</p>
      </div>
    </div>

    <div v-else-if="error" class="flex-1 flex items-center justify-center p-8 text-center">
      <div>
        <p class="text-sm font-medium text-white/80 mb-1">Failed to load PDF</p>
        <p class="text-xs text-white/40">{{ error }}</p>
      </div>
    </div>

    <!-- ── Pages ──────────────────────────────────────────────────────────── -->
    <div
      v-else
      ref="scrollRef"
      class="flex-1 overflow-auto"
      :style="scrollMode === 'page' ? { scrollSnapType: 'y mandatory' } : {}"
      @scroll.passive="onScroll"
    >
      <div
        class="flex flex-col items-center"
        :style="scrollMode === 'page' ? { gap: '0px', paddingTop: '0' } : { gap: `${PAGE_GAP}px`, paddingTop: '56px' }"
      >
        <div
          v-for="(row, ri) in pageRows"
          :key="ri"
          :data-pages="row.join(',')"
          class="flex gap-1"
          :style="
            scrollMode === 'page'
              ? { height: `${containerH}px`, scrollSnapAlign: 'start', alignItems: 'center', justifyContent: 'center' }
              : { height: `${rowHeights[ri] ?? 0}px`, alignItems: 'flex-start' }
          "
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
            <canvas
              class="block"
              :ref="(el) => { if (el) canvasMap.set(pageNum, el as HTMLCanvasElement) }"
            />
            <div
              data-text-layer
              class="absolute inset-0 overflow-hidden"
              style="pointer-events: none"
              :ref="(el) => { if (el) textLayerMap.set(pageNum, el as HTMLElement) }"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Progress bar -->
    <div v-if="!loading && !error && totalPages > 0" class="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
      <div class="h-full bg-blue-400/60 transition-all duration-500" :style="{ width: `${progressPct}%` }" />
    </div>
  </div>

  <!-- Zoom dropdown — teleported to escape stacking context created by header -->
  <Teleport to="body">
    <div
      v-if="showZoomMenu"
      class="fixed w-40 rounded-lg shadow-2xl py-1 overflow-hidden"
      :style="{ zIndex: 9999, background: 'rgba(35,38,41,0.98)', border: '1px solid rgba(255,255,255,0.1)', transform: 'translateX(-50%)', top: zoomMenuStyle.top, left: zoomMenuStyle.left }"
      @click.stop
    >
      <button
        v-for="preset in ZOOM_PRESETS"
        :key="preset.label"
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="zoomMode === 'custom' && customScale === parseFloat(preset.value) ? 'text-white' : 'text-white/60'"
        @click="applyZoomPreset(preset.value)"
      >
        {{ preset.label }}
        <span v-if="zoomMode === 'custom' && customScale === parseFloat(preset.value)" class="text-blue-400 text-[10px]">✓</span>
      </button>
    </div>
  </Teleport>

  <!-- View dropdown — teleported to escape stacking context created by header -->
  <Teleport to="body">
    <div
      v-if="showViewMenu"
      class="fixed w-44 rounded-lg shadow-2xl py-1 overflow-hidden"
      :style="{ zIndex: 9999, background: 'rgba(35,38,41,0.98)', border: '1px solid rgba(255,255,255,0.1)', top: viewMenuStyle.top, right: viewMenuStyle.right }"
      @click.stop
    >
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="zoomMode === 'fit-width' ? 'text-white' : 'text-white/60'"
        @click="applyZoomPreset('fit-width'); showViewMenu = false"
      >
        Fit Width<span v-if="zoomMode === 'fit-width'" class="text-blue-400 text-[10px]">✓</span>
      </button>
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="zoomMode === 'fit-page' ? 'text-white' : 'text-white/60'"
        @click="applyZoomPreset('fit-page'); showViewMenu = false"
      >
        Fit Page<span v-if="zoomMode === 'fit-page'" class="text-blue-400 text-[10px]">✓</span>
      </button>
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="zoomMode === 'custom' && customScale === 1 ? 'text-white' : 'text-white/60'"
        @click="applyZoomPreset('1'); showViewMenu = false"
      >
        Actual Size<span v-if="zoomMode === 'custom' && customScale === 1" class="text-blue-400 text-[10px]">✓</span>
      </button>
      <div class="my-1 border-t border-white/10" />
      <button
        class="w-full text-left px-3 py-1.5 text-xs text-white/60 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-between"
        @click="rotate(); showViewMenu = false"
      >
        Rotate CW <RotateCw :size="12" />
      </button>
      <div class="my-1 border-t border-white/10" />
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="spread === 'none' ? 'text-white' : 'text-white/60'"
        @click="spread = 'none'; showViewMenu = false"
      >
        Single Page<span v-if="spread === 'none'" class="text-blue-400 text-[10px]">✓</span>
      </button>
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="spread === 'odd' ? 'text-white' : 'text-white/60'"
        @click="spread = 'odd'; showViewMenu = false"
      >
        Two-Page Spread<span v-if="spread === 'odd'" class="text-blue-400 text-[10px]">✓</span>
      </button>
      <div class="my-1 border-t border-white/10" />
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="scrollMode === 'continuous' ? 'text-white' : 'text-white/60'"
        @click="scrollMode = 'continuous'; showViewMenu = false"
      >
        Continuous Scroll<span v-if="scrollMode === 'continuous'" class="text-blue-400 text-[10px]">✓</span>
      </button>
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-white/10 transition-colors flex items-center justify-between"
        :class="scrollMode === 'page' ? 'text-white' : 'text-white/60'"
        @click="scrollMode = 'page'; showViewMenu = false"
      >
        Page by Page<span v-if="scrollMode === 'page'" class="text-blue-400 text-[10px]">✓</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
@reference "tailwindcss";
.pdf-btn {
  @apply flex items-center justify-center w-7 h-7 rounded text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed;
}
.sep {
  @apply w-px h-5 mx-1 bg-white/15 shrink-0;
}
</style>
