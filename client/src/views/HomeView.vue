<script setup lang="ts">
import { computed, onUnmounted, provide, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowUpDown,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  CheckSquare,
  FileSpreadsheet,
  Filter,
  Layers,
  Search,
  SlidersHorizontal,
  Square,
  Telescope,
  X,
} from '@lucide/vue'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import VirtualBookTable from '@/features/book/components/VirtualBookTable.vue'
import TableColumnPanel from '@/features/book/components/TableColumnPanel.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import BookSortBuilder from '@/features/book/components/BookSortBuilder.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import ViewHeader from '@/components/ViewHeader.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import BulkEditMetadataDialog from '@/features/book/components/BulkEditMetadataDialog.vue'
import { useBulkEditMetadata } from '@/features/book/composables/useBulkEditMetadata'
import type { BulkEditFields } from '@/features/book/composables/useBulkEditMetadata'
import MetadataExportDialog from '@/features/book/components/MetadataExportDialog.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import SaveAsSmartScopeDialog from '@/features/smart-scope/components/SaveAsSmartScopeDialog.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import JumpRail from '@/features/book/components/JumpRail.vue'
import type { BookCard } from '@bookorbit/types'
import { useBookViewWindow } from '@/features/book/composables/useBookViewWindow'
import { useViewSearch } from '@/features/book/composables/useViewSearch'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'

import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useLiveScanBooks } from '@/features/scanner/composables/useLiveScanBooks'
import ScanProgressBar from '@/features/scanner/components/ScanProgressBar.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'
import { useViewDisplaySettings } from '@/composables/useViewDisplaySettings'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'
import { useViewSort } from '@/features/book/composables/useViewSort'
import { usePageTitle } from '@/composables/usePageTitle'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookViewContext } from '@/features/book/composables/useBookViewContext'
import { useBookTableShell } from '@/features/book/composables/useBookTableShell'
import { useInfiniteScrollSentinel } from '@/features/book/composables/useInfiniteScrollSentinel'
import { useSavedViews, type SavedView } from '@/features/book/composables/useSavedViews'
import type { GroupRule, Rule, SortSpec } from '@bookorbit/types'
import EntityNotFound from '@/components/EntityNotFound.vue'
import { type QuerySelectionState } from '@/features/book/composables/useBookBulkActions'

const route = useRoute()
const router = useRouter()
const { viewMode, effectiveViewMode } = useEffectiveViewMode()
const { libraries, loaded: librariesLoaded } = useLibraries()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()

const libraryId = shallowRef<number | null>(route.params.id ? Number(route.params.id) : null)
const currentLibrary = computed(() => libraries.value.find((l) => l.id === libraryId.value))
const currentCoverAspectRatio = computed(() => currentLibrary.value?.coverAspectRatio ?? DEFAULT_COVER_ASPECT_RATIO)
const { coverSize, gridGap } = useViewDisplaySettings('library', libraryId, currentCoverAspectRatio)

const libraryNotFound = computed(() => librariesLoaded.value && libraryId.value !== null && !currentLibrary.value)
const title = computed(() => currentLibrary.value?.name ?? 'Library')
const libraryIcon = computed(() => currentLibrary.value?.icon ?? 'BookOpen')
const pageTitle = computed(() => {
  if (currentLibrary.value?.name) return `Library · ${currentLibrary.value.name}`
  return libraryId.value === null ? 'Library' : `Library #${libraryId.value}`
})
usePageTitle(pageTitle)

provide(COVER_ASPECT_RATIO_KEY, currentCoverAspectRatio)

const { getEffectivePreference, setPreference, prefs } = useSeriesCollapsePreference()
const collapseEnabledRef = ref(libraryId.value !== null ? getEffectivePreference({ libraryId: libraryId.value }) : false)

watch(libraryId, (id) => {
  collapseEnabledRef.value = id !== null ? getEffectivePreference({ libraryId: id }) : false
})

watch(prefs, () => {
  collapseEnabledRef.value = libraryId.value !== null ? getEffectivePreference({ libraryId: libraryId.value }) : false
})

const { searchQuery, debouncedQuery, clearSearch } = useViewSearch()

