<script setup lang="ts">
import { computed, onUnmounted, provide, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { Bookmark, BookmarkCheck, BookOpen, FileSpreadsheet, Pencil, RefreshCw, Telescope, Upload, X } from '@lucide/vue'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import VirtualBookTable from '@/features/book/components/VirtualBookTable.vue'
import TableColumnPanel from '@/features/book/components/TableColumnPanel.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import BookSortBuilder from '@/features/book/components/BookSortBuilder.vue'
import BookShuffleButton from '@/features/book/components/BookShuffleButton.vue'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowseSearchField from '@/components/browse-header/BrowseSearchField.vue'
import BrowseSortControl from '@/components/browse-header/BrowseSortControl.vue'
import BrowseFilterControl from '@/components/browse-header/BrowseFilterControl.vue'
import BrowseInlineGroup from '@/components/browse-header/BrowseInlineGroup.vue'
import FormatFacetChips from '@/components/browse-header/FormatFacetChips.vue'
import BrowseViewControls from '@/components/browse-header/BrowseViewControls.vue'
import BrowsePageMenu from '@/components/browse-header/BrowsePageMenu.vue'
import BrowseScanButton from '@/components/browse-header/BrowseScanButton.vue'
import { barDivider, outlineButton } from '@/components/browse-header/browse-header'
import { cn } from '@/lib/utils'
import ViewHeaderDisplayControls from '@/components/view-header/ViewHeaderDisplayControls.vue'
import BookUploadModal from '@/features/library/components/BookUploadModal.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import MoveToLibrarySheet from '@/features/book/components/MoveToLibrarySheet.vue'
import { useMoveToLibraryTarget } from '@/features/book/composables/useMoveToLibraryTarget'
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
import { useEffectiveSeriesCollapse } from '@/features/book/composables/useEffectiveSeriesCollapse'

import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useLiveScanBooks } from '@/features/scanner/composables/useLiveScanBooks'
import { useLibraryScan } from '@/features/scanner/composables/useLibraryScan'
import { useFilterTokens } from '@/features/book/composables/useFilterTokens'
import { useLibraryFacets } from '@/features/library/composables/useLibraryFacets'
import { useLibraryHeaderFacts } from '@/features/library/composables/useLibraryHeaderFacts'
import { formatFilterValueLabel, sortFieldLabel } from '@/features/book/lib/filter-labels'
import { formatBytes } from '@/lib/formatting'
import { formatRelativeTimeFromNow } from '@/i18n/formatters'
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
import { useInfiniteScrollSentinel } from '@/composables/useInfiniteScrollSentinel'
import { useSavedViews, type SavedView } from '@/features/book/composables/useSavedViews'
import type { GroupRule, Rule, SortSpec } from '@bookorbit/types'
import EntityNotFound from '@/components/EntityNotFound.vue'
import { type QuerySelectionState } from '@/features/book/composables/useBookBulkActions'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { viewMode, effectiveViewMode } = useEffectiveViewMode()
const { libraries, loaded: librariesLoaded } = useLibraries()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()

const libraryId = shallowRef<number | null>(route.params.id ? Number(route.params.id) : null)
const currentLibrary = computed(() => libraries.value.find((l) => l.id === libraryId.value))
const currentCoverAspectRatio = computed(() => currentLibrary.value?.coverAspectRatio ?? DEFAULT_COVER_ASPECT_RATIO)
const { coverSize, gridGap } = useViewDisplaySettings('library', libraryId, currentCoverAspectRatio)
const { tableDensity, showJumpRails } = useDisplaySettings()

const libraryNotFound = computed(() => librariesLoaded.value && libraryId.value !== null && !currentLibrary.value)
const title = computed(() => currentLibrary.value?.name ?? t('views.library.title'))
const libraryIcon = computed(() => currentLibrary.value?.icon ?? 'BookOpen')
const pageTitle = computed(() => {
  if (currentLibrary.value?.name) return t('views.library.pageTitle', { name: currentLibrary.value.name })
  return libraryId.value === null ? t('views.library.title') : t('views.library.pageTitleWithId', { id: libraryId.value })
})
usePageTitle(pageTitle)

provide(COVER_ASPECT_RATIO_KEY, currentCoverAspectRatio)

