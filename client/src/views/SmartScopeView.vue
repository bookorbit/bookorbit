<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import {
  AlertTriangle,
  Settings2,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Aperture,
  CheckSquare,
  FileSpreadsheet,
  Filter,
  Layers,
  Search,
  SlidersHorizontal,
  Square,
  X,
} from '@lucide/vue'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import VirtualBookTable from '@/features/book/components/VirtualBookTable.vue'
import TableColumnPanel from '@/features/book/components/TableColumnPanel.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SmartScopeEditorPanel from '@/features/smart-scope/components/SmartScopeEditorPanel.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import BulkEditMetadataDialog from '@/features/book/components/BulkEditMetadataDialog.vue'
import MetadataExportDialog from '@/features/book/components/MetadataExportDialog.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import JumpRail from '@/features/book/components/JumpRail.vue'
import { toast } from 'vue-sonner'
import { useBookViewWindow } from '@/features/book/composables/useBookViewWindow'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'
import { useViewDisplaySettings } from '@/composables/useViewDisplaySettings'
import { useViewSearch } from '@/features/book/composables/useViewSearch'
import FilterSummary from '@/features/book/components/FilterSummary.vue'
import { SORT_FIELD_LABELS } from '@/features/book/lib/filter-labels'
import { DEFAULT_COVER_ASPECT_RATIO } from '@/features/book/lib/cover-aspect-ratio'
import { usePageTitle } from '@/composables/usePageTitle'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useBookViewContext } from '@/features/book/composables/useBookViewContext'
import { useBookTableShell } from '@/features/book/composables/useBookTableShell'
import { useInfiniteScrollSentinel } from '@/features/book/composables/useInfiniteScrollSentinel'
import { useSavedViews, type SavedView } from '@/features/book/composables/useSavedViews'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBulkEditMetadata } from '@/features/book/composables/useBulkEditMetadata'
import type { BulkEditFields } from '@/features/book/composables/useBulkEditMetadata'
import type { BookCard, GroupRule, SortField } from '@bookorbit/types'
import EntityNotFound from '@/components/EntityNotFound.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { viewMode, effectiveViewMode } = useEffectiveViewMode()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()
const { smartScopeFilterExpanded } = useDisplaySettings()

const smartScopeId = shallowRef(Number(route.params.id))
const coverAspectRatio = computed(() => DEFAULT_COVER_ASPECT_RATIO)
const { coverSize, gridGap } = useViewDisplaySettings('smartScope', smartScopeId, coverAspectRatio)
const { tableDensity } = useDisplaySettings()
const { allSavedViews, saveView, renameView, deleteView, duplicateView, toggleFavorite, importViews } = useSavedViews('smartScope', smartScopeId)

const { getEffectivePreference, setPreference, prefs } = useSeriesCollapsePreference()
const collapseEnabledRef = ref(getEffectivePreference({ smartScopeId: smartScopeId.value }))

watch(smartScopeId, (id) => {
  collapseEnabledRef.value = getEffectivePreference({ smartScopeId: id })
})

watch(prefs, () => {
  collapseEnabledRef.value = getEffectivePreference({ smartScopeId: smartScopeId.value })
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
  scopeId: smartScopeId,
  listEndpoint: (id) => `/api/v1/smart-scopes/${id}/books/query`,
  bucketsEndpoint: (id) => `/api/v1/smart-scopes/${id}/books/jump-buckets`,
  viewMode: effectiveViewMode,
  collapseEnabled: collapseEnabledRef,
  q: debouncedQuery,
})
const { setBookContext } = useBookNavigation()
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
useBookViewContext(slots, total, loadMorePrefix)
const { smartScopes, loaded: smartScopesLoaded, error: smartScopesError, fetchSmartScopes, deleteSmartScope } = useSmartScopes()
const smartScopeNotFound = ref(false)
const smartScopeLoadError = computed(() => smartScopesError.value ?? booksError.value)

