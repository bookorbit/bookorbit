<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, CheckCircle2, ChevronUp, Loader2, RotateCcw, X } from 'lucide-vue-next'
import {
  useTableColumns,
  COLUMN_DEFS,
  COLUMN_DEF_MAP,
  LOCK_ROW_COLUMN_DEF,
  type ColumnId,
  type ColumnDef,
} from '@/features/book/composables/useTableColumns'
import { useTableCellEditor } from '@/features/book/composables/useTableCellEditor'
import { useTableLocks } from '@/features/book/composables/useTableLocks'
import { useTablePresets } from '@/features/book/composables/useTablePresets'
import { useTableContextMenu } from '@/features/book/composables/useTableContextMenu'
import { useTableScrollBehavior } from '@/features/book/composables/useTableScrollBehavior'
import { useTableResize } from '@/features/book/composables/useTableResize'
import { useTableDragReorder } from '@/features/book/composables/useTableDragReorder'
import { useTableKeyboard } from '@/features/book/composables/useTableKeyboard'
import { useTableSorting } from '@/features/book/composables/useTableSorting'
import { useTableQuickFilters } from '@/features/book/composables/useTableQuickFilters'
import { useTableCellHelpers } from '@/features/book/composables/useTableCellHelpers'
import { useTableCoverDialog } from '@/features/book/composables/useTableCoverDialog'
import KeyboardShortcutOverlay from './KeyboardShortcutOverlay.vue'
import { useAuthorSearch } from '@/features/book/composables/useAuthorSearch'
import { useGenreSearch, useTagSearch } from '@/features/book/composables/useTagSearch'
import { usePublisherSearch, useSeriesNameSearch, useLanguageSearch } from '@/features/book/composables/useMetadataFieldSearch'
import { useRefreshMetadata } from '@/features/book/composables/useRefreshMetadata'
import { useRefreshingBooks } from '@/features/book/composables/useRefreshingBooks'
import { useBookRefreshFeedback } from '@/features/book/composables/useBookRefreshFeedback'
import type { InFlightOp } from '@/features/book/composables/useBookBulkActions'
import { useRouter } from 'vue-router'
import { detectChangedColumns, mergeBookCardWithDetail } from '@/features/book/lib/book-card-mapper'
import { buildLockStateBookUpdate, mergeBookPatchWithLatest, sameLockFields } from '@/features/book/lib/table-row-state-sync'
import BookCoverDialog from './table/BookCoverDialog.vue'
import BookTableCellDispatcher from './table/BookTableCellDispatcher.vue'
import BookTableCollapsedSeriesCell from './table/BookTableCollapsedSeriesCell.vue'
import BookTableContextMenu from './table/BookTableContextMenu.vue'
import BookTableHeader from './table/BookTableHeader.vue'
import BookTableHeaderContextMenu from './table/BookTableHeaderContextMenu.vue'
import type { BookCard, Rule, SortSpec, TableLayoutState, TableViewType } from '@bookorbit/types'
import { BOOK_METADATA_LOCK_FIELDS } from '@bookorbit/types'
import { useNarratorSearch } from '@/features/book/composables/useNarratorSearch'
import { SORT_FIELD_LABELS } from '@/features/book/lib/filter-labels'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

const props = withDefaults(
  defineProps<{
    books: BookCard[]
    sort: SortSpec[]
    viewType: TableViewType
    selectionMode?: boolean
    isSelected?: (id: number) => boolean
    hasMore?: boolean
    loading?: boolean
    total?: number
    sortable?: boolean
    selectedCount?: number
    filterActive?: boolean
    initialized?: boolean
    inFlight?: InFlightOp | null
  }>(),
  { sortable: true, initialized: true },
)

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'
const emit = defineEmits<{
  'update:sort': [value: SortSpec[]]
  action: [book: BookCard, type: BookActionType]
  select: [id: number, event: MouseEvent]
  'update:book': [updated: BookCard]
  'load-more': []
  'select-all': [checked: boolean]
  'enter-selection': []
  'quick-filter': [rule: Rule]
}>()

const { md } = useBreakpoints(breakpointsTailwind)
const isReadOnly = computed(() => !md.value)
const { tableDensity, tableZebraStriping } = useDisplaySettings()
const router = useRouter()

const { layout, visibleColumns, allColumns, toggleColumn, setColumnOrder, setColumnWidth, setLayout, pinColumn, unpinColumn, resetLayout } =
  useTableColumns(props.viewType)
const editor = useTableCellEditor()
const locks = useTableLocks()
const tablePresets = useTablePresets(
  props.viewType,
  COLUMN_DEFS.map((column) => column.id),
)

