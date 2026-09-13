<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, FileText, Highlighter, Search, X } from '@lucide/vue'
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue'
import { useBookmarkCapability } from '@embedpdf/plugin-bookmark/vue'
import { useScroll } from '@embedpdf/plugin-scroll/vue'
import type { AnnotationItem } from '@bookorbit/types'
import ReaderBottomSheet, { type ReaderSheetSnap } from '../../shared/components/ReaderBottomSheet.vue'
import PdfNavRail from './PdfNavRail.vue'
import PdfSidebarPanes from './PdfSidebarPanes.vue'
import { flattenPdfBookmarks, type FlatPdfBookmark } from '../pdf-viewer-utils'
import {
  PDF_SIDEBAR_MAX_WIDTH,
  PDF_SIDEBAR_MIN_WIDTH,
  PDF_SIDEBAR_TABS,
  type PdfSidebarLayout,
  type PdfSidebarTab,
} from '../composables/usePdfSidebarLayout'

const props = withDefaults(
  defineProps<{
    documentId: string
    activeTab: PdfSidebarTab
    open?: boolean
    layout?: PdfSidebarLayout
    width?: number
    annotations: AnnotationItem[]
    loadError?: boolean
    loading?: boolean
    loadingMore?: boolean
    hasMore?: boolean
  }>(),
  { open: true, layout: 'dock', width: 304 },
)

const emit = defineEmits<{
  close: []
  'update:activeTab': [tab: PdfSidebarTab]
  'update:width': [width: number]
  navigateHighlight: [annotation: AnnotationItem]
  deleteHighlight: [id: number]
  retryHighlights: []
  loadMoreHighlights: []
}>()

const { t } = useI18n()

const { state: scrollState, provides: scroll } = useScroll(() => props.documentId)
const { provides: bookmarksCapability } = useBookmarkCapability()
const { provides: annotationCapability } = useAnnotationCapability()

const sidebarId = `pdf-sidebar-${useId()}`
const sheetSnap = ref<ReaderSheetSnap>('peek')
const bookmarks = ref<FlatPdfBookmark[]>([])
const bookmarksLoading = ref(false)
const bookmarksLoaded = ref(false)

const TAB_ICONS = { thumbnails: FileText, contents: BookOpen, search: Search, highlights: Highlighter } as const

const tabIds = computed(() => Object.fromEntries(PDF_SIDEBAR_TABS.map((tab) => [tab, `${sidebarId}-tab-${tab}`])) as Record<PdfSidebarTab, string>)
const panelIds = computed(
  () => Object.fromEntries(PDF_SIDEBAR_TABS.map((tab) => [tab, `${sidebarId}-panel-${tab}`])) as Record<PdfSidebarTab, string>,
)

const TAB_LABEL_KEYS = {
  thumbnails: 'reader.pdf.sidebar.pages',
  contents: 'reader.pdf.sidebar.contents',
  search: 'reader.pdf.sidebar.search',
  highlights: 'reader.sidebar.tabs.notesShort',
} as const

function tabLabel(tab: PdfSidebarTab) {
  return t(TAB_LABEL_KEYS[tab])
}

const panelCount = computed(() => {
  if (props.activeTab === 'thumbnails') return scrollState.value.totalPages ? String(scrollState.value.totalPages) : ''
  if (props.activeTab === 'highlights') return props.annotations.length ? String(props.annotations.length) : ''
  return ''
})

function selectTab(tab: PdfSidebarTab) {
  emit('update:activeTab', tab)
}

function handleClose() {
  emit('close')
}

function handleSheetOpen(open: boolean) {
  if (!open) emit('close')
}

function handleSheetSnap(snap: ReaderSheetSnap) {
  sheetSnap.value = snap
}

function handleSheetTabKeydown(event: KeyboardEvent) {
  const current = PDF_SIDEBAR_TABS.indexOf(props.activeTab)
  let next: number
  if (event.key === 'ArrowRight') next = (current + 1) % PDF_SIDEBAR_TABS.length
  else if (event.key === 'ArrowLeft') next = (current - 1 + PDF_SIDEBAR_TABS.length) % PDF_SIDEBAR_TABS.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = PDF_SIDEBAR_TABS.length - 1
  else return

  event.preventDefault()
  const nextTab = PDF_SIDEBAR_TABS[next]
  if (nextTab) selectTab(nextTab)
}