const { getEffectivePreference, setPreference, prefs } = useSeriesCollapsePreference()
const collapseEnabledRef = ref(libraryId.value !== null ? getEffectivePreference({ libraryId: libraryId.value }) : false)
const selectionMode = ref(false)
const effectiveCollapseEnabled = useEffectiveSeriesCollapse(collapseEnabledRef, selectionMode)

watch(libraryId, (id) => {
  collapseEnabledRef.value = id !== null ? getEffectivePreference({ libraryId: id }) : false
})

watch(prefs, () => {
  collapseEnabledRef.value = libraryId.value !== null ? getEffectivePreference({ libraryId: libraryId.value }) : false
})

const { searchQuery, debouncedQuery, clearSearch } = useViewSearch()
const mainRef = ref<HTMLElement | null>(null)

const {
  booksProxy: books,
  slots,
  total,
  loading,
  initialized: booksInitialized,
  error,
  filter,
  sort,
  randomSortActive,
  reshuffle,
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
  scopeId: libraryId,
  listEndpoint: (id) => `/api/v1/libraries/${id}/books`,
  bucketsEndpoint: (id) => `/api/v1/libraries/${id}/books/jump-buckets`,
  viewMode: effectiveViewMode,
  railEnabled: showJumpRails,
  railViewport: mainRef,
  collapseEnabled: effectiveCollapseEnabled,
  q: debouncedQuery,
})
const { onLibraryUploadCompleted } = useLibraryUploadEvents()
useScrollRestoreOnActivate(mainRef)
const { setBookContext } = useBookNavigation()
useBookViewContext(slots, total, loadMorePrefix)

const FILTER_STORAGE_PREFIX = 'bookorbit:filter:library:'
function getFilterKey(id: number) {
  return `${FILTER_STORAGE_PREFIX}${id}`
}

const savedFilter = ref<GroupRule | undefined>(undefined)
const hasSavedFilter = computed(() => savedFilter.value !== undefined)
const isFilterSaved = computed(() => filter.value !== undefined && JSON.stringify(filter.value) === JSON.stringify(savedFilter.value))

const { sortModel, isDefaultSort, resetSort } = useViewSort(sort, 'library', libraryId)
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
  const ids = books.value.filter((book) => !book.collapsedSeries).map((book) => book.id)
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

const localSortModel = computed({
  get: () => sortModel.value,
  set: (v: SortSpec[]) => {
    sortModel.value = v
  },
})

function handleResetSort() {
  resetSort()
}

const { tokens: filterTokens, selectedFormats, ruleCount: filterRuleCount, removeToken: removeFilterToken, toggleFormat } = useFilterTokens(filter)

const { facets } = useLibraryFacets(libraryId, filter, debouncedQuery)
const formatFacets = computed(() => facets.value?.formats ?? [])
const showFormatFacets = computed(() => formatFacets.value.length > 1 || selectedFormats.value.length > 0)
const selectedFormatsLabel = computed(() => (selectedFormats.value.length > 0 ? selectedFormats.value.map(formatFilterValueLabel).join(', ') : null))
const isNarrowed = computed(() => filterRuleCount.value > 0 || debouncedQuery.value.trim().length > 0)

const canManageLibraries = computed(() => hasPermission('manage_libraries'))
const canUpload = computed(() => hasPermission('library_upload'))
const canExport = computed(() => hasPermission('library_download') && !isDemoRestrictedAccount.value)
const hasPageMenu = computed(() => canExport.value || ((canManageLibraries.value || canUpload.value) && currentLibrary.value !== undefined))

const { sizeBytes, lastScanAt } = useLibraryHeaderFacts(libraryId, canManageLibraries)
const libraryScanning = computed(() => libraryId.value !== null && isScanning(libraryId.value))

interface HeaderFact {
  key: string
  text: string
}