const { search: searchAuthors } = useAuthorSearch()
const { search: searchGenres } = useGenreSearch()
const { search: searchTags } = useTagSearch()
const { search: searchNarrators } = useNarratorSearch()
const { search: searchPublisher } = usePublisherSearch()
const { search: searchSeriesName } = useSeriesNameSearch()
const { search: searchLanguage } = useLanguageSearch()
const { refreshWithFeedback } = useRefreshMetadata()
const { isRefreshing } = useRefreshingBooks()
const refreshFeedback = useBookRefreshFeedback()
const { getSortDir, handleColumnSort, removeSortField } = useTableSorting(
  () => props.sort,
  () => props.sortable ?? true,
  (sort) => emit('update:sort', sort),
)
const { getQuickFilterOptions, buildQuickFilterRule } = useTableQuickFilters(props.viewType)
const { getCellValue, isCellLocked, isCellReadOnly, isMandatoryFieldEmpty, isBookFileMissing, getPinnedCellBackground } = useTableCellHelpers(
  locks,
  () => isReadOnly.value,
)
const { coverDialogBook, handleCoverClick, handleCoverDialogUpdateBook } = useTableCoverDialog(
  () => props.selectionMode ?? false,
  (updated) => emit('update:book', updated),
  () => props.books,
)

function getChipsSearchFn(colId: ColumnId): (q: string) => Promise<string[]> {
  if (colId === 'authors') return searchAuthors
  if (colId === 'genres') return searchGenres
  if (colId === 'tags') return searchTags
  if (colId === 'narrators') return searchNarrators
  return () => Promise.resolve([])
}

function getChipsLinkFn(colId: ColumnId): ((chip: string) => string | null) | undefined {
  if (colId === 'authors') return (name) => `/authors?q=${encodeURIComponent(name)}`
  return undefined
}

function getChipsActionFn(colId: ColumnId): ((chip: string) => void) | undefined {
  if (props.viewType !== 'library') return undefined
  if (colId === 'genres') {
    return (name) => emit('quick-filter', { type: 'rule', field: 'genre', operator: 'includesAny', value: [name] })
  }
  if (colId === 'tags') {
    return (name) => emit('quick-filter', { type: 'rule', field: 'tag', operator: 'includesAny', value: [name] })
  }
  return undefined
}

function getTextCellOpenLink(book: BookCard, colId: ColumnId): string | null {
  if (colId === 'title') return `/book/${book.id}`
  if (colId === 'seriesName' && book.seriesId != null) return `/series/${book.seriesId}`
  return null
}

const rowPaddingClass = computed(() => {
  if (tableDensity.value === 'compact') return 'py-1'
  if (tableDensity.value === 'roomy') return 'py-2.5'
  return 'py-1.5'
})

function getTextCellOpenLinkLabel(colId: ColumnId): string | null {
  if (colId === 'title') return 'Open book details'
  if (colId === 'seriesName') return 'Open series'
  return null
}

function getTextSearchFn(colId: ColumnId): ((q: string) => Promise<string[]>) | undefined {
  if (colId === 'publisher') return searchPublisher
  if (colId === 'seriesName') return searchSeriesName
  if (colId === 'language') return searchLanguage
  return undefined
}

const metadataInFlight = computed(() => (props.inFlight?.label === 'Refreshing metadata' ? props.inFlight : null))
const metadataFailed = computed(() => metadataInFlight.value?.failed ?? 0)
const metadataRemaining = computed(() => {
  if (!metadataInFlight.value) return 0
  return Math.max(metadataInFlight.value.total - metadataInFlight.value.processed, 0)
})
function getRowFeedback(bookId: number) {
  return refreshFeedback.getFeedback(bookId)
}

function isRowRefreshing(bookId: number): boolean {
  return getRowFeedback(bookId)?.state === 'refreshing' || isRefreshing(bookId)
}

function isCellChanged(bookId: number, colId: ColumnId): boolean {
  return refreshFeedback.isCellChanged(bookId, colId)
}

function getRowFeedbackMessage(bookId: number): string {
  return getRowFeedback(bookId)?.message ?? 'Metadata refresh failed'
}

async function retryMetadataRefresh(book: BookCard) {
  if (isRefreshing(book.id)) return
  refreshFeedback.markRefreshing(book.id)
  const updated = await refreshWithFeedback(book.id)
  if (updated) {
    const merged = mergeBookCardWithDetail(book, updated)
    refreshFeedback.markSuccess(book.id, detectChangedColumns(book, merged))
    emit('update:book', merged)
    return
  }
  refreshFeedback.markFailed(book.id)
}

// Init lock state for books and prune stale entries
watch(
  () => props.books,
  (books) => {
    for (const book of books) {
      locks.initBook(book.id, book.lockedFields)
    }
    locks.pruneStaleEntries(new Set(books.map((b) => b.id)))
  },
  { immediate: true },
)

