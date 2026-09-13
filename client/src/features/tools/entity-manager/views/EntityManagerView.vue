<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { BrowseEntityItem, DuplicateCluster } from '@bookorbit/types'

import { useEntityManager, type EntityManagerMode } from '../../composables/useEntityManager'
import { useEntityRowDensity } from '../composables/useEntityRowDensity'
import type { EntityRowDensity } from '../types'
import DuplicateReviewControls from '../components/DuplicateReviewControls.vue'
import DuplicatesPanel from '../components/DuplicatesPanel.vue'
import EntityBrowseToolbar from '../components/EntityBrowseToolbar.vue'
import EntityBrowseTable from '../components/EntityBrowseTable.vue'
import EntityTypeSelector from '../components/EntityTypeSelector.vue'
import ModeSwitcher from '../components/ModeSwitcher.vue'
import RenameModal from '../components/RenameModal.vue'
import DeleteModal from '../components/DeleteModal.vue'
import SplitModal from '../components/SplitModal.vue'
import BulkDeleteModal from '../components/BulkDeleteModal.vue'
import BrowseMergeModal from '../components/BrowseMergeModal.vue'

const em = useEntityManager()
const { density } = useEntityRowDensity()

const renameTarget = ref<BrowseEntityItem | null>(null)
const deleteTarget = ref<BrowseEntityItem | null>(null)
const splitTarget = ref<BrowseEntityItem | null>(null)
const showBulkDelete = ref(false)
const showBrowseMerge = ref(false)

const selectedBrowseItems = computed(() => Array.from(em.selectedItemsMap.value.values()))
const hasActiveFilters = computed(() => em.browseSearch.value.length > 0 || em.browseBookCount.value === 'empty')
const deleteDefaultMode = computed<'soft' | 'hard'>(() => (deleteTarget.value?.bookCount === 0 ? 'hard' : 'soft'))
const bulkDeleteDefaultMode = computed<'soft' | 'hard'>(() =>
  selectedBrowseItems.value.length > 0 && selectedBrowseItems.value.every((item) => item.bookCount === 0) ? 'hard' : 'soft',
)

let searchDebounce: ReturnType<typeof setTimeout> | null = null
let skipNextSearchWatch = false

function refreshBrowseFromFirstPage(): void {
  em.browsePage.value = 1
  em.fetchBrowse()
}

watch(em.browseSearch, () => {
  if (skipNextSearchWatch) {
    skipNextSearchWatch = false
    return
  }
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    refreshBrowseFromFirstPage()
  }, 300)
})

watch(
  [em.mode, em.entityType],
  ([newMode]) => {
    if (newMode === 'browse') {
      em.fetchBrowse()
    } else if (newMode === 'duplicates') {
      em.fetchScanStatus()
      runScan()
    }
  },
  { immediate: true },
)

function handleUpdateMode(value: EntityManagerMode): void {
  em.mode.value = value
}

function runScan(): void {
  em.scanPage.value = 1
  em.scan()
}

function handleUpdateMinSimilarity(value: number): void {
  em.minSimilarity.value = value
  runScan()
}

function handleRefreshDuplicates(): void {
  em.refreshDuplicates()
}

function handleScanPage(value: number): void {
  em.scanPage.value = value
  em.scan()
}

async function handleDismissCluster(cluster: DuplicateCluster): Promise<void> {
  for (const pair of cluster.pairDetails) {
    await em.dismissPair(pair.idA, pair.idB)
  }
  em.removeClustersByIds(cluster.entities.map((entity) => entity.id))
}

function handleUpdateSearch(value: string): void {
  em.browseSearch.value = value
}

function handleUpdatePage(value: number): void {
  em.browsePage.value = value
  em.fetchBrowse()
}

function handleUpdatePageSize(value: number): void {
  em.browsePageSize.value = value
  refreshBrowseFromFirstPage()
}

function handleUpdateDensity(value: EntityRowDensity): void {
  density.value = value
}

function handleToggleAll(selected: boolean): void {
  em.setSelection(
    em.browseItems.value.map((item) => item.id),
    selected,
  )
}

function handleClearFilters(): void {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
    searchDebounce = null
  }
  if (em.browseSearch.value !== '') skipNextSearchWatch = true
  em.browseSearch.value = ''
  em.browseBookCount.value = 'any'
  refreshBrowseFromFirstPage()
}

