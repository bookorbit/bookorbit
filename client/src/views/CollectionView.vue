<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AlertTriangle, CheckSquare, FileSpreadsheet, FolderOpen, Layers, Pencil, Search, SlidersHorizontal, Square, X } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import VirtualBookTable from '@/features/book/components/VirtualBookTable.vue'
import TableColumnPanel from '@/features/book/components/TableColumnPanel.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import BulkEditMetadataDialog from '@/features/book/components/BulkEditMetadataDialog.vue'
import MetadataExportDialog from '@/features/book/components/MetadataExportDialog.vue'
import EditCollectionDialog from '@/features/collection/components/EditCollectionDialog.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import JumpRail from '@/features/book/components/JumpRail.vue'
import { toast } from 'vue-sonner'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useBookViewWindow } from '@/features/book/composables/useBookViewWindow'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'
import { useViewSearch } from '@/features/book/composables/useViewSearch'
import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'
import { useViewDisplaySettings } from '@/composables/useViewDisplaySettings'
import { usePageTitle } from '@/composables/usePageTitle'
import { DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { useViewSort } from '@/features/book/composables/useViewSort'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useBookViewContext } from '@/features/book/composables/useBookViewContext'
import { useBookTableShell } from '@/features/book/composables/useBookTableShell'
import { useInfiniteScrollSentinel } from '@/features/book/composables/useInfiniteScrollSentinel'
import { useSavedViews, type SavedView } from '@/features/book/composables/useSavedViews'
import { useBulkEditMetadata } from '@/features/book/composables/useBulkEditMetadata'
import type { BulkEditFields } from '@/features/book/composables/useBulkEditMetadata'
import type { BookCard } from '@bookorbit/types'
import EntityNotFound from '@/components/EntityNotFound.vue'

const route = useRoute()
const router = useRouter()
const { viewMode, effectiveViewMode } = useEffectiveViewMode()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()

const collectionId = computed(() => Number(route.params.id))
const { tableDensity } = useDisplaySettings()
const { allSavedViews, saveView, renameView, deleteView, duplicateView, toggleFavorite, importViews } = useSavedViews('collection', collectionId)
const coverAspectRatio = computed(() => DEFAULT_COVER_ASPECT_RATIO)
const { coverSize, gridGap } = useViewDisplaySettings('collection', collectionId, coverAspectRatio)
const { collections, loaded: collectionsLoaded, error: collectionsError, fetchCollections, removeBooksFromCollection } = useCollections()
const collectionNotFound = ref(false)
const collection = computed(() => collections.value.find((c) => c.id === collectionId.value))
const pageTitle = computed(() => {
  if (collection.value?.name) return `Collection · ${collection.value.name}`
  return Number.isFinite(collectionId.value) ? `Collection #${collectionId.value}` : 'Collection'
})
usePageTitle(pageTitle)

const { getEffectivePreference, setPreference, prefs } = useSeriesCollapsePreference()
const collapseEnabledRef = ref(getEffectivePreference({ collectionId: collectionId.value }))

watch(collectionId, (id) => {
  collapseEnabledRef.value = getEffectivePreference({ collectionId: id })
})

watch(prefs, () => {
  collapseEnabledRef.value = getEffectivePreference({ collectionId: collectionId.value })
})

const { searchQuery, debouncedQuery, clearSearch } = useViewSearch()

const {
  booksProxy: books,
  slots,
  total,
  loading,
  initialized: booksInitialized,
  error: booksError,
  sort: tableSort,
  reset: resetBooks,
  contiguousPrefix,
  hasMorePrefix,
  loadMorePrefix,
  handleRange,
  handleFirstVisibleIndex,
  registerScroller,
  handleJump,
  buckets,
  bucketKind,
  refreshBuckets,
  railVisible,
  activeBucketKey,
  letterTemplate,
  railGutterReserved,
  releaseRailGutter,
} = useBookViewWindow({
  scopeId: collectionId,
  listEndpoint: (id) => `/api/v1/collections/${id}/books/query`,
  bucketsEndpoint: (id) => `/api/v1/collections/${id}/books/jump-buckets`,
  viewMode: effectiveViewMode,
  collapseEnabled: collapseEnabledRef,
  q: debouncedQuery,
})
const { sortModel: tableSortModel } = useViewSort(tableSort, 'collection', collectionId)
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
const collectionLoadError = computed(() => collectionsError.value ?? booksError.value)
const { setBookContext } = useBookNavigation()
useBookViewContext(slots, total, loadMorePrefix)

