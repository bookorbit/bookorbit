<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUnmounted, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { interactionPlugin } from '@embedpdf/vue/interaction'
import { linkPlugin } from '@embedpdf/vue/link'
import { outlinePlugin } from '@embedpdf/vue/outline'
import { renderPlugin } from '@embedpdf/vue/render'
import { Viewer, type AnyPlugin, type InitialDocument } from '@embedpdf/vue/runtime'
import { searchPlugin } from '@embedpdf/vue/search'
import { selectionPlugin } from '@embedpdf/vue/selection'
import { stagePlugin } from '@embedpdf/vue/stage'
import { LoaderCircle } from '@lucide/vue'
import type { PdfReaderSettings } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import PdfReaderContent from './components/PdfReaderContent.vue'
import { createPdfEngine } from './pdf-engine'
import { pdfStageRules, toStageFlow, toStageRotation, toStageSpread, toStageZoom } from './pdf-viewer-utils'

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

const plugins = shallowRef<AnyPlugin[]>([])
const initialDocuments = shallowRef<InitialDocument[]>([])
const viewerKey = shallowRef(0)
const readerReady = shallowRef(false)
const documentError = shallowRef<Error | null>(null)
const initialPage = shallowRef<number | null>(null)
const initialPercentage = shallowRef(0)
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

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

function buildPlugins(settings: PdfReaderSettings): AnyPlugin[] {
  return [
    stagePlugin({
      ...toStageFlow(settings.scrollMode),
      spread: toStageSpread(settings.spread),
      zoom: toStageZoom(settings),
      minZoom: 0.25,
      maxZoom: 4,
      padding: 12,
      gap: { px: 12 },
      viewRotation: toStageRotation(settings.rotation),
      // One CSS pixel per PDF point, the scale saved custom zoom levels were written in.
      viewUnitsPerPoint: 1,
      scrollBehavior: prefersReducedMotion() ? 'instant' : 'smooth',
      scrollChaining: false,
      responsive: pdfStageRules(settings.spread),
    }),
    renderPlugin(),
    interactionPlugin(),
    selectionPlugin(),
    searchPlugin(),
    outlinePlugin(),
    linkPlugin(),
  ]
}

function setPosition(pageNumber: number, totalPages: number) {
  progress.pageNumber.value = pageNumber
  progress.percentage.value = totalPages > 0 ? (pageNumber / totalPages) * 100 : progress.percentage.value
}

function applyPendingProgress() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!pendingPageUpdate) return false
  const { pageNumber, totalPages } = pendingPageUpdate
  pendingPageUpdate = null
  setPosition(pageNumber, totalPages)
  return true
}

function flushProgress() {
  if (applyPendingProgress()) void progress.save()
}

function handlePageChange(pageNumber: number, totalPages: number, restored = false) {
  // Landing on the opening page is not a move: writing it back would replace another client's
  // percentage-only position with a snapped page, so it is only remembered for an explicit save.
  if (restored) {
    setPosition(pageNumber, totalPages)
    onActivity()
    return
  }
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

// Each load mounts a new viewer, which starts its own engine and opens the file once; the
// viewer reads its engine, plugins and documents only when it mounts.
async function loadReader() {
  const sequence = ++loadSequence
  documentAbortController?.abort()
  const abortController = new AbortController()
  documentAbortController = abortController
  documentError.value = null
  readerReady.value = false
  try {
    const [, , response] = await Promise.all([
      bookSettings.load(),
      progress.load(),
      api(`/api/v1/books/files/${props.fileId}/serve`, { signal: abortController.signal }),
    ])
    if (!response.ok) throw new Error(t('reader.pdf.requestFailed', { status: response.status }))
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0) throw new Error(t('reader.pdf.emptyDocument'))
    if (sequence !== loadSequence || abortController.signal.aborted) return
    const settings = bookSettings.effective.value as PdfReaderSettings
    const savedPage = progress.pageNumber.value
    initialPage.value = parseDeepLinkPage() ?? (savedPage !== null && savedPage > 0 ? savedPage : null)
    initialPercentage.value = progress.percentage.value
    initialDocuments.value = [{ source: { kind: 'bytes', bytes: new Uint8Array(buffer) }, name: 'PDF' }]
    plugins.value = buildPlugins(settings)
    viewerKey.value += 1
    readerReady.value = true
  } catch (error) {
    if (sequence !== loadSequence || abortController.signal.aborted) return
    documentError.value = error instanceof Error ? error : new Error(t('reader.pdf.loadFallback'))
  } finally {
    if (documentAbortController === abortController) documentAbortController = null
  }
}

function viewerErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : t('reader.pdf.engineOpenError')
}

function handleRetry() {
  void loadReader()
}

onMounted(loadReader)

// Before unmount, because useReadingSession ends the session from its own unmounted hook, which
// runs first and would otherwise miss a page turn still inside the save debounce.
onBeforeUnmount(flushProgress)

onUnmounted(() => {
  loadSequence += 1
  documentAbortController?.abort()
  flushSettings()
})
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-background text-foreground">
    <div v-if="documentError" class="absolute inset-0 flex items-center justify-center p-6">
      <div class="max-w-sm text-center">
        <p class="mb-2 text-sm font-medium text-foreground">{{ t('reader.pdf.openError') }}</p>
        <p class="text-xs text-muted-foreground">{{ documentError.message }}</p>
        <div class="mt-4 flex justify-center gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            @click="handleBack"
          >
            {{ t('reader.header.goBack') }}
          </button>
          <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetry">
            {{ t('reader.retry') }}
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="!readerReady" class="absolute inset-0 flex items-center justify-center bg-background">
      <div class="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
        <LoaderCircle :size="30" class="animate-spin text-primary" />
        <span class="text-sm">{{ t('reader.pdf.preparing') }}</span>
      </div>
    </div>

    <Viewer v-else :key="viewerKey" :engine="createPdfEngine" :plugins="plugins" :initial-documents="initialDocuments">
      <template #fallback>
        <div class="absolute inset-0 flex items-center justify-center bg-background">
          <div class="flex flex-col items-center gap-3 text-muted-foreground" role="status" aria-live="polite">
            <LoaderCircle :size="30" class="animate-spin text-primary" />
            <span class="text-sm">{{ t('reader.pdf.preparing') }}</span>
          </div>
        </div>
      </template>
      <template #error="{ error }">
        <div class="absolute inset-0 flex items-center justify-center p-6">
          <div class="max-w-sm text-center">
            <p class="mb-2 text-sm font-medium text-foreground">{{ t('reader.pdf.openError') }}</p>
            <p class="text-xs text-muted-foreground">{{ viewerErrorMessage(error) }}</p>
            <div class="mt-4 flex justify-center gap-2">
              <button
                class="rounded-md border border-border px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                @click="handleBack"
              >
                {{ t('reader.header.goBack') }}
              </button>
              <button class="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetry">
                {{ t('reader.retry') }}
              </button>
            </div>
          </div>
        </div>
      </template>
      <PdfReaderContent
        :book-id="props.bookId"
        :file-id="props.fileId"
        :initial-page="initialPage"
        :initial-percentage="initialPercentage"
        :settings="effectiveSettings"
        :peek-mode="props.peekMode"
        @back="handleBack"
        @page-change="handlePageChange"
        @retry="handleRetry"
        @settings-change="handleSettingsChange"
        @start-reading="handleStartReading"
      />
    </Viewer>
  </div>
</template>