const {
  booksProxy: books,
  slots,
  total,
  loading,
  initialized: booksInitialized,
  error,
  filter,
  sort,
  reset: resetBooks,
  updateBooks,
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
  scopeId: libraryId,
  listEndpoint: (id) => `/api/v1/libraries/${id}/books`,
  bucketsEndpoint: (id) => `/api/v1/libraries/${id}/books/jump-buckets`,
  viewMode: effectiveViewMode,
  collapseEnabled: collapseEnabledRef,
  q: debouncedQuery,
})
const { onLibraryUploadCompleted } = useLibraryUploadEvents()
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
const { setBookContext } = useBookNavigation()
useBookViewContext(slots, total, loadMorePrefix)

const FILTER_STORAGE_PREFIX = 'bookorbit:filter:library:'
function getFilterKey(id: number) {
  return `${FILTER_STORAGE_PREFIX}${id}`
}

const savedFilter = ref<GroupRule | undefined>(undefined)
const hasSavedFilter = computed(() => savedFilter.value !== undefined)
const isFilterSaved = computed(() => JSON.stringify(filter.value) === JSON.stringify(savedFilter.value))

const { sortModel, isDefaultSort, sortSummary, resetSort } = useViewSort(sort, 'library', libraryId)
const { tableDensity } = useDisplaySettings()
const { allSavedViews, saveView, renameView, deleteView, duplicateView, toggleFavorite, importViews } = useSavedViews('library', libraryId)

function handleSaveCurrentView(name: string) {
  if (!tableRef.value) return
  saveView({
    name,
    layout: tableRef.value.currentLayout,
    sort: sort.value,
    filter: filter.value,
  })
}

function handleApplySavedView(view: SavedView) {
  tableRef.value?.applyPreset(view.layout, view.sort)
  filter.value = view.filter ? JSON.parse(JSON.stringify(view.filter)) : undefined
}

function handleRenameSavedView(id: string, name: string) {
  renameView(id, name)
}

function handleDeleteSavedView(id: string) {
  deleteView(id)
}

function handleDuplicateSavedView(id: string) {
  duplicateView(id)
}

function handleToggleSavedViewFavorite(id: string) {
  toggleFavorite(id)
}

function downloadBackup(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function handleExportTableBackup() {
  downloadBackup(`library-table-backup-${libraryId.value ?? 'shared'}.json`, {
    version: 1,
    presets: tableRef.value?.allPresets.filter((preset) => !preset.isBuiltIn) ?? [],
    savedViews: allSavedViews.value,
  })
}

async function handleImportTableBackup(file: File) {
  const raw = await file.text()
  const parsed = JSON.parse(raw) as { presets?: unknown[]; savedViews?: unknown[] }
  const importedPresets = handleImportPresetBackup((parsed.presets ?? []) as never)
  const importedViews = importViews((parsed.savedViews ?? []) as SavedView[])
  if (importedPresets === 0 && importedViews === 0) return
}

function handleQuickFilter(rule: Rule) {
  filter.value = filter.value
    ? {
        type: 'group',
        join: 'AND',
        rules: [...filter.value.rules, rule],
      }
    : {
        type: 'group',
        join: 'AND',
        rules: [rule],
      }
}

function handleTableDensityChange(value: 'compact' | 'comfortable' | 'roomy') {
  tableDensity.value = value
}

function handleSelectAllLoaded(checked: boolean) {
  const ids = books.value.map((book) => book.id)
  if (checked) {
    selectAll(ids)
    if (total.value > books.value.length) {
      showQuerySelectionBanner.value = true
    }
  } else {
    deselectAll(ids)
    querySelection.value = null
    showQuerySelectionBanner.value = false
  }
}

function activateQuerySelection() {
  querySelection.value = {
    libraryId: libraryId.value ?? undefined,
    filter: filter.value,
    q: debouncedQuery.value || undefined,
    sort: sort.value,
    total: total.value,
  }
  showQuerySelectionBanner.value = false
}

function dismissQuerySelectionBanner() {
  showQuerySelectionBanner.value = false
}

watch(
  libraryId,
  (id) => {
    if (id !== null) {
      try {
        const raw = localStorage.getItem(getFilterKey(id))
        const saved: GroupRule | undefined = raw ? JSON.parse(raw) : undefined
        savedFilter.value = saved
        filter.value = saved
      } catch {
        savedFilter.value = undefined
        filter.value = undefined
      }
    } else {
      savedFilter.value = undefined
      filter.value = undefined
    }
  },
  { immediate: true },
)

function saveFilter() {
  if (libraryId.value === null || !filter.value) return
  const snapshot: GroupRule = JSON.parse(JSON.stringify(filter.value))
  savedFilter.value = snapshot
  localStorage.setItem(getFilterKey(libraryId.value), JSON.stringify(snapshot))
}

function forgetSavedFilter() {
  if (libraryId.value === null) return
  savedFilter.value = undefined
  localStorage.removeItem(getFilterKey(libraryId.value))
}

const { subscribeLibrary, getProgress, isScanning } = useScanProgress()
const { newBookIds, start: startLiveScan, stop: stopLiveScan } = useLiveScanBooks(libraryId, books)
const scanProgress = computed(() => (libraryId.value !== null ? getProgress(libraryId.value) : undefined))

watch(
  libraryId,
  (id) => {
    if (id !== null) {
      subscribeLibrary(id)
      startLiveScan()
    } else {
      stopLiveScan()
    }
  },
  { immediate: true },
)

const filterOpen = ref(false)
const mobileControlsExpanded = ref(false)

const localSortModel = computed({
  get: () => sortModel.value,
  set: (v: SortSpec[]) => {
    sortModel.value = v
  },
})

function handleResetSort() {
  resetSort()
}

const activeFilterCount = computed(() => filter.value?.rules?.length ?? 0)
const mobileControlsBadgeCount = computed(() => activeFilterCount.value + (!isDefaultSort.value ? 1 : 0))

function clearFilters() {
  filter.value = undefined
  forgetSavedFilter()
}

function toggleMobileControls() {
  mobileControlsExpanded.value = !mobileControlsExpanded.value
}

function toggleFilterPanel() {
  filterOpen.value = !filterOpen.value
}

function closeFilterPanel() {
  filterOpen.value = false
}

const { sentinel } = useInfiniteScrollSentinel({
  hasMore: hasMorePrefix,
  loading,
  loadMore: loadMorePrefix,
})

const stopUploadCompletedListener = onLibraryUploadCompleted((event) => {
  if (event.uploadedCount === 0) return
  if (libraryId.value === event.libraryId) {
    resetBooks()
    refreshBuckets()
  }
})

onUnmounted(() => stopUploadCompletedListener())

watch(libraryId, () => {
  clearSearch()
})

const saveAsSmartScopeOpen = ref(false)
const querySelection = ref<QuerySelectionState | null>(null)
const showQuerySelectionBanner = ref(false)

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
  getSelectionPayload,
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
  querySelection,
})

