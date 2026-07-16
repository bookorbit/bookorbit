<script setup lang="ts">
import { computed, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { EmbedPDF } from '@embedpdf/core/vue'
import { createPluginRegistration, type PluginBatchRegistrations, type PluginRegistry } from '@embedpdf/core'
import { usePdfiumEngine } from '@embedpdf/engines/vue'
import pdfiumWasmUrl from '@embedpdf/pdfium/pdfium.wasm?url'
import { LockModeType } from '@embedpdf/plugin-annotation'
import { AnnotationPluginPackage } from '@embedpdf/plugin-annotation/vue'
import { BookmarkPluginPackage } from '@embedpdf/plugin-bookmark/vue'
import { DocumentManagerPlugin, DocumentManagerPluginPackage } from '@embedpdf/plugin-document-manager/vue'
import { HistoryPluginPackage } from '@embedpdf/plugin-history/vue'
import { InteractionManagerPluginPackage } from '@embedpdf/plugin-interaction-manager/vue'
import { PanPluginPackage } from '@embedpdf/plugin-pan/vue'
import { RenderPluginPackage } from '@embedpdf/plugin-render/vue'
import { RotatePluginPackage } from '@embedpdf/plugin-rotate/vue'
import { ScrollPluginPackage } from '@embedpdf/plugin-scroll/vue'
import { SearchPluginPackage } from '@embedpdf/plugin-search/vue'
import { SelectionPluginPackage } from '@embedpdf/plugin-selection/vue'
import { SpreadPluginPackage } from '@embedpdf/plugin-spread/vue'
import { ThumbnailPluginPackage } from '@embedpdf/plugin-thumbnail/vue'
import { TilingPluginPackage } from '@embedpdf/plugin-tiling/vue'
import { ViewportPluginPackage } from '@embedpdf/plugin-viewport/vue'
import { ZoomPluginPackage } from '@embedpdf/plugin-zoom/vue'
import { LoaderCircle } from '@lucide/vue'
import type { PdfReaderSettings } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import PdfReaderContent from './components/PdfReaderContent.vue'
import { toRotation, toScrollStrategy, toSpreadMode, toZoomLevel } from './pdf-viewer-utils'

const { t } = useI18n()

const props = defineProps<{ bookId: number; fileId: number; peekMode?: boolean }>()
const route = useRoute()
const router = useRouter()
const trackingEnabled = computed(() => !props.peekMode)

const bookSettings = useReaderSettings(props.fileId, 'pdf')
const effectiveSettings = computed(() => bookSettings.effective.value as PdfReaderSettings)
const { onActivity, elapsedMinutes } = useReadingSession(
  props.fileId,
  () => ({
    percentage: progress.percentage.value,
    pageNumber: progress.pageNumber.value,
  }),
  { trackingEnabled },
)
const progress = useReaderProgress(props.bookId, props.fileId, elapsedMinutes, 0, { trackingEnabled })
const absolutePdfiumWasmUrl = new URL(pdfiumWasmUrl, window.location.href).href

const {
  engine,
  isLoading: engineLoading,
  error: engineError,
} = usePdfiumEngine({
  wasmUrl: absolutePdfiumWasmUrl,
  worker: true,
})
const plugins = shallowRef<PluginBatchRegistrations>([])
const documentBuffer = shallowRef<ArrayBuffer | null>(null)
const readerReady = shallowRef(false)
const documentError = shallowRef<Error | null>(null)
const initialPage = shallowRef(1)
let saveTimer: ReturnType<typeof setTimeout> | null = null
let settingsTimer: ReturnType<typeof setTimeout> | null = null
let documentAbortController: AbortController | null = null
let loadSequence = 0
let pendingPageUpdate: { pageNumber: number; totalPages: number } | null = null
let pendingSettingsPatch: Partial<PdfReaderSettings> | null = null

function parseDeepLinkPage(): number | null {
  const value = Array.isArray(route.query.page) ? route.query.page[0] : route.query.page
  if (typeof value !== 'string') return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null
}

function buildPlugins(settings: PdfReaderSettings): PluginBatchRegistrations {
  return [
    createPluginRegistration(DocumentManagerPluginPackage, {
      maxDocuments: 1,
    }),
    createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
    createPluginRegistration(ScrollPluginPackage, {
      defaultStrategy: toScrollStrategy(settings.scrollMode),
      defaultPageGap: 12,
      defaultBufferSize: 3,
    }),
    createPluginRegistration(InteractionManagerPluginPackage),
    createPluginRegistration(ZoomPluginPackage, {
      defaultZoomLevel: toZoomLevel(settings),
      minZoom: 0.25,
      maxZoom: 4,
    }),
    createPluginRegistration(PanPluginPackage, { defaultMode: 'mobile' }),
    createPluginRegistration(SpreadPluginPackage, { defaultSpreadMode: toSpreadMode(settings.spread) }),
    createPluginRegistration(RotatePluginPackage, { defaultRotation: toRotation(settings.rotation) }),
    createPluginRegistration(RenderPluginPackage),
    createPluginRegistration(TilingPluginPackage, {
      tileSize: 768,
      overlapPx: 2.5,
      extraRings: 0,
    }),
    createPluginRegistration(SelectionPluginPackage, { marquee: { enabled: false } }),
    createPluginRegistration(SearchPluginPackage),
    createPluginRegistration(HistoryPluginPackage),
    createPluginRegistration(AnnotationPluginPackage, {
      autoOpenLinks: false,
      locked: { type: LockModeType.All },
    }),
    createPluginRegistration(ThumbnailPluginPackage, {
      width: 132,
      paddingY: 12,
    }),
    createPluginRegistration(BookmarkPluginPackage),
  ]
}

function applyPendingProgress() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!pendingPageUpdate) return false
  const { pageNumber, totalPages } = pendingPageUpdate
  pendingPageUpdate = null
  progress.pageNumber.value = pageNumber
  progress.percentage.value = totalPages > 0 ? (pageNumber / totalPages) * 100 : progress.percentage.value
  return true
}

