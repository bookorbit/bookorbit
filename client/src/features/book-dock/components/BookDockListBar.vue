<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpDown, Check, FolderPlus, Keyboard, Loader2, PenLine, RefreshCw, Trash2, Wand2, X } from '@lucide/vue'
import { Permission, type BookDockSummary } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatNumber } from '@/i18n/formatters'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import type { SortField } from '../composables/useBookDockFiles'

const props = defineProps<{
  pageCount: number
  total: number
  totalSizeBytes: number | null
  allOnPageSelected: boolean
  selectAllMatching: boolean
  selectionCount: number
  fetchedCount: number
  errorCount: number
  sort: SortField
  summary: BookDockSummary
  keyboardActive: boolean
}>()

const emit = defineEmits<{
  toggleSelectAll: []
  selectAllMatching: []
  sort: [SortField]
  finalize: []
  setDestination: []
  bulkEdit: []
  deselect: []
  bulkDiscard: []
  applyFetched: []
  retryFetch: []
}>()

const { t } = useI18n()
const { hasPermission, isDemoRestrictedAccount } = usePermissions()

const canFinalize = computed(() => hasPermission(Permission.LibraryUpload))
const canBulkEdit = computed(() => !isDemoRestrictedAccount.value)
const hasSelection = computed(() => props.selectionCount > 0)

/** Server-counted, not derived: subtracting needsReview also removed weak matches,
 *  which finalize accepts perfectly well. */
const filableCount = computed(() => props.summary.readyToFile)

const sortOptions = computed<{ value: SortField; label: string }[]>(() => [
  { value: 'attention', label: t('bookDock.layout.sort.attention') },
  { value: 'createdAt', label: t('bookDock.layout.sort.createdAt') },
  { value: 'fileName', label: t('bookDock.layout.sort.fileName') },
  { value: 'fileSize', label: t('bookDock.layout.sort.fileSize') },
  { value: 'format', label: t('bookDock.layout.sort.format') },
  { value: 'status', label: t('bookDock.layout.sort.status') },
])

function onToggleSelectAll() {
  emit('toggleSelectAll')
}
function onSelectAllMatching() {
  emit('selectAllMatching')
}
function onSortChange(event: Event) {
  emit('sort', (event.target as HTMLSelectElement).value as SortField)
}
function emitFinalize() {
  emit('finalize')
}
function emitSetDestination() {
  emit('setDestination')
}
function emitBulkEdit() {
  emit('bulkEdit')
}
function emitDeselect() {
  emit('deselect')
}
function emitBulkDiscard() {
  emit('bulkDiscard')
}
function emitApplyFetched() {
  emit('applyFetched')
}
function emitRetryFetch() {
  emit('retryFetch')
}
</script>