const smartScope = computed(() => smartScopes.value.find((l) => l.id === smartScopeId.value))
const pageTitle = computed(() => {
  if (smartScope.value?.name) return t('views.smartScope.pageTitle', { name: smartScope.value.name })
  return Number.isFinite(smartScopeId.value) ? t('views.smartScope.pageTitleWithId', { id: smartScopeId.value }) : t('views.smartScope.title')
})
usePageTitle(pageTitle)

const sortChip = computed(() => {
  const specs = smartScope.value?.defaultSort
  if (!specs?.length) return null
  return specs.map((s) => `${SORT_FIELD_LABELS[s.field as SortField] ?? s.field} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', ')
})

const filterExpanded = smartScopeFilterExpanded
const mobileControlsExpanded = ref(false)

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
  anchor.download = `smart-scope-table-backup-${smartScopeId.value ?? 'shared'}.json`
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

watch(
  smartScope,
  (scope) => {
    tableSort.value = scope?.defaultSort?.length ? [...scope.defaultSort] : [{ field: 'title', dir: 'asc' }]
  },
  { immediate: true },
)

const editorOpen = ref(false)
const confirmSmartScopeDelete = ref(false)
const deleting = ref(false)

async function handleDelete() {
  if (!confirmSmartScopeDelete.value) {
    confirmSmartScopeDelete.value = true
    return
  }
  deleting.value = true
  const name = smartScope.value?.name ?? t('views.smartScope.defaultName')
  try {
    await deleteSmartScope(smartScopeId.value)
    toast.success(t('views.smartScope.toast.deleted', { name }))
    router.push({ name: 'dashboard' })
  } catch {
    toast.error(t('views.smartScope.toast.deleteFailed', { name }))
  } finally {
    deleting.value = false
    confirmSmartScopeDelete.value = false
  }
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < 640
}

function closeMobileControls() {
  mobileControlsExpanded.value = false
  confirmSmartScopeDelete.value = false
}

function collapseMobileControlsIfNeeded() {
  if (!mobileControlsExpanded.value) return
  if (!isMobileViewport()) return
  closeMobileControls()
}

function toggleMobileControls() {
  mobileControlsExpanded.value = !mobileControlsExpanded.value
}

function toggleFilterSummary() {
  filterExpanded.value = !filterExpanded.value
  collapseMobileControlsIfNeeded()
}

function openEditor() {
  editorOpen.value = true
  confirmSmartScopeDelete.value = false
  collapseMobileControlsIfNeeded()
}

function openMetadataExport() {
  metadataExportOpen.value = true
  collapseMobileControlsIfNeeded()
}

async function handleToggleCollapse() {
  const next = !collapseEnabledRef.value
  collapseEnabledRef.value = next
  await setPreference({ smartScopeId: smartScopeId.value }, next)
}

function onSaved() {
  resetBooks()
  refreshBuckets()
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
  await retrySmartScopeLoad()
})

async function retrySmartScopeLoad() {
  smartScopeNotFound.value = false
  await fetchSmartScopes()
  if (smartScopesError.value) return
  if (!smartScope.value && smartScopesLoaded.value) {
    smartScopeNotFound.value = true
    return
  }
  if (smartScope.value && booksError.value) {
    resetBooks()
  }
}

watch(smartScopeId, async () => {
  clearSearch()
  await retrySmartScopeLoad()
})

defineOptions({ name: 'SmartScopeView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <SmartScopeEditorPanel :open="editorOpen" :smartScope="smartScope" @close="editorOpen = false" @saved="onSaved" />

    <BookQuickView
      :book-id="quickViewBookId"
      :open="quickViewOpen"
      @update:open="quickViewOpen = $event"
      @action="quickViewBookId !== null && handleBookAction({ id: quickViewBookId } as BookCard, $event)"
    />

    <SelectionActionBar
      :visible="selectionMode"
      :count="selectedCount"
      :in-flight="inFlight"
      @send="sendBookOpen = true"
      @download="handleDownloadFiles"
      @export-metadata="openMetadataExport"
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
      view-type="smartScope"
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
        :title="smartScope?.name ?? t('views.smartScope.title')"
        :icon="smartScope?.icon ?? undefined"
        fallback-icon="Aperture"
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
                v-if="smartScope?.filter || sortChip"
                class="hidden sm:flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors"
                :class="
                  filterExpanded
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                "
                :aria-label="filterExpanded ? 'Hide filter summary' : 'Show filter summary'"
                @click="toggleFilterSummary"
              >
                <Filter :size="13" />
                <span>{{ t('views.smartScope.filter') }}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ filterExpanded ? 'Hide filter summary' : 'Show filter summary' }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="hidden sm:flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                :class="
                  collapseEnabledRef
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                "
                :aria-label="collapseEnabledRef ? t('views.bookView.expandSeries') : t('views.bookView.collapseSeries')"
                @click="handleToggleCollapse"
              >
                <Layers :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {{ collapseEnabledRef ? t('views.bookView.expandSeries') : t('views.bookView.collapseSeries') }}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                v-if="hasPermission('library_download') && !isDemoRestrictedAccount"
                class="hidden sm:flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground bg-background transition-colors hover:text-foreground hover:bg-muted"
                :aria-label="t('views.bookView.exportMetadata')"
                @click="openMetadataExport"
              >
                <FileSpreadsheet :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('views.bookView.exportMetadata') }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="hidden sm:flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :aria-label="t('views.smartScope.edit')"
                @click="openEditor"
              >
                <Settings2 :size="13" />
                <span>{{ t('common.edit') }}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('views.smartScope.edit') }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                :disabled="deleting"
                class="hidden sm:flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
                :class="
                  confirmSmartScopeDelete
                    ? 'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20'
                    : 'border-input text-muted-foreground hover:text-destructive hover:border-destructive'
                "
                :aria-label="confirmSmartScopeDelete ? 'Confirm delete Smart Scope' : 'Delete Smart Scope'"
                @click="handleDelete"
              >
                <Trash2 :size="14" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ confirmSmartScopeDelete ? 'Confirm delete' : 'Delete Smart Scope' }}</TooltipContent>
          </Tooltip>
          <button
            class="sm:hidden flex h-8 w-8 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :aria-label="t('views.smartScope.showControlsAria')"
            @click="toggleMobileControls"
          >
            <SlidersHorizontal :size="14" />
          </button>
        </template>
        <template #mobile-menu>
          <DropdownMenuItem @click="handleToggleCollapse">
            <CheckSquare v-if="collapseEnabledRef" :size="14" class="mr-2" />
            <Square v-else :size="14" class="mr-2" />
            {{ t('views.bookView.collapseSeries') }}
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
            :placeholder="t('views.bookView.searchPlaceholder')"
            class="mobile-search-input h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          />
          <button v-if="searchQuery.trim()" class="ml-1 text-muted-foreground/85 transition-colors hover:text-foreground" @click="clearSearch">
            <X :size="12" />
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="smartScope?.filter || sortChip"
            @click="toggleFilterSummary"
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <component :is="filterExpanded ? ChevronUp : ChevronDown" :size="13" />
            <span>{{ filterExpanded ? 'Hide filter' : 'Show filter' }}</span>
          </button>
          <button
            v-if="hasPermission('library_download') && !isDemoRestrictedAccount"
            @click="openMetadataExport"
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <FileSpreadsheet :size="13" />
            <span>{{ t('views.bookView.export') }}</span>
          </button>
          <button
            @click="openEditor"
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings2 :size="13" />
            <span>{{ t('common.edit') }}</span>
          </button>
          <button
            @click="handleDelete"
            :disabled="deleting"
            class="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors"
            :class="
              confirmSmartScopeDelete
                ? 'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20'
                : 'border-input text-muted-foreground hover:text-destructive hover:border-destructive'
            "
          >
            <Trash2 :size="13" />
            <span>{{ confirmSmartScopeDelete ? t('views.smartScope.confirmDelete') : t('common.delete') }}</span>
          </button>
          <button
            class="flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="closeMobileControls"
          >
            <X :size="13" />
            <span>{{ t('common.close') }}</span>
          </button>
        </div>
      </section>

      <main ref="mainRef" :class="effectiveViewMode === 'table' ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto'">
        <div v-if="smartScopeLoadError" class="flex flex-col items-center justify-center gap-3 py-24 text-center">
          <div class="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle :size="28" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('views.smartScope.loadError') }}</p>
          <p class="max-w-md text-xs text-muted-foreground">{{ smartScopeLoadError }}</p>
          <button
            class="rounded-md border border-input px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            @click="retrySmartScopeLoad"
          >
            {{ t('views.common.retry') }}
          </button>
        </div>

        <EntityNotFound v-else-if="smartScopeNotFound" :entity="t('views.entity.smartScope')" />

        <template v-else>
          <!-- Filter summary -->
          <div
            v-if="filterExpanded && (smartScope?.filter || sortChip)"
            class="flex flex-wrap items-center gap-2 mb-4 cursor-pointer"
            @click="editorOpen = true"
          >
            <FilterSummary v-if="smartScope?.filter" :node="smartScope.filter as GroupRule" />
            <span v-if="sortChip" class="inline-flex items-center text-xs rounded-md border border-border/60 overflow-hidden">
              <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground border-r border-border/60">
                <ArrowUpDown :size="10" class="shrink-0" />
                <span class="font-semibold">{{ t('views.bookView.sort') }}</span>
              </span>
              <span class="px-2 py-0.5 bg-muted/40 text-foreground font-medium">{{ sortChip }}</span>
            </span>
          </div>

          <!-- Empty state: no rules configured -->
          <div
            v-if="booksInitialized && !loading && !smartScope?.filter && books.length === 0"
            class="flex flex-col items-center justify-center py-24 gap-4 text-center"
          >
            <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <Settings2 :size="28" class="text-muted-foreground/70" />
            </div>
            <div class="flex flex-col gap-1">
              <p class="text-sm font-medium text-foreground">{{ t('views.smartScope.empty.noRules') }}</p>
              <p class="text-xs text-muted-foreground max-w-xs">
                {{ t('views.smartScope.empty.noRulesHint') }}
              </p>
            </div>
            <button
              @click="editorOpen = true"
              class="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              {{ t('views.smartScope.empty.configure') }}
            </button>
          </div>

          <!-- Empty state: rules set but no matches -->
          <div
            v-else-if="booksInitialized && !loading && books.length === 0 && smartScope?.filter"
            class="flex flex-col items-center justify-center py-24 gap-3 text-center"
          >
            <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
              <Aperture :size="28" class="text-muted-foreground/70" />
            </div>
            <p class="text-sm font-medium text-foreground">{{ t('views.smartScope.empty.noMatch') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('views.smartScope.empty.noMatchHint') }}</p>
            <button @click="editorOpen = true" class="text-xs text-primary hover:underline">{{ t('views.smartScope.empty.edit') }}</button>
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
            :rail-gutter="railGutterReserved"
            @range="handleRange"
            @first-visible-index="handleFirstVisibleIndex"
            @action="handleBookAction"
            @select="handleSelect"
          />

          <!-- List view -->
          <div v-if="effectiveViewMode === 'list' && contiguousPrefix.length > 0" class="flex flex-col divide-y divide-border">
            <BookListRow
              v-for="book in contiguousPrefix"
              :key="book.id"
              :book="book"
              :selection-mode="selectionMode"
              :selected="isSelected(book.id)"
              @select="handleSelect(book.id, $event)"
              @action="handleBookAction(book, $event)"
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
            view-type="smartScope"
            :selection-mode="selectionMode"
            :is-selected="isSelected"
            :selected-count="selectedCount"
            :initialized="booksInitialized"
            @update:sort="tableSort = $event"
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
            <span v-else-if="!hasMorePrefix && contiguousPrefix.length > 0" class="text-xs text-muted-foreground">
              {{ t('views.bookView.allBooksLoaded', { count: formatNumber(total) }) }}
            </span>
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
