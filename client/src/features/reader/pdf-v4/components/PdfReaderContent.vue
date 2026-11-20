<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, ExternalLink, LoaderCircle } from '@lucide/vue'
import { DocumentGate, useDocument } from '@embedpdf/vue/runtime'
import { SelectionMenu } from '@embedpdf/vue/selection'
import { useStage, useStageEvent, useStageState, type StageCapability, type StageSettings, type StageSettingsChangedEvent } from '@embedpdf/vue/stage'
import type { AnnotationItem, PdfReaderSettings } from '@bookorbit/types'
import { useFullscreen } from '../../shared/composables/useFullscreen'
import PdfDocumentViewport from './PdfDocumentViewport.vue'
import PdfPasswordPrompt from './PdfPasswordPrompt.vue'
import PdfReaderSettingsPanel from './PdfReaderSettingsPanel.vue'
import PdfReaderSidebar from './PdfReaderSidebar.vue'
import PdfReaderToolbar from './PdfReaderToolbar.vue'
import { toPageRange } from '../pdf-pagination'
import { fromStageZoom, fromStageZoomMode, pdfStageRules, toStageFlow, toStageSpread } from '../pdf-viewer-utils'
import { usePdfFullscreenChrome } from '../composables/usePdfFullscreenChrome'
import { usePdfHighlights } from '../composables/usePdfHighlights'
import { usePdfInteractionMode } from '../composables/usePdfInteractionMode'
import { usePdfSidebarLayout, type PdfSidebarTab } from '../composables/usePdfSidebarLayout'
import NoteDialog from '../../shared/components/NoteDialog.vue'
import PdfSelectionPopup from './PdfSelectionPopup.vue'

const props = defineProps<{
  bookId: number
  fileId: number
  initialPage: number | null
  initialPercentage?: number
  settings: PdfReaderSettings
  peekMode?: boolean
}>()

const { t } = useI18n()

const emit = defineEmits<{
  back: []
  pageChange: [pageNumber: number, totalPages: number, restored: boolean]
  retry: []
  settingsChange: [patch: Partial<PdfReaderSettings>]
  startReading: []
}>()

const stage = useStage()
const { zoomLevel, zoomMode, currentPageIndex, pageCount, viewRotation } = useStageState()
const documentStatus = useDocument((document) => document.status)
const documentPageCount = useDocument((document) => document.pageCount)
const { isPanning, togglePan, activateTextSelection } = usePdfInteractionMode()
const { isFullscreen, isFullscreenSupported, toggleFullscreen } = useFullscreen()

const sidebar = usePdfSidebarLayout()
const settingsOpen = ref(false)
const pendingExternalUrl = ref<URL | null>(null)
const currentScrollMode = ref<PdfReaderSettings['scrollMode']>(props.settings.scrollMode)
const currentSpreadPreference = ref<PdfReaderSettings['spread']>(props.settings.spread)
const currentPageIndexes = ref<number[]>([])
let initialPageRestored = false
let restoringPage: number | null = null
let previewingZoom = false

const pageRange = computed(() => toPageRange(currentPageIndexes.value, currentPageIndex.value + 1, pageCount.value))
const zoomPercent = computed(() => Math.round(zoomLevel.value * 100))
const currentZoomMode = computed(() => fromStageZoomMode(zoomMode.value))
const externalHost = computed(() => pendingExternalUrl.value?.hostname ?? '')
const hasOpenUi = computed(() => sidebar.open.value || settingsOpen.value || pendingExternalUrl.value !== null)
const {
  pinned: headerPinned,
  visible: headerVisible,
  reveal: revealHeader,
  togglePinned: toggleHeaderPinned,
} = usePdfFullscreenChrome(isFullscreen, hasOpenUi)
const highlights = usePdfHighlights({ bookId: props.bookId, fileId: props.fileId })

// Every Stage call throws while no document is open: a button pressed during opening does nothing.
function withStage(action: (capability: StageCapability) => void) {
  try {
    action(stage)
  } catch {
    return
  }
}

