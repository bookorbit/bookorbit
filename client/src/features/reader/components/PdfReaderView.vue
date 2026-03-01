<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize, Minimize, Minus, Plus, Search, Settings, X } from 'lucide-vue-next'
import { usePdf } from '../composables/usePdf'
import { usePdfZoom } from '../composables/usePdfZoom'
import { usePdfLayout, PAGE_GAP } from '../composables/usePdfLayout'
import { usePdfRenderer } from '../composables/usePdfRenderer'
import { useReaderProgress } from '../composables/useReaderProgress'
import { useReaderSettings } from '../composables/useReaderSettings'
import { useVisibility } from '../composables/useVisibility'
import PdfSettingsPanel from './PdfSettingsPanel.vue'
import type { PageDim } from '../composables/usePdf'
import type { PdfReaderSettings } from '@projectx/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{ bookId: number; fileId: number }>()
const router = useRouter()

const { pdfDoc, totalPages, loading, error, load, getPageDim, renderPage, getTextContent } = usePdf()
const progress = useReaderProgress(props.bookId, props.fileId)
const bookSettings = useReaderSettings(props.fileId, 'pdf')
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

// ── Per-book settings save ─────────────────────────────────────────────────────
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

// ── Settings ─────────────────────────────────────────────────────────────────
const showSettings = ref(false)

// ── Find ──────────────────────────────────────────────────────────────────────
const showFind = ref(false)
const findQuery = ref('')
const findMatches = ref(0)

watch(findQuery, (q) => {
  if (!q.trim()) {
    findMatches.value = 0
    return
  }
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
    showSettings.value = false
  }
}

function onPageCommit() {
  const n = parseInt(String(pageInput.value))
  if (!isNaN(n)) goToPage(n)
}

// ── Mount / unmount ───────────────────────────────────────────────────────────
onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  const onFsChange = () => {
    isFullscreen.value = !!document.fullscreenElement
  }
  document.addEventListener('fullscreenchange', onFsChange)
  onUnmounted(() => document.removeEventListener('fullscreenchange', onFsChange))

  await progress.load()
  await bookSettings.load()

  // Seed from effective (hardcoded fallback → format defaults → per-book delta)
  const ps = bookSettings.effective.value as PdfReaderSettings
  spread.value = ps.spread
  zoomMode.value = ps.zoomMode
  customScale.value = ps.customScale
  scrollMode.value = ps.scrollMode

  // Register per-field watches AFTER seeding so assignments above don't trigger saves.
  watch(spread, (v) => bookSettings.updateBookSettings({ spread: v }))
  watch(zoomMode, (v) => bookSettings.updateBookSettings({ zoomMode: v }))
  watch(customScale, (v) => bookSettings.updateBookSettings({ customScale: v }))
  watch(scrollMode, (v) => bookSettings.updateBookSettings({ scrollMode: v }))

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
  onUnmounted(() => {
    ro?.disconnect()
    ro = null
  })

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
  <div class="fixed inset-0 bg-[#525659] flex flex-col overflow-hidden select-none" @mousemove="showHeader()">
    <!-- ── Header ─────────────────────────────────────────────────────────── -->
    <div
      class="absolute top-0 left-0 right-0 z-50 flex flex-col transition-all duration-300"
      :class="headerVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'"
    >
      <!-- Toolbar -->
      <div
        class="h-12 flex items-center px-3 gap-0.5"
        style="
          background: rgba(18, 18, 20, 0.92);
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        "
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" @click="router.back()"><ArrowLeft :size="16" /></button>
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>
        <div class="viewer-sep" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">
              <ChevronLeft :size="16" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Previous page</TooltipContent>
        </Tooltip>
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
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">
              <ChevronRight :size="16" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Next page</TooltipContent>
        </Tooltip>
        <div class="viewer-sep" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" @click.stop="adjustZoom(-0.1)"><Minus :size="14" /></button>
          </TooltipTrigger>
          <TooltipContent>Zoom out</TooltipContent>
        </Tooltip>
        <span class="text-xs text-white/80 font-mono min-w-[64px] text-center tabular-nums select-none">{{ zoomLabel }}</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" @click.stop="adjustZoom(0.1)"><Plus :size="14" /></button>
          </TooltipTrigger>
          <TooltipContent>Zoom in</TooltipContent>
        </Tooltip>
        <div class="viewer-sep" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" :class="showFind ? 'bg-white/20 text-white' : ''" @click="showFind = !showFind">
              <Search :size="14" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Find (⌘F)</TooltipContent>
        </Tooltip>
        <div class="viewer-sep" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" @click="toggleFullscreen">
              <Minimize v-if="isFullscreen" :size="14" />
              <Maximize v-else :size="14" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ isFullscreen ? 'Exit fullscreen' : 'Fullscreen' }}</TooltipContent>
        </Tooltip>
        <div class="viewer-sep" />

        <Tooltip>
          <TooltipTrigger as-child>
            <button class="viewer-btn" :class="showSettings ? 'bg-white/20 text-white' : ''" @click.stop="showSettings = !showSettings">
              <Settings :size="14" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>

      <!-- Find bar -->
      <div
        v-if="showFind"
        class="flex items-center gap-2 px-3 py-2"
        style="background: rgba(18, 18, 20, 0.98); border-bottom: 1px solid rgba(255, 255, 255, 0.08)"
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
        <button class="viewer-btn w-6 h-6" @click="closeFind"><X :size="12" /></button>
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
              :ref="
                (el) => {
                  if (el) canvasMap.set(pageNum, el as HTMLCanvasElement)
                }
              "
            />
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
          </div>
        </div>
      </div>
    </div>

    <!-- Progress bar -->
    <div v-if="!loading && !error && totalPages > 0" class="absolute bottom-0 left-0 right-0 h-0.5 bg-white/10">
      <div class="h-full bg-blue-400/60 transition-all duration-500" :style="{ width: `${progressPct}%` }" />
    </div>
  </div>

  <!-- Settings panel -->
  <PdfSettingsPanel
    v-if="showSettings"
    :zoomMode="zoomMode"
    :customScale="customScale"
    :zoomLabel="zoomLabel"
    :spread="spread"
    :scrollMode="scrollMode"
    :rotation="rotation"
    @applyZoomPreset="applyZoomPreset"
    @update:spread="spread = $event"
    @update:scrollMode="scrollMode = $event"
    @rotate="rotate()"
    @close="showSettings = false"
  />
</template>
