<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle, ExternalLink, LoaderCircle } from '@lucide/vue'
import type { DocumentState } from '@embedpdf/core'
import { PdfErrorCode } from '@embedpdf/models'
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue'
import { DocumentContent } from '@embedpdf/plugin-document-manager/vue'
import { usePan } from '@embedpdf/plugin-pan/vue'
import { useRotate } from '@embedpdf/plugin-rotate/vue'
import { ScrollStrategy, useScroll, useScrollCapability } from '@embedpdf/plugin-scroll/vue'
import { useSelectionCapability } from '@embedpdf/plugin-selection/vue'
import { SpreadMode, useSpread } from '@embedpdf/plugin-spread/vue'
import { ZoomMode, useZoom, type ZoomLevel } from '@embedpdf/plugin-zoom/vue'
import type { PdfReaderSettings } from '@bookorbit/types'
import { useFullscreen } from '../../shared/composables/useFullscreen'
import PdfDocumentViewport from './PdfDocumentViewport.vue'
import PdfPasswordPrompt from './PdfPasswordPrompt.vue'
import PdfReaderSettingsPanel from './PdfReaderSettingsPanel.vue'
import PdfReaderSidebar, { type PdfSidebarTab } from './PdfReaderSidebar.vue'
import PdfReaderToolbar from './PdfReaderToolbar.vue'
import { fromRotation, safeExternalPdfUrl } from '../pdf-viewer-utils'
import { usePdfFullscreenChrome } from '../composables/usePdfFullscreenChrome'
import { usePdfPagination } from '../composables/usePdfPagination'
import { usePdfResponsiveSpread } from '../composables/usePdfResponsiveSpread'

const props = defineProps<{
  documentId: string
  initialPage: number
  settings: PdfReaderSettings
  peekMode?: boolean
}>()

const emit = defineEmits<{
  back: []
  pageChange: [pageNumber: number, totalPages: number]
  retry: []
  settingsChange: [patch: Partial<PdfReaderSettings>]
  startReading: []
}>()

const { state: scrollState, provides: scroll } = useScroll(() => props.documentId)
const { provides: scrollCapability } = useScrollCapability()
const { state: zoomState, provides: zoom } = useZoom(() => props.documentId)
const { provides: spread } = useSpread(() => props.documentId)
const { rotation, provides: rotate } = useRotate(() => props.documentId)
const { isPanning, provides: pan } = usePan(() => props.documentId)
const { provides: selectionCapability } = useSelectionCapability()
const { provides: annotationCapability } = useAnnotationCapability()
const { isFullscreen, isFullscreenSupported, toggleFullscreen } = useFullscreen()

const sidebarOpen = ref(false)
const sidebarTab = ref<PdfSidebarTab>('thumbnails')
const settingsOpen = ref(false)
const pendingExternalUrl = ref<URL | null>(null)
const restoredInitialPage = ref(false)
const viewerSurface = ref<HTMLElement | null>(null)
const currentScrollMode = ref<PdfReaderSettings['scrollMode']>(props.settings.scrollMode)
const currentSpreadPreference = ref<PdfReaderSettings['spread']>(props.settings.spread)
let previewingZoom = false
const zoomPercent = computed(() => Math.round(zoomState.value.currentZoomLevel * 100))
const currentZoomMode = computed<PdfReaderSettings['zoomMode']>(() => {
  if (zoomState.value.zoomLevel === ZoomMode.FitPage) return 'fit-page'
  if (zoomState.value.zoomLevel === ZoomMode.FitWidth) return 'fit-width'
  if (zoomState.value.zoomLevel === ZoomMode.Automatic) return 'automatic'
  return 'custom'
})
const currentRotation = computed(() => fromRotation(rotation.value))
const externalHost = computed(() => pendingExternalUrl.value?.hostname ?? '')
const searchOpen = computed(() => sidebarOpen.value && sidebarTab.value === 'search')
const hasOpenUi = computed(() => sidebarOpen.value || settingsOpen.value || pendingExternalUrl.value !== null)
const {
  pinned: headerPinned,
  visible: headerVisible,
  reveal: revealHeader,
  togglePinned: toggleHeaderPinned,
} = usePdfFullscreenChrome(isFullscreen, hasOpenUi)
const {
  pageRange,
  getPageRange,
  goToPage: handleGoToPage,
  previousPage: handlePreviousPage,
  nextPage: handleNextPage,
  handleWheel: handleViewportWheel,
  handleTouchStart,
  handleTouchEnd,
} = usePdfPagination({
  mode: currentScrollMode,
  scrollState,
  scroll,
  onActivity: revealHeader,
})
const { apply: applyResponsiveSpread } = usePdfResponsiveSpread(viewerSurface, currentSpreadPreference, spread)