const headerFacts = computed<HeaderFact[]>(() => {
  const facts: HeaderFact[] = []
  const libraryTotal = facets.value?.libraryTotal ?? currentLibrary.value?.bookCount ?? null
  if (libraryTotal !== null) {
    if (isNarrowed.value && facets.value) {
      facts.push({
        key: 'count',
        text: t('components.browseHeader.facts.booksOf', { matching: formatNumber(facets.value.total), total: libraryTotal }),
      })
    } else {
      facts.push({ key: 'count', text: t('components.browseHeader.facts.books', { count: libraryTotal }) })
    }
  }
  if (sizeBytes.value !== null && sizeBytes.value > 0) facts.push({ key: 'size', text: formatBytes(sizeBytes.value) })
  const progress = libraryId.value !== null ? getProgress(libraryId.value) : undefined
  if (libraryScanning.value && progress && !canManageLibraries.value) {
    facts.push({
      key: 'scan',
      text: t('components.browseHeader.facts.scanningProgress', { processed: formatNumber(progress.processed), total: formatNumber(progress.total) }),
    })
  } else if (lastScanAt.value && canManageLibraries.value && !libraryScanning.value) {
    facts.push({ key: 'scan', text: t('components.browseHeader.facts.scanned', { time: formatRelativeTimeFromNow(lastScanAt.value) }) })
  }
  return facts
})

const foldedCount = computed(() => {
  const value = isNarrowed.value && facets.value ? facets.value.total : (facets.value?.libraryTotal ?? currentLibrary.value?.bookCount)
  return value === undefined ? undefined : formatNumber(value)
})

const sortLabel = computed(() => (sort.value[0] ? sortFieldLabel(sort.value[0].field) : ''))
const sortDirection = computed<'asc' | 'desc'>(() => sort.value[0]?.dir ?? 'asc')

function toggleSortDirection() {
  const [first, ...rest] = sort.value
  if (!first) return
  localSortModel.value = [{ ...first, dir: first.dir === 'asc' ? 'desc' : 'asc' }, ...rest]
}

function clearFilters() {
  filter.value = undefined
  forgetSavedFilter()
}

function handleClearAll() {
  clearFilters()
  clearSearch()
}

function openFilterPanel() {
  filterOpen.value = true
}

function openSaveAsSmartScope() {
  filterOpen.value = false
  saveAsSmartScopeOpen.value = true
}

const uploadOpen = ref(false)

function openUpload() {
  uploadOpen.value = true
}

function closeUpload() {
  uploadOpen.value = false
}

const { scanLibrary } = useLibraryScan()

function handleMenuScan() {
  if (currentLibrary.value) void scanLibrary(currentLibrary.value)
}

function openLibrarySettings() {
  if (libraryId.value === null) return
  void router.push({ name: 'settings-libraries', query: { edit: String(libraryId.value) } })
}