<template>
  <div class="sticky top-0 z-20 border-b border-border bg-card/92 backdrop-blur" data-testid="book-dock-list-bar">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
      <input
        type="checkbox"
        data-testid="book-dock-select-all"
        class="size-4 shrink-0 cursor-pointer accent-primary"
        :checked="props.allOnPageSelected"
        :aria-label="t('bookDock.layout.selectAllOnPage')"
        @change="onToggleSelectAll"
      />

      <!-- One count, not three: the selection replaces the page count while it exists. -->
      <span v-if="hasSelection" class="text-xs font-medium tabular-nums" data-testid="book-dock-selection-count">
        {{ t('bookDock.layout.selection.nSelected', { count: formatNumber(props.selectionCount) }) }}
      </span>
      <span v-else class="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
        <span>
          {{ t('bookDock.layout.showingOf', { shown: formatNumber(props.pageCount), total: formatNumber(props.total) }) }}
          <template v-if="props.totalSizeBytes"> · {{ formatBytes(props.totalSizeBytes) }}</template>
        </span>
        <!-- Inline in a bar that is always on screen. As its own block this appeared
             and vanished as files processed, shunting the whole list up and down. -->
        <span v-if="props.summary.pending > 0" class="flex items-center gap-1 text-blue-600 dark:text-blue-400">
          <span aria-hidden="true">·</span>
          <Loader2 v-if="props.summary.working > 0" class="size-3 animate-spin" aria-hidden="true" />
          <span role="status">{{ t('bookDock.layout.working.label', { count: formatNumber(props.summary.pending) }) }}</span>
        </span>
      </span>

      <label v-if="!hasSelection" class="flex items-center gap-1.5">
        <span class="sr-only">{{ t('bookDock.layout.sort.label') }}</span>
        <ArrowUpDown class="size-3 text-muted-foreground" aria-hidden="true" />
        <select
          data-testid="book-dock-sort"
          class="h-6 rounded-md border border-border bg-transparent px-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :value="props.sort"
          @change="onSortChange"
        >
          <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>

      <!-- Only while the list has focus: three keys do not need permanent billing. -->
      <span v-if="props.keyboardActive && !hasSelection" class="hidden items-center gap-1.5 text-[10.5px] text-muted-foreground lg:flex">
        <Keyboard class="size-3" aria-hidden="true" />
        {{ t('bookDock.layout.keyboardHint') }}
      </span>

      <div class="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        <template v-if="hasSelection">
          <button
            v-if="props.fetchedCount > 0"
            type="button"
            data-testid="book-dock-apply-fetched"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-amber-500/12 px-2.5 text-[11.5px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-amber-300"
            @click="emitApplyFetched"
          >
            <Wand2 class="size-3" aria-hidden="true" />
            {{ t('bookDock.applyFetched') }}
          </button>
          <button
            v-if="props.errorCount > 0"
            type="button"
            data-testid="book-dock-retry-errors"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-sky-500/12 px-2.5 text-[11.5px] font-medium text-sky-700 transition-colors hover:bg-sky-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-sky-300"
            @click="emitRetryFetch"
          >
            <RefreshCw class="size-3" aria-hidden="true" />
            {{ t('bookDock.retryErrors') }}
          </button>
          <button
            v-if="canFinalize"
            type="button"
            data-testid="book-dock-set-destination"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-emerald-500/12 px-2.5 text-[11.5px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-emerald-300"
            @click="emitSetDestination"
          >
            <FolderPlus class="size-3" aria-hidden="true" />
            {{ t('bookDock.setDestinationAction') }}
          </button>
          <button
            v-if="canBulkEdit"
            type="button"
            data-testid="book-dock-bulk-edit"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-violet-500/12 px-2.5 text-[11.5px] font-medium text-violet-700 transition-colors hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-violet-300"
            @click="emitBulkEdit"
          >
            <PenLine class="size-3" aria-hidden="true" />
            {{ t('bookDock.bulkEditAction') }}
          </button>
          <button
            type="button"
            data-testid="book-dock-deselect"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-muted px-2.5 text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            @click="emitDeselect"
          >
            <X class="size-3" aria-hidden="true" />
            {{ t('bookDock.deselect') }}
          </button>
          <button
            type="button"
            data-testid="book-dock-bulk-discard"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-red-500/10 px-2.5 text-[11.5px] font-medium text-red-600 transition-colors hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:text-red-400"
            @click="emitBulkDiscard"
          >
            <Trash2 class="size-3" aria-hidden="true" />
            {{ t('bookDock.discard') }}
          </button>
          <button
            v-if="canFinalize"
            type="button"
            data-testid="book-dock-finalize"
            class="inline-flex h-7 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-[11.5px] font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            @click="emitFinalize"
          >
            <Check class="size-3" aria-hidden="true" />
            {{ t('bookDock.layout.selection.fileToLibrary', { count: props.selectionCount }) }}
          </button>
        </template>

        <span v-else-if="filableCount > 0" class="text-[11px] tabular-nums text-muted-foreground">
          {{ t('bookDock.layout.selection.nReadyToFile', { count: formatNumber(filableCount) }) }}
        </span>
      </div>
    </div>

    <!--
      Selecting the page is not the same as selecting the query. At scale that
      difference decides whether a bulk action touches 20 rows or all of them.
    -->
    <div
      v-if="props.allOnPageSelected && props.total > props.pageCount"
      class="flex flex-wrap items-center gap-2 border-t border-border bg-primary/8 px-3 py-1.5 text-[11.5px]"
    >
      <span>{{ t('bookDock.layout.allOnPageSelected', { count: formatNumber(props.pageCount) }) }}</span>
      <button
        v-if="!props.selectAllMatching"
        type="button"
        data-testid="book-dock-select-all-matching"
        class="rounded-md bg-primary px-2 py-0.5 font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        @click="onSelectAllMatching"
      >
        {{ t('bookDock.layout.selectAllMatching', { count: formatNumber(props.total) }) }}
      </button>
      <span v-else class="font-medium text-primary">{{ t('bookDock.layout.allMatchingSelected', { count: formatNumber(props.total) }) }}</span>
    </div>
  </div>
</template>