function handleBack() {
  emit('back')
}

function handleZoomOut() {
  zoom.value?.zoomOut()
}

function handleZoomIn() {
  zoom.value?.zoomIn()
}

function handleToggleSidebar() {
  if (sidebarOpen.value && sidebarTab.value !== 'search') {
    sidebarOpen.value = false
    return
  }
  sidebarTab.value = 'thumbnails'
  sidebarOpen.value = true
}

function handleToggleSearch() {
  if (sidebarOpen.value && sidebarTab.value === 'search') {
    sidebarOpen.value = false
    return
  }
  sidebarTab.value = 'search'
  sidebarOpen.value = true
}

function handleSidebarClose() {
  sidebarOpen.value = false
}

function handleSidebarTab(tab: PdfSidebarTab) {
  sidebarTab.value = tab
}

function handleTogglePan() {
  pan.value?.togglePan()
}

function handleSelectTool() {
  pan.value?.disablePan()
}

function handleSettingsOpen(open: boolean) {
  settingsOpen.value = open
}

function handleStartReading() {
  emit('startReading')
}

function handleScrollMode(mode: PdfReaderSettings['scrollMode']) {
  currentScrollMode.value = mode
  scroll.value?.setScrollStrategy(mode === 'horizontal' ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical)
  emit('settingsChange', { scrollMode: mode })
  handleGoToPage(pageRange.value.start)
}

function handleSpread(mode: PdfReaderSettings['spread']) {
  currentSpreadPreference.value = mode
  emit('settingsChange', { spread: mode })
  if (mode === 'auto') applyResponsiveSpread()
  else spread.value?.setSpreadMode(mode === 'odd' ? SpreadMode.Odd : mode === 'even' ? SpreadMode.Even : SpreadMode.None)
}

function handleZoom(mode: PdfReaderSettings['zoomMode'], scale?: number) {
  let value: ZoomLevel = ZoomMode.FitPage
  if (mode === 'fit-width') value = ZoomMode.FitWidth
  if (mode === 'automatic') value = ZoomMode.Automatic
  if (mode === 'custom') value = scale ?? zoomState.value.currentZoomLevel
  zoom.value?.requestZoom(value)
}

function handleZoomPreview(scale: number) {
  previewingZoom = true
  try {
    zoom.value?.requestZoom(scale)
  } finally {
    previewingZoom = false
  }
}

function handleRotateBackward() {
  rotate.value?.rotateBackward()
}

function handleRotateForward() {
  rotate.value?.rotateForward()
}

function handleCancelExternalLink() {
  pendingExternalUrl.value = null
}

function handleOpenExternalLink() {
  const url = pendingExternalUrl.value
  pendingExternalUrl.value = null
  if (url) window.open(url.href, '_blank', 'noopener,noreferrer')
}

function handleRetryDocument() {
  emit('retry')
}

function hasDocumentPages(documentState: DocumentState) {
  return (documentState.document?.pageCount ?? 0) > 0
}

function handleReaderActivity() {
  revealHeader()
}

function handleKeydown(event: KeyboardEvent) {
  revealHeader()
  const target = event.target as HTMLElement | null
  const editing = target?.matches('input, textarea, select, button, a, [role="button"], [role="menuitem"], [contenteditable="true"]') === true

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault()
    handleToggleSearch()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c' && !editing) {
    selectionCapability.value?.forDocument(props.documentId).copyToClipboard()
    return
  }
  if (editing) return

  if (event.key === 'Escape') {
    if (pendingExternalUrl.value) handleCancelExternalLink()
    else if (sidebarOpen.value) handleSidebarClose()
    return
  }
  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault()
    handlePreviousPage()
  } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
    event.preventDefault()
    handleNextPage()
  } else if (event.key === 'Home') {
    event.preventDefault()
    handleGoToPage(1)
  } else if (event.key === 'End') {
    event.preventDefault()
    handleGoToPage(scrollState.value.totalPages)
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    handleZoomIn()
  } else if (event.key === '-') {
    event.preventDefault()
    handleZoomOut()
  } else if (event.key === '0') {
    event.preventDefault()
    handleZoom(currentZoomMode.value === 'custom' ? 'fit-page' : currentZoomMode.value)
  }
}