function refreshPageRange() {
  try {
    currentPageIndexes.value = stage.listCurrentPages().map((page) => page.index)
  } catch {
    currentPageIndexes.value = []
  }
}

function handleBack() {
  emit('back')
}

function handlePreviousPage() {
  revealHeader()
  withStage((capability) => capability.previousPage())
}

function handleNextPage() {
  revealHeader()
  withStage((capability) => capability.nextPage())
}

function handleGoToPage(page: number) {
  const clamped = Math.min(Math.max(page, 1), pageCount.value || 1)
  withStage((capability) => capability.goToPage(clamped - 1))
}

function handleSelectPage(pageIndex: number) {
  handleGoToPage(pageIndex + 1)
}

function handleZoomOut() {
  withStage((capability) => capability.zoomOut())
}

function handleZoomIn() {
  withStage((capability) => capability.zoomIn())
}

function handleToggleSidebar() {
  sidebar.setOpen(!sidebar.open.value)
}

function handleSidebarClose() {
  sidebar.close()
}

function handleSidebarTab(tab: PdfSidebarTab) {
  sidebar.selectTab(tab)
}

function handleSidebarWidth(width: number) {
  sidebar.setWidth(width)
}

function handleTogglePan() {
  togglePan()
}

function handleSelectTool() {
  activateTextSelection()
}

function handleSettingsOpen(open: boolean) {
  settingsOpen.value = open
}

function handleStartReading() {
  emit('startReading')
}

function handleHighlightAction(color: string, style: string) {
  void highlights.applyHighlight(color, style)
}

function handleHighlightNote() {
  highlights.openNoteDialog()
}

function handleHighlightNoteText(value: string) {
  highlights.noteText.value = value
}

function handleHighlightSaveNote(note: string) {
  void highlights.saveNote(note)
}

function handleHighlightCancelNote() {
  highlights.cancelNoteDialog()
}

function handleHighlightDismiss() {
  highlights.dismissPopup()
}

function handleNavigateHighlight(annotation: AnnotationItem) {
  highlights.navigateTo(annotation)
  if (sidebar.layout.value === 'sheet') sidebar.close()
}

function handleDeleteHighlight(id: number) {
  void highlights.deleteAnnotation(id)
}

function handleRetryHighlights() {
  void highlights.retryLoad()
}

function handleLoadMoreHighlights() {
  void highlights.loadMore()
}

function handleScrollMode(mode: PdfReaderSettings['scrollMode']) {
  currentScrollMode.value = mode
  withStage((capability) => capability.updateSettings(toStageFlow(mode)))
  emit('settingsChange', { scrollMode: mode })
}

function handleSpread(mode: PdfReaderSettings['spread']) {
  currentSpreadPreference.value = mode
  withStage((capability) => {
    capability.setResponsiveRules(pdfStageRules(mode))
    capability.updateSettings({ spread: toStageSpread(mode) })
  })
  emit('settingsChange', { spread: mode })
}

function handleZoom(mode: PdfReaderSettings['zoomMode'], scale?: number) {
  withStage((capability) => {
    if (mode === 'fit-width') capability.fitWidth()
    else if (mode === 'automatic') capability.fitAutomatic()
    else if (mode === 'custom') capability.zoomTo(scale ?? zoomLevel.value)
    else capability.fitPage()
    // A slider commit lands on the level its preview already set, which changes no setting.
    saveZoom(capability.getSettings().zoom)
  })
}

function handleZoomPreview(scale: number) {
  previewingZoom = true
  try {
    withStage((capability) => capability.zoomTo(scale))
  } finally {
    previewingZoom = false
  }
}

function rotateView(delta: 90 | -90) {
  withStage((capability) => {
    capability.rotateViewBy(delta)
    emit('settingsChange', { rotation: capability.getViewRotation() })
  })
}

function handleRotateBackward() {
  rotateView(-90)
}

function handleRotateForward() {
  rotateView(90)
}

