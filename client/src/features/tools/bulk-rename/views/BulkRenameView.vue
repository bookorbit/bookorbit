<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize } from '@vueuse/core'
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Play, RefreshCw, SlidersHorizontal, X } from '@lucide/vue'
import type { BulkRenameStatus, Library } from '@bookorbit/types'

import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { storage } from '@/services/storage'
import { useBulkRename } from '../../composables/useBulkRename'
import BulkRenameStatusBadge from '../components/BulkRenameStatusBadge.vue'
import BulkRenameConfirmDialog from '../components/BulkRenameConfirmDialog.vue'

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()
const bulk = useBulkRename()

const showConfirmDialog = ref(false)
const librarySelectRef = ref<HTMLSelectElement | null>(null)
const tableViewportRef = ref<HTMLElement | null>(null)
const { width: tableViewportWidth } = useElementSize(tableViewportRef)
const showFullPaths = ref<boolean>(storage.get<boolean>('tools.bulkRename.showFullPaths', false))
type BulkRenameColumnVisibility = {
  title: boolean
  currentPath: boolean
  newPath: boolean
}
const defaultColumnVisibility: BulkRenameColumnVisibility = {
  title: true,
  currentPath: true,
  newPath: true,
}
const columnVisibility = ref<BulkRenameColumnVisibility>(
  storage.get<BulkRenameColumnVisibility>('tools.bulkRename.columnVisibility', defaultColumnVisibility),
)
type ColumnOption = { key: keyof BulkRenameColumnVisibility; label: string }
const columnOptions = computed<ColumnOption[]>(() => [
  { key: 'title', label: t('tools.bulkRename.columns.title') },
  { key: 'currentPath', label: t('tools.bulkRename.columns.currentPath') },
  { key: 'newPath', label: t('tools.bulkRename.columns.newPath') },
])

const eligibleLibraries = computed(() => libraries.value.filter((lib: Library) => lib.fileRenameEnabled))
const selectedLibrary = computed(() => eligibleLibraries.value.find((lib: Library) => lib.id === bulk.selectedLibraryId.value) ?? null)
const selectedLibraryRoots = computed(() => selectedLibrary.value?.folders.map((folder) => folder.path) ?? [])

const statusOptions = computed<{ value: BulkRenameStatus | undefined; label: string }[]>(() => [
  { value: undefined, label: t('tools.bulkRename.filter.all') },
  { value: 'will_rename', label: t('tools.bulkRename.status.willRename') },
  { value: 'unchanged', label: t('tools.bulkRename.status.unchanged') },
  { value: 'collision', label: t('tools.bulkRename.status.collision') },
  { value: 'no_pattern', label: t('tools.bulkRename.status.noPattern') },
  { value: 'error', label: t('tools.bulkRename.status.error') },
])

const hasPreview = computed(() => bulk.previewItems.value.length > 0 || bulk.previewTotal.value > 0)
const showTitleColumn = computed(() => columnVisibility.value.title)
const showCurrentPathColumn = computed(() => columnVisibility.value.currentPath)
const showNewPathColumn = computed(() => columnVisibility.value.newPath)
const tablePathMaxLength = computed(() => {
  const visiblePathColumns = Number(showCurrentPathColumn.value) + Number(showNewPathColumn.value)
  if (visiblePathColumns <= 0) return 72

  // Approximate available text width in each path column.
  const tableWidth = tableViewportWidth.value
  const indexColumnPx = 72
  const statusColumnPx = 152
  const titleColumnPx = showTitleColumn.value ? 320 : 0
  const framePaddingPx = 16
  const pathCellPaddingPx = 32
  const charWidthPx = 7.1
  const availableForPaths = Math.max(tableWidth - indexColumnPx - statusColumnPx - titleColumnPx - framePaddingPx, 0)
  const perPathColumnPx = availableForPaths / visiblePathColumns
  const textPx = Math.max(perPathColumnPx - pathCellPaddingPx, 0)
  const maxChars = Math.floor(textPx / charWidthPx)

  return Math.min(220, Math.max(24, maxChars))
})

onMounted(async () => {
  await fetchLibraries()
})

