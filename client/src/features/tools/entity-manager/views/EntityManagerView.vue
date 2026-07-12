<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateTime } from '@/i18n/formatters'
import { CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2, RefreshCw, Search } from '@lucide/vue'
import type { BrowseEntityItem, DuplicateCluster } from '@bookorbit/types'

import { useEntityManager, type EntityManagerMode } from '../../composables/useEntityManager'
import DuplicateClusterCard from '../components/DuplicateClusterCard.vue'
import DuplicateScanControls from '../components/DuplicateScanControls.vue'
import DismissedPairsSection from '../components/DismissedPairsSection.vue'
import EntityBrowseTable from '../components/EntityBrowseTable.vue'
import EntityTypeSelector from '../components/EntityTypeSelector.vue'
import ModeSwitcher from '../components/ModeSwitcher.vue'
import RenameModal from '../components/RenameModal.vue'
import DeleteModal from '../components/DeleteModal.vue'
import SplitModal from '../components/SplitModal.vue'
import BulkDeleteModal from '../components/BulkDeleteModal.vue'
import BrowseMergeModal from '../components/BrowseMergeModal.vue'

const { t } = useI18n()
const em = useEntityManager()

const renameTarget = ref<BrowseEntityItem | null>(null)
const deleteTarget = ref<BrowseEntityItem | null>(null)
const splitTarget = ref<BrowseEntityItem | null>(null)
const showBulkDelete = ref(false)
const showBrowseMerge = ref(false)

const selectedBrowseItems = computed(() => Array.from(em.selectedItemsMap.value.values()))
const deleteDefaultMode = computed<'soft' | 'hard'>(() => (deleteTarget.value?.bookCount === 0 ? 'hard' : 'soft'))
const bulkDeleteDefaultMode = computed<'soft' | 'hard'>(() =>
  selectedBrowseItems.value.length > 0 && selectedBrowseItems.value.every((item) => item.bookCount === 0) ? 'hard' : 'soft',
)

let searchDebounce: ReturnType<typeof setTimeout> | null = null

function refreshBrowseFromFirstPage(): void {
  if (em.browsePage.value === 1) {
    em.fetchBrowse()
    return
  }
  em.browsePage.value = 1
}

watch(em.browseSearch, () => {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    refreshBrowseFromFirstPage()
  }, 300)
})

watch(em.browsePage, () => {
  em.fetchBrowse()
})

watch(
  em.mode,
  (newMode) => {
    if (newMode === 'browse') {
      em.fetchBrowse()
    } else if (newMode === 'duplicates') {
      em.fetchScanStatus()
    }
  },
  { immediate: true },
)

watch(
  em.entityType,
  () => {
    if (em.mode.value === 'browse') {
      em.fetchBrowse()
    } else if (em.mode.value === 'duplicates') {
      em.fetchScanStatus()
    }
  },
  { immediate: true },
)

function handleUpdateMode(value: EntityManagerMode): void {
  em.mode.value = value
}

function handleUpdateMinSimilarity(value: number): void {
  em.minSimilarity.value = value
}

function handleScan(): void {
  em.scanPage.value = 1
  em.scan()
}

function handleRefreshDuplicates(): void {
  em.refreshDuplicates()
}

function handleScanPage(value: number): void {
  em.scanPage.value = value
  em.scan()
}

function handleScanPrevPage(): void {
  handleScanPage(em.scanPage.value - 1)
}

function handleScanNextPage(): void {
  handleScanPage(em.scanPage.value + 1)
}

function handleUpdateSearch(value: string): void {
  em.browseSearch.value = value
}

