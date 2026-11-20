<script setup lang="ts">
import type { AnnotationItem } from '@bookorbit/types'
import PdfNotesPanel from './PdfNotesPanel.vue'
import PdfOutlinePane from './PdfOutlinePane.vue'
import PdfSearchPanel from './PdfSearchPanel.vue'
import PdfThumbnailGrid from './PdfThumbnailGrid.vue'
import type { PdfSidebarTab } from '../composables/usePdfSidebarLayout'

defineProps<{
  activeTab: PdfSidebarTab
  active: boolean
  currentPage: number
  totalPages: number
  annotations: AnnotationItem[]
  loadError?: boolean
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
}>()

const emit = defineEmits<{
  selectPage: [pageIndex: number]
  navigateHighlight: [annotation: AnnotationItem]
  deleteHighlight: [id: number]
  retryHighlights: []
  loadMoreHighlights: []
}>()

function handleSelectPage(pageIndex: number) {
  emit('selectPage', pageIndex)
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
  <PdfThumbnailGrid v-if="activeTab === 'thumbnails'" :current-page="currentPage" :total-pages="totalPages" @select="handleSelectPage" />
  <PdfOutlinePane v-else-if="activeTab === 'contents'" :current-page="currentPage" />
  <PdfSearchPanel v-else-if="activeTab === 'search'" :active="active" />
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