function flushProgress() {
  if (applyPendingProgress()) void progress.save()
}

function handlePageChange(pageNumber: number, totalPages: number) {
  onActivity()
  pendingPageUpdate = { pageNumber, totalPages }
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushProgress, 2000)
}

function flushSettings() {
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = null
  if (!pendingSettingsPatch) return
  const patch = pendingSettingsPatch
  pendingSettingsPatch = null
  bookSettings.updateBookSettings(patch)
}

function handleSettingsChange(patch: Partial<PdfReaderSettings>) {
  pendingSettingsPatch = { ...pendingSettingsPatch, ...patch }
  if (settingsTimer) clearTimeout(settingsTimer)
  settingsTimer = setTimeout(flushSettings, 200)
}

async function handleStartReading() {
  const query = { ...route.query }
  delete query.mode
  await router.replace({ name: 'reader', params: route.params, query })
  applyPendingProgress()
  await progress.save()
  onActivity()
}

function handleBack() {
  router.back()
}

async function loadReader() {
  const sequence = ++loadSequence
  documentAbortController?.abort()
  const abortController = new AbortController()
  documentAbortController = abortController
  documentError.value = null
  documentBuffer.value = null
  readerReady.value = false
  try {
    const [, , response] = await Promise.all([
      bookSettings.load(),
      progress.load(),
      api(`/api/v1/books/files/${props.fileId}/serve`, { signal: abortController.signal }),
    ])
    if (!response.ok) throw new Error(`The PDF request failed with status ${response.status}.`)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0) throw new Error('The PDF request returned an empty document.')
    if (sequence !== loadSequence || abortController.signal.aborted) return
    const settings = bookSettings.effective.value as PdfReaderSettings
    initialPage.value = parseDeepLinkPage() ?? progress.pageNumber.value ?? 1
    documentBuffer.value = buffer
    plugins.value = buildPlugins(settings)
    readerReady.value = true
  } catch (error) {
    if (sequence !== loadSequence || abortController.signal.aborted) return
    documentError.value = error instanceof Error ? error : new Error('The PDF could not be loaded.')
  } finally {
    if (documentAbortController === abortController) documentAbortController = null
  }
}