const displayColumns = computed(() => [LOCK_ROW_COLUMN_DEF, ...visibleColumns.value])
const currentLayout = computed<TableLayoutState>(() => ({
  columnOrder: [...layout.value.columnOrder],
  hiddenColumns: [...layout.value.hiddenColumns],
  columnWidths: { ...layout.value.columnWidths },
  ...(layout.value.pinnedColumns ? { pinnedColumns: { ...layout.value.pinnedColumns } } : {}),
}))
const pinnedLeftOffsets = computed(() => {
  const offsets = new Map<string, number>()
  let left = 0
  for (const column of displayColumns.value) {
    if (column.pinned === 'left' || column.id === 'lockRow') {
      offsets.set(column.id, left)
      left += column.defaultWidth
    }
  }
  return offsets
})
const statusAnchorColumnId = computed<ColumnId | null>(() => {
  const visibleIds = displayColumns.value.map((column) => column.id)
  if (visibleIds.includes('title')) return 'title'
  if (visibleIds.includes('authors')) return 'authors'
  return null
})

const scrollContainerRef = ref<HTMLDivElement | null>(null)
const { contextMenuBook, contextMenuPosition, openContextMenu, closeContextMenu } = useTableContextMenu()
const { isScrolled, showScrollTop, onScroll, scrollToTop } = useTableScrollBehavior(scrollContainerRef)

// Extracted composables
const {
  resizingColumnId: _resizingColumnId,
  isResizableCol: _isResizableCol,
  startResize,
  autoFitColumn,
  autoFitAllColumns,
} = useTableResize(scrollContainerRef, displayColumns, setColumnWidth, isReadOnly)
void _resizingColumnId
void _isResizableCol

const {
  dragSourceColId,
  dropTargetColId,
  dropSide,
  isDraggableCol: _isDraggableCol,
  handleColDragStart,
  handleColDragOver,
  handleColDragLeave,
  handleColDrop,
  handleColDragEnd,
} = useTableDragReorder(allColumns, setColumnOrder)
void _isDraggableCol

// Column header context menu
const headerCtxColumn = ref<ColumnDef | null>(null)
const headerCtxPosition = ref<{ x: number; y: number } | null>(null)
const headerCtxSortDir = computed<'asc' | 'desc' | null>(() => {
  if (!headerCtxColumn.value?.sortField) return null
  return getSortDir(headerCtxColumn.value.sortField)
})

function handleHeaderContextMenu(event: MouseEvent, col: ColumnDef) {
  if (isReadOnly.value || col.id === 'lockRow') return
  event.preventDefault()
  headerCtxColumn.value = col
  headerCtxPosition.value = { x: event.clientX, y: event.clientY }
}

function handleHeaderCtxSortAsc() {
  if (!headerCtxColumn.value?.sortField) return
  emit('update:sort', [{ field: headerCtxColumn.value.sortField, dir: 'asc' }])
}

function handleHeaderCtxSortDesc() {
  if (!headerCtxColumn.value?.sortField) return
  emit('update:sort', [{ field: headerCtxColumn.value.sortField, dir: 'desc' }])
}

function handleHeaderCtxClearSort() {
  if (!headerCtxColumn.value?.sortField) return
  removeSortField(headerCtxColumn.value.sortField)
}

function handleHeaderCtxHideColumn() {
  if (!headerCtxColumn.value) return
  toggleColumn(headerCtxColumn.value.id)
}

function handleHeaderCtxAutoFitAll() {
  autoFitAllColumns()
}

function handleHeaderCtxAutoFit() {
  if (!headerCtxColumn.value) return
  autoFitColumn(headerCtxColumn.value.id)
}

function handleHeaderCtxPinLeft() {
  if (!headerCtxColumn.value) return
  pinColumn(headerCtxColumn.value.id, 'left')
}

function handleHeaderCtxPinRight() {
  if (!headerCtxColumn.value) return
  pinColumn(headerCtxColumn.value.id, 'right')
}

function handleHeaderCtxUnpin() {
  if (!headerCtxColumn.value) return
  unpinColumn(headerCtxColumn.value.id)
}

function handleHeaderCtxQuickFilter(key: string) {
  if (!headerCtxColumn.value) return
  const rule = buildQuickFilterRule(headerCtxColumn.value.id, key)
  if (!rule) return
  emit('quick-filter', rule)
}

function closeHeaderContextMenu() {
  headerCtxColumn.value = null
  headerCtxPosition.value = null
}

// Checkbox selection helpers
const allBooksSelected = computed(() => {
  if (props.books.length === 0 || !props.isSelected) return false
  return props.books.every((b) => props.isSelected!(b.id))
})

const someBooksSelected = computed(() => {
  if (props.books.length === 0 || !props.isSelected) return false
  const someSelected = props.books.some((b) => props.isSelected!(b.id))
  return someSelected && !allBooksSelected.value
})

function handleSelectAllToggle(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  emit('select-all', checked)
}

function handleCheckboxClick(bookId: number, event: MouseEvent) {
  if (!props.selectionMode) {
    emit('enter-selection')
  }
  emit('select', bookId, event)
}