function handleBrowseSortChange(sortBy: 'name' | 'bookCount', sortOrder: 'asc' | 'desc'): void {
  em.browseSortBy.value = sortBy
  em.browseSortOrder.value = sortOrder
  refreshBrowseFromFirstPage()
}

function handleUpdateBookCount(value: 'any' | 'empty'): void {
  em.browseBookCount.value = em.isInline.value ? 'any' : value
  refreshBrowseFromFirstPage()
}

async function handleMerge(targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean): Promise<void> {
  await em.mergeEntities(targetId, sourceIds, writeFiles)
  em.removeClustersByIds(sourceIds)
}

async function handleDismissEntity(cluster: DuplicateCluster, entityId: number | string): Promise<void> {
  const pairs = cluster.pairDetails.filter((p) => p.idA === entityId || p.idB === entityId)
  for (const pair of pairs) {
    await em.dismissPair(pair.idA, pair.idB)
  }
  em.removeClustersByIds([entityId])
}

async function handleDismissPair(idA: number | string, idB: number | string): Promise<void> {
  await em.dismissPair(idA, idB)
  em.removePairFromClusters(idA, idB)
}

async function handleUndismiss(idA: number | string, idB: number | string): Promise<void> {
  await em.undismissPair(idA, idB)
  if (em.clusters.value.length > 0) {
    em.scan()
  }
}

function handleToggleDismissed(): void {
  em.showDismissed.value = !em.showDismissed.value
}

function handleSelectItem(id: number | string, event: MouseEvent): void {
  if (event.shiftKey) {
    em.rangeSelectTo(id)
    return
  }
  em.toggleSelection(id)
}

function handleRename(item: BrowseEntityItem): void {
  renameTarget.value = item
}

function handleDelete(item: BrowseEntityItem): void {
  deleteTarget.value = item
}

function handleSplit(item: BrowseEntityItem): void {
  splitTarget.value = item
}

function handleBulkDelete(): void {
  showBulkDelete.value = true
}

function handleBulkMerge(): void {
  showBrowseMerge.value = true
}

async function handleBrowseMergeConfirm(targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean): Promise<void> {
  await em.mergeEntities(targetId, sourceIds, writeFiles)
  showBrowseMerge.value = false
  em.clearSelection()
  em.fetchBrowse()
}

async function handleRenameConfirm(newName: string, writeFiles: boolean): Promise<void> {
  if (!renameTarget.value) return
  await em.renameEntity(renameTarget.value.id, newName, writeFiles)
  renameTarget.value = null
  em.fetchBrowse()
}

async function handleDeleteConfirm(mode: 'soft' | 'hard' | 'inline', writeFiles: boolean): Promise<void> {
  if (!deleteTarget.value) return
  const id = deleteTarget.value.id
  await em.deleteEntity(id, mode, writeFiles)
  em.removeFromSelection(id)
  deleteTarget.value = null
  em.fetchBrowse()
}

async function handleSplitConfirm(newNames: string[], writeFiles: boolean): Promise<void> {
  if (!splitTarget.value) return
  const id = splitTarget.value.id
  await em.splitEntity(id as number, newNames, writeFiles)
  em.removeFromSelection(id)
  splitTarget.value = null
  em.fetchBrowse()
}

