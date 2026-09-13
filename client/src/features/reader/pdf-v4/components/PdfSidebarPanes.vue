<script setup lang="ts">
import type { AnnotationItem } from '@bookorbit/types'
import PdfNotesPanel from './PdfNotesPanel.vue'
import PdfOutlineTree from './PdfOutlineTree.vue'
import PdfSearchPanel from './PdfSearchPanel.vue'
import PdfThumbnailGrid from './PdfThumbnailGrid.vue'
import type { FlatPdfBookmark } from '../pdf-viewer-utils'
import type { PdfSidebarTab } from '../composables/usePdfSidebarLayout'

defineProps<{
  documentId: string
  activeTab: PdfSidebarTab
  active: boolean
  currentPage: number
  totalPages: number
  bookmarks: FlatPdfBookmark[]
  bookmarksLoading: boolean
  annotations: AnnotationItem[]
  loadError?: boolean
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
}>()

const emit = defineEmits<{
  selectPage: [pageIndex: number]
  navigateBookmark: [entry: FlatPdfBookmark]
  navigateHighlight: [annotation: AnnotationItem]
  deleteHighlight: [id: number]
  retryHighlights: []
  loadMoreHighlights: []
}>()

function handleSelectPage(pageIndex: number) {
  emit('selectPage', pageIndex)
}

function handleNavigateBookmark(entry: FlatPdfBookmark) {
  emit('navigateBookmark', entry)
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
</script>

<template>
  <PdfThumbnailGrid
    v-if="activeTab === 'thumbnails'"
    :document-id="documentId"
    :current-page="currentPage"
    :total-pages="totalPages"
    @select="handleSelectPage"
  />
  <PdfOutlineTree
    v-else-if="activeTab === 'contents'"
    :bookmarks="bookmarks"
    :loading="bookmarksLoading"
    :current-page="currentPage"
    @navigate="handleNavigateBookmark"
  />
  <PdfSearchPanel v-else-if="activeTab === 'search'" :document-id="documentId" :active="active" />
  <PdfNotesPanel
    v-else
    :annotations="annotations"
    :load-error="loadError"
    :loading="loading"
    :loading-more="loadingMore"
    :has-more="hasMore"
    @navigate="handleNavigateHighlight"
    @delete="handleDeleteHighlight"
    @retry="handleRetryHighlights"
    @load-more="handleLoadMoreHighlights"
  />
</template>