function openAllMatchingExport() {
  openMetadataExport('all-matching')
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
  selectionMode,
  querySelection,
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
  getSelectionPayload: () => getSelectionPayload(),
  selectedCount: computed(() => (querySelection.value ? querySelection.value.total : selectedCount.value)),
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

// Moved books leave this view through the book:transferred socket event, so the
// sheet only has to drop the now-stale selection.
function handleBooksMoved() {
  exitSelectionMode()
}

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

async function handleCollapseSeriesUpdate(next: boolean) {
  if (selectionMode.value) return
  if (libraryId.value === null) return
  collapseEnabledRef.value = next
  await setPreference({ libraryId: libraryId.value }, next)
}

defineOptions({ name: 'HomeView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <section class="flex flex-1 flex-col min-h-0">
      <BrowseHeader
        :eyebrow="t('components.browseHeader.eyebrow.library')"
        :title="title"
        :icon="libraryIcon"
        fallback-icon="BookOpen"
        :folded-count="foldedCount"
        :switcher="libraryId !== null ? { kind: 'library', id: libraryId } : null"
        :scroll-container="mainRef"
      >
        <template #facts>
          <template v-for="(fact, index) in headerFacts" :key="fact.key">
            <span v-if="index > 0" class="size-[3px] shrink-0 rounded-full bg-muted-foreground" aria-hidden="true" />
            <span class="truncate" :class="fact.key === 'count' ? 'shrink-0' : ''">{{ fact.text }}</span>
          </template>
        </template>

        <template #actions>
          <BrowseScanButton v-if="canManageLibraries && currentLibrary" class="hidden md:inline-flex" :library="currentLibrary" />
          <button v-if="canUpload && currentLibrary" type="button" :class="cn(outlineButton, 'hidden md:inline-flex')" @click="openUpload">
            <Upload :size="14" class="text-muted-foreground" aria-hidden="true" />
            {{ t('book.detail.addFile.upload') }}
          </button>
          <BrowsePageMenu v-if="hasPageMenu" :name="title">
            <DropdownMenuItem v-if="canManageLibraries && currentLibrary" class="md:hidden" @click="handleMenuScan">
              <RefreshCw :size="14" class="mr-2" />
              {{ t('settings.admin.libraries.scan') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canUpload && currentLibrary" class="md:hidden" @click="openUpload">
              <Upload :size="14" class="mr-2" />
              {{ t('components.browseHeader.menu.upload') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canExport" @click="openAllMatchingExport">
              <FileSpreadsheet :size="14" class="mr-2" />
              {{ t('views.bookView.exportMetadata') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canManageLibraries && currentLibrary" @click="openLibrarySettings">
              <Pencil :size="14" class="mr-2" />
              {{ t('settings.admin.libraries.editLibrary') }}
            </DropdownMenuItem>
          </BrowsePageMenu>
        </template>

        <template #bar>
          <BrowseSearchField
            v-model="searchQuery"
            :placeholder="t('views.bookView.searchPlaceholder')"
            :tokens="filterTokens"
            :active="isNarrowed"
            can-save-as-smart-scope
            can-save-filter
            :filter-saved="isFilterSaved"
            @remove-token="removeFilterToken"
            @clear="handleClearAll"
            @save-as-smart-scope="openSaveAsSmartScope"
            @save-filter="saveFilter"
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
            <BookSortBuilder v-model="localSortModel" />
            <button
              v-if="!isDefaultSort"
              type="button"
              class="mt-3 w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              @click="handleResetSort"
            >
              {{ t('views.bookView.resetSort') }}
            </button>
          </BrowseSortControl>
          <BookShuffleButton v-if="randomSortActive" desktop-only compact @shuffle="reshuffle" />
          <BrowseFilterControl v-model:open="filterOpen" :count="filterRuleCount">
            <BookFilterBuilder v-model="filter" />
            <template v-if="filterRuleCount > 0 || hasSavedFilter" #footer>
              <button
                v-if="filterRuleCount > 0"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="filterRuleCount === 0"
                @click="openSaveAsSmartScope"
              >
                <Telescope :size="13" class="text-muted-foreground" aria-hidden="true" />
                {{ t('views.library.saveAsSmartScope') }}
              </button>
              <button
                v-if="filterRuleCount > 0"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                :class="isFilterSaved ? 'border-primary/40 bg-primary/8 text-primary' : 'border-input text-foreground hover:bg-muted'"
                :disabled="filterRuleCount === 0"
                @click="saveFilter"
              >
                <BookmarkCheck v-if="isFilterSaved" :size="13" aria-hidden="true" />
                <Bookmark v-else :size="13" class="text-muted-foreground" aria-hidden="true" />
                {{ isFilterSaved ? t('views.library.saved') : t('views.library.saveFilter') }}
              </button>
              <button
                v-if="hasSavedFilter"
                type="button"
                class="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-destructive"
                @click="forgetSavedFilter"
              >
                <X :size="12" aria-hidden="true" />
                {{ t('views.library.removeSavedFilter') }}
              </button>
              <span class="flex-1" />
              <button
                v-if="filterRuleCount > 0"
                type="button"
                class="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
                @click="clearFilters"
              >
                {{ t('views.bookView.clearAllFilters') }}
              </button>
            </template>
          </BrowseFilterControl>
          <template v-if="showFormatFacets">
            <span :class="barDivider" aria-hidden="true" />
            <BrowseInlineGroup
              :label="t('components.browseHeader.facets.format')"
              :value="selectedFormatsLabel"
              :active="selectedFormats.length > 0"
              hide-on-phone
            >
              <FormatFacetChips :facets="formatFacets" :selected="selectedFormats" @toggle="toggleFormat" />
            </BrowseInlineGroup>
          </template>
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
              </ViewHeaderDisplayControls>
            </template>
          </BrowseViewControls>
        </template>
      </BrowseHeader>

      <main ref="mainRef" :class="effectiveViewMode === 'table' ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'">
        <EntityNotFound v-if="libraryNotFound" :entity="t('views.entity.library')" />

        <template v-else>
          <div v-if="error" class="text-sm text-destructive mb-4">{{ error }}</div>

          <!-- Empty state: no matches with filters -->
          <div
            v-if="booksInitialized && !loading && books.length === 0 && filterRuleCount > 0"
            class="flex flex-col items-center justify-center py-24 gap-3 text-center"
          >
            <p class="text-sm font-medium text-foreground">{{ t('views.library.empty.noFilterMatch') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('views.library.empty.noFilterMatchHint') }}</p>
            <button @click="clearFilters" class="text-xs text-primary hover:underline">{{ t('views.library.empty.clearFilters') }}</button>
          </div>

          <!-- Empty state: no books in library -->
          <div
            v-else-if="booksInitialized && !loading && books.length === 0"
            class="flex flex-col items-center justify-center py-24 gap-4 text-center"
          >
            <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <BookOpen :size="28" class="text-muted-foreground" />
            </div>
            <div v-if="libraryId !== null && isScanning(libraryId)" class="flex flex-col gap-1">
              <p class="text-sm font-medium text-foreground">{{ t('views.library.empty.scanning') }}</p>
              <p class="text-xs text-muted-foreground max-w-xs">{{ t('views.library.empty.scanningHint') }}</p>
            </div>
            <div v-else class="flex flex-col gap-1">
              <p class="text-sm font-medium text-foreground">{{ t('views.library.empty.emptyLibrary') }}</p>
              <p class="text-xs text-muted-foreground max-w-xs">{{ t('views.library.empty.emptyLibraryHint') }}</p>
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
            :rail-gutter-kind="bucketKind"
            @range="handleRange"
            @first-visible-index="handleFirstVisibleIndex"
            :allow-move-to-library="true"
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
            :sort="sort"
            :loading="loading"
            :total="total"
            view-type="library"
            :library-id="libraryId ?? undefined"
            :selection-mode="selectionMode"
            :is-selected="isSelected"
            :selected-count="selectedCount"
            :filter-active="filterRuleCount > 0"
            :initialized="booksInitialized"
            @update:sort="localSortModel = $event"
            :allow-move-to-library="true"
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
        <span class="text-muted-foreground">
          {{ t('views.library.querySelection.loadedSelected', { selected: formatNumber(selectedCount), total: formatNumber(total) }) }}
        </span>
        <button class="font-medium text-primary underline-offset-2 hover:underline" @click="activateQuerySelection">
          {{ t('views.library.querySelection.selectAllMatching', { total: formatNumber(total) }) }}
        </button>
        <button class="text-muted-foreground hover:text-foreground" @click="dismissQuerySelectionBanner">
          <X :size="14" />
        </button>
      </div>
    </Transition>

    <SelectionActionBar
      :metadata-editable="canEditSelectionMetadata"
      :visible="selectionMode"
      :count="querySelection ? querySelection.total : selectedCount"
      :in-flight="inFlight"
      :query-scoped="querySelection !== null"
      @send="sendBookOpen = true"
      @download="handleDownloadFiles"
      @export-metadata="openMetadataExport(querySelection ? 'all-matching' : 'selected')"
      @add-to-collection="addToCollectionOpen = true"
      @move-to-library="openMoveForSelection"
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

    <MoveToLibrarySheet
      :open="moveToLibraryOpen"
      :selection-payload="movePayload"
      :selected-count="moveCount"
      :current-library-id="libraryId"
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

    <SendBookDialog
      :open="sendBookOpen"
      :selection-payload="getSelectionPayload()"
      :selected-count="querySelection ? querySelection.total : selectedCount"
      @update:open="sendBookOpen = $event"
      @sent="exitSelectionMode"
    />

    <SaveAsSmartScopeDialog :open="saveAsSmartScopeOpen" :filter="filter" :sort="sort" @close="saveAsSmartScopeOpen = false" />

    <BookUploadModal v-if="uploadOpen && libraryId !== null" :library-id="libraryId" @close="closeUpload" @uploaded="closeUpload" />

    <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />
  </div>
</template>