function handleUpdatePage(value: number): void {
  em.browsePage.value = value
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
    <div class="flex-none space-y-5 pb-5">
      <div class="flex flex-wrap items-center gap-3">
        <EntityTypeSelector v-model="em.entityType.value" />
        <ModeSwitcher :model-value="em.mode.value" @update:model-value="handleUpdateMode" />
      </div>

      <!-- Duplicates scan controls - only shown in duplicates mode -->
      <div v-if="em.mode.value === 'duplicates'">
        <DuplicateScanControls
          :min-similarity="em.minSimilarity.value"
          :scanning="em.scanning.value"
          @update:min-similarity="handleUpdateMinSimilarity"
          @scan="handleScan"
        />

        <!-- Compute status bar -->
        <div v-if="em.duplicateScanStatus.value && !em.isInline.value" class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <template v-if="em.duplicateScanStatus.value.state === 'computing'">
            <Loader2 class="h-3 w-3 animate-spin shrink-0" />
            <span>
              {{ t('tools.entityManager.duplicates.computing') }}
              <template v-if="em.duplicateScanStatus.value.progressPct !== null">{{ em.duplicateScanStatus.value.progressPct }}%</template>
            </span>
          </template>
          <template v-else-if="em.duplicateScanStatus.value.state === 'done' && em.duplicateScanStatus.value.computedAt">
            <span>{{
              t('tools.entityManager.duplicates.computedAt', { date: formatDateTime(new Date(em.duplicateScanStatus.value.computedAt)) })
            }}</span>
            <button class="flex items-center gap-1 hover:text-foreground transition-colors" @click="handleRefreshDuplicates">
              <RefreshCw class="h-3 w-3" />
              {{ t('tools.entityManager.duplicates.recompute') }}
            </button>
          </template>
          <template v-else-if="em.duplicateScanStatus.value.state === 'idle'">
            <span>{{ t('tools.entityManager.duplicates.noneComputed') }}</span>
            <button class="flex items-center gap-1 hover:text-foreground transition-colors" @click="handleRefreshDuplicates">
              <RefreshCw class="h-3 w-3" />
              {{ t('tools.entityManager.duplicates.computeNow') }}
            </button>
          </template>
        </div>

        <div v-if="em.scanError.value" class="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {{ em.scanError.value }}
        </div>
      </div>
    </div>

    <!-- Scrollable content area -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Duplicates mode -->
      <template v-if="em.mode.value === 'duplicates'">
        <template v-if="!em.scanning.value && em.clusters.value.length === 0 && !em.scanError.value">
          <div
            v-if="!em.hasScanned.value"
            class="rounded-lg border border-border/50 bg-card/40 px-6 py-12 flex flex-col items-center gap-4 text-center"
          >
            <div class="rounded-full bg-muted p-4">
              <Search class="h-8 w-8 text-muted-foreground" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-medium">{{ t('tools.entityManager.duplicates.emptyTitle') }}</p>
              <p class="text-xs text-muted-foreground max-w-xs">{{ t('tools.entityManager.duplicates.emptyDescription') }}</p>
            </div>
          </div>
          <div v-else class="rounded-lg border border-border/50 bg-card/40 px-6 py-12 flex flex-col items-center gap-4 text-center">
            <div class="rounded-full bg-green-500/10 p-4">
              <CheckCircle2 class="h-8 w-8 text-green-500" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-medium">{{ t('tools.entityManager.duplicates.noneFoundTitle') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('tools.entityManager.duplicates.noneFoundDescription') }}</p>
            </div>
          </div>
        </template>

        <div v-if="em.clusters.value.length > 0" class="space-y-3">
          <p class="text-sm text-muted-foreground">
            {{ t('tools.entityManager.duplicates.clustersFound', { count: em.scanTotal.value }, em.scanTotal.value) }}
          </p>
          <DuplicateClusterCard
            v-for="(cluster, idx) in em.clusters.value"
            :key="idx"
            :cluster="cluster"
            :capabilities="em.capabilities.value"
            :operation-loading="em.operationLoading.value"
            @merge="handleMerge"
            @dismiss-entity="(entityId) => handleDismissEntity(cluster, entityId)"
            @dismiss-pair="handleDismissPair"
          />

          <div v-if="em.scanTotalPages.value > 1" class="flex items-center justify-center gap-3 pt-2">
            <button
              class="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
              :disabled="em.scanPage.value <= 1"
              @click="handleScanPrevPage"
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
            <span class="text-sm text-muted-foreground">{{ em.scanPage.value }} / {{ em.scanTotalPages.value }}</span>
            <button
              class="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
              :disabled="em.scanPage.value >= em.scanTotalPages.value"
              @click="handleScanNextPage"
            >
              <ChevronRight class="h-4 w-4" />
            </button>
          </div>
        </div>

        <div class="pt-4 pb-2">
          <button
            class="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            @click="handleToggleDismissed"
          >
            <component :is="em.showDismissed.value ? ChevronUp : ChevronDown" class="h-4 w-4" />
            <span>
              {{ em.showDismissed.value ? t('tools.entityManager.dismissed.hidePairs') : t('tools.entityManager.dismissed.showPairs') }}
              <template v-if="!em.showDismissed.value && em.dismissedPairs.value.length > 0"> ({{ em.dismissedPairs.value.length }}) </template>
            </span>
          </button>
          <div v-if="em.showDismissed.value" class="mt-3">
            <DismissedPairsSection :pairs="em.dismissedPairs.value" :loading="em.dismissedLoading.value" @undismiss="handleUndismiss" />
          </div>
        </div>
      </template>

      <!-- Browse mode -->
      <template v-if="em.mode.value === 'browse'">
        <EntityBrowseTable
          :items="em.browseItems.value"
          :total="em.browseTotal.value"
          :page="em.browsePage.value"
          :page-size="em.browsePageSize.value"
          :total-pages="em.browseTotalPages.value"
          :search="em.browseSearch.value"
          :sort-by="em.browseSortBy.value"
          :sort-order="em.browseSortOrder.value"
          :book-count="em.browseBookCount.value"
          :loading="em.browseLoading.value"
          :selected-ids="em.selectedIds.value"
          :capabilities="em.capabilities.value"
          :is-inline="em.isInline.value"
          @update:page="handleUpdatePage"
          @update:search="handleUpdateSearch"
          @update:book-count="handleUpdateBookCount"
          @sort-change="handleBrowseSortChange"
          @select="handleSelectItem"
          @rename="handleRename"
          @delete="handleDelete"
          @split="handleSplit"
          @bulk-delete="handleBulkDelete"
          @bulk-merge="handleBulkMerge"
          @clear-selection="em.clearSelection"
          @refresh="em.fetchBrowse"
        />
      </template>
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
