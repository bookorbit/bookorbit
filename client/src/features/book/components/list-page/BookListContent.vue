<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import type { SortSpec } from '@bookorbit/types'
import BookListRow from '@/features/book/components/BookListRow.vue'
import JumpRail from '@/features/book/components/JumpRail.vue'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import VirtualBookTable from '@/features/book/components/VirtualBookTable.vue'
import type { BookListPage } from '@/features/book/composables/useBookListPage'

/**
 * The books themselves in whichever view is active, the list view's load-more sentinel and the jump
 * rail. The host renders it inside its scrolling `<main>`, after its own empty states.
 */
defineProps<{
  page: BookListPage
  /** The sort the table marks as its default; the library default when absent. */
  defaultSort?: SortSpec[]
}>()

const { t } = useI18n()
</script>

<template>
  <VirtualBookGrid
    v-if="page.effectiveViewMode === 'grid' && page.books.length > 0"
    :ref="page.bindGrid"
    :books="page.slots"
    :cover-size="page.coverSize"
    :grid-gap="page.gridGap"
    :selection-mode="page.selectionMode"
    :is-selected="page.isSelected"
    :rail-gutter="page.railGutterReserved"
    :rail-gutter-kind="page.bucketKind"
    :media-kind="page.gridMediaKind"
    :allow-move-to-library="true"
    @range="page.handleRange"
    @first-visible-index="page.handleFirstVisibleIndex"
    @action="page.handleBookAction"
    @select="page.handleSelect"
  />

  <div v-if="page.effectiveViewMode === 'list' && page.contiguousPrefix.length > 0" class="flex flex-col divide-y divide-border">
    <BookListRow
      v-for="book in page.contiguousPrefix"
      :key="book.id"
      :book="book"
      :selection-mode="page.selectionMode"
      :selected="page.isSelected(book.id)"
      :allow-move-to-library="true"
      @select="page.handleSelect(book.id, $event)"
      @action="page.handleBookAction(book, $event)"
    />
  </div>

  <VirtualBookTable
    v-if="page.effectiveViewMode === 'table'"
    :ref="page.bindTable"
    :books="page.slots"
    :in-flight="page.inFlight"
    :sort="page.tableSort"
    :default-sort="defaultSort"
    :loading="page.loading"
    :total="page.total"
    :view-type="page.viewType"
    :selection-mode="page.selectionMode"
    :is-selected="page.isSelected"
    :selected-count="page.selectedCount"
    :initialized="page.booksInitialized"
    :allow-move-to-library="true"
    @update:sort="page.setSortModel"
    @action="page.handleBookAction"
    @select="page.handleSelect"
    @update:book="page.handleTableBookUpdate"
    @visible-range="page.handleRange"
    @first-visible-index="page.handleFirstVisibleIndex"
    @select-all="page.handleSelectAllLoaded"
    @enter-selection="page.enterSelectionMode"
  />

  <div v-if="page.effectiveViewMode === 'list'" :ref="page.bindSentinel" class="mt-4 flex h-8 items-center justify-center">
    <span v-if="page.loading" class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
    <span v-else-if="!page.hasMorePrefix && page.contiguousPrefix.length > 0" class="text-xs text-muted-foreground">
      {{ t('views.bookView.allBooksLoaded', { count: formatNumber(page.bookTotal) }) }}
    </span>
  </div>

  <JumpRail
    :visible="page.railVisible"
    :buckets="page.buckets"
    :kind="page.bucketKind ?? 'letter'"
    :field="page.primarySortField"
    :granularity="page.temporalGranularity"
    :max-slots="page.railCapacity"
    :viewport="page.mainEl"
    :active-key="page.activeBucketKey"
    :template="page.bucketKind === 'letter' ? page.letterTemplate : undefined"
    @jump="page.handleJump"
    @after-leave="page.releaseRailGutter"
  />
</template>