watch(
  () => props.settings.scrollMode,
  (mode) => {
    currentScrollMode.value = mode
  },
)

watch(
  () => props.settings.spread,
  (mode) => {
    currentSpreadPreference.value = mode
    if (mode === 'auto') applyResponsiveSpread()
  },
)

watch(
  scrollCapability,
  (capability, _previous, onCleanup) => {
    if (!capability) return
    const unsubscribeLayout = capability.onLayoutReady((event) => {
      if (event.documentId !== props.documentId || !event.isInitial || restoredInitialPage.value) return
      const page = Math.min(Math.max(props.initialPage, 1), event.totalPages || 1)
      restoredInitialPage.value = true
      if (page > 1) scroll.value?.scrollToPage({ pageNumber: page })
    })
    const unsubscribePage = capability.onPageChange((event) => {
      if (event.documentId !== props.documentId || !restoredInitialPage.value) return
      const range = getPageRange(event.pageNumber, event.totalPages)
      emit('pageChange', range.end, event.totalPages)
    })
    onCleanup(() => {
      unsubscribeLayout()
      unsubscribePage()
    })
  },
  { immediate: true },
)

watch(
  zoom,
  (scope, _previous, onCleanup) => {
    if (!scope) return
    const unsubscribe = scope.onZoomChange((event) => {
      if (previewingZoom) return
      if (event.level === ZoomMode.FitPage) emit('settingsChange', { zoomMode: 'fit-page' })
      else if (event.level === ZoomMode.FitWidth) emit('settingsChange', { zoomMode: 'fit-width' })
      else if (event.level === ZoomMode.Automatic) emit('settingsChange', { zoomMode: 'automatic' })
      else emit('settingsChange', { zoomMode: 'custom', customScale: event.newZoom })
    })
    onCleanup(unsubscribe)
  },
  { immediate: true },
)

watch(
  spread,
  (scope, _previous, onCleanup) => {
    if (!scope) return
    const unsubscribe = scope.onSpreadChange((mode) => {
      if (currentSpreadPreference.value === 'auto') return
      emit('settingsChange', { spread: mode === SpreadMode.Odd ? 'odd' : mode === SpreadMode.Even ? 'even' : 'none' })
    })
    onCleanup(unsubscribe)
  },
  { immediate: true },
)

watch(
  rotate,
  (scope, _previous, onCleanup) => {
    if (!scope) return
    const unsubscribe = scope.onRotateChange((value) => emit('settingsChange', { rotation: fromRotation(value) }))
    onCleanup(unsubscribe)
  },
  { immediate: true },
)