function handleThumbnail(pageIndex: number) {
  scroll.value?.scrollToPage({ pageNumber: pageIndex + 1, behavior: 'smooth' })
}

function handleBookmark(entry: FlatPdfBookmark) {
  const target = entry.bookmark.target
  if (!target) return
  annotationCapability.value?.forDocument(props.documentId).navigateTarget(target)
}

function handleNavigateHighlight(annotation: AnnotationItem) {
  emit('navigateHighlight', annotation)
}

function handleDeleteHighlight(id: number) {
  emit('deleteHighlight', id)
}

function handleRetryHighlights() {
  emit('retryHighlights')
}

function handleLoadMoreHighlights() {
  emit('loadMoreHighlights')
}

function loadBookmarks() {
  if (bookmarksLoaded.value || bookmarksLoading.value || !bookmarksCapability.value) return
  bookmarksLoading.value = true
  bookmarksCapability.value
    .forDocument(props.documentId)
    .getBookmarks()
    .wait(
      ({ bookmarks: items }) => {
        bookmarks.value = flattenPdfBookmarks(items)
        bookmarksLoaded.value = true
        bookmarksLoading.value = false
      },
      () => {
        bookmarksLoaded.value = true
        bookmarksLoading.value = false
      },
    )
}

watch(
  () => [props.activeTab, props.open, bookmarksCapability.value] as const,
  ([tab, open]) => {
    if (open && tab === 'contents') loadBookmarks()
  },
  { immediate: true },
)

// --- resize -------------------------------------------------------------

const resizing = ref(false)
let pointerId: number | null = null
let startX = 0
let startWidth = 0

function handleResizeStart(event: PointerEvent) {
  pointerId = event.pointerId
  startX = event.clientX
  startWidth = props.width
  resizing.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  event.preventDefault()
}

function handleResizeMove(event: PointerEvent) {
  if (!resizing.value || event.pointerId !== pointerId) return
  // The panel is anchored to the inline start edge, so a rightward drag widens it.
  const delta = document.dir === 'rtl' ? startX - event.clientX : event.clientX - startX
  emit('update:width', Math.min(Math.max(startWidth + delta, PDF_SIDEBAR_MIN_WIDTH), PDF_SIDEBAR_MAX_WIDTH))
}

function handleResizeEnd(event: PointerEvent) {
  if (event.pointerId !== pointerId) return
  resizing.value = false
  pointerId = null
}

function handleResizeKeydown(event: KeyboardEvent) {
  const step = event.shiftKey ? 48 : 16
  let delta = 0
  if (event.key === 'ArrowRight') delta = step
  else if (event.key === 'ArrowLeft') delta = -step
  else return
  event.preventDefault()
  emit('update:width', Math.min(Math.max(props.width + delta, PDF_SIDEBAR_MIN_WIDTH), PDF_SIDEBAR_MAX_WIDTH))
}
</script>