const { onBookMissing, onBookRestored, onBookMoved, onBookTransferred } = useBookEvents()
const TRANSFER_REFRESH_DEBOUNCE_MS = 300
let transferRefreshTimer: ReturnType<typeof setTimeout> | null = null

function scheduleTransferRefresh(targetLibraryId: number) {
  if (transferRefreshTimer) clearTimeout(transferRefreshTimer)
  transferRefreshTimer = setTimeout(() => {
    transferRefreshTimer = null
    if (libraryId.value !== targetLibraryId) return
    resetBooks()
    refreshBuckets()
  }, TRANSFER_REFRESH_DEBOUNCE_MS)
}

onUnmounted(() => {
  if (transferRefreshTimer) clearTimeout(transferRefreshTimer)
})

function applyStatusToLoadedBooks(bookIds: number[], status: BookCard['status']) {
  const targets = new Set(bookIds)
  updateBooks(books.value.filter((book) => targets.has(book.id) && book.status !== status).map((book) => ({ ...book, status })))
}

onBookMissing((bookIds) => {
  applyStatusToLoadedBooks(bookIds, 'missing')
})
onBookRestored((bookIds) => {
  applyStatusToLoadedBooks(bookIds, 'present')
})
onBookMoved((bookIds) => {
  applyStatusToLoadedBooks(bookIds, 'present')
})
onBookTransferred((event) => {
  if (libraryId.value === event.fromLibraryId) {
    const transferred = new Set(event.bookIds)
    books.value = books.value.filter((book) => !transferred.has(book.id))
    deselectAll(event.bookIds)
    if (querySelection.value) querySelection.value = null
    scheduleTransferRefresh(event.fromLibraryId)
  } else if (libraryId.value === event.toLibraryId) {
    scheduleTransferRefresh(event.toLibraryId)
  }
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

const metadataExportOpen = ref(false)
const metadataExportDefaultScope = ref<'selected' | 'all-matching'>('all-matching')

const metadataExportQuery = computed(() => {
  if (libraryId.value === null) return undefined
  return {
    libraryId: libraryId.value,
    filter: filter.value,
    q: debouncedQuery.value || undefined,
    sort: sort.value,
  }
})

const visibleExportColumns = computed(() => {
  if (!tableRef.value) return []
  return tableRef.value.allColumns.filter((column) => column.visible).map((column) => column.id)
})

function openMetadataExport(scope: 'selected' | 'all-matching') {
  metadataExportDefaultScope.value = scope
  metadataExportOpen.value = true
}

watch(selectionMode, (active) => {
  if (!active) {
    querySelection.value = null
    showQuerySelectionBanner.value = false
  }
})

const {
  submit: submitBulkEdit,
  submitting: bulkEditSubmitting,
  selectedCount: bulkEditCount,
} = useBulkEditMetadata(selectedIds, books, querySelection)

function handleEditSelected() {
  const count = querySelection.value ? querySelection.value.total : selectedIds.value.size
  if (count === 0) return
  if (count >= 2 || querySelection.value) {
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
    if (querySelection.value || hasAddOrRemoveFields(fields)) {
      resetBooks()
    }
  }
}

function hasAddOrRemoveFields(fields: BulkEditFields): boolean {
  return [fields.authors, fields.genres, fields.tags, fields.narrators].some((f) => f && f.mode !== 'replace')
}

async function handleToggleCollapse() {
  if (libraryId.value === null) return
  const next = !collapseEnabledRef.value
  collapseEnabledRef.value = next
  await setPreference({ libraryId: libraryId.value }, next)
}

defineOptions({ name: 'HomeView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <section class="flex flex-1 flex-col min-h-0">
      <ViewHeader
        :title="title"
        :icon="libraryIcon"
        fallback-icon="BookOpen"
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
          <div v-if="effectiveViewMode !== 'table'" class="hidden sm:flex items-center gap-1">
            <Popover>
              <PopoverTrigger as-child>
                <button
                  class="flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-colors"
                  :class="
                    !isDefaultSort
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                  "
                >
                  <ArrowUpDown :size="13" />
                  <span class="hidden lg:inline">{{ sortSummary }}</span>
                  <span class="lg:hidden"
                    >Sort<template v-if="!isDefaultSort"> ({{ sort.length }})</template></span
                  >
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-80 p-3">
                <BookSortBuilder v-model="localSortModel" />
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  v-if="!isDefaultSort"
                  @click="handleResetSort"
                  class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X :size="13" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Reset sort to default</TooltipContent>
            </Tooltip>
          </div>
          <div class="hidden sm:block w-px h-5 bg-border shrink-0" />
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
                @click="openMetadataExport('all-matching')"
              >
                <FileSpreadsheet :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Export metadata</TooltipContent>
          </Tooltip>
          <button
            @click="toggleFilterPanel"
            class="hidden sm:flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-colors"
            :class="
              activeFilterCount > 0
                ? 'border-primary text-primary bg-primary/10'
                : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
            "
          >
            <Filter :size="13" />
            <span>Filters</span>
            <span v-if="activeFilterCount > 0" class="text-xs font-semibold">({{ activeFilterCount }})</span>
          </button>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                v-if="activeFilterCount > 0"
                @click="clearFilters"
                class="hidden sm:flex items-center gap-1 h-8 px-2 rounded-md text-sm text-muted-foreground hover:text-destructive transition-colors"
              >
                <X :size="13" />
                Clear
              </button>
            </TooltipTrigger>
            <TooltipContent>Clear all filters</TooltipContent>
          </Tooltip>

          <button
            class="sm:hidden relative flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
            :class="
              mobileControlsExpanded
                ? 'border-primary text-primary bg-primary/10'
                : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
            "
            @click="toggleMobileControls"
          >
            <SlidersHorizontal :size="14" />
            <span
              v-if="mobileControlsBadgeCount > 0"
              class="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
            >
              {{ mobileControlsBadgeCount }}
            </span>
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
            @delete-view="handleDeleteSavedView"
            @rename-view="handleRenameSavedView"
            @duplicate-view="handleDuplicateSavedView"
            @favorite-view="handleToggleSavedViewFavorite"
            @update:density="handleTableDensityChange"
            @export-backup="handleExportTableBackup"
            @import-backup="handleImportTableBackup"
            @reset="handleResetColumns"
          />
        </template>
      </ViewHeader>

      <section v-if="mobileControlsExpanded" class="mb-3 space-y-2 rounded-lg border border-border/70 bg-card/70 p-2 sm:hidden">
        <div class="flex h-9 items-center rounded-md border border-input bg-background px-2.5">
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
          <Popover>
            <PopoverTrigger as-child>
              <button
                class="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors"
                :class="
                  !isDefaultSort
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                "
              >
                <ArrowUpDown :size="13" />
                <span>Sort</span>
                <span v-if="!isDefaultSort" class="rounded-full border border-primary/40 px-1 py-0.5 text-[10px] font-semibold leading-none">On</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-80 p-3">
              <BookSortBuilder v-model="localSortModel" />
            </PopoverContent>
          </Popover>

          <button
            v-if="!isDefaultSort"
            class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:text-destructive hover:bg-destructive/10"
            @click="handleResetSort"
          >
            <X :size="13" />
          </button>

          <button
            @click="toggleFilterPanel"
            class="flex items-center gap-1.5 h-8 px-2.5 rounded-md border text-sm transition-colors"
            :class="
              activeFilterCount > 0
                ? 'border-primary text-primary bg-primary/10'
                : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
            "
          >
            <Filter :size="13" />
            <span>Filters</span>
            <span v-if="activeFilterCount > 0" class="rounded-full bg-primary/10 px-1 py-0.5 text-[10px] font-semibold leading-none">
              {{ activeFilterCount }}
            </span>
          </button>

          <button
            v-if="hasPermission('library_download') && !isDemoRestrictedAccount"
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="openMetadataExport('all-matching')"
          >
            <FileSpreadsheet :size="13" />
            <span>Export</span>
          </button>

          <button
            v-if="activeFilterCount > 0"
            @click="clearFilters"
            class="h-8 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-destructive"
          >
            Clear
          </button>
        </div>
      </section>

      <!-- Filter builder panel rendered outside <main> so it stays anchored when the list is scrolled -->
      <div v-if="filterOpen && !libraryNotFound" class="mb-4 p-3 rounded-md border border-border bg-card">
        <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span class="text-xs font-medium text-muted-foreground sm:shrink-0">Filter rules</span>
          <div class="flex w-full flex-wrap items-center gap-1.5 sm:w-auto sm:flex-nowrap">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  v-if="activeFilterCount > 0"
                  @click="saveAsSmartScopeOpen = true"
                  class="flex min-h-7 items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Telescope :size="13" />
                  <span class="hidden sm:inline whitespace-nowrap">Save as Smart Scope</span>
                  <span class="sm:hidden whitespace-nowrap">Save Scope</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>Save this filter as a named Smart Scope</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  v-if="activeFilterCount > 0"
                  @click="saveFilter"
                  class="flex min-h-7 items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap"
                  :class="
                    isFilterSaved
                      ? 'border-primary/40 text-primary bg-primary/8'
                      : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                  "
                >
                  <BookmarkCheck v-if="isFilterSaved" :size="13" />
                  <Bookmark v-else :size="13" />
                  {{ isFilterSaved ? 'Saved' : 'Save filter' }}
                </button>
              </TooltipTrigger>
              <TooltipContent>{{ isFilterSaved ? 'Filter saved' : 'Save filter for this library' }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  v-if="hasSavedFilter"
                  @click="forgetSavedFilter"
                  class="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/70 hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X :size="11" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Remove saved filter</TooltipContent>
            </Tooltip>
            <button
              class="min-h-7 whitespace-nowrap rounded-md border border-input px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              @click="closeFilterPanel"
            >
              Close
            </button>
          </div>
        </div>
        <BookFilterBuilder v-model="filter" />
      </div>

      <main ref="mainRef" :class="effectiveViewMode === 'table' ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'">
        <EntityNotFound v-if="libraryNotFound" entity="Library" />

        <template v-else>
          <div v-if="error" class="text-sm text-destructive mb-4">{{ error }}</div>

          <ScanProgressBar :progress="scanProgress" class="mb-3" />

          <!-- Empty state: no matches with filters -->
          <div
            v-if="booksInitialized && !loading && books.length === 0 && activeFilterCount > 0"
            class="flex flex-col items-center justify-center py-24 gap-3 text-center"
          >
            <p class="text-sm font-medium text-foreground">No books match your filters</p>
            <p class="text-xs text-muted-foreground">Try adjusting or clearing your filters to see more books.</p>
            <button @click="clearFilters" class="text-xs text-primary hover:underline">Clear filters</button>
          </div>

          <!-- Empty state: no books in library -->
          <div
            v-else-if="booksInitialized && !loading && books.length === 0"
            class="flex flex-col items-center justify-center py-24 gap-4 text-center"
          >
            <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <BookOpen :size="28" class="text-muted-foreground/70" />
            </div>
            <div v-if="libraryId !== null && isScanning(libraryId)" class="flex flex-col gap-1">
              <p class="text-sm font-medium text-foreground">Scanning your library...</p>
              <p class="text-xs text-muted-foreground max-w-xs">Books will appear here as they are discovered.</p>
            </div>
            <div v-else class="flex flex-col gap-1">
              <p class="text-sm font-medium text-foreground">Your library is empty</p>
              <p class="text-xs text-muted-foreground max-w-xs">Once you add books to this library, they will appear here.</p>
            </div>
          </div>

          <!-- Grid view -->
          <VirtualBookGrid
            v-if="effectiveViewMode === 'grid' && books.length > 0"
            ref="bookGridRef"
            :books="slots"
            :cover-size="coverSize"
            :grid-gap="gridGap"
            :selection-mode="selectionMode"
            :is-selected="isSelected"
            :new-book-ids="newBookIds"
            :rail-gutter="railGutterReserved"
            @range="handleRange"
            @first-visible-index="handleFirstVisibleIndex"
            @action="handleBookAction"
            @select="handleSelect"
            @update:book="handleTableBookUpdate"
          />

          <!-- List view -->
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
            :sort="sort"
            :loading="loading"
            :total="total"
            view-type="library"
            :selection-mode="selectionMode"
            :is-selected="isSelected"
            :selected-count="selectedCount"
            :filter-active="activeFilterCount > 0"
            :initialized="booksInitialized"
            @update:sort="localSortModel = $event"
            @action="handleBookAction"
            @select="handleSelect"
            @update:book="handleTableBookUpdate"
            @visible-range="handleRange"
            @first-visible-index="handleFirstVisibleIndex"
            @select-all="handleSelectAllLoaded"
            @enter-selection="enterSelectionMode"
            @quick-filter="handleQuickFilter"
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
        </template>
      </main>
    </section>

    <BookQuickView
      :book-id="quickViewBookId"
      :open="quickViewOpen"
      @update:open="quickViewOpen = $event"
      @action="quickViewBookId !== null && handleBookAction({ id: quickViewBookId } as BookCard, $event)"
    />

    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0 -translate-y-2"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="showQuerySelectionBanner && !querySelection"
        class="fixed bottom-16 left-1/2 z-40 -translate-x-1/2 flex items-center gap-3 rounded-lg border border-primary/30 bg-background px-4 py-2.5 text-sm shadow-lg"
      >
        <span class="text-muted-foreground"> {{ selectedCount.toLocaleString() }} of {{ total.toLocaleString() }} loaded books selected. </span>
        <button class="font-medium text-primary underline-offset-2 hover:underline" @click="activateQuerySelection">
          Select all {{ total.toLocaleString() }} matching books
        </button>
        <button class="text-muted-foreground hover:text-foreground" @click="dismissQuerySelectionBanner">
          <X :size="14" />
        </button>
      </div>
    </Transition>

    <SelectionActionBar
      :visible="selectionMode"
      :count="querySelection ? querySelection.total : selectedCount"
      :in-flight="inFlight"
      :query-scoped="querySelection !== null"
      @send="sendBookOpen = true"
      @download="handleDownloadFiles"
      @export-metadata="openMetadataExport(querySelection ? 'all-matching' : 'selected')"
      @add-to-collection="addToCollectionOpen = true"
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
      view-type="library"
      :selected-book-ids="[...selectedIds]"
      :selected-count="selectedCount"
      :total-count="total"
      :all-matching-query="metadataExportQuery"
      :sort="sort"
      :visible-columns="visibleExportColumns"
      :default-scope="metadataExportDefaultScope"
      @update:open="metadataExportOpen = $event"
    />

    <AddToCollectionSheet
      :open="addToCollectionOpen"
      :selection-payload="getSelectionPayload()"
      :selected-count="querySelection ? querySelection.total : selectedCount"
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

    <SendBookDialog
      :open="sendBookOpen"
      :selection-payload="getSelectionPayload()"
      :selected-count="querySelection ? querySelection.total : selectedCount"
      @update:open="sendBookOpen = $event"
      @sent="exitSelectionMode"
    />

    <SaveAsSmartScopeDialog :open="saveAsSmartScopeOpen" :filter="filter" :sort="sort" @close="saveAsSmartScopeOpen = false" />

    <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />
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