function handleSaveCurrentView(name: string) {
  if (!tableRef.value) return
  saveView({
    name,
    layout: tableRef.value.currentLayout,
    sort: tableSort.value,
  })
}

function handleApplySavedView(view: SavedView) {
  tableRef.value?.applyPreset(view.layout, view.sort)
}

function handleExportTableBackup() {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          version: 1,
          presets: tableRef.value?.allPresets.filter((preset) => !preset.isBuiltIn) ?? [],
          savedViews: allSavedViews.value,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `collection-table-backup-${collectionId.value ?? 'shared'}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function handleImportTableBackup(file: File) {
  const raw = await file.text()
  const parsed = JSON.parse(raw) as { presets?: unknown[]; savedViews?: unknown[] }
  handleImportPresetBackup((parsed.presets ?? []) as never)
  importViews((parsed.savedViews ?? []) as SavedView[])
}

function handleTableDensityChange(value: 'compact' | 'comfortable' | 'roomy') {
  tableDensity.value = value
}

function handleSelectAllLoaded(checked: boolean) {
  const ids = books.value.map((book) => book.id)
  if (checked) selectAll(ids)
  else deselectAll(ids)
}

const {
  tableRef,
  handleResetColumns,
  handleToggleColumn,
  handleColumnPanelReorder,
  handleApplyTablePreset,
  handleSaveTablePreset,
  handleDeleteTablePreset,
  handleRenameTablePreset,
  handleDuplicateTablePreset,
  handleTogglePresetFavorite,
  handleImportPresetBackup,
  selectionMode,
  selectedIds,
  selectedCount,
  enterSelectionMode,
  exitSelectionMode,
  selectAll,
  deselectAll,
  isSelected,
  handleSelect,
  toggleSelectionMode,
  deleteBookId,
  deletingBook,
  cancelDelete,
  confirmDelete,
  inFlight,
  handleBulkRefreshMetadata,
  handleBulkReExtractCover,
  handleDownloadFiles,
  handleBulkSetStatus,
  handleBulkSetRating,
  handleBulkSetField,
  handleBulkSetMetadataLock,
  handleDeleteSelected,
  addToCollectionOpen,
  bulkEditOpen,
  sendBookOpen,
  quickViewBookId,
  quickViewOpen,
  handleBookAction,
  handleTableBookUpdate,
  handleEditIndividually,
} = useBookTableShell({
  books,
})

const metadataExportOpen = ref(false)
const visibleExportColumns = computed(() => {
  if (!tableRef.value) return []
  return tableRef.value.allColumns.filter((column) => column.visible).map((column) => column.id)
})

const editCollectionOpen = ref(false)
const mobileControlsExpanded = ref(false)
let removingInProgress = false

async function handleRemoveFromCollection() {
  if (removingInProgress || !collectionId.value || selectedIds.value.size === 0) return
  removingInProgress = true
  try {
    const ids = [...selectedIds.value]
    await removeBooksFromCollection(collectionId.value, { bookIds: ids })
    resetBooks()
    refreshBuckets()
    exitSelectionMode()
    toast.success(`Removed ${ids.length} book${ids.length === 1 ? '' : 's'} from collection`)
  } catch {
    toast.error('Failed to remove books from collection')
  } finally {
    removingInProgress = false
  }
}

function handleCollectionDeleted() {
  editCollectionOpen.value = false
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 640
}

function closeMobileControls() {
  mobileControlsExpanded.value = false
}

function collapseMobileControlsIfNeeded() {
  if (!mobileControlsExpanded.value) return
  if (!isMobileViewport()) return
  closeMobileControls()
}

function toggleMobileControls() {
  mobileControlsExpanded.value = !mobileControlsExpanded.value
}

function openCollectionEditor() {
  editCollectionOpen.value = true
  collapseMobileControlsIfNeeded()
}

function openMetadataExport() {
  metadataExportOpen.value = true
  collapseMobileControlsIfNeeded()
}

const { submit: submitBulkEdit, submitting: bulkEditSubmitting, selectedCount: bulkEditCount } = useBulkEditMetadata(selectedIds, books)

function handleEditSelected() {
  const count = selectedIds.value.size
  if (count === 0) return
  if (count >= 2) {
    bulkEditOpen.value = true
    return
  }
  const ids = [...selectedIds.value]
  setBookContext(ids, ids.length)
  router.push({ name: 'book-detail', params: { bookId: ids[0] }, query: { tab: 'edit' } })
  exitSelectionMode()
}

async function handleBulkEditConfirm(fields: BulkEditFields) {
  const result = await submitBulkEdit(fields)
  if (result) {
    bulkEditOpen.value = false
    resetBooks()
  }
}

async function handleToggleCollapse() {
  const next = !collapseEnabledRef.value
  collapseEnabledRef.value = next
  await setPreference({ collectionId: collectionId.value }, next)
}

const { sentinel } = useInfiniteScrollSentinel({
  hasMore: hasMorePrefix,
  loading,
  loadMore: loadMorePrefix,
})

const bookGridRef = ref<{ scrollToIndex: (index: number) => void } | null>(null)

watch(
  [bookGridRef, tableRef, effectiveViewMode],
  () => {
    if (effectiveViewMode.value === 'grid' && bookGridRef.value) {
      const grid = bookGridRef.value
      registerScroller((index) => grid.scrollToIndex(index))
    } else if (effectiveViewMode.value === 'table' && tableRef.value) {
      const table = tableRef.value
      registerScroller((index) => table.scrollToIndex(index))
    } else {
      registerScroller(null)
    }
  },
  { immediate: true },
)

onMounted(async () => {
  await retryCollectionLoad()
})

async function retryCollectionLoad() {
  collectionNotFound.value = false
  await fetchCollections()
  if (collectionsError.value) return
  if (!collection.value && collectionsLoaded.value) {
    collectionNotFound.value = true
    return
  }
  if (collection.value && booksError.value) {
    resetBooks()
  }
}

watch(collectionId, async () => {
  clearSearch()
  await retryCollectionLoad()
})

defineOptions({ name: 'CollectionView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <BookQuickView
      :book-id="quickViewBookId"
      :open="quickViewOpen"
      @update:open="quickViewOpen = $event"
      @action="quickViewBookId !== null && handleBookAction({ id: quickViewBookId } as BookCard, $event)"
    />

    <SelectionActionBar
      :visible="selectionMode"
      :count="selectedCount"
      :in-collection="true"
      :in-flight="inFlight"
      @send="sendBookOpen = true"
      @download="handleDownloadFiles"
      @export-metadata="openMetadataExport"
      @add-to-collection="addToCollectionOpen = true"
      @remove-from-collection="handleRemoveFromCollection"
      @edit="handleEditSelected"
      @edit-individually="handleEditIndividually"
      @refresh-metadata="handleBulkRefreshMetadata"
      @re-extract-cover="handleBulkReExtractCover"
      @set-status="handleBulkSetStatus"
      @set-rating="handleBulkSetRating"
      @set-field="handleBulkSetField"
      @lock-metadata="handleBulkSetMetadataLock"
      @delete="handleDeleteSelected"
      @exit="exitSelectionMode"
    />

    <MetadataExportDialog
      :open="metadataExportOpen"
      view-type="collection"
      :selected-book-ids="[...selectedIds]"
      :selected-count="selectedCount"
      :total-count="total"
      :sort="tableSort"
      :visible-columns="visibleExportColumns"
      default-scope="selected"
      @update:open="metadataExportOpen = $event"
    />

    <AddToCollectionSheet
      :open="addToCollectionOpen"
      :selection-payload="{ bookIds: [...selectedIds] }"
      :selected-count="selectedCount"
      @update:open="addToCollectionOpen = $event"
      @done="exitSelectionMode"
    />
    <BulkEditMetadataDialog
      :open="bulkEditOpen"
      :book-count="bulkEditCount"
      :submitting="bulkEditSubmitting"
      @update:open="bulkEditOpen = $event"
      @confirm="handleBulkEditConfirm"
    />

    <EditCollectionDialog
      v-if="collection"
      :open="editCollectionOpen"
      :collection="collection"
      @close="editCollectionOpen = false"
      @deleted="handleCollectionDeleted"
    />
    <SendBookDialog
      :open="sendBookOpen"
      :selection-payload="{ bookIds: [...selectedIds] }"
      :selected-count="selectedCount"
      @update:open="sendBookOpen = $event"
      @sent="exitSelectionMode"
    />
    <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />

    <section class="flex flex-1 flex-col min-h-0">
      <ViewHeader
        :title="collection?.name ?? 'Collection'"
        :icon="collection?.icon || 'FolderOpen'"
        fallback-icon="FolderOpen"
        :total="total"
        v-model:coverSize="coverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="viewMode"
        :selection-mode="selectionMode"
        :searchable="true"
        :mobile-search-in-menu="false"
        v-model:searchQuery="searchQuery"
        @toggle-selection="toggleSelectionMode"
      >
        <template #toolbar>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="hidden sm:flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                :class="
                  collapseEnabledRef
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                "
                @click="handleToggleCollapse"
              >
                <Layers :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ collapseEnabledRef ? 'Expand series' : 'Collapse series' }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                v-if="hasPermission('library_download') && !isDemoRestrictedAccount"
                class="hidden sm:flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground bg-background transition-colors hover:text-foreground hover:bg-muted"
                @click="openMetadataExport"
              >
                <FileSpreadsheet :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Export metadata</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                v-if="collection"
                class="hidden sm:flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="openCollectionEditor"
              >
                <Pencil :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit collection</TooltipContent>
          </Tooltip>

          <button
            class="sm:hidden flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="toggleMobileControls"
          >
            <SlidersHorizontal :size="14" />
          </button>
        </template>
        <template #mobile-menu>
          <DropdownMenuItem @click="handleToggleCollapse">
            <CheckSquare v-if="collapseEnabledRef" :size="14" class="mr-2" />
            <Square v-else :size="14" class="mr-2" />
            Collapse series
          </DropdownMenuItem>
        </template>
        <template v-if="effectiveViewMode === 'table'" #columns>
          <TableColumnPanel
            v-if="tableRef"
            :all-columns="tableRef.allColumns"
            :all-presets="tableRef.allPresets"
            :saved-views="allSavedViews"
            :table-density="tableDensity"
            @toggle-column="handleToggleColumn"
            @reorder-columns="handleColumnPanelReorder"
            @apply-preset="handleApplyTablePreset"
            @save-preset="handleSaveTablePreset"
            @delete-preset="handleDeleteTablePreset"
            @rename-preset="handleRenameTablePreset"
            @duplicate-preset="handleDuplicateTablePreset"
            @favorite-preset="handleTogglePresetFavorite"
            @apply-view="handleApplySavedView"
            @save-view="handleSaveCurrentView"
            @delete-view="deleteView"
            @rename-view="renameView"
            @duplicate-view="duplicateView"
            @favorite-view="toggleFavorite"
            @update:density="handleTableDensityChange"
            @export-backup="handleExportTableBackup"
            @import-backup="handleImportTableBackup"
            @reset="handleResetColumns"
          />
        </template>
      </ViewHeader>

      <section v-if="mobileControlsExpanded" class="mb-3 rounded-lg border border-border/70 bg-card/70 p-2 sm:hidden">
        <div class="mb-2 flex h-9 items-center rounded-md border border-input bg-background px-2.5">
          <Search :size="13" class="mr-1.5 shrink-0 text-muted-foreground/85" />
          <input
            v-model="searchQuery"
            type="search"
            placeholder="Search title, author, series, narrator..."
            class="mobile-search-input h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          />
          <button v-if="searchQuery.trim()" class="ml-1 text-muted-foreground/85 transition-colors hover:text-foreground" @click="clearSearch">
            <X :size="12" />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            class="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors"
            :class="
              collapseEnabledRef
                ? 'border-primary text-primary bg-primary/10'
                : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground'
            "
            @click="handleToggleCollapse"
          >
            <Layers :size="13" />
            <span>{{ collapseEnabledRef ? 'Expanded' : 'Collapse series' }}</span>
          </button>
          <button
            v-if="hasPermission('library_download') && !isDemoRestrictedAccount"
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="openMetadataExport"
          >
            <FileSpreadsheet :size="13" />
            <span>Export</span>
          </button>
          <button
            v-if="collection"
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="openCollectionEditor"
          >
            <Pencil :size="13" />
            <span>Edit</span>
          </button>
          <button
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="closeMobileControls"
          >
            <X :size="13" />
            <span>Close</span>
          </button>
        </div>
      </section>

      <main ref="mainRef" :class="effectiveViewMode === 'table' ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'">
        <div v-if="collectionLoadError" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle :size="28" />
          </div>
          <p class="text-sm font-medium text-foreground">Could not load this collection</p>
          <p class="max-w-md text-xs text-muted-foreground">{{ collectionLoadError }}</p>
          <button
            class="rounded-md border border-input px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            @click="retryCollectionLoad"
          >
            Retry
          </button>
        </div>

        <EntityNotFound v-else-if="collectionNotFound" entity="Collection" />

        <div v-else-if="booksInitialized && !loading && books.length === 0" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <FolderOpen :size="28" class="text-muted-foreground/70" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ debouncedQuery ? 'No books match this search' : 'No books in this collection' }}</p>
          <p class="text-xs text-muted-foreground">
            {{ debouncedQuery ? 'Try a different search term or clear the search.' : 'Select books from your library and add them here.' }}
          </p>
        </div>

        <VirtualBookGrid
          v-if="effectiveViewMode === 'grid' && books.length > 0"
          ref="bookGridRef"
          :books="slots"
          :cover-size="coverSize"
          :grid-gap="gridGap"
          :selection-mode="selectionMode"
          :is-selected="isSelected"
          :rail-gutter="railGutterReserved"
          @range="handleRange"
          @first-visible-index="handleFirstVisibleIndex"
          @action="handleBookAction"
          @select="handleSelect"
        />

        <div v-if="effectiveViewMode === 'list' && contiguousPrefix.length > 0" class="flex flex-col divide-y divide-border">
          <BookListRow
            v-for="book in contiguousPrefix"
            :key="book.id"
            :book="book"
            :selection-mode="selectionMode"
            :selected="isSelected(book.id)"
            @action="handleBookAction(book, $event)"
            @select="handleSelect(book.id, $event)"
          />
        </div>

        <!-- Table view -->
        <VirtualBookTable
          v-if="effectiveViewMode === 'table'"
          ref="tableRef"
          :books="slots"
          :in-flight="inFlight"
          :sort="tableSort"
          :loading="loading"
          :total="total"
          view-type="collection"
          :selection-mode="selectionMode"
          :is-selected="isSelected"
          :selected-count="selectedCount"
          :initialized="booksInitialized"
          @update:sort="tableSortModel = $event"
          @action="handleBookAction"
          @select="handleSelect"
          @update:book="handleTableBookUpdate"
          @visible-range="handleRange"
          @first-visible-index="handleFirstVisibleIndex"
          @select-all="handleSelectAllLoaded"
          @enter-selection="enterSelectionMode"
        />

        <div v-if="effectiveViewMode === 'list'" ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
          <span v-if="loading" class="text-xs text-muted-foreground">Loading...</span>
          <span v-else-if="!hasMorePrefix && contiguousPrefix.length > 0" class="text-xs text-muted-foreground"
            >All {{ total.toLocaleString() }} books loaded</span
          >
        </div>

        <JumpRail
          :visible="railVisible"
          :buckets="buckets"
          :kind="bucketKind ?? 'letter'"
          :active-key="activeBucketKey"
          :template="bucketKind === 'letter' ? letterTemplate : undefined"
          @jump="handleJump"
          @after-leave="releaseRailGutter"
        />
      </main>
    </section>
  </div>
</template>

<style scoped>
.mobile-search-input::-webkit-search-decoration,
.mobile-search-input::-webkit-search-cancel-button,
.mobile-search-input::-webkit-search-results-button,
.mobile-search-input::-webkit-search-results-decoration {
  -webkit-appearance: none;
}

.mobile-search-input::-ms-clear,
.mobile-search-input::-ms-reveal {
  display: none;
  width: 0;
  height: 0;
}
</style>
