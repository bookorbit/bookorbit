<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { PDFViewer, ScrollPlugin, ScrollStrategy, SpreadMode, ZoomMode } from '@embedpdf/vue-pdf-viewer'
import type { PDFViewerConfig, PluginRegistry, ScrollCapability, EmbedPdfContainer } from '@embedpdf/vue-pdf-viewer'
import { getAccessToken } from '@/lib/api'
import { useReaderProgress } from '../shared/composables/useReaderProgress'
import { useReadingSession } from '../shared/composables/useReadingSession'
import { useReaderSettings } from '../shared/composables/useReaderSettings'
import { useThemeStore, ACCENT_OPTIONS } from '@/stores/theme'
import type { PdfReaderSettings } from '@bookorbit/types'
import { getIsDark, lookupAccentHex } from './pdf-viewer-utils'
import { ArrowLeft } from '@lucide/vue'

const props = defineProps<{ bookId: number; fileId: number; peekMode?: boolean }>()
const route = useRoute()
const router = useRouter()
const trackingEnabled = computed(() => !props.peekMode)

const themeStore = useThemeStore()

const bookSettings = useReaderSettings(props.fileId, 'pdf')
const { onActivity, elapsedMinutes } = useReadingSession(
  props.fileId,
  () => ({
    percentage: progress.percentage.value,
    pageNumber: progress.pageNumber.value,
  }),
  { trackingEnabled },
)
const progress = useReaderProgress(props.bookId, props.fileId, elapsedMinutes, 0, { trackingEnabled })

let saveTimer: ReturnType<typeof setTimeout> | null = null
let unsubPageChange: (() => void) | null = null
let unsubLayoutReady: (() => void) | null = null
let themeObserver: MutationObserver | null = null
let viewerContainer: EmbedPdfContainer | null = null

function buildThemeConfig() {
  const isDark = getIsDark()
  const accentHex = lookupAccentHex(themeStore.accent, ACCENT_OPTIONS)
  return {
    preference: isDark ? ('dark' as const) : ('light' as const),
    light: { accent: { primary: accentHex } },
    dark: { accent: { primary: accentHex } },
  }
}

function scheduleSave(pageNumber: number, totalPages: number) {
  currentPageNumber.value = pageNumber
  totalPageCount.value = totalPages
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    progress.pageNumber.value = pageNumber
    progress.percentage.value = (pageNumber / totalPages) * 100
    progress.save()
  }, 2000)
}

const configReady = ref(false)
const viewerConfig = ref<PDFViewerConfig>({})
const currentPageNumber = ref<number | null>(null)
const totalPageCount = ref<number | null>(null)

onMounted(async () => {
  await bookSettings.load()

  const settings = bookSettings.effective.value as PdfReaderSettings
  const token = getAccessToken()

  viewerConfig.value = {
    theme: buildThemeConfig(),
    tabBar: 'never',
    disabledCategories: [
      'annotation',
      'signature',
      'form',
      'document-print',
      'export',
      'insert',
      'redaction',
      'document-open',
      'document-close',
      'document-protect',
      'document-export',
    ],
    scroll: {
      defaultStrategy: settings.scrollMode === 'horizontal' ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical,
    },
    spread: {
      defaultSpreadMode: settings.spread === 'odd' ? SpreadMode.Odd : settings.spread === 'even' ? SpreadMode.Even : SpreadMode.None,
    },
    zoom: {
      defaultZoomLevel:
        settings.zoomMode === 'fit-width' ? ZoomMode.FitWidth : settings.zoomMode === 'fit-page' ? ZoomMode.FitPage : settings.customScale,
    },
    documentManager: {
      initialDocuments: [
        {
          url: `/api/v1/books/files/${props.fileId}/serve`,
          requestOptions: {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        },
      ],
    },
  }

  configReady.value = true
})

function handleInit(container: EmbedPdfContainer) {
  viewerContainer = container
}

function handleReady(registry: PluginRegistry) {
  setupProgressTracking(registry)
  setupSettingsPersistence(registry)
  setupThemeSync()
}

async function setupProgressTracking(registry: PluginRegistry) {
  await progress.load()

  const scroll = registry.getPlugin<InstanceType<typeof ScrollPlugin>>(ScrollPlugin.id)?.provides() as ScrollCapability | undefined

  if (!scroll) return

  unsubLayoutReady = scroll.onLayoutReady(({ isInitial, totalPages }) => {
    if (!isInitial) return
    const deepLinkQuery = route?.query?.page
    const deepLinkPage = typeof deepLinkQuery === 'string' ? Number.parseInt(deepLinkQuery, 10) : NaN
    const initialPage = Number.isFinite(deepLinkPage) && deepLinkPage >= 1 ? deepLinkPage : (progress.pageNumber.value ?? 1)
    currentPageNumber.value = initialPage
    totalPageCount.value = totalPages
    if (initialPage > 1 && initialPage <= totalPages) {
      scroll.scrollToPage({ pageNumber: initialPage })
    }
  })

  unsubPageChange = scroll.onPageChange(({ pageNumber, totalPages }) => {
    onActivity()
    scheduleSave(pageNumber, totalPages)
  })
}

function setupSettingsPersistence(registry: PluginRegistry) {
  const scroll = registry.getPlugin<InstanceType<typeof ScrollPlugin>>(ScrollPlugin.id)?.provides() as ScrollCapability | undefined

  if (scroll) {
    scroll.onStateChange((state) => {
      const strategy = state.strategy
      if (strategy) {
        bookSettings.updateBookSettings({ scrollMode: strategy as PdfReaderSettings['scrollMode'] })
      }
    })
  }
}

function setupThemeSync() {
  themeObserver = new MutationObserver(() => {
    if (!viewerContainer) return
    viewerContainer.setTheme(buildThemeConfig())
  })

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

async function startTrackedReading() {
  const query = { ...route.query }
  delete query.mode
  await router.replace({ name: 'reader', params: route.params, query })
  await nextTick()
  if (currentPageNumber.value !== null) {
    progress.pageNumber.value = currentPageNumber.value
    progress.percentage.value = totalPageCount.value ? (currentPageNumber.value / totalPageCount.value) * 100 : progress.percentage.value
  }
  await progress.save()
  onActivity()
}

onUnmounted(() => {
  unsubPageChange?.()
  unsubLayoutReady?.()
  themeObserver?.disconnect()
  if (saveTimer) clearTimeout(saveTimer)
})
</script>

<template>
  <div class="fixed inset-0 flex flex-col">
    <!-- Floating Back Button (FAB) -->
    <div class="pointer-events-none absolute bottom-6 left-6 z-50 flex">
      <button
        class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full bg-background/95 text-foreground shadow-lg border border-border backdrop-blur-md transition-transform hover:scale-105 active:scale-95"
        @click="router.back()"
        aria-label="Go back"
      >
        <ArrowLeft :size="22" />
      </button>
    </div>

    <div v-if="props.peekMode" class="pointer-events-none absolute left-0 right-0 top-3 z-50 flex justify-center">
      <div class="pointer-events-auto flex h-8 items-center gap-2 rounded-md border border-primary/30 bg-background/95 px-2 text-primary shadow-sm">
        <span class="text-xs font-medium">Peeking</span>
        <button
          class="h-6 rounded-sm bg-primary px-2 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
          @click="startTrackedReading"
        >
          Start reading
        </button>
      </div>
    </div>
    <PDFViewer v-if="configReady" :config="viewerConfig" style="flex: 1; min-height: 0" @init="handleInit" @ready="handleReady" />
  </div>
</template>