async function handleEmbedInitialized(registry: PluginRegistry) {
  const sequence = loadSequence
  const buffer = documentBuffer.value
  if (!buffer) return

  await registry.pluginsReady()
  if (sequence !== loadSequence || registry.isDestroyed()) return

  const documentManager = registry.getPlugin<DocumentManagerPlugin>(DocumentManagerPlugin.id)?.provides()
  if (!documentManager) {
    documentError.value = new Error('The PDF document manager could not be initialized.')
    return
  }

  let documentId: string | null = null
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const opened = await documentManager
        .openDocumentBuffer({
          buffer,
          name: 'PDF',
          rotation: toRotation(effectiveSettings.value.rotation),
        })
        .toPromise()
      documentId = opened.documentId
      const document = await opened.task.toPromise()
      if (sequence !== loadSequence || registry.isDestroyed()) return
      if (document.pageCount > 0) return

      await documentManager.closeDocument(opened.documentId).toPromise()
      if (sequence !== loadSequence || registry.isDestroyed()) return
    }

    documentError.value = new Error('The PDF engine opened this document without any pages.')
  } catch (error) {
    if (sequence !== loadSequence || registry.isDestroyed()) return
    if (documentId && documentManager.getDocumentState(documentId)?.status === 'error') return
    documentError.value = error instanceof Error ? error : new Error('The PDF could not be opened by the document engine.')
  }
}

function handleRetry() {
  if (engineError.value) {
    window.location.reload()
    return
  }
  void loadReader()
}

onMounted(loadReader)

onUnmounted(() => {
  loadSequence += 1
  documentAbortController?.abort()
  flushProgress()
  flushSettings()
})
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-background text-foreground">
    <div v-if="engineError || documentError" class="absolute inset-0 flex items-center justify-center p-6">
      <div class="max-w-sm text-center">
        <p class="mb-2 text-sm font-medium text-foreground">{{ t('reader.pdf.openError') }}</p>
        <p class="text-xs text-muted-foreground">{{ (engineError || documentError)?.message }}</p>
        <div class="mt-4 flex justify-center gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            @click="handleBack"
          >
            Go back
          </button>
          <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetry">
            {{ t('reader.retry') }}
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="engineLoading || !engine || !readerReady" class="absolute inset-0 flex items-center justify-center bg-background">
      <div class="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
        <LoaderCircle :size="30" class="animate-spin text-primary" />
        <span class="text-sm">{{ t('reader.pdf.preparing') }}</span>
      </div>
    </div>

    <EmbedPDF v-else :engine="engine" :plugins="plugins" :on-initialized="handleEmbedInitialized">
      <template #default="{ pluginsReady, activeDocumentId, activeDocument }">
        <div v-if="!pluginsReady || !activeDocumentId || !activeDocument" class="absolute inset-0 flex items-center justify-center bg-background">
          <div class="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
            <LoaderCircle :size="30" class="animate-spin text-primary" />
            <span class="text-sm">{{ t('reader.pdf.opening') }}</span>
          </div>
        </div>
        <PdfReaderContent
          v-else
          :document-id="activeDocumentId"
          :initial-page="initialPage"
          :settings="effectiveSettings"
          :peek-mode="props.peekMode"
          @back="handleBack"
          @page-change="handlePageChange"
          @retry="handleRetry"
          @settings-change="handleSettingsChange"
          @start-reading="handleStartReading"
        />
      </template>
    </EmbedPDF>
  </div>
</template>