function handleExternalLink(url: URL) {
  pendingExternalUrl.value = url
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

// A percentage without a page number was written by a client that tracks no pages, so the page
// is estimated from it the way the iOS reader does.
function resolveInitialPage(totalPages: number) {
  const total = Math.max(totalPages, 1)
  const percentage = props.initialPercentage ?? 0
  let page = 1
  if (props.initialPage !== null) page = props.initialPage
  else if (Number.isFinite(percentage) && percentage > 0) page = Math.round((percentage / 100) * total)
  return Math.min(Math.max(page, 1), total)
}

// The Stage opens wherever the last navigation before it showed asked for, without scrolling
// there, so the saved page is requested as soon as the document is ready.
function restoreInitialPage() {
  if (initialPageRestored) return
  initialPageRestored = true
  const page = resolveInitialPage(documentPageCount.value)
  restoringPage = page
  if (page > 1) withStage((capability) => capability.goToPage(page - 1, { behavior: 'instant' }))
  refreshPageRange()
}

function handlePageChanged() {
  refreshPageRange()
  if (!initialPageRestored) return
  const range = pageRange.value
  const restored = restoringPage !== null && range.start <= restoringPage && restoringPage <= range.end
  restoringPage = null
  emit('pageChange', range.end, pageCount.value, restored)
}

function saveZoom(zoom: StageSettings['zoom']) {
  const patch = fromStageZoom(zoom)
  if (!patch) return
  const { zoomMode, customScale } = props.settings
  if (patch.zoomMode === zoomMode && (zoomMode !== 'custom' || patch.customScale === customScale)) return
  emit('settingsChange', patch)
}

// The zoom setting, not onZoomChanged: a step zoom moves the camera before it turns a fit mode
// into a level, so the zoom event still names the fit mode.
function handleStageSettingsChanged(event: StageSettingsChangedEvent) {
  refreshPageRange()
  if (!previewingZoom && event.changedKeys.includes('zoom')) saveZoom(event.settings.zoom)
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
    sidebar.selectTab('search')
    return
  }
  if (editing) return

  if (event.key === 'Escape') {
    if (pendingExternalUrl.value) handleCancelExternalLink()
    else if (sidebar.open.value) handleSidebarClose()
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
    handleGoToPage(pageCount.value)
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

useStageEvent((capability) => capability.onPageChanged, handlePageChanged)
useStageEvent((capability) => capability.onZoomChanged, refreshPageRange)
useStageEvent((capability) => capability.onSettingsChanged, handleStageSettingsChanged)

watch(
  documentStatus,
  (status) => {
    if (status === 'ready') restoreInitialPage()
  },
  { immediate: true },
)

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
  },
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
      :total-pages="pageCount"
      :zoom-percent="zoomPercent"
      :sidebar-open="sidebar.open.value"
      :show-sidebar-toggle="sidebar.layout.value === 'sheet'"
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
          :rotation="viewRotation"
          :zoom-mode="currentZoomMode"
          :custom-scale="zoomLevel"
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
        :active-tab="sidebar.activeTab.value"
        :open="sidebar.open.value"
        :layout="sidebar.layout.value"
        :width="sidebar.width.value"
        :current-page="currentPageIndex + 1"
        :total-pages="pageCount"
        :annotations="highlights.annotations.value"
        :load-error="highlights.loadError.value"
        :loading="highlights.loading.value"
        :loading-more="highlights.loadingMore.value"
        :has-more="highlights.hasMore.value"
        @close="handleSidebarClose"
        @update:active-tab="handleSidebarTab"
        @update:width="handleSidebarWidth"
        @select-page="handleSelectPage"
        @navigate-highlight="handleNavigateHighlight"
        @delete-highlight="handleDeleteHighlight"
        @retry-highlights="handleRetryHighlights"
        @load-more-highlights="handleLoadMoreHighlights"
      />

      <div class="relative min-w-0 flex-1 overflow-hidden" @wheel.passive="handleReaderActivity">
        <DocumentGate>
          <template #fallback>
            <div class="absolute inset-0 flex items-center justify-center bg-background">
              <div class="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
                <LoaderCircle :size="28" class="animate-spin text-primary" />
                <span class="text-sm">{{ t('reader.pdf.loading') }}</span>
              </div>
            </div>
          </template>
          <template #locked="{ document }">
            <PdfPasswordPrompt :document="document" @back="handleBack" />
          </template>
          <template #error="{ document }">
            <div class="absolute inset-0 flex items-center justify-center p-6">
              <div class="max-w-sm text-center">
                <AlertTriangle :size="30" class="mx-auto mb-3 text-destructive" />
                <p class="mb-2 text-sm font-medium text-foreground">{{ t('reader.pdf.openError') }}</p>
                <p class="text-xs text-muted-foreground">{{ document.error.message || t('reader.pdf.loadFallback') }}</p>
                <div class="mt-4 flex justify-center gap-2">
                  <button
                    class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    @click="handleBack"
                  >
                    {{ t('reader.header.goBack') }}
                  </button>
                  <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetryDocument">
                    {{ t('reader.retry') }}
                  </button>
                </div>
              </div>
            </div>
          </template>
          <div v-if="documentPageCount === 0" class="absolute inset-0 flex items-center justify-center p-6">
            <div class="max-w-sm text-center">
              <AlertTriangle :size="30" class="mx-auto mb-3 text-destructive" />
              <p class="mb-2 text-sm font-medium text-foreground">{{ t('reader.pdf.noPages') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('reader.pdf.noPagesHint') }}</p>
              <div class="mt-4 flex justify-center gap-2">
                <button
                  class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                  @click="handleBack"
                >
                  {{ t('reader.header.goBack') }}
                </button>
                <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetryDocument">
                  {{ t('reader.retry') }}
                </button>
              </div>
            </div>
          </div>
          <PdfDocumentViewport v-else :annotations="highlights.annotations.value" @external-link="handleExternalLink">
            <template #overlay>
              <SelectionMenu placement="top" :gap="8">
                <PdfSelectionPopup
                  :visible="highlights.popupVisible.value"
                  :selected-text="highlights.selectedText.value"
                  :overlapping-annotation-id="highlights.overlappingAnnotationId.value"
                  :disabled="highlights.isSaving.value"
                  @highlight="handleHighlightAction"
                  @note="handleHighlightNote"
                  @delete-annotation="handleDeleteHighlight"
                  @dismiss="handleHighlightDismiss"
                />
              </SelectionMenu>
            </template>
          </PdfDocumentViewport>
        </DocumentGate>
      </div>
    </div>

    <div v-if="pendingExternalUrl" class="fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-4">
      <div class="w-full max-w-md rounded-xl border border-border bg-card p-5 text-card-foreground shadow-2xl">
        <div class="mb-4 flex items-start gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><ExternalLink :size="18" /></div>
          <div class="min-w-0">
            <h2 class="font-serif text-base font-semibold">{{ t('reader.pdf.externalLinkTitle') }}</h2>
            <p class="mt-1 text-xs text-muted-foreground">{{ t('reader.pdf.externalLinkDescription', { host: externalHost }) }}</p>
            <p class="mt-2 truncate rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">{{ pendingExternalUrl.href }}</p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            @click="handleCancelExternalLink"
          >
            {{ t('common.cancel') }}
          </button>
          <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleOpenExternalLink">
            {{ t('reader.pdf.openLink') }}
          </button>
        </div>
      </div>
    </div>

    <NoteDialog
      v-if="highlights.showNoteDialog.value"
      :selectedText="highlights.selectedText.value"
      :modelValue="highlights.noteText.value"
      :saving="highlights.isSaving.value"
      @update:modelValue="handleHighlightNoteText"
      @save="handleHighlightSaveNote"
      @cancel="handleHighlightCancelNote"
    />
  </div>
</template>