// Sort strip
const activeSorts = computed(() =>
  props.sort.map((s) => ({
    field: s.field,
    dir: s.dir,
    label: SORT_FIELD_LABELS[s.field] ?? s.field,
  })),
)

// Skeleton rows for initial loading
const SKELETON_ROW_COUNT = 12

const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.books.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: () => 44,
    overscan: 10,
  })),
)

const virtualItems = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

const isLoadingMore = ref(false)

watch(virtualItems, (items) => {
  if (!props.hasMore || props.loading || isLoadingMore.value || !items.length) return
  const last = items[items.length - 1]!
  if (last.index >= props.books.length - 15) {
    isLoadingMore.value = true
    emit('load-more')
  }
})

watch(
  () => props.loading,
  (loading) => {
    if (!loading) isLoadingMore.value = false
  },
)

// Keyboard navigation
const { focusedRowIndex, focusedColIndex, isFocusedCell, handleTableKeydown } = useTableKeyboard({
  books: () => props.books,
  displayColumns,
  activeCellKey: editor.activeCellKey,
  selectionMode: () => props.selectionMode ?? false,
  isReadOnly: () => isReadOnly.value,
  virtualizer,
  isCellReadOnly,
  onActivate: handleActivate,
  onSelect: (id, event) => emit('select', id, event),
  onCopyRow: () => {},
})

const shortcutOverlayOpen = ref(false)

function handleKeydownWithShortcuts(event: KeyboardEvent) {
  if (event.key === '?' && !editor.activeCellKey.value) {
    event.preventDefault()
    shortcutOverlayOpen.value = !shortcutOverlayOpen.value
    return
  }
  if (shortcutOverlayOpen.value) return
  handleTableKeydown(event)
}

