<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { AlertTriangle, FileSpreadsheet, Pencil, Trash2 } from '@lucide/vue'
import BookSortBuilder from '@/features/book/components/BookSortBuilder.vue'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import BookShuffleButton from '@/features/book/components/BookShuffleButton.vue'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowseSearchField from '@/components/browse-header/BrowseSearchField.vue'
import BrowseSortControl from '@/components/browse-header/BrowseSortControl.vue'
import BrowseFilterControl from '@/components/browse-header/BrowseFilterControl.vue'
import BrowseViewControls from '@/components/browse-header/BrowseViewControls.vue'
import BrowsePageMenu from '@/components/browse-header/BrowsePageMenu.vue'
import { barDivider, outlineButton } from '@/components/browse-header/browse-header'
import ViewHeaderDisplayControls from '@/components/view-header/ViewHeaderDisplayControls.vue'
import { useFilterTokens } from '@/features/book/composables/useFilterTokens'
import { sortFieldLabel } from '@/features/book/lib/filter-labels'
import { cn } from '@/lib/utils'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import VirtualBookTable from '@/features/book/components/VirtualBookTable.vue'
import TableColumnPanel from '@/features/book/components/TableColumnPanel.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import MoveToLibrarySheet from '@/features/book/components/MoveToLibrarySheet.vue'
import { useMoveToLibraryTarget } from '@/features/book/composables/useMoveToLibraryTarget'
import BulkEditMetadataDialog from '@/features/book/components/BulkEditMetadataDialog.vue'
import MetadataExportDialog from '@/features/book/components/MetadataExportDialog.vue'
import EditCollectionDialog from '@/features/collection/components/EditCollectionDialog.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import JumpRail from '@/features/book/components/JumpRail.vue'
import { toast } from 'vue-sonner'
import { useCollections } from '@/features/collection/composables/useCollections'
import { canMutateCollection } from '@/features/collection/lib/collection-access'
import { useBookViewWindow } from '@/features/book/composables/useBookViewWindow'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'
import { useEffectiveSeriesCollapse } from '@/features/book/composables/useEffectiveSeriesCollapse'
import { useViewSearch } from '@/features/book/composables/useViewSearch'
import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'
import { useViewDisplaySettings } from '@/composables/useViewDisplaySettings'
import { usePageTitle } from '@/composables/usePageTitle'
import { DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { useViewSort } from '@/features/book/composables/useViewSort'
import { COLLECTION_DEFAULT_SORT } from '@/features/book/lib/sort-defaults'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useBookViewContext } from '@/features/book/composables/useBookViewContext'
import { useBookTableShell } from '@/features/book/composables/useBookTableShell'
import { useInfiniteScrollSentinel } from '@/composables/useInfiniteScrollSentinel'
import { useSavedViews, type SavedView } from '@/features/book/composables/useSavedViews'
import { useBulkEditMetadata } from '@/features/book/composables/useBulkEditMetadata'
import type { BulkEditFields } from '@/features/book/composables/useBulkEditMetadata'
import type { BookCard } from '@bookorbit/types'
import EntityNotFound from '@/components/EntityNotFound.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { viewMode, effectiveViewMode } = useEffectiveViewMode()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()

const collectionId = shallowRef(Number(route.params.id))
const { tableDensity, showJumpRails } = useDisplaySettings()
const { allSavedViews, saveView, renameView, deleteView, duplicateView, toggleFavorite, importViews } = useSavedViews('collection', collectionId)
const coverAspectRatio = computed(() => DEFAULT_COVER_ASPECT_RATIO)
const { coverSize, gridGap } = useViewDisplaySettings('collection', collectionId, coverAspectRatio)
const {
  collections,
  loaded: collectionsLoaded,
  error: collectionsError,
  fetchCollections,
  removeBooksFromCollection,
  deleteCollection,
} = useCollections()
const collectionNotFound = ref(false)
const collection = computed(() => collections.value.find((c) => c.id === collectionId.value))
const isCollectionOwner = computed(() => canMutateCollection(collection.value))
const pageTitle = computed(() => {
  if (collection.value?.name) return t('views.collection.pageTitle', { name: collection.value.name })
  return Number.isFinite(collectionId.value) ? t('views.collection.pageTitleWithId', { id: collectionId.value }) : t('views.collection.title')
})
usePageTitle(pageTitle)

const { getEffectivePreference, setPreference, prefs } = useSeriesCollapsePreference()
const collapseEnabledRef = ref(getEffectivePreference({ collectionId: collectionId.value }))
const selectionMode = ref(false)
const effectiveCollapseEnabled = useEffectiveSeriesCollapse(collapseEnabledRef, selectionMode)

