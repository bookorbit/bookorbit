import { computed, provide, reactive, ref, toValue, watch, type ComponentPublicInstance, type MaybeRefOrGetter, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { BookCard, BookMergedEvent, ConcreteBookMediaKind, CoverAspectRatio, GroupRule, SortSpec } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'
import { useInfiniteScrollSentinel } from '@/composables/useInfiniteScrollSentinel'
import { useViewDisplaySettings } from '@/composables/useViewDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { DEFAULT_SORT } from '@/features/book/lib/sort-defaults'
import { sortFieldLabel } from '@/features/book/lib/filter-labels'
import { useBookLinkSync } from './useBookLinkSync'
import { useBookMergeSync } from './useBookMergeSync'
import { useBookNavigation } from './useBookNavigation'
import { useBookTableShell } from './useBookTableShell'
import { useBookViewContext } from './useBookViewContext'
import { useBookViewWindow } from './useBookViewWindow'
import { useBulkEditMetadata, type BulkEditFields } from './useBulkEditMetadata'
import { useEffectiveSeriesCollapse } from './useEffectiveSeriesCollapse'
import { useFilterPanel } from './useFilterPanel'
import { useFilterTokens } from './useFilterTokens'
import { useMoveToLibraryTarget } from './useMoveToLibraryTarget'
import { useSavedViews, type SavedView } from './useSavedViews'
import { useSortBarLabels } from './useSortFields'
import { useScrollRestoreOnActivate } from './useScrollRestoreOnActivate'
import { useSeriesCollapsePreference, type CollapseScope } from './useSeriesCollapsePreference'
import { useViewSearch } from './useViewSearch'
import { useViewSort } from './useViewSort'

/** The book listings that share one page shell: everything but the library and the author page. */
export type BookListViewType = 'smartScope' | 'collection' | 'genre' | 'tag'

export interface BookListPageOptions {
  viewType: BookListViewType
  scopeId: Ref<number>
  listEndpoint: (id: number) => string
  bucketsEndpoint: (id: number) => string
  /** The sort a fresh visit starts with and "Reset sort" returns to. */
  defaultSort?: MaybeRefOrGetter<SortSpec[]>
  /** Seeds the window before the remembered sort loads; only needed when it differs from the library default. */
  initialSort?: SortSpec[]
  collapseScope: (id: number) => CollapseScope
  coverAspectRatio?: Ref<CoverAspectRatio>
  /** Holds every request until the host knows enough to ask, such as a smart scope's own default sort. */
  enabled?: Ref<boolean>
  /** Prefix of the downloaded table backup file name. */
  backupFilePrefix: string
}

type ScrollTarget = { scrollToIndex: (index: number) => void }
type BookAction = Parameters<ReturnType<typeof useBookTableShell>['handleBookAction']>[1]
type ViewMode = ReturnType<typeof useEffectiveViewMode>['viewMode']['value']

/**
 * Everything a book listing page needs between its header and its content: the paged window and
 * jump rail, search, sort, filters, display settings, saved views, selection and every bulk action.
 * The host page keeps what is its own (the entity it lists, its header, its empty states) and hands
 * this to the shared list components.
 *
 * Returned as one reactive object so it can travel to those components as a single prop.
 */
export function useBookListPage(options: BookListPageOptions) {
  const { t } = useI18n()
  const router = useRouter()
  const { viewMode, effectiveViewMode } = useEffectiveViewMode()
  const { hasPermission, isDemoRestrictedAccount } = usePermissions()
  const { tableDensity, showJumpRails } = useDisplaySettings()
  const scopeId = options.scopeId
  const defaultSort = options.defaultSort ?? DEFAULT_SORT

  const savedViews = useSavedViews(options.viewType, scopeId)

  const { getEffectivePreference, setPreference, prefs } = useSeriesCollapsePreference()
  const collapseEnabledRef = ref(getEffectivePreference(options.collapseScope(scopeId.value)))
  const selectionMode = ref(false)
  const effectiveCollapseEnabled = useEffectiveSeriesCollapse(collapseEnabledRef, selectionMode)

  watch([scopeId, prefs], () => {
    collapseEnabledRef.value = getEffectivePreference(options.collapseScope(scopeId.value))
  })

  const { searchQuery, debouncedQuery, clearSearch } = useViewSearch()
  const mainRef = ref<HTMLElement | null>(null)
  const viewWindow = useBookViewWindow({
    scopeId,
    listEndpoint: options.listEndpoint,
    bucketsEndpoint: options.bucketsEndpoint,
    viewMode: effectiveViewMode,
    railEnabled: showJumpRails,
    railViewport: mainRef,
    collapseEnabled: effectiveCollapseEnabled,
    collapseLinked: true,
    q: debouncedQuery,
    ...(options.enabled ? { enabled: options.enabled } : {}),
    ...(options.initialSort ? { defaultSort: options.initialSort } : {}),
  })
  const { booksProxy: books, slots, total, bookTotal, loading, filter, sort: tableSort, loadMorePrefix, hasMorePrefix, registerScroller } = viewWindow

  const { setBookContext } = useBookNavigation()
  useScrollRestoreOnActivate(mainRef)
  useBookViewContext(slots, total, loadMorePrefix)

  const coverAspectRatio = computed<CoverAspectRatio>(() => options.coverAspectRatio?.value ?? DEFAULT_COVER_ASPECT_RATIO)
  // A square shelf reads as an audiobook shelf, so a book that also has an ebook still shows its audiobook.
  const gridMediaKind = computed<ConcreteBookMediaKind | null>(() => (coverAspectRatio.value === '1/1' ? 'audiobook' : null))
  provide(COVER_ASPECT_RATIO_KEY, coverAspectRatio)
  const { coverSize, gridGap } = useViewDisplaySettings(options.viewType, scopeId, coverAspectRatio)

  const { sortModel: tableSortModel, isDefaultSort, resetSort, loadSort } = useViewSort(tableSort, options.viewType, scopeId, defaultSort)
  const sortLabel = computed(() => (tableSort.value[0] ? sortFieldLabel(tableSort.value[0].field) : ''))
  const sortDirection = computed<'asc' | 'desc'>(() => tableSort.value[0]?.dir ?? 'asc')
  const defaultSortSpec = computed(() => toValue(defaultSort))
  const {
    extraLevels: sortExtraLevels,
    currentDirection: sortDirectionLabel,
    nextDirection: sortNextDirectionLabel,
    isRandom: sortIsRandom,
  } = useSortBarLabels(tableSort)

  function toggleSortDirection() {
    const [first, ...rest] = tableSort.value
    if (!first) return
    tableSortModel.value = [{ ...first, dir: first.dir === 'asc' ? 'desc' : 'asc' }, ...rest]
  }

  const filterPanel = useFilterPanel()
  const filterMatchCount = computed(() => (viewWindow.initialized.value ? bookTotal.value : null))
  const {
    tokens: filterTokens,
    ruleCount: filterRuleCount,
    join: filterJoin,
    setJoin: setFilterJoin,
    removeToken: removeFilterToken,
  } = useFilterTokens(filter, { formatFacet: false })
  const isNarrowed = computed(() => filterRuleCount.value > 0 || debouncedQuery.value.trim().length > 0)
  const canExport = computed(() => hasPermission('library_download') && !isDemoRestrictedAccount.value)

  function clearFilters() {
    filter.value = undefined
  }

  function clearAll() {
    clearFilters()
    clearSearch()
  }

  function openFilterPanel(element: HTMLElement | null = null) {
    filterPanel.openFields(element)
  }

  function editFilterToken(index: number, element: HTMLElement) {
    filterPanel.openRule(index, element)
  }

  /** A different entity starts from a clean slate rather than the last one's search and filters. */
  function resetNarrowing() {
    clearSearch()
    filter.value = undefined
  }

  const shell = useBookTableShell({
    books,
    selectionMode,
    onMoveToLibrary: (bookId) => moveTarget.openForBook(bookId),
  })
  const { tableRef, selectedIds, selectedCount, selectAll, deselectAll, exitSelectionMode, bulkEditOpen } = shell

  const moveTarget = useMoveToLibraryTarget({
    getSelectionPayload: () => ({ bookIds: [...selectedIds.value] }),
    selectedCount,
  })

  function handleSaveCurrentView(name: string) {
    if (!tableRef.value) return
    savedViews.saveView({ name, layout: tableRef.value.currentLayout, sort: tableSort.value })
  }

  function handleApplySavedView(view: SavedView) {
    tableRef.value?.applyPreset(view.layout, view.sort)
  }

  function handleExportTableBackup() {
    const backup = {
      version: 1,
      presets: tableRef.value?.allPresets.filter((preset) => !preset.isBuiltIn) ?? [],
      savedViews: savedViews.allSavedViews.value,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${options.backupFilePrefix}-table-backup-${scopeId.value ?? 'shared'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function handleImportTableBackup(file: File) {
    const parsed = JSON.parse(await file.text()) as { presets?: unknown[]; savedViews?: unknown[] }
    shell.handleImportPresetBackup((parsed.presets ?? []) as never)
    savedViews.importViews((parsed.savedViews ?? []) as SavedView[])
  }

  function handleTableDensityChange(value: 'compact' | 'comfortable' | 'roomy') {
    tableDensity.value = value
  }

  function handleSelectAllLoaded(checked: boolean) {
    const ids = books.value.filter((book) => !book.collapsedSeries).map((book) => book.id)
    if (checked) selectAll(ids)
    else deselectAll(ids)
  }

  function reload() {
    viewWindow.reset()
    viewWindow.refreshBuckets()
  }

  // A moved book keeps its place in every listing that shares this shell, so only the stale
  // selection needs clearing.
  function handleBooksMoved() {
    exitSelectionMode()
  }

  const { applyMerged } = useBookMergeSync({ books, deselect: deselectAll, refresh: reload })

  function handleBooksMerged(event: BookMergedEvent) {
    applyMerged(event)
    exitSelectionMode()
  }

  // Books from any library can sit here, and with linked books collapsed a link anywhere can fold or
  // split a card, so every link change reloads the listing.
  const { scheduleRefresh: scheduleLinkRefresh } = useBookLinkSync({ books, refresh: reload, affectsScope: () => true })

  function handleBooksLinked() {
    exitSelectionMode()
    scheduleLinkRefresh()
  }

  const metadataExportOpen = ref(false)
  const visibleExportColumns = computed(() => tableRef.value?.allColumns.filter((column) => column.visible).map((column) => column.id) ?? [])

  function openMetadataExport() {
    metadataExportOpen.value = true
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
      viewWindow.reset()
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

  async function handleCollapseSeriesUpdate(next: boolean) {
    if (selectionMode.value) return
    collapseEnabledRef.value = next
    await setPreference(options.collapseScope(scopeId.value), next)
  }

  /**
   * The count fact a header shows: the entity's total, or "N of M" once a search or filter narrows
   * it. Collapsed series count cards rather than books, so a narrowed collapsed view keeps the total.
   */
  function countFact(entityTotal: number | null | undefined): string | null {
    if (typeof entityTotal !== 'number') return null
    if (isNarrowed.value && !effectiveCollapseEnabled.value && viewWindow.initialized.value) {
      return t('components.browseHeader.facts.booksOf', { matching: formatNumber(bookTotal.value), total: entityTotal })
    }
    return t('components.browseHeader.facts.books', { count: entityTotal })
  }

  const { sentinel } = useInfiniteScrollSentinel({ hasMore: hasMorePrefix, loading, loadMore: loadMorePrefix })

  const bookGridRef = ref<ScrollTarget | null>(null)

  watch(
    [bookGridRef, tableRef, effectiveViewMode],
    () => {
      const target = effectiveViewMode.value === 'grid' ? bookGridRef.value : effectiveViewMode.value === 'table' ? tableRef.value : null
      registerScroller(target ? (index) => target.scrollToIndex(index) : null)
    },
    { immediate: true },
  )

  // The shared list components receive this object as a prop, so every write they make goes
  // through one of these instead of assigning to the prop.
  function setSearchQuery(value: string) {
    searchQuery.value = value
  }

  function setFilter(value: GroupRule | undefined) {
    filter.value = value
  }

  function setSortModel(value: SortSpec[]) {
    tableSortModel.value = value
  }

  function setViewMode(value: ViewMode) {
    viewMode.value = value
  }

  function setQuickViewOpen(value: boolean) {
    shell.quickViewOpen.value = value
  }

  function handleQuickViewAction(action: BookAction) {
    const id = shell.quickViewBookId.value
    if (id !== null) shell.handleBookAction({ id } as BookCard, action)
  }

  function setAddToCollectionOpen(value: boolean) {
    shell.addToCollectionOpen.value = value
  }

  function openAddToCollection() {
    shell.addToCollectionOpen.value = true
  }

  function setBulkEditOpen(value: boolean) {
    bulkEditOpen.value = value
  }

  function setSendBookOpen(value: boolean) {
    shell.sendBookOpen.value = value
  }

  function openSendBook() {
    shell.sendBookOpen.value = true
  }

  function setMetadataExportOpen(value: boolean) {
    metadataExportOpen.value = value
  }

  function bindMain(el: Element | ComponentPublicInstance | null) {
    mainRef.value = el instanceof HTMLElement ? el : null
  }

  function bindGrid(el: Element | ComponentPublicInstance | null) {
    bookGridRef.value = (el as ScrollTarget | null) ?? null
  }

  function bindTable(el: Element | ComponentPublicInstance | null) {
    tableRef.value = (el as typeof tableRef.value) ?? null
  }

  function bindSentinel(el: Element | ComponentPublicInstance | null) {
    sentinel.value = el instanceof HTMLElement ? el : null
  }

  return reactive({
    viewType: options.viewType,
    scopeId,
    viewMode,
    effectiveViewMode,
    tableDensity,
    showJumpRails,
    canExport,
    ...viewWindow,
    books,
    booksInitialized: viewWindow.initialized,
    booksError: viewWindow.error,
    resetBooks: viewWindow.reset,
    tableSort,
    reload,
    searchQuery,
    debouncedQuery,
    clearSearch,
    mainEl: mainRef,
    bindMain,
    bindGrid,
    bindTable,
    bindSentinel,
    effectiveCollapseEnabled,
    handleCollapseSeriesUpdate,
    coverAspectRatio,
    gridMediaKind,
    coverSize,
    gridGap,
    handleCoverSizeUpdate,
    handleGridGapUpdate,
    handleShowJumpRailsUpdate,
    tableSortModel,
    isDefaultSort,
    resetSort,
    loadSort,
    sortLabel,
    sortDirection,
    sortDirectionLabel,
    sortNextDirectionLabel,
    sortExtraLevels,
    sortIsRandom,
    defaultSortSpec,
    toggleSortDirection,
    filterOpen: filterPanel.open,
    filterView: filterPanel.view,
    filterAnchor: filterPanel.anchor,
    filterMatchCount,
    closeFilterPanel: filterPanel.close,
    filterTokens,
    filterRuleCount,
    removeFilterToken,
    filterJoin,
    setFilterJoin,
    editFilterToken,
    isNarrowed,
    clearFilters,
    clearAll,
    openFilterPanel,
    resetNarrowing,
    countFact,
    allSavedViews: savedViews.allSavedViews,
    renameView: savedViews.renameView,
    deleteView: savedViews.deleteView,
    duplicateView: savedViews.duplicateView,
    toggleFavorite: savedViews.toggleFavorite,
    handleSaveCurrentView,
    handleApplySavedView,
    handleExportTableBackup,
    handleImportTableBackup,
    handleTableDensityChange,
    handleSelectAllLoaded,
    ...shell,
    moveToLibraryOpen: moveTarget.open,
    movePayload: moveTarget.payload,
    moveCount: moveTarget.count,
    openMoveForSelection: moveTarget.openForSelection,
    setMoveOpen: moveTarget.setOpen,
    handleBooksMoved,
    handleBooksMerged,
    handleBooksLinked,
    metadataExportOpen,
    visibleExportColumns,
    openMetadataExport,
    bulkEditSubmitting,
    bulkEditCount,
    handleEditSelected,
    handleBulkEditConfirm,
    setSearchQuery,
    setFilter,
    setFilterOpen: filterPanel.setOpen,
    setSortModel,
    setViewMode,
    setQuickViewOpen,
    handleQuickViewAction,
    setAddToCollectionOpen,
    openAddToCollection,
    setBulkEditOpen,
    setSendBookOpen,
    openSendBook,
    setMetadataExportOpen,
  })
}

export type BookListPage = ReturnType<typeof useBookListPage>
