<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import { useRouter } from 'vue-router'
import { usePdf } from './composables/usePdf'
import { usePdfZoom } from './composables/usePdfZoom'
import { usePdfLayout, PAGE_GAP, type ScrollMode } from './composables/usePdfLayout'
import { usePdfRenderer } from './composables/usePdfRenderer'
import { usePdfFind } from './composables/usePdfFind'
import { usePdfOutline } from './composables/usePdfOutline'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import PdfToolbar from './components/PdfToolbar.vue'
import PdfFindBar from './components/FindBar.vue'
import PdfSidebar from './components/PdfSidebar.vue'
import type { PageDim } from './composables/usePdf'
import type { PdfReaderSettings } from '@projectx/types'

const props = defineProps<{ bookId: number; fileId: number }>()
const router = useRouter()

const { pdfDoc, totalPages, loading, error, load, getPageDim, startRenderPage, getTextContent } = usePdf()
const progress = useReaderProgress(props.bookId, props.fileId)
const bookSettings = useReaderSettings(props.fileId, 'pdf')

const { onActivity } = useReadingSession(props.fileId, () => ({
  percentage: progress.percentage.value,
  pageNumber: progress.pageNumber.value,
}))

// ── Layout container ──────────────────────────────────────────────────────────
const scrollRef = ref<HTMLElement | null>(null)
const containerW = ref(0)
const containerH = ref(0)

function measure() {
  if (!scrollRef.value) return
  containerW.value = scrollRef.value.clientWidth
  containerH.value = scrollRef.value.clientHeight
}

// ── Page dims ─────────────────────────────────────────────────────────────────
const pageDims = ref<PageDim[]>([])
const effectiveDims = computed(() => pageDims.value)

// ── Spread ────────────────────────────────────────────────────────────────────
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

const renderer = usePdfRenderer(startRenderPage, getTextContent, scale, totalPages, onDimUpdate)
const { canvasMap, textLayerMap, invalidate, setupIO, reset, destroy } = renderer

// ── Find ──────────────────────────────────────────────────────────────────────
const find = usePdfFind(textLayerMap)
const findBarRef = ref<InstanceType<typeof PdfFindBar> | null>(null)
const showFind = ref(false)

function openFind() {
  showFind.value = true
  nextTick(() => findBarRef.value?.focus())
}

function closeFind() {
  showFind.value = false
  find.clear()
  findBarRef.value?.clear()
}

// ── Outline ───────────────────────────────────────────────────────────────────
const outline = usePdfOutline(pdfDoc)

// ── Sidebar ───────────────────────────────────────────────────────────────────
const showSidebar = ref(true)

// ── Cursor tool ───────────────────────────────────────────────────────────────
const cursorTool = ref<'select' | 'hand'>('select')

// Hand tool drag state
let isDragging = false
let lastX = 0
let lastY = 0
let pendingDx = 0
let pendingDy = 0
let rafId: number | null = null

function flushScroll() {
  rafId = null
  if (pendingDx !== 0 || pendingDy !== 0) {
    scrollRef.value?.scrollBy({ left: -pendingDx, top: -pendingDy })
    pendingDx = 0
    pendingDy = 0
  }
}

function onScrollMouseDown(e: MouseEvent) {
  if (cursorTool.value !== 'hand') return
  isDragging = true
  lastX = e.clientX
  lastY = e.clientY
}
function onScrollMouseMove(e: MouseEvent) {
  if (!isDragging || cursorTool.value !== 'hand') return
  pendingDx += e.clientX - lastX
  pendingDy += e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  if (rafId === null) rafId = requestAnimationFrame(flushScroll)
}
function onScrollMouseUp() {
  isDragging = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
    flushScroll()
  }
}

// ── Fullscreen ────────────────────────────────────────────────────────────────
const isFullscreen = ref(false)

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.()
  else document.documentElement.requestFullscreen?.()
}

// ── Invalidation ──────────────────────────────────────────────────────────────
watch(scale, invalidate)

watch([spread, scrollMode], async () => {
  const page = currentPage.value
  invalidate()
  await nextTick()
  if (scrollRef.value) setupIO(scrollRef.value)
  goToPage(page, 'instant')
})