watch(collectionId, (id) => {
  collapseEnabledRef.value = getEffectivePreference({ collectionId: id })
})

watch(prefs, () => {
  collapseEnabledRef.value = getEffectivePreference({ collectionId: collectionId.value })
})

const { searchQuery, debouncedQuery, clearSearch } = useViewSearch()
const mainRef = ref<HTMLElement | null>(null)

const {
  booksProxy: books,
  slots,
  total,
  loading,
  initialized: booksInitialized,
  error: booksError,
  filter,
  sort: tableSort,
  randomSortActive,
  reshuffle,
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
  primarySortField,
  temporalGranularity,
  railCapacity,
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
  railEnabled: showJumpRails,
  railViewport: mainRef,
  collapseEnabled: effectiveCollapseEnabled,
  q: debouncedQuery,
  defaultSort: COLLECTION_DEFAULT_SORT,
})
const { sortModel: tableSortModel, isDefaultSort, resetSort } = useViewSort(tableSort, 'collection', collectionId, COLLECTION_DEFAULT_SORT)
const sortLabel = computed(() => (tableSort.value[0] ? sortFieldLabel(tableSort.value[0].field) : ''))
const sortDirection = computed<'asc' | 'desc'>(() => tableSort.value[0]?.dir ?? 'asc')

function toggleSortDirection() {
  const [first, ...rest] = tableSort.value
  if (!first) return
  tableSortModel.value = [{ ...first, dir: first.dir === 'asc' ? 'desc' : 'asc' }, ...rest]
}

const filterOpen = ref(false)
const { tokens: filterTokens, ruleCount: filterRuleCount, removeToken: removeFilterToken } = useFilterTokens(filter, { formatFacet: false })
const isNarrowed = computed(() => filterRuleCount.value > 0 || debouncedQuery.value.trim().length > 0)
const canExport = computed(() => hasPermission('library_download') && !isDemoRestrictedAccount.value)

function clearFilters() {
  filter.value = undefined
}

function handleClearAll() {
  clearFilters()
  clearSearch()
}

function openFilterPanel() {
  filterOpen.value = true
}
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
  const ids = books.value.filter((book) => !book.collapsedSeries).map((book) => book.id)
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
  selectedIds,
  selectedCount,
  canEditSelectionMetadata,
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
  selectionMode,
  onMoveToLibrary: (bookId) => openMoveForBook(bookId),
})

const {
  open: moveToLibraryOpen,
  payload: movePayload,
  count: moveCount,
  openForSelection: openMoveForSelection,
  openForBook: openMoveForBook,
  setOpen: setMoveOpen,
} = useMoveToLibraryTarget({
  getSelectionPayload: () => ({ bookIds: [...selectedIds.value] }),
  selectedCount,
})

// A moved book keeps its collection and scope membership, so only the stale
// selection needs clearing here.
function handleBooksMoved() {
  exitSelectionMode()
}

const metadataExportOpen = ref(false)
const visibleExportColumns = computed(() => {
  if (!tableRef.value) return []
  return tableRef.value.allColumns.filter((column) => column.visible).map((column) => column.id)
})

const editCollectionOpen = ref(false)
let removingInProgress = false

async function handleRemoveFromCollection() {
  if (!isCollectionOwner.value || removingInProgress || !collectionId.value || selectedIds.value.size === 0) return
  removingInProgress = true
  try {
    const ids = [...selectedIds.value]
    await removeBooksFromCollection(collectionId.value, { bookIds: ids })
    resetBooks()
    refreshBuckets()
    exitSelectionMode()
    toast.success(t('views.collection.toast.removed', { count: ids.length }))
  } catch {
    toast.error(t('views.collection.toast.removeFailed'))
  } finally {
    removingInProgress = false
  }
}

function handleCollectionDeleted() {
  editCollectionOpen.value = false
}

function openCollectionEditor() {
  editCollectionOpen.value = true
}

function openMetadataExport() {
  metadataExportOpen.value = true
}

const hasPageMenu = computed(() => (isCollectionOwner.value && collection.value !== undefined) || canExport.value)

interface HeaderFact {
  key: string
  text: string
}

const headerFacts = computed<HeaderFact[]>(() => {
  const facts: HeaderFact[] = []
  const collectionTotal = collection.value?.bookCount ?? null
  if (typeof collectionTotal === 'number') {
    if (isNarrowed.value && !effectiveCollapseEnabled.value && booksInitialized.value) {
      facts.push({ key: 'count', text: t('components.browseHeader.facts.booksOf', { matching: formatNumber(total.value), total: collectionTotal }) })
    } else {
      facts.push({ key: 'count', text: t('components.browseHeader.facts.books', { count: collectionTotal }) })
    }
  }
  const description = collection.value?.description?.trim()
  if (description) facts.push({ key: 'description', text: description })
  return facts
})