function shouldPreserveTargetFocus(target: EventTarget | null): boolean {
  const targetElement = target instanceof Element ? target : target instanceof Node ? target.parentElement : null
  if (!targetElement) return false
  return Boolean(
    targetElement.closest(
      [
        'input',
        'textarea',
        'select',
        'button',
        'a',
        '[role="button"]',
        '[role="textbox"]',
        '[role="combobox"]',
        '[contenteditable="true"]',
        '[data-cell-activator="true"]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(', '),
    ),
  )
}

function focusTableCell(rowIndex: number, colIndex: number, event?: MouseEvent, bookId?: number, colId?: ColumnId) {
  focusedRowIndex.value = rowIndex
  focusedColIndex.value = colIndex
  if (bookId != null && colId && editor.isActive(bookId, colId)) return
  if (shouldPreserveTargetFocus(event?.target ?? null)) return
  scrollContainerRef.value?.focus({ preventScroll: true })
}

onMounted(() => {
  scrollContainerRef.value?.addEventListener('scroll', onScroll, { passive: true })
})

onUnmounted(() => {
  scrollContainerRef.value?.removeEventListener('scroll', onScroll)
})

// Bump tbody key on sort change to trigger enter animation
watch(
  () => props.sort,
  () => {
    nextTick(() => {
      if (scrollContainerRef.value) scrollContainerRef.value.scrollTop = 0
    })
  },
  { deep: true },
)

// Editable column IDs in display order (for Tab navigation)
const editableColumnIds = computed<ColumnId[]>(() => visibleColumns.value.filter((c) => c.isEditable).map((c) => c.id))

function handleActivate(book: BookCard, colId: ColumnId) {
  if (isReadOnly.value || props.selectionMode) return
  const col = displayColumns.value.find((c) => c.id === colId)
  if (!col || isCellReadOnly(book, col)) return
  editor.activateCell(book.id, colId, getCellValue(book, colId))
}

function handleSave(book: BookCard, colId: ColumnId, newValue: unknown) {
  editor.saveCell(book.id, colId, newValue, (patch) => {
    const updated = mergeBookPatchWithLatest(props.books, book, patch)
    emit('update:book', updated)
  })
}

function handleCancel(bookId: number, colId: ColumnId) {
  editor.cancelCellIfActive(bookId, colId)
}

function handleNavigate(book: BookCard, colId: ColumnId, direction: 'next' | 'prev' | 'rowUp' | 'rowDown') {
  if (direction === 'rowUp' || direction === 'rowDown') {
    editor.navigateRow(direction === 'rowDown' ? 'down' : 'up', props.books, book.id, colId)
    return
  }
  editor.navigateCell(direction, editableColumnIds.value, book, colId)
}

function handleRowClick(book: BookCard, e: MouseEvent) {
  if (props.selectionMode) {
    emit('select', book.id, e)
    return
  }
  if (book.collapsedSeries) {
    if (book.seriesId != null) router.push({ name: 'series-detail', params: { seriesId: book.seriesId } })
  }
}

function emitLockStateUpdate(book: BookCard, nextFields: BookCard['lockedFields']) {
  const updated = buildLockStateBookUpdate(props.books, book, nextFields)
  if (!updated) return
  emit('update:book', updated)
}

async function handleToggleCellLock(book: BookCard, colId: ColumnId) {
  const lockField = COLUMN_DEF_MAP.get(colId)?.lockField
  if (!lockField) return
  const beforeFields = [...locks.getFields(book.id)]
  await locks.toggleField(book.id, lockField)
  const afterFields = [...locks.getFields(book.id)]
  if (sameLockFields(beforeFields, afterFields)) return
  emitLockStateUpdate(book, afterFields)
}

async function handleLockAllRow(book: BookCard) {
  const beforeFields = [...locks.getFields(book.id)]
  await locks.lockAll(book.id)
  const afterFields = [...locks.getFields(book.id)]
  if (sameLockFields(beforeFields, afterFields)) return
  emitLockStateUpdate(book, afterFields)
}

async function handleUnlockAllRow(book: BookCard) {
  const beforeFields = [...locks.getFields(book.id)]
  await locks.unlockAll(book.id)
  const afterFields = [...locks.getFields(book.id)]
  if (sameLockFields(beforeFields, afterFields)) return
  emitLockStateUpdate(book, afterFields)
}

function isRowFullyLocked(book: BookCard): boolean {
  return getRowLockedFieldCount(book) >= BOOK_METADATA_LOCK_FIELDS.length
}

function getRowLockedFieldCount(book: BookCard): number {
  return locks.getFields(book.id).length
}

function handleRowContextMenu(event: MouseEvent, book: BookCard): void {
  if (props.selectionMode) return
  openContextMenu(event, book)
}

function handleContextMenuAction(book: BookCard, type: BookActionType): void {
  closeContextMenu()
  emit('action', book, type)
}

function applyPreset(layoutState: TableLayoutState, sort?: SortSpec[]): void {
  setLayout(layoutState)
  if (sort && sort.length > 0) emit('update:sort', sort)
}

function saveCurrentPreset(name: string): void {
  tablePresets.savePreset(name, currentLayout.value, props.sort)
}

defineExpose({
  allColumns,
  currentLayout,
  toggleColumn,
  setColumnOrder,
  resetLayout,
  applyPreset,
  saveCurrentPreset,
  deletePreset: tablePresets.deletePreset,
  renamePreset: tablePresets.renamePreset,
  duplicatePreset: tablePresets.duplicatePreset,
  togglePresetFavorite: tablePresets.toggleFavorite,
  importPresetBackup: tablePresets.importPresets,
  allPresets: tablePresets.allPresets,
  autoFitAllColumns,
})
</script>

<template>
  <div class="relative flex-1 min-h-0 flex flex-col overflow-hidden rounded-md border border-border">
    <!-- Screen-reader live region for dynamic announcements -->
    <div aria-live="polite" aria-atomic="true" class="sr-only">
      <span v-if="selectionMode && selectedCount != null && selectedCount > 0"
        >{{ selectedCount }} {{ selectedCount === 1 ? 'book' : 'books' }} selected</span
      >
      <span v-if="loading && initialized">Loading more books</span>
    </div>
    <!-- Sort strip: visible when multiple sorts are active -->
    <div v-if="activeSorts.length > 1" class="shrink-0 flex items-center gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-1">
      <span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">Sort</span>
      <div class="flex flex-wrap items-center gap-1">
        <span
          v-for="(s, idx) in activeSorts"
          :key="s.field"
          class="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
        >
          <span class="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold">{{ idx + 1 }}</span>
          {{ s.label }}
          <ArrowUp v-if="s.dir === 'asc'" :size="10" />
          <ArrowDown v-else :size="10" />
          <button class="ml-0.5 rounded-full p-0.5 hover:bg-primary/20 transition-colors" @click="removeSortField(s.field)">
            <X :size="9" />
          </button>
        </span>
      </div>
    </div>

    <div v-if="metadataInFlight" class="shrink-0 flex items-center justify-between border-b border-border/60 bg-primary/5 px-3 py-1">
      <div class="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Loader2 :size="12" class="animate-spin" />
        <span>Refreshing metadata {{ metadataInFlight.processed }} / {{ metadataInFlight.total }}</span>
      </div>
      <span v-if="metadataFailed > 0" class="text-xs font-medium text-amber-700 dark:text-amber-400">{{ metadataFailed }} failed</span>
      <span v-else class="text-xs text-muted-foreground">{{ metadataRemaining }} remaining</span>
    </div>

    <div v-if="isReadOnly" class="shrink-0 border-b border-border/60 bg-amber-500/8 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
      Table editing is disabled on smaller screens. Switch to list or grid for quicker actions.
    </div>

    <div ref="scrollContainerRef" class="relative flex-1 min-h-0 overflow-auto" tabindex="0" @keydown="handleKeydownWithShortcuts">
      <table role="grid" class="w-full border-collapse text-sm" style="table-layout: fixed">
        <BookTableHeader
          :display-columns="displayColumns"
          :sort="props.sort"
          :is-scrolled="isScrolled"
          :loading="props.loading ?? false"
          :selection-mode="props.selectionMode ?? false"
          :all-books-selected="allBooksSelected"
          :some-books-selected="someBooksSelected"
          :is-read-only="isReadOnly"
          :pinned-left-offsets="pinnedLeftOffsets"
          :drag-source-col-id="dragSourceColId"
          :drop-target-col-id="dropTargetColId"
          :drop-side="dropSide"
          :sortable="props.sortable ?? true"
          @select-all="handleSelectAllToggle"
          @column-sort="handleColumnSort"
          @header-context-menu="handleHeaderContextMenu"
          @col-drag-start="handleColDragStart"
          @col-drag-over="handleColDragOver"
          @col-drag-leave="handleColDragLeave"
          @col-drop="handleColDrop"
          @col-drag-end="handleColDragEnd"
          @resize-start="startResize"
          @auto-fit-column="autoFitColumn"
        />

        <!-- Skeleton loading rows -->
        <tbody v-if="!initialized && loading" role="rowgroup">
          <tr v-for="i in SKELETON_ROW_COUNT" :key="`skeleton-${i}`" role="row" class="border-b border-border/50">
            <td v-if="selectionMode" role="gridcell" class="px-2 align-middle" :class="rowPaddingClass" :style="{ width: '36px', minWidth: '36px' }">
              <div class="mx-auto h-4 w-4 rounded bg-muted animate-pulse" />
            </td>
            <td
              v-for="col in displayColumns"
              :key="col.id"
              role="gridcell"
              class="overflow-hidden px-2 align-middle"
              :class="rowPaddingClass"
              :style="{ width: `${col.defaultWidth}px`, minWidth: `${col.minWidth}px` }"
            >
              <div v-if="col.cellType === 'cover'" class="h-9 w-9 rounded-sm bg-muted animate-pulse" />
              <div v-else-if="col.cellType === 'rating'" class="flex items-center gap-0.5">
                <div v-for="s in 5" :key="s" class="h-3 w-3 rounded-full bg-muted animate-pulse" />
              </div>
              <div v-else-if="col.cellType === 'progress'" class="h-1.5 w-full rounded-full bg-muted animate-pulse" />
              <div v-else-if="col.cellType === 'actions'" class="h-5 w-5 rounded bg-muted animate-pulse" />
              <div v-else class="h-4 rounded bg-muted animate-pulse" :style="{ width: `${40 + ((i * 17 + col.defaultWidth) % 60)}%` }" />
            </td>
          </tr>
        </tbody>

        <tbody v-else class="tbody-enter" role="rowgroup">
          <tr v-if="virtualItems.length > 0 && virtualItems[0]!.start > 0" role="row">
            <td role="gridcell" :colspan="displayColumns.length + (selectionMode ? 1 : 0)" :style="{ height: `${virtualItems[0]!.start}px` }" />
          </tr>

          <tr
            v-for="vItem in virtualItems"
            :key="String(vItem.key)"
            role="row"
            :aria-label="books[vItem.index]!.title ?? undefined"
            class="group border-b border-border/50 transition-colors"
            :class="[
              selectionMode && isSelected?.(books[vItem.index]!.id) ? 'bg-primary/8' : 'hover:bg-muted/40',
              selectionMode ? 'cursor-pointer' : '',
              isBookFileMissing(books[vItem.index]!) ? 'bg-destructive/5' : '',
              isRowRefreshing(books[vItem.index]!.id) ? 'opacity-85' : '',
              focusedRowIndex === vItem.index && !editor.activeCellKey.value ? 'ring-1 ring-inset ring-primary/40' : '',
              tableZebraStriping && vItem.index % 2 === 1 && !(selectionMode && isSelected?.(books[vItem.index]!.id)) ? 'bg-muted/20' : '',
            ]"
            @click="handleRowClick(books[vItem.index]!, $event)"
            @contextmenu.prevent="(event) => handleRowContextMenu(event, books[vItem.index]!)"
          >
            <!-- Checkbox cell -->
            <td
              v-if="selectionMode"
              role="gridcell"
              class="overflow-hidden px-2 bg-background"
              :class="rowPaddingClass"
              :style="{ width: '36px', minWidth: '36px', position: 'sticky', left: '0px', zIndex: 20 }"
            >
              <div class="flex items-center justify-center">
                <input
                  type="checkbox"
                  class="accent-primary h-3.5 w-3.5 cursor-pointer"
                  :checked="isSelected?.(books[vItem.index]!.id) ?? false"
                  @click.stop="handleCheckboxClick(books[vItem.index]!.id, $event)"
                />
              </div>
            </td>

            <td
              v-for="(col, colIdx) in displayColumns"
              :key="col.id"
              :data-col-id="col.id"
              :data-row-index="vItem.index"
              role="gridcell"
              class="relative overflow-hidden px-2 align-middle"
              :class="[
                rowPaddingClass,
                col.pinned === 'right' ? 'border-l border-border/60' : '',
                col.pinned === null ? (isMandatoryFieldEmpty(books[vItem.index]!, col.id) ? 'bg-amber-500/5' : '') : '',
                isCellChanged(books[vItem.index]!.id, col.id) ? 'book-cell--changed' : '',
                isFocusedCell(vItem.index, colIdx) && !editor.isActive(books[vItem.index]!.id, col.id)
                  ? 'outline outline-2 outline-primary/50 -outline-offset-2 rounded-sm'
                  : '',
              ]"
              :style="{
                width: `${col.defaultWidth}px`,
                minWidth: `${col.minWidth}px`,
                ...(col.pinned === 'left' || col.id === 'lockRow'
                  ? {
                      position: 'sticky',
                      left: `${(selectionMode ? 36 : 0) + (pinnedLeftOffsets.get(col.id) ?? 0)}px`,
                      zIndex: col.id === 'lockRow' ? 20 : 2,
                      background: getPinnedCellBackground(
                        books[vItem.index]!,
                        col.id,
                        selectionMode && (isSelected?.(books[vItem.index]!.id) ?? false),
                      ),
                    }
                  : {}),
                ...(col.pinned === 'right'
                  ? {
                      position: 'sticky',
                      right: '0',
                      zIndex: 2,
                      background: getPinnedCellBackground(
                        books[vItem.index]!,
                        col.id,
                        selectionMode && (isSelected?.(books[vItem.index]!.id) ?? false),
                      ),
                    }
                  : {}),
              }"
              @click="focusTableCell(vItem.index, colIdx, $event, books[vItem.index]!.id, col.id)"
            >
              <template v-if="books[vItem.index]!.collapsedSeries">
                <BookTableCollapsedSeriesCell :book="books[vItem.index]!" :col-id="col.id" />
              </template>
              <template v-else>
                <BookTableCellDispatcher
                  :book="books[vItem.index]!"
                  :col-id="col.id"
                  :cell-type="col.cellType"
                  :has-lock-field="!!COLUMN_DEF_MAP.get(col.id)?.lockField"
                  :is-locked="isCellLocked(books[vItem.index]!, col.id)"
                  :is-active="editor.isActive(books[vItem.index]!.id, col.id)"
                  :is-read-only="isCellReadOnly(books[vItem.index]!, col)"
                  :is-fully-locked="isRowFullyLocked(books[vItem.index]!)"
                  :locked-field-count="getRowLockedFieldCount(books[vItem.index]!)"
                  :selection-mode="props.selectionMode ?? false"
                  :always-show-open-link-icon="isReadOnly"
                  :value="getCellValue(books[vItem.index]!, col.id)"
                  :search-fn="col.cellType === 'text' ? getTextSearchFn(col.id) : col.cellType === 'chips' ? getChipsSearchFn(col.id) : undefined"
                  :open-link="col.cellType === 'text' ? getTextCellOpenLink(books[vItem.index]!, col.id) : undefined"
                  :open-link-label="col.cellType === 'text' ? getTextCellOpenLinkLabel(col.id) : undefined"
                  :link-fn="col.cellType === 'chips' ? getChipsLinkFn(col.id) : undefined"
                  :chip-action-fn="col.cellType === 'chips' ? getChipsActionFn(col.id) : undefined"
                  :allow-decimal="col.id === 'seriesIndex'"
                  @activate="handleActivate(books[vItem.index]!, col.id)"
                  @save="(value) => handleSave(books[vItem.index]!, col.id, value)"
                  @cancel="handleCancel(books[vItem.index]!.id, col.id)"
                  @navigate="(direction) => handleNavigate(books[vItem.index]!, col.id, direction)"
                  @cover-click="handleCoverClick(books[vItem.index]!)"
                  @toggle-lock="handleToggleCellLock(books[vItem.index]!, col.id)"
                  @lock-all="handleLockAllRow(books[vItem.index]!)"
                  @unlock-all="handleUnlockAllRow(books[vItem.index]!)"
                  @action="(type) => emit('action', books[vItem.index]!, type)"
                  @update:book="(updated) => emit('update:book', updated)"
                />

                <div
                  v-if="statusAnchorColumnId === col.id && getRowFeedback(books[vItem.index]!.id)"
                  class="pointer-events-auto absolute right-1 top-1 z-30"
                >
                  <span
                    v-if="getRowFeedback(books[vItem.index]!.id)?.state === 'refreshing'"
                    class="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/12 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  >
                    <Loader2 :size="10" class="animate-spin" />
                    Fetching...
                  </span>
                  <span
                    v-else-if="getRowFeedback(books[vItem.index]!.id)?.state === 'success'"
                    class="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    <CheckCircle2 :size="10" />
                    Updated
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-1 py-0.5 text-[10px] font-medium text-destructive"
                  >
                    <AlertTriangle :size="10" />
                    Failed
                    <button
                      class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-destructive/20"
                      :title="getRowFeedbackMessage(books[vItem.index]!.id)"
                      @click.stop="retryMetadataRefresh(books[vItem.index]!)"
                    >
                      <RotateCcw :size="8" />
                    </button>
                  </span>
                </div>
              </template>
            </td>
          </tr>

          <tr v-if="virtualItems.length > 0" role="row">
            <td
              role="gridcell"
              :colspan="displayColumns.length + (selectionMode ? 1 : 0)"
              :style="{ height: `${totalSize - virtualItems[virtualItems.length - 1]!.end}px` }"
            />
          </tr>
        </tbody>
      </table>
    </div>

    <div
      v-if="books.length === 0 && !loading"
      class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground"
    >
      <BookOpen :size="36" class="opacity-30" />
      <p class="text-sm">No books to display</p>
    </div>

    <!-- Scroll to top FAB -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      leave-active-class="transition-all duration-150 ease-in"
      enter-from-class="opacity-0 translate-y-2"
      leave-to-class="opacity-0 translate-y-2"
    >
      <button
        v-if="showScrollTop"
        class="absolute bottom-10 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors"
        aria-label="Scroll to top"
        @click="scrollToTop"
      >
        <ChevronUp :size="16" />
      </button>
    </Transition>

    <!-- Enhanced status bar -->
    <div class="shrink-0 flex items-center justify-between border-t border-border/60 bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
      <div class="flex items-center gap-2">
        <span v-if="selectionMode && selectedCount">
          {{ selectedCount.toLocaleString() }} selected
          <span class="text-muted-foreground/60">/ </span>
        </span>
        <span v-if="filterActive" class="flex items-center gap-1 text-primary">
          <span class="h-1.5 w-1.5 rounded-full bg-primary" />
          Filtered
        </span>
        <span v-if="hasMore">{{ books.length.toLocaleString() }} of {{ (total ?? 0).toLocaleString() }} loaded</span>
        <span v-else>{{ (total ?? books.length).toLocaleString() }} {{ (total ?? books.length) === 1 ? 'book' : 'books' }}</span>
      </div>
      <div class="flex items-center gap-3">
        <button
          class="inline-flex h-5 w-5 items-center justify-center rounded border border-border/70 bg-background text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Keyboard shortcuts (?)"
          aria-label="Show table keyboard shortcuts"
          @click="shortcutOverlayOpen = true"
        >
          ?
        </button>
        <span class="hidden lg:inline text-[11px] text-muted-foreground/80">Copy cell: Ctrl/Cmd+C · Copy row: Ctrl/Cmd+Shift+C</span>
        <span v-if="loading" class="flex items-center gap-1">
          <Loader2 :size="11" class="animate-spin" />
          Loading...
        </span>
      </div>
    </div>

    <BookTableContextMenu
      :book="contextMenuBook"
      :position="contextMenuPosition"
      @action="handleContextMenuAction"
      @update:book="(updated) => emit('update:book', updated)"
      @close="closeContextMenu"
    />

    <BookTableHeaderContextMenu
      v-if="headerCtxColumn"
      :column="headerCtxColumn"
      :position="headerCtxPosition"
      :sort-dir="headerCtxSortDir"
      :quick-filters="getQuickFilterOptions(headerCtxColumn.id)"
      @sort-asc="handleHeaderCtxSortAsc"
      @sort-desc="handleHeaderCtxSortDesc"
      @clear-sort="handleHeaderCtxClearSort"
      @quick-filter="handleHeaderCtxQuickFilter"
      @hide-column="handleHeaderCtxHideColumn"
      @auto-fit="handleHeaderCtxAutoFit"
      @auto-fit-all="handleHeaderCtxAutoFitAll"
      @pin-left="handleHeaderCtxPinLeft"
      @pin-right="handleHeaderCtxPinRight"
      @unpin="handleHeaderCtxUnpin"
      @close="closeHeaderContextMenu"
    />
  </div>

  <BookCoverDialog :book="coverDialogBook" :read-only="isReadOnly" @close="coverDialogBook = null" @update:book="handleCoverDialogUpdateBook" />
  <KeyboardShortcutOverlay v-model:open="shortcutOverlayOpen" />
</template>

<style scoped>
.tbody-enter {
  animation: tbodyEnter 0.22s cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes tbodyEnter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.book-cell--changed {
  animation: cellChangedFlash 2.8s ease-out both;
}

@keyframes cellChangedFlash {
  0% {
    box-shadow: inset 0 0 0 999px color-mix(in oklch, oklch(0.696 0.17 162.48) 20%, transparent);
  }
  85% {
    box-shadow: inset 0 0 0 999px color-mix(in oklch, oklch(0.696 0.17 162.48) 8%, transparent);
  }
  100% {
    box-shadow: inset 0 0 0 999px transparent;
  }
}
</style>