// ── Progress ──────────────────────────────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout> | null = null

watch(currentPage, (page) => {
  onActivity()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    progress.pageNumber.value = page
    progress.percentage.value = (page / totalPages.value) * 100
    progress.save()
  }, 2000)
})

const progressPct = computed(() => (totalPages.value ? Math.round((currentPage.value / totalPages.value) * 100) : 0))

// ── Scroll container style ────────────────────────────────────────────────────
const scrollStyle = computed((): CSSProperties => {
  if (scrollMode.value === 'horizontal') return { overflowX: 'auto', overflowY: 'hidden' }
  if (scrollMode.value === 'page') return { overflowY: 'auto', scrollSnapType: 'y mandatory' }
  return { overflowY: 'auto' }
})

// ── Keyboard ──────────────────────────────────────────────────────────────────
function onKeyDown(e: KeyboardEvent) {
  if (showFind.value && (e.target as HTMLElement)?.tagName === 'INPUT') return
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
    e.preventDefault()
    openFind()
    return
  }
  if (e.key === 'Escape') {
    closeFind()
    return
  }

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
}

function onPageCommit(page: number) {
  if (!isNaN(page)) goToPage(page)
}

function onFindSearch(q: string) {
  find.query.value = q
  find.search()
}

function onFindMatchCase(v: boolean) {
  find.matchCase.value = v
  find.search()
}

function onFindWholeWord(v: boolean) {
  find.wholeWord.value = v
  find.search()
}