watch(
  annotationCapability,
  (capability, _previous, onCleanup) => {
    if (!capability) return
    const unsubscribe = capability.forDocument(props.documentId).onNavigate((event) => {
      if (event.result.outcome !== 'uri') return
      pendingExternalUrl.value = safeExternalPdfUrl(event.result.uri)
    })
    onCleanup(unsubscribe)
  },
  { immediate: true },
)

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background" @mousemove="handleReaderActivity" @pointerdown="handleReaderActivity">
    <PdfReaderToolbar
      v-show="headerVisible"
      :current-page-start="pageRange.start"
      :current-page-end="pageRange.end"
      :total-pages="scrollState.totalPages"
      :zoom-percent="zoomPercent"
      :sidebar-open="sidebarOpen"
      :search-open="searchOpen"
      :settings-open="settingsOpen"
      :pan-active="isPanning"
      :fullscreen="isFullscreen"
      :fullscreen-supported="isFullscreenSupported"
      :header-pinned="headerPinned"
      :peek-mode="props.peekMode"
      @back="handleBack"
      @previous-page="handlePreviousPage"
      @next-page="handleNextPage"
      @go-to-page="handleGoToPage"
      @zoom-out="handleZoomOut"
      @zoom-in="handleZoomIn"
      @toggle-sidebar="handleToggleSidebar"
      @toggle-search="handleToggleSearch"
      @toggle-pan="handleTogglePan"
      @select-tool="handleSelectTool"
      @toggle-fullscreen="toggleFullscreen"
      @toggle-header-pin="toggleHeaderPinned"
      @update:settings-open="handleSettingsOpen"
      @start-reading="handleStartReading"
    >
      <template #settings>
        <PdfReaderSettingsPanel
          :scroll-mode="currentScrollMode"
          :spread="currentSpreadPreference"
          :rotation="currentRotation"
          :zoom-mode="currentZoomMode"
          :custom-scale="zoomState.currentZoomLevel"
          @preview-zoom="handleZoomPreview"
          @set-scroll-mode="handleScrollMode"
          @set-spread="handleSpread"
          @set-zoom="handleZoom"
          @rotate-backward="handleRotateBackward"
          @rotate-forward="handleRotateForward"
        />
      </template>
    </PdfReaderToolbar>

    <div class="relative flex min-h-0 flex-1 overflow-hidden">
      <PdfReaderSidebar
        v-if="sidebarOpen"
        :document-id="props.documentId"
        :active-tab="sidebarTab"
        :header-visible="headerVisible"
        @close="handleSidebarClose"
        @update:active-tab="handleSidebarTab"
      />

      <div
        ref="viewerSurface"
        class="relative min-w-0 flex-1 overflow-hidden"
        @wheel="handleViewportWheel"
        @touchstart="handleTouchStart"
        @touchend="handleTouchEnd"
      >
        <DocumentContent :document-id="props.documentId">
          <template #default="{ documentState, isLoading, isError, isLoaded }">
            <div v-if="isLoading" class="absolute inset-0 flex items-center justify-center bg-background">
              <div class="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
                <LoaderCircle :size="28" class="animate-spin text-primary" />
                <span class="text-sm">Loading PDF</span>
              </div>
            </div>
            <PdfPasswordPrompt
              v-else-if="isError && documentState.errorCode === PdfErrorCode.Password"
              :document-state="documentState"
              @back="handleBack"
            />
            <div v-else-if="isError" class="absolute inset-0 flex items-center justify-center p-6">
              <div class="max-w-sm text-center">
                <AlertTriangle :size="30" class="mx-auto mb-3 text-destructive" />
                <p class="mb-2 text-sm font-medium text-foreground">Unable to open this PDF</p>
                <p class="text-xs text-muted-foreground">{{ documentState.error || 'The document could not be loaded.' }}</p>
                <div class="mt-4 flex justify-center gap-2">
                  <button
                    class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    @click="handleBack"
                  >
                    Go back
                  </button>
                  <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetryDocument">
                    Retry
                  </button>
                </div>
              </div>
            </div>
            <div v-else-if="isLoaded && !hasDocumentPages(documentState)" class="absolute inset-0 flex items-center justify-center p-6">
              <div class="max-w-sm text-center">
                <AlertTriangle :size="30" class="mx-auto mb-3 text-destructive" />
                <p class="mb-2 text-sm font-medium text-foreground">This PDF opened without any pages</p>
                <p class="text-xs text-muted-foreground">Reload the document to recover from the incomplete PDF engine response.</p>
                <div class="mt-4 flex justify-center gap-2">
                  <button
                    class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    @click="handleBack"
                  >
                    Go back
                  </button>
                  <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetryDocument">
                    Retry
                  </button>
                </div>
              </div>
            </div>
            <PdfDocumentViewport v-else-if="isLoaded" :document-id="props.documentId" />
          </template>
        </DocumentContent>
      </div>
    </div>

    <div v-if="pendingExternalUrl" class="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div class="w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-2xl">
        <div class="mb-4 flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><ExternalLink :size="18" /></div>
          <div class="min-w-0">
            <h2 class="font-serif text-base font-semibold">Open external link?</h2>
            <p class="mt-1 text-xs text-muted-foreground">This PDF wants to open {{ externalHost }} in a new tab.</p>
            <p class="mt-2 truncate rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">{{ pendingExternalUrl.href }}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            @click="handleCancelExternalLink"
          >
            Cancel
          </button>
          <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleOpenExternalLink">
            Open link
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