async function handleBulkDeleteConfirm(mode: 'soft' | 'hard' | 'inline', writeFiles: boolean): Promise<void> {
  const ids = Array.from(em.selectedIds.value)
  await em.bulkDeleteEntities(ids, mode, writeFiles)
  showBulkDelete.value = false
  em.clearSelection()
  em.fetchBrowse()
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div class="flex flex-none flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-border bg-card px-2.5 py-2">
      <EntityTypeSelector v-model="em.entityType.value" />
      <span class="hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden="true" />
      <ModeSwitcher :model-value="em.mode.value" @update:model-value="handleUpdateMode" />
      <span class="hidden h-5 w-px shrink-0 bg-border sm:block" aria-hidden="true" />

      <EntityBrowseToolbar
        v-if="em.mode.value === 'browse'"
        :search="em.browseSearch.value"
        :book-count="em.browseBookCount.value"
        :total="em.browseTotal.value"
        :density="density"
        :selected-count="em.selectedIds.value.size"
        :is-inline="em.isInline.value"
        @update:search="handleUpdateSearch"
        @update:book-count="handleUpdateBookCount"
        @update:density="handleUpdateDensity"
        @bulk-merge="handleBulkMerge"
        @bulk-delete="handleBulkDelete"
        @clear-selection="em.clearSelection"
      />
      <DuplicateReviewControls
        v-else
        :total="em.scanTotal.value"
        :scanning="em.scanning.value"
        :scan-status="em.duplicateScanStatus.value"
        :min-similarity="em.minSimilarity.value"
        :is-inline="em.isInline.value"
        @update:min-similarity="handleUpdateMinSimilarity"
        @recompute="handleRefreshDuplicates"
      />
    </div>

    <!-- Duplicates mode -->
    <div v-if="em.mode.value === 'duplicates'" class="flex-1 min-h-0 overflow-hidden pt-3">
      <DuplicatesPanel
        :clusters="em.clusters.value"
        :page="em.scanPage.value"
        :total-pages="em.scanTotalPages.value"
        :scanning="em.scanning.value"
        :has-scanned="em.hasScanned.value"
        :scan-error="em.scanError.value"
        :operation-loading="em.operationLoading.value"
        :dismissed-pairs="em.dismissedPairs.value"
        :dismissed-loading="em.dismissedLoading.value"
        :show-dismissed="em.showDismissed.value"
        @update:page="handleScanPage"
        @merge="handleMerge"
        @dismiss-entity="handleDismissEntity"
        @dismiss-pair="handleDismissPair"
        @dismiss-cluster="handleDismissCluster"
        @undismiss="handleUndismiss"
        @toggle-dismissed="handleToggleDismissed"
      />
    </div>

    <!-- Browse mode: the data grid owns its own scroll so the header can stick -->
    <div v-if="em.mode.value === 'browse'" class="flex-1 min-h-0 overflow-hidden pt-3">
      <EntityBrowseTable
        :items="em.browseItems.value"
        :total="em.browseTotal.value"
        :page="em.browsePage.value"
        :page-size="em.browsePageSize.value"
        :total-pages="em.browseTotalPages.value"
        :sort-by="em.browseSortBy.value"
        :sort-order="em.browseSortOrder.value"
        :density="density"
        :loading="em.browseLoading.value"
        :has-active-filters="hasActiveFilters"
        :selected-ids="em.selectedIds.value"
        :capabilities="em.capabilities.value"
        :is-inline="em.isInline.value"
        @update:page="handleUpdatePage"
        @update:page-size="handleUpdatePageSize"
        @sort-change="handleBrowseSortChange"
        @select="handleSelectItem"
        @toggle-all="handleToggleAll"
        @rename="handleRename"
        @delete="handleDelete"
        @split="handleSplit"
        @clear-filters="handleClearFilters"
      />
    </div>

    <!-- Modals -->
    <RenameModal
      v-if="renameTarget"
      :current-name="renameTarget.name"
      :loading="em.operationLoading.value"
      @confirm="handleRenameConfirm"
      @cancel="renameTarget = null"
    />

    <DeleteModal
      v-if="deleteTarget"
      :entity-name="deleteTarget.name"
      :is-inline="em.isInline.value"
      :default-mode="deleteDefaultMode"
      :loading="em.operationLoading.value"
      @confirm="handleDeleteConfirm"
      @cancel="deleteTarget = null"
    />

    <SplitModal
      v-if="splitTarget"
      :entity-name="splitTarget.name"
      :loading="em.operationLoading.value"
      @confirm="handleSplitConfirm"
      @cancel="splitTarget = null"
    />

    <BulkDeleteModal
      v-if="showBulkDelete"
      :count="em.selectedIds.value.size"
      :is-inline="em.isInline.value"
      :default-mode="bulkDeleteDefaultMode"
      :loading="em.operationLoading.value"
      @confirm="handleBulkDeleteConfirm"
      @cancel="showBulkDelete = false"
    />

    <BrowseMergeModal
      v-if="showBrowseMerge"
      :items="selectedBrowseItems"
      :loading="em.operationLoading.value"
      @confirm="handleBrowseMergeConfirm"
      @cancel="showBrowseMerge = false"
    />
  </div>
</template>