<template>
  <PdfNavRail
    v-if="props.layout !== 'sheet'"
    :active-tab="props.activeTab"
    :open="props.open"
    :highlight-count="props.annotations.length"
    :tab-ids="tabIds"
    :panel-ids="panelIds"
    @select="selectTab"
  />

  <aside
    v-if="props.layout !== 'sheet' && props.open"
    data-pdf-reader-panel
    class="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-e border-border bg-card text-card-foreground"
    :class="props.layout === 'overlay' ? 'absolute inset-y-0 start-14 z-30 shadow-2xl' : ''"
    :style="{ width: `${props.width}px` }"
  >
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border ps-3 pe-1">
      <h2 class="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-semibold text-foreground">
        <span class="truncate">{{ tabLabel(props.activeTab) }}</span>
        <span v-if="panelCount" class="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{{ panelCount }}</span>
      </h2>
      <button type="button" class="viewer-btn" :aria-label="t('reader.pdf.sidebar.closeNavigation')" @click="handleClose">
        <X :size="17" />
      </button>
    </div>

    <div :id="panelIds[props.activeTab]" role="tabpanel" :aria-labelledby="tabIds[props.activeTab]" class="flex min-h-0 flex-1 flex-col">
      <PdfSidebarPanes
        :document-id="props.documentId"
        :active-tab="props.activeTab"
        :active="props.open"
        :current-page="scrollState.currentPage"
        :total-pages="scrollState.totalPages"
        :bookmarks="bookmarks"
        :bookmarks-loading="bookmarksLoading"
        :annotations="props.annotations"
        :load-error="props.loadError"
        :loading="props.loading"
        :loading-more="props.loadingMore"
        :has-more="props.hasMore"
        @select-page="handleThumbnail"
        @navigate-bookmark="handleBookmark"
        @navigate-highlight="handleNavigateHighlight"
        @delete-highlight="handleDeleteHighlight"
        @retry-highlights="handleRetryHighlights"
        @load-more-highlights="handleLoadMoreHighlights"
      />
    </div>

    <div
      role="separator"
      tabindex="0"
      aria-orientation="vertical"
      :aria-label="t('reader.pdf.sidebar.resizePanel')"
      :aria-valuenow="props.width"
      :aria-valuemin="PDF_SIDEBAR_MIN_WIDTH"
      :aria-valuemax="PDF_SIDEBAR_MAX_WIDTH"
      class="absolute inset-y-0 end-0 z-10 w-1.5 cursor-col-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      :class="resizing ? 'bg-primary/40' : 'hover:bg-primary/25'"
      @pointerdown="handleResizeStart"
      @pointermove="handleResizeMove"
      @pointerup="handleResizeEnd"
      @pointercancel="handleResizeEnd"
      @keydown="handleResizeKeydown"
    />
  </aside>

  <ReaderBottomSheet
    v-if="props.layout === 'sheet'"
    :open="props.open"
    :snap="sheetSnap"
    :label="t('reader.pdf.sidebar.tabsLabel')"
    @update:open="handleSheetOpen"
    @update:snap="handleSheetSnap"
  >
    <div class="flex shrink-0 items-center gap-2 px-3 pb-2">
      <div
        role="tablist"
        :aria-label="t('reader.pdf.sidebar.tabsLabel')"
        class="flex min-w-0 flex-1 gap-0.5 rounded-xl bg-muted p-1"
        @keydown="handleSheetTabKeydown"
      >
        <button
          v-for="tab in PDF_SIDEBAR_TABS"
          :id="tabIds[tab]"
          :key="tab"
          type="button"
          role="tab"
          :aria-selected="props.activeTab === tab"
          :aria-controls="panelIds[tab]"
          :tabindex="props.activeTab === tab ? 0 : -1"
          class="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="props.activeTab === tab ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'"
          @click="selectTab(tab)"
        >
          <component :is="TAB_ICONS[tab]" :size="14" class="shrink-0" aria-hidden="true" />
          <span class="truncate">{{ tabLabel(tab) }}</span>
        </button>
      </div>
      <button type="button" class="viewer-btn" :aria-label="t('reader.pdf.sidebar.closeNavigation')" @click="handleClose">
        <X :size="17" />
      </button>
    </div>

    <div
      :id="panelIds[props.activeTab]"
      role="tabpanel"
      :aria-labelledby="tabIds[props.activeTab]"
      class="flex min-h-0 flex-1 flex-col border-t border-border"
    >
      <PdfSidebarPanes
        :document-id="props.documentId"
        :active-tab="props.activeTab"
        :active="props.open"
        :current-page="scrollState.currentPage"
        :total-pages="scrollState.totalPages"
        :bookmarks="bookmarks"
        :bookmarks-loading="bookmarksLoading"
        :annotations="props.annotations"
        :load-error="props.loadError"
        :loading="props.loading"
        :loading-more="props.loadingMore"
        :has-more="props.hasMore"
        @select-page="handleThumbnail"
        @navigate-bookmark="handleBookmark"
        @navigate-highlight="handleNavigateHighlight"
        @delete-highlight="handleDeleteHighlight"
        @retry-highlights="handleRetryHighlights"
        @load-more-highlights="handleLoadMoreHighlights"
      />
    </div>
  </ReaderBottomSheet>
</template>