const foldedCount = computed(() => {
  const count = collection.value?.bookCount
  return typeof count === 'number' ? formatNumber(count) : undefined
})

const confirmDeleteOpen = ref(false)
const deletingCollection = ref(false)

function requestDelete() {
  confirmDeleteOpen.value = true
}

function cancelCollectionDelete() {
  confirmDeleteOpen.value = false
}

async function handleDeleteCollection() {
  const current = collection.value
  if (!current) return
  deletingCollection.value = true
  try {
    await deleteCollection(current.id)
    toast.success(t('collection.editDialog.deleted', { name: current.name }))
    void router.replace({ name: 'dashboard' })
  } catch {
    toast.error(t('collection.editDialog.deleteFailed'))
  } finally {
    deletingCollection.value = false
    confirmDeleteOpen.value = false
  }
}

function handleCoverSizeUpdate(value: number) {
  coverSize.value = value
}

function handleGridGapUpdate(value: number) {
  gridGap.value = value
}

function handleShowJumpRailsUpdate(value: boolean) {
  showJumpRails.value = value
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

async function handleCollapseSeriesUpdate(next: boolean) {
  if (selectionMode.value) return
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
  filter.value = undefined
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
      :metadata-editable="canEditSelectionMetadata"
      :visible="selectionMode"
      :count="selectedCount"
      :in-collection="isCollectionOwner"
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
      @move-to-library="openMoveForSelection"
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

    <MoveToLibrarySheet
      :open="moveToLibraryOpen"
      :selection-payload="movePayload"
      :selected-count="moveCount"
      @update:open="setMoveOpen"
      @moved="handleBooksMoved"
    />
    <BulkEditMetadataDialog
      :open="bulkEditOpen"
      :book-count="bulkEditCount"
      :submitting="bulkEditSubmitting"
      @update:open="bulkEditOpen = $event"
      @confirm="handleBulkEditConfirm"
    />

    <EditCollectionDialog
      v-if="collection && isCollectionOwner"
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

    <ConfirmDialog
      :open="confirmDeleteOpen"
      :title="t('components.browseHeader.menu.deleteCollection')"
      :description="t('components.browseHeader.menu.confirmDelete', { name: collection?.name ?? t('views.collection.title') })"
      :confirm-label="t('common.delete')"
      :busy="deletingCollection"
      @confirm="handleDeleteCollection"
      @cancel="cancelCollectionDelete"
    />

    <section class="flex flex-1 flex-col min-h-0">
      <BrowseHeader
        :eyebrow="t('components.browseHeader.eyebrow.collection')"
        :title="collection?.name ?? t('views.collection.title')"
        :icon="collection?.icon || 'FolderOpen'"
        fallback-icon="FolderOpen"
        :folded-count="foldedCount"
        :switcher="Number.isFinite(collectionId) ? { kind: 'collection', id: collectionId } : null"
        :scroll-container="mainRef"
      >
        <template #facts>
          <template v-for="(fact, index) in headerFacts" :key="fact.key">
            <span v-if="index > 0" class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span class="truncate" :class="fact.key === 'count' ? 'shrink-0' : ''">{{ fact.text }}</span>
          </template>
        </template>

        <template #actions>
          <button
            v-if="isCollectionOwner && collection"
            type="button"
            :class="cn(outlineButton, 'hidden md:inline-flex')"
            @click="openCollectionEditor"
          >
            <Pencil :size="14" class="text-muted-foreground" aria-hidden="true" />
            {{ t('common.edit') }}
          </button>
          <BrowsePageMenu v-if="hasPageMenu" :name="collection?.name ?? t('views.collection.title')">
            <DropdownMenuItem v-if="isCollectionOwner && collection" class="md:hidden" @click="openCollectionEditor">
              <Pencil :size="14" class="mr-2" />
              {{ t('views.collection.editCollection') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canExport" @click="openMetadataExport">
              <FileSpreadsheet :size="14" class="mr-2" />
              {{ t('views.bookView.exportMetadata') }}
            </DropdownMenuItem>
            <template v-if="isCollectionOwner && collection">
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="requestDelete">
                <Trash2 :size="14" class="mr-2" />
                {{ t('components.browseHeader.menu.deleteCollection') }}
              </DropdownMenuItem>
            </template>
          </BrowsePageMenu>
        </template>

        <template #bar>
          <BrowseSearchField
            v-model="searchQuery"
            :placeholder="t('views.bookView.searchPlaceholder')"
            :tokens="filterTokens"
            :active="isNarrowed"
            @remove-token="removeFilterToken"
            @clear="handleClearAll"
            @open-filters="openFilterPanel"
          />
          <span :class="barDivider" aria-hidden="true" />
          <BrowseSortControl
            v-if="effectiveViewMode !== 'table'"
            :label="sortLabel"
            :direction="sortDirection"
            :changed="!isDefaultSort"
            @toggle-direction="toggleSortDirection"
          >
            <BookSortBuilder v-model="tableSortModel" collection-scoped />
            <button
              v-if="!isDefaultSort"
              type="button"
              class="mt-3 w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              @click="resetSort"
            >
              {{ t('views.bookView.resetSort') }}
            </button>
          </BrowseSortControl>
          <BookShuffleButton v-if="randomSortActive" desktop-only compact @shuffle="reshuffle" />
          <BrowseFilterControl v-model:open="filterOpen" :count="filterRuleCount">
            <BookFilterBuilder v-model="filter" />
            <template v-if="filterRuleCount > 0" #footer>
              <span class="flex-1" />
              <button
                type="button"
                class="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
                @click="clearFilters"
              >
                {{ t('views.bookView.clearAllFilters') }}
              </button>
            </template>
          </BrowseFilterControl>
          <span :class="barDivider" aria-hidden="true" />
          <BrowseViewControls
            v-model:view-mode="viewMode"
            :selection-mode="selectionMode"
            :display-wide="effectiveViewMode === 'table'"
            @toggle-selection="toggleSelectionMode"
          >
            <template #display>
              <ViewHeaderDisplayControls
                :view-mode="effectiveViewMode"
                :cover-size="coverSize"
                :grid-gap="gridGap"
                show-jump-rail-toggle
                :show-jump-rails="showJumpRails"
                show-collapse-series
                :collapse-series="effectiveCollapseEnabled"
                :collapse-series-locked="selectionMode"
                @update:cover-size="handleCoverSizeUpdate"
                @update:grid-gap="handleGridGapUpdate"
                @update:show-jump-rails="handleShowJumpRailsUpdate"
                @update:collapse-series="handleCollapseSeriesUpdate"
              >
                <template #columns>
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
              </ViewHeaderDisplayControls>
            </template>
          </BrowseViewControls>
        </template>
      </BrowseHeader>

      <main ref="mainRef" :class="effectiveViewMode === 'table' ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'">
        <div v-if="collectionLoadError" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle :size="28" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('views.collection.loadError') }}</p>
          <p class="max-w-md text-xs text-muted-foreground">{{ collectionLoadError }}</p>
          <button
            class="rounded-md border border-input px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            @click="retryCollectionLoad"
          >
            {{ t('views.common.retry') }}
          </button>
        </div>

        <EntityNotFound v-else-if="collectionNotFound" :entity="t('views.entity.collection')" />

        <div v-else-if="booksInitialized && !loading && books.length === 0" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <FolderOpen :size="28" class="text-muted-foreground" />
          </div>
          <p class="text-sm font-medium text-foreground">
            {{ debouncedQuery ? t('views.collection.empty.noSearchMatch') : t('views.collection.empty.noBooks') }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ debouncedQuery ? t('views.collection.empty.noSearchMatchHint') : t('views.collection.empty.noBooksHint') }}
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
          :rail-gutter-kind="bucketKind"
          @range="handleRange"
          @first-visible-index="handleFirstVisibleIndex"
          :allow-move-to-library="true"
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
            :allow-move-to-library="true"
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
          :default-sort="COLLECTION_DEFAULT_SORT"
          :loading="loading"
          :total="total"
          view-type="collection"
          :selection-mode="selectionMode"
          :is-selected="isSelected"
          :selected-count="selectedCount"
          :initialized="booksInitialized"
          @update:sort="tableSortModel = $event"
          :allow-move-to-library="true"
          @action="handleBookAction"
          @select="handleSelect"
          @update:book="handleTableBookUpdate"
          @visible-range="handleRange"
          @first-visible-index="handleFirstVisibleIndex"
          @select-all="handleSelectAllLoaded"
          @enter-selection="enterSelectionMode"
        />

        <div v-if="effectiveViewMode === 'list'" ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
          <span v-if="loading" class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
          <span v-else-if="!hasMorePrefix && contiguousPrefix.length > 0" class="text-xs text-muted-foreground">{{
            t('views.bookView.allBooksLoaded', { count: formatNumber(total) })
          }}</span>
        </div>

        <JumpRail
          :visible="railVisible"
          :buckets="buckets"
          :kind="bucketKind ?? 'letter'"
          :field="primarySortField"
          :granularity="temporalGranularity"
          :max-slots="railCapacity"
          :viewport="mainRef"
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