function handleLibraryChange(event: Event): void {
  const target = event.target as HTMLSelectElement
  const id = parseInt(target.value, 10)
  if (!isNaN(id)) {
    bulk.selectLibrary(id)
    bulk.loadPreview()
  }
}

function handleSetStatusFilter(value: BulkRenameStatus | undefined): void {
  bulk.setStatusFilter(value)
}

function focusLibrarySelect(): void {
  librarySelectRef.value?.focus()
}

function handleColumnVisibilityChange(key: keyof BulkRenameColumnVisibility, checked: boolean): void {
  columnVisibility.value = {
    ...columnVisibility.value,
    [key]: checked,
  }
}

function handleRefreshPreview(): void {
  bulk.loadPreview()
}

function handlePrevPage(): void {
  if (bulk.page.value > 1) {
    bulk.setPage(bulk.page.value - 1)
  }
}

function handleNextPage(): void {
  if (bulk.page.value < bulk.totalPages.value) {
    bulk.setPage(bulk.page.value + 1)
  }
}

function handleOpenConfirm(): void {
  showConfirmDialog.value = true
}

function handleCloseConfirm(): void {
  showConfirmDialog.value = false
}

async function handleConfirmExecute(): Promise<void> {
  showConfirmDialog.value = false
  await bulk.execute()
  if (!bulk.executionError.value) {
    bulk.loadPreview()
  }
}

function handleCancelExecution(): void {
  bulk.cancelExecution()
}

function getStatusCount(status: BulkRenameStatus | undefined): number {
  if (status === undefined) {
    return Object.values(bulk.totalByStatus.value).reduce((total, count) => total + count, 0)
  }
  return bulk.totalByStatus.value[status] ?? 0
}

function isStatusActive(status: BulkRenameStatus | undefined): boolean {
  return bulk.statusFilter.value === status
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (normalized.length > 1 && normalized.endsWith('/')) {
    return normalized.slice(0, -1)
  }
  return normalized
}

function stripLibraryRoot(path: string): string {
  const normalizedPath = normalizePath(path)
  const matchedRoot = selectedLibraryRoots.value
    .map((root) => normalizePath(root))
    .sort((a, b) => b.length - a.length)
    .find((root) => normalizedPath === root || normalizedPath.startsWith(`${root}/`))

  if (!matchedRoot) return path
  if (normalizedPath === matchedRoot) return '.'
  return normalizedPath.slice(matchedRoot.length + 1)
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const remaining = maxLength - 3
  const head = Math.ceil(remaining / 2)
  const tail = Math.floor(remaining / 2)
  return `${value.slice(0, head)}...${value.slice(value.length - tail)}`
}

function truncatePathKeepingExtension(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 12) return value.slice(0, Math.max(maxLength - 3, 1)) + '...'

  const normalized = normalizePath(value)
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1)
  const extensionIndex = basename.lastIndexOf('.')
  const extension = extensionIndex > 0 ? basename.slice(extensionIndex) : ''
  const remaining = maxLength - 3
  const minimumTail = extension ? Math.min(Math.max(extension.length + 10, 18), 40) : 18
  const tail = Math.min(Math.max(Math.floor(remaining * 0.55), minimumTail), remaining - 8)
  const head = remaining - tail

  return `${normalized.slice(0, head)}...${normalized.slice(normalized.length - tail)}`
}

function resolveVisiblePath(path: string): string {
  return showFullPaths.value ? path : stripLibraryRoot(path)
}

function formatCardPath(path: string | null | undefined): string {
  if (!path) return '-'
  return truncatePathKeepingExtension(resolveVisiblePath(path), 72)
}

function formatTablePath(path: string | null | undefined): string {
  if (!path) return '-'
  return truncatePathKeepingExtension(resolveVisiblePath(path), tablePathMaxLength.value)
}

function formatTitle(title: string): string {
  return truncateMiddle(title, 52)
}

watch(
  () => bulk.selectedLibraryId.value,
  (newId) => {
    if (newId === null) {
      bulk.previewItems.value = []
      bulk.previewTotal.value = 0
    }
  },
)

watch(showFullPaths, (value) => {
  storage.set('tools.bulkRename.showFullPaths', value)
})