// ── Mount / unmount ───────────────────────────────────────────────────────────
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('mouseup', onScrollMouseUp)
  window.addEventListener('mousemove', onScrollMouseMove, { passive: true })

  document.addEventListener('fullscreenchange', () => {
    isFullscreen.value = !!document.fullscreenElement
  })

  await progress.load()
  await bookSettings.load()

  const ps = bookSettings.effective.value as PdfReaderSettings
  // Coerce saved 'continuous' (old value) to 'vertical'
  const savedMode = ps.scrollMode as string
  scrollMode.value = savedMode === 'continuous' ? 'vertical' : (ps.scrollMode as ScrollMode)
  spread.value = ps.spread
  zoomMode.value = ps.zoomMode
  customScale.value = ps.customScale

  watch(spread, (v) => bookSettings.updateBookSettings({ spread: v }))
  watch(zoomMode, (v) => bookSettings.updateBookSettings({ zoomMode: v }))
  watch(customScale, (v) => bookSettings.updateBookSettings({ customScale: v }))
  watch(scrollMode, (v) => bookSettings.updateBookSettings({ scrollMode: v } as Parameters<typeof bookSettings.updateBookSettings>[0]))

  await load(props.fileId)
  if (!pdfDoc.value) return

  const firstDim = await getPageDim(1)
  pageDims.value = Array.from({ length: totalPages.value }, () => ({ ...firstDim }))
  reset()

  await nextTick()
  measure()

  await outline.load()

  resizeObserver = new ResizeObserver(async () => {
    measure()
    invalidate()
    await nextTick()
    if (scrollRef.value) setupIO(scrollRef.value)
  })

  if (scrollRef.value) {
    resizeObserver.observe(scrollRef.value)
    setupIO(scrollRef.value)
  }

  if (progress.pageNumber.value && progress.pageNumber.value > 1) {
    await nextTick()
    goToPage(progress.pageNumber.value, 'instant')
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('mouseup', onScrollMouseUp)
  window.removeEventListener('mousemove', onScrollMouseMove)
  if (rafId !== null) cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
  resizeObserver = null
  destroy()
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<template>
  <div class="fixed inset-0 flex flex-col overflow-hidden select-none bg-muted">
    <!-- Toolbar (always visible) -->
    <PdfToolbar
      :current-page="currentPage"
      :total-pages="totalPages"
      :page-input="pageInput"
      :zoom-label="zoomLabel"
      :zoom-mode="zoomMode"
      :custom-scale="customScale"
      :scale="scale"
      :spread="spread"
      :scroll-mode="scrollMode"
      :is-fullscreen="isFullscreen"
      :show-sidebar="showSidebar"
      :show-find="showFind"
      :cursor-tool="cursorTool"
      :file-id="props.fileId"
      @back="router.back()"
      @toggle-sidebar="showSidebar = !showSidebar"
      @toggle-find="showFind ? closeFind() : openFind()"
      @prev-page="goToPage(currentPage - 1)"
      @next-page="goToPage(currentPage + 1)"
      @first-page="goToPage(1)"
      @last-page="goToPage(totalPages)"
      @commit-page="onPageCommit"
      @zoom-out="adjustZoom(-0.1)"
      @zoom-in="adjustZoom(0.1)"
      @apply-zoom-preset="applyZoomPreset"
      @toggle-fullscreen="toggleFullscreen"
      @update:spread="spread = $event"
      @update:scroll-mode="scrollMode = $event"
      @update:cursor-tool="cursorTool = $event"
    />

    <!-- Find bar -->
    <PdfFindBar
      v-if="showFind"
      ref="findBarRef"
      :match-count="find.matchCount.value"
      :current-index="find.currentIndex.value"
      @close="closeFind()"
      @search="onFindSearch"
      @next="find.next()"
      @prev="find.prev()"
      @update:match-case="onFindMatchCase"
      @update:whole-word="onFindWholeWord"
      @update:highlight-all="find.highlightAll.value = $event"
    />

    <!-- Body: sidebar + pages -->
    <div class="flex flex-1 min-h-0 min-w-0">
      <!-- Sidebar -->
      <PdfSidebar
        v-if="showSidebar"
        :total-pages="totalPages"
        :current-page="currentPage"
        :outline="outline.outline.value"
        :outline-loading="outline.loading.value"
        @go-to-page="(page) => goToPage(page, 'instant')"
      />

      <!-- PDF Viewport -->
      <div class="flex-1 min-w-0 relative">
        <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-background">
          <div class="flex flex-col items-center gap-3">
            <div class="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <p class="text-sm text-muted-foreground">Loading PDF...</p>
          </div>
        </div>

        <div v-else-if="error" class="absolute inset-0 flex items-center justify-center p-8 text-center bg-background">
          <div>
            <p class="text-sm font-medium text-foreground mb-1">Failed to load PDF</p>
            <p class="text-xs text-muted-foreground">{{ error }}</p>
          </div>
        </div>

        <div
          v-else
          ref="scrollRef"
          class="absolute inset-0"
          :class="cursorTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-auto'"
          :style="scrollStyle"
          @scroll.passive="onScroll"
          @mousedown="onScrollMouseDown"
        >
          <!-- Vertical / Wrapped / Page modes -->
          <div
            v-if="scrollMode !== 'horizontal'"
            class="flex flex-col items-center"
            :style="scrollMode === 'page' ? { gap: '0', padding: '0' } : { gap: `${PAGE_GAP}px`, padding: '16px 16px 32px' }"
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
                  width: `${Math.round((pageDims[pageNum - 1]?.width ?? 595) * scale)}px`,
                  height: `${Math.round((pageDims[pageNum - 1]?.height ?? 842) * scale)}px`,
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
                  :class="cursorTool === 'select' ? 'select-text' : 'select-none pointer-events-none'"
                  :ref="
                    (el) => {
                      if (el) textLayerMap.set(pageNum, el as HTMLElement)
                    }
                  "
                />
              </div>
            </div>
          </div>

          <!-- Horizontal mode: single row, scrolls left-right -->
          <div v-else class="flex flex-row items-center" :style="{ gap: `${PAGE_GAP}px`, padding: '16px', height: '100%' }">
            <div
              v-for="pageNum in totalPages"
              :key="pageNum"
              :data-pages="`${pageNum}`"
              class="relative bg-white shadow-xl overflow-hidden shrink-0"
              :style="{
                width: `${Math.round((pageDims[pageNum - 1]?.width ?? 595) * scale)}px`,
                height: `${Math.round((pageDims[pageNum - 1]?.height ?? 842) * scale)}px`,
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

        <!-- Progress bar -->
        <div v-if="!loading && !error && totalPages > 0" class="absolute bottom-0 left-0 right-0 h-0.5 bg-border z-10">
          <div class="h-full bg-primary/60 transition-all duration-500" :style="{ width: `${progressPct}%` }" />
        </div>
      </div>
    </div>
  </div>
</template>