watch(
  columnVisibility,
  (value) => {
    storage.set('tools.bulkRename.columnVisibility', value)
  },
  { deep: true },
)
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col gap-4">
    <section class="rounded-lg border border-border/70 bg-card/50 p-4">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-3">
          <div class="min-w-0 flex flex-col gap-2">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <label class="text-sm font-medium text-foreground sm:shrink-0">{{ t('tools.bulkRename.library') }}</label>
              <select
                ref="librarySelectRef"
                class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-1"
                :value="bulk.selectedLibraryId.value ?? ''"
                @change="handleLibraryChange"
              >
                <option value="" disabled>{{ t('tools.bulkRename.selectLibraryPlaceholder') }}</option>
                <option v-for="lib in eligibleLibraries" :key="lib.id" :value="lib.id">
                  {{ lib.name }}
                </option>
              </select>
            </div>
            <p v-if="eligibleLibraries.length === 0" class="text-sm text-muted-foreground">
              {{ t('tools.bulkRename.noEligibleLibraries') }}
            </p>
          </div>

          <div v-if="bulk.selectedLibraryId.value !== null" class="flex flex-wrap items-center gap-2 lg:justify-self-end">
            <button
              class="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted/60 disabled:opacity-50"
              :disabled="bulk.loading.value || bulk.executing.value"
              @click="handleRefreshPreview"
            >
              <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': bulk.loading.value }" />
              {{ t('tools.bulkRename.refresh') }}
            </button>

            <button
              v-if="!bulk.executing.value"
              class="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              :disabled="bulk.totalByStatus.value.will_rename === 0 || bulk.loading.value"
              @click="handleOpenConfirm"
            >
              <Play class="h-4 w-4" />
              {{ t('tools.bulkRename.applyRename') }}
            </button>

            <button
              v-else
              class="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              @click="handleCancelExecution"
            >
              <X class="h-4 w-4" />
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>

        <div v-if="bulk.selectedLibraryId.value !== null" class="rounded-md bg-muted/20 px-3 py-2.5">
          <div class="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium text-foreground">{{ t('tools.bulkRename.summary.label') }}</span>
              <span class="rounded-full bg-primary/15 px-2.5 py-0.5 text-primary">{{
                t('tools.bulkRename.summary.toRename', { count: bulk.totalByStatus.value.will_rename })
              }}</span>
              <span class="rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground">{{
                t('tools.bulkRename.summary.unchanged', { count: bulk.totalByStatus.value.unchanged })
              }}</span>
              <span v-if="bulk.totalByStatus.value.collision > 0" class="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-amber-500">
                {{ t('tools.bulkRename.summary.collisions', { count: bulk.totalByStatus.value.collision }, bulk.totalByStatus.value.collision) }}
              </span>
              <span v-if="bulk.totalByStatus.value.error > 0" class="rounded-full bg-destructive/15 px-2.5 py-0.5 text-destructive">
                {{ t('tools.bulkRename.summary.errors', { count: bulk.totalByStatus.value.error }, bulk.totalByStatus.value.error) }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <label class="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input v-model="showFullPaths" type="checkbox" class="h-4 w-4 rounded border-border bg-background text-primary" />
                {{ t('tools.bulkRename.showFullPaths') }}
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button
                    class="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                  >
                    <SlidersHorizontal class="h-3.5 w-3.5" />
                    {{ t('tools.bulkRename.columnsMenu') }}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-44">
                  <DropdownMenuCheckboxItem
                    v-for="opt in columnOptions"
                    :key="opt.key"
                    :model-value="columnVisibility[opt.key]"
                    @update:model-value="(checked) => handleColumnVisibilityChange(opt.key, checked === true)"
                  >
                    {{ opt.label }}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <button
              v-for="opt in statusOptions"
              :key="opt.label"
              class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
              :class="
                isStatusActive(opt.value)
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border/70 bg-background/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              "
              @click="handleSetStatusFilter(opt.value)"
            >
              <span>{{ opt.label }}</span>
              <span class="rounded bg-muted/70 px-1.5 py-0.5 text-[11px] leading-none text-foreground">
                {{ getStatusCount(opt.value) }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </section>

    <div
      v-if="bulk.selectedLibraryId.value === null"
      class="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-center"
    >
      <div class="flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
        <SlidersHorizontal class="h-6 w-6 text-muted-foreground" />
      </div>
      <div class="space-y-1">
        <p class="text-base font-semibold text-foreground">{{ t('tools.bulkRename.empty.title') }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">
          {{ t('tools.bulkRename.empty.description') }}
        </p>
      </div>
      <button
        class="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
        @click="focusLibrarySelect"
      >
        {{ t('tools.bulkRename.empty.chooseLibrary') }}
      </button>
    </div>

    <template v-else>
      <div v-if="bulk.executing.value" class="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-primary">
        <Loader2 class="h-4 w-4 animate-spin" />
        <span class="text-sm">{{ t('tools.bulkRename.renamingInProgress') }}</span>
      </div>

      <div
        v-if="bulk.executionStats.value && !bulk.executing.value"
        class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-emerald-600 dark:text-emerald-400"
      >
        <p class="text-sm font-medium">{{ t('tools.bulkRename.completed.title') }}</p>
        <p class="mt-1 text-sm">
          {{
            t('tools.bulkRename.completed.stats', {
              succeeded: bulk.executionStats.value.succeeded,
              failed: bulk.executionStats.value.failed,
              skipped: bulk.executionStats.value.skipped,
              processed: bulk.executionStats.value.processed,
            })
          }}
        </p>
      </div>

      <div
        v-if="bulk.executionError.value && !bulk.executing.value"
        class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive"
      >
        <p class="text-sm font-medium">{{ t('tools.bulkRename.executionFailed') }}</p>
        <p class="mt-1 text-sm">{{ bulk.executionError.value }}</p>
      </div>

      <div
        v-if="bulk.previewError.value && !hasPreview"
        class="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-6 text-center text-destructive"
      >
        <p class="text-sm font-medium">{{ t('tools.bulkRename.previewFailed') }}</p>
        <p class="mt-1 text-sm">{{ bulk.previewError.value }}</p>
      </div>

      <div
        v-else-if="bulk.loading.value && !hasPreview"
        class="flex flex-1 items-center justify-center rounded-lg border border-border/60 bg-card/20"
      >
        <Loader2 class="h-6 w-6 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="hasPreview" class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card/40">
        <div ref="tableViewportRef" class="min-h-0 flex-1 overflow-auto">
          <div class="divide-y divide-border/60 md:hidden">
            <article v-for="(item, idx) in bulk.previewItems.value" :key="item.bookId" class="space-y-2 px-3 py-3">
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-muted-foreground">#{{ (bulk.page.value - 1) * bulk.pageSize.value + idx + 1 }}</p>
                <BulkRenameStatusBadge :status="item.status" class="shrink-0" />
              </div>
              <div v-if="showTitleColumn" class="flex min-w-0 items-center gap-2">
                <RouterLink
                  :to="{ name: 'book-detail', params: { bookId: item.bookId } }"
                  class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  :aria-label="t('tools.bulkRename.openBookDetails')"
                >
                  <ExternalLink class="h-3.5 w-3.5" />
                </RouterLink>
                <p class="min-w-0 truncate text-sm font-medium text-foreground" :title="item.title">
                  {{ formatTitle(item.title) }}
                </p>
              </div>
              <div v-if="showCurrentPathColumn" class="space-y-0.5">
                <p class="text-[11px] uppercase tracking-wide text-muted-foreground">{{ t('tools.bulkRename.columns.currentPath') }}</p>
                <p class="truncate font-mono text-xs text-muted-foreground" :title="item.currentPath">{{ formatCardPath(item.currentPath) }}</p>
              </div>
              <div v-if="showNewPathColumn" class="space-y-0.5">
                <p class="text-[11px] uppercase tracking-wide text-muted-foreground">{{ t('tools.bulkRename.columns.newPath') }}</p>
                <p class="truncate font-mono text-xs text-muted-foreground" :title="item.newPath ?? '-'">{{ formatCardPath(item.newPath) }}</p>
              </div>
            </article>
          </div>

          <table class="hidden w-full table-fixed text-sm md:table">
            <colgroup>
              <col class="w-10" />
              <col v-if="showTitleColumn" class="w-72" />
              <col v-if="showCurrentPathColumn" />
              <col v-if="showNewPathColumn" />
              <col class="w-30" />
            </colgroup>
            <thead class="sticky top-0 z-10 bg-muted/70 backdrop-blur-sm">
              <tr>
                <th class="px-4 py-2.5 text-left font-medium text-muted-foreground">#</th>
                <th v-if="showTitleColumn" class="w-56 px-4 py-2.5 text-left font-medium text-muted-foreground">
                  {{ t('tools.bulkRename.columns.title') }}
                </th>
                <th v-if="showCurrentPathColumn" class="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  {{ t('tools.bulkRename.columns.currentPath') }}
                </th>
                <th v-if="showNewPathColumn" class="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  {{ t('tools.bulkRename.columns.newPath') }}
                </th>
                <th class="w-30 px-4 py-2.5 text-left font-medium text-muted-foreground">{{ t('tools.bulkRename.columns.status') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border/60">
              <tr v-for="(item, idx) in bulk.previewItems.value" :key="item.bookId" class="hover:bg-muted/25">
                <td class="px-4 py-2.5 align-top text-muted-foreground">{{ (bulk.page.value - 1) * bulk.pageSize.value + idx + 1 }}</td>
                <td v-if="showTitleColumn" class="w-56 px-4 py-2.5 align-top font-medium text-foreground" :title="item.title">
                  <div class="flex min-w-0 items-center gap-2">
                    <RouterLink
                      :to="{ name: 'book-detail', params: { bookId: item.bookId } }"
                      class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/70 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      :aria-label="t('tools.bulkRename.openBookDetails')"
                    >
                      <ExternalLink class="h-3.5 w-3.5" />
                    </RouterLink>
                    <span class="min-w-0 truncate">{{ formatTitle(item.title) }}</span>
                  </div>
                </td>
                <td
                  v-if="showCurrentPathColumn"
                  class="max-w-0 px-4 py-2.5 align-top font-mono text-xs text-muted-foreground"
                  :title="item.currentPath"
                >
                  <div class="overflow-hidden whitespace-nowrap">
                    {{ formatTablePath(item.currentPath) }}
                  </div>
                </td>
                <td
                  v-if="showNewPathColumn"
                  class="max-w-0 px-4 py-2.5 align-top font-mono text-xs text-muted-foreground"
                  :title="item.newPath ?? '-'"
                >
                  <div class="overflow-hidden whitespace-nowrap">
                    {{ formatTablePath(item.newPath) }}
                  </div>
                </td>
                <td class="w-30 px-4 py-2.5 align-top whitespace-nowrap">
                  <BulkRenameStatusBadge :status="item.status" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-muted/20 px-4 py-3">
          <p class="text-xs text-muted-foreground sm:text-sm">
            {{
              t('tools.bulkRename.pagination.showing', {
                from: (bulk.page.value - 1) * bulk.pageSize.value + 1,
                to: Math.min(bulk.page.value * bulk.pageSize.value, bulk.previewTotal.value),
                total: bulk.previewTotal.value,
              })
            }}
          </p>
          <div class="flex items-center gap-1">
            <button
              class="rounded-md p-1.5 hover:bg-muted transition-colors disabled:opacity-30"
              :disabled="bulk.page.value <= 1"
              @click="handlePrevPage"
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
            <span class="px-2 text-sm text-muted-foreground">{{ bulk.page.value }} / {{ bulk.totalPages.value }}</span>
            <button
              class="rounded-md p-1.5 hover:bg-muted transition-colors disabled:opacity-30"
              :disabled="bulk.page.value >= bulk.totalPages.value"
              @click="handleNextPage"
            >
              <ChevronRight class="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div
        v-else
        class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/20 p-10 text-muted-foreground"
      >
        <p>{{ t('tools.bulkRename.noBooksMatch') }}</p>
      </div>
    </template>

    <BulkRenameConfirmDialog
      :open="showConfirmDialog"
      :rename-count="bulk.totalByStatus.value.will_rename"
      @confirm="handleConfirmExecute"
      @cancel="handleCloseConfirm"
    />
  </div>
</template>
