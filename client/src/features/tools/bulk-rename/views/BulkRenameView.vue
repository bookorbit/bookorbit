<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, CheckCircle2, Loader2, Play, SlidersHorizontal, X } from '@lucide/vue'
import type { BulkRenamePreviewItem, Library } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { storage } from '@/services/storage'
import { useBulkRename, type BulkRenameScope } from '../../composables/useBulkRename'
import { useBulkRenameReview } from '../composables/useBulkRenameReview'
import { stripRoot } from '../utils/pathDiff'
import BulkRenameConfirmDialog from '../components/BulkRenameConfirmDialog.vue'
import BulkRenameDetail from '../components/BulkRenameDetail.vue'
import BulkRenameRail from '../components/BulkRenameRail.vue'
import BulkRenameRunDialog from '../components/BulkRenameRunDialog.vue'

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()
const bulk = useBulkRename()

const SHOW_FULL_PATHS_KEY = 'tools.bulkRename.showFullPaths'

const showConfirm = ref(false)
const showFullPaths = ref<boolean>(storage.get<boolean>(SHOW_FULL_PATHS_KEY, false))
/** Mobile is a list to detail push, so the detail pane is a separate screen below `md`. */
const mobileDetail = ref(false)
const railRef = ref<InstanceType<typeof BulkRenameRail> | null>(null)

const eligibleLibraries = computed(() => libraries.value.filter((library: Library) => library.fileRenameEnabled))
const selectedLibrary = computed(() => eligibleLibraries.value.find((library: Library) => library.id === bulk.selectedLibraryId.value) ?? null)

const libraryRoots = computed(() => selectedLibrary.value?.folders.map((folder) => folder.path) ?? [])

/**
 * Paths are shown relative to the library root. The absolute prefix is identical on every row
 * and pushes the part that actually differs off the end of the line, and depth-based labels
 * like "4 levels to 3" would otherwise count folders the reviewer never chose.
 */
const relativeItems = computed<BulkRenamePreviewItem[]>(() => {
  const roots = libraryRoots.value
  if (roots.length === 0) return bulk.items.value
  return bulk.items.value.map((item) => ({
    ...item,
    currentPath: stripRoot(item.currentPath, roots),
    newPath: item.newPath === null ? null : stripRoot(item.newPath, roots),
  }))
})

const totalRenameable = computed(() => bulk.totalByStatus.value.will_rename)
const review = useBulkRenameReview(relativeItems, totalRenameable)

const runnableCount = computed(() => review.selectedCount.value)
/** The server's narrowed count once the run has started, falling back to the local estimate. */
const runDialogTotal = computed(() => bulk.runTotal.value || runnableCount.value)
const skippedCount = computed(() => Math.max(0, totalRenameable.value - runnableCount.value))
const hasResult = computed(() => bulk.executionStats.value !== null && !bulk.executing.value)

/** Books the preview refused to rename: a missing pattern or a per-book failure, not a conflict. */
const cannotRenameCount = computed(() => bulk.totalByStatus.value.no_pattern + bulk.totalByStatus.value.error)

/**
 * A run can finish with failures or write-time skips. Reporting only the successes in a green
 * banner would hide a partial filesystem failure, so the outcome drives both copy and colour.
 */
const resultTone = computed<'success' | 'warning' | 'error'>(() => {
  const stats = bulk.executionStats.value
  if (!stats) return 'success'
  if (stats.failed > 0) return 'error'
  if (stats.skipped > 0) return 'warning'
  return 'success'
})

const resultParts = computed<string[]>(() => {
  const stats = bulk.executionStats.value
  if (!stats) return []
  const parts = [t('tools.bulkRename.run.resultTitle', { done: stats.succeeded, total: stats.processed })]
  if (stats.failed > 0) parts.push(t('tools.bulkRename.run.resultFailed', { count: stats.failed }))
  if (stats.skipped > 0) parts.push(t('tools.bulkRename.run.resultSkipped', { count: stats.skipped }))
  return parts
})

const previewErrorMessage = computed(() => {
  const failure = bulk.previewError.value
  return failure ? t(`tools.bulkRename.executionError.${failure.code}`, { status: failure.status ?? 0 }) : ''
})

const executionErrorMessage = computed(() => {
  const failure = bulk.executionError.value
  return failure ? t(`tools.bulkRename.executionError.${failure.code}`, { status: failure.status ?? 0 }) : ''
})

/** The untouched item behind the open row, so the detail can offer the absolute path. */
const currentAbsolute = computed(() => bulk.items.value.find((item) => item.bookId === review.current.value?.bookId) ?? null)

function handleKeydown(event: KeyboardEvent): void {
  const target = event.target
  const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return
  if (showConfirm.value || bulk.executing.value) return

  if (event.key === 'ArrowDown' || event.key === 'j') {
    event.preventDefault()
    review.step(1)
  } else if (event.key === 'ArrowUp' || event.key === 'k') {
    event.preventDefault()
    review.step(-1)
  } else if (event.key === 's' || event.key === 'S') {
    event.preventDefault()
    if (review.current.value) review.toggleSelected(review.current.value)
  }
}

onMounted(async () => {
  document.addEventListener('keydown', handleKeydown)
  await fetchLibraries()
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
})

watch(
  () => review.current.value?.bookId,
  () => railRef.value?.revealCurrent(),
)

watch(showFullPaths, (value) => storage.set(SHOW_FULL_PATHS_KEY, value))

function handleSelectLibrary(libraryId: number): void {
  bulk.selectLibrary(libraryId)
  review.reset()
  mobileDetail.value = false
  void bulk.loadPreview()
}

/** Scope is only a view filter and the status totals behind the counts do not move, so the selection survives it. */
function handleScopeChange(scope: BulkRenameScope): void {
  review.selectedId.value = null
  bulk.setScope(scope)
}

function handleSearchChange(value: string): void {
  bulk.setSearch(value)
  review.selectedId.value = null
}

function handleSelect(bookId: number): void {
  review.select(bookId)
  mobileDetail.value = true
}

function handleBack(): void {
  mobileDetail.value = false
}

function handleStep(delta: number): void {
  review.step(delta)
}

function handleToggleSelectedCurrent(): void {
  if (review.current.value) review.toggleSelected(review.current.value)
}

function handleToggleSelected(item: BulkRenamePreviewItem): void {
  review.toggleSelected(item)
}

function handleToggleGroup(key: string): void {
  review.toggleGroup(key)
}

function handleToggleGroupSelected(key: string): void {
  review.toggleGroupSelected(key)
}

function handleToggleAll(): void {
  review.toggleAll()
}

function handleLoadMore(): void {
  void bulk.loadMore()
}

function handleOpenConfirm(): void {
  showConfirm.value = true
}

function handleCancelConfirm(): void {
  showConfirm.value = false
}

async function handleConfirmRun(): Promise<void> {
  showConfirm.value = false
  await bulk.execute(review.runSelection.value)
  if (!bulk.executionError.value) {
    review.resetAfterRun()
    await bulk.loadPreview()
  }
}

function handleStopRun(): void {
  bulk.cancelExecution()
}

function handleDismissResult(): void {
  bulk.executionStats.value = null
}

function handleToggleFullPaths(value: boolean): void {
  showFullPaths.value = value
}

function handleRetryPreview(): void {
  void bulk.loadPreview()
}
</script>

<template>
  <div class="flex h-full min-h-0 w-full flex-col">
    <div
      v-if="hasResult"
      class="flex flex-none items-center gap-2.5 border-b px-5 py-2.5 text-sm"
      :class="{
        'border-success/30 bg-success/10 text-success': resultTone === 'success',
        'border-warning/30 bg-warning/10 text-warning': resultTone === 'warning',
        'border-destructive/30 bg-destructive/10 text-destructive': resultTone === 'error',
      }"
      :role="resultTone === 'error' ? 'alert' : 'status'"
    >
      <CheckCircle2 v-if="resultTone === 'success'" class="size-4 shrink-0" aria-hidden="true" />
      <AlertTriangle v-else class="size-4 shrink-0" aria-hidden="true" />
      <span>{{ resultParts.join(' - ') }}</span>
      <span class="flex-1" />
      <Button variant="ghost" size="sm" @click="handleDismissResult">
        <X class="size-3.5" aria-hidden="true" />
        {{ t('tools.bulkRename.run.dismiss') }}
      </Button>
    </div>

    <div
      v-if="bulk.executionError.value"
      class="flex flex-none items-center gap-2.5 border-b border-destructive/30 bg-destructive/10 px-5 py-2.5 text-sm text-destructive"
      role="alert"
    >
      <span>{{ t('tools.bulkRename.executionFailed') }} - {{ executionErrorMessage }}</span>
    </div>

    <div v-if="bulk.selectedLibraryId.value === null" class="flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
      <span class="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <SlidersHorizontal class="size-6" aria-hidden="true" />
      </span>
      <div class="space-y-1">
        <p class="text-base font-semibold">{{ t('tools.bulkRename.empty.title') }}</p>
        <p class="max-w-sm text-sm text-muted-foreground">{{ t('tools.bulkRename.empty.description') }}</p>
      </div>
      <p v-if="eligibleLibraries.length === 0" class="max-w-sm text-sm text-muted-foreground">
        {{ t('tools.bulkRename.noEligibleLibraries') }}
      </p>
      <div v-else class="flex flex-wrap justify-center gap-2">
        <Button v-for="library in eligibleLibraries" :key="library.id" variant="outline" @click="handleSelectLibrary(library.id)">
          {{ library.name }}
        </Button>
      </div>
    </div>

    <div
      v-else-if="bulk.previewError.value && bulk.items.value.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center"
    >
      <p class="text-sm font-medium text-destructive">{{ t('tools.bulkRename.previewFailed') }}</p>
      <p class="max-w-sm text-sm text-muted-foreground">{{ previewErrorMessage }}</p>
      <Button variant="outline" @click="handleRetryPreview">{{ t('tools.bulkRename.refresh') }}</Button>
    </div>

    <div v-else-if="bulk.loading.value && bulk.items.value.length === 0" class="flex flex-1 items-center justify-center">
      <Loader2 class="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>

    <div v-else class="grid min-h-0 flex-1 md:grid-cols-[22rem_minmax(0,1fr)]">
      <BulkRenameRail
        ref="railRef"
        :class="{ 'max-md:hidden': mobileDetail }"
        :libraries="eligibleLibraries"
        :library="selectedLibrary"
        :scope="bulk.scope.value"
        :counts="bulk.totalByStatus.value"
        :search="bulk.search.value"
        :groups="review.groups.value"
        :collapsed="review.collapsed.value"
        :current-id="review.current.value?.bookId ?? null"
        :selected-count="runnableCount"
        :selection-state="review.selectionState.value"
        :has-more="bulk.hasMore.value"
        :loading-more="bulk.loadingMore.value"
        :kind-of="review.kindOf"
        :is-selected="review.isSelected"
        :group-state="review.groupState"
        @select-library="handleSelectLibrary"
        @update:scope="handleScopeChange"
        @update:search="handleSearchChange"
        @select="handleSelect"
        @toggle-selected="handleToggleSelected"
        @toggle-group-selected="handleToggleGroupSelected"
        @toggle-group="handleToggleGroup"
        @toggle-all="handleToggleAll"
        @load-more="handleLoadMore"
      />

      <BulkRenameDetail
        :class="{ 'max-md:hidden': !mobileDetail }"
        :item="review.current.value"
        :kind="review.currentKind.value"
        :pattern="bulk.pattern.value"
        :siblings="review.siblings.value"
        :index="review.currentIndex.value"
        :total="review.visible.value.length"
        :selected="review.current.value ? review.isSelected(review.current.value) : false"
        :runnable-count="runnableCount"
        :full-current-path="currentAbsolute?.currentPath ?? null"
        :full-new-path="currentAbsolute?.newPath ?? null"
        :show-full-paths="showFullPaths"
        @update:show-full-paths="handleToggleFullPaths"
        @step="handleStep"
        @select="handleSelect"
        @toggle-selected="handleToggleSelectedCurrent"
        @apply="handleOpenConfirm"
        @back="handleBack"
      />
    </div>

    <div v-if="!mobileDetail && runnableCount > 0" class="flex-none border-t border-border bg-card/80 px-4 py-2.5 backdrop-blur-sm md:hidden">
      <Button class="w-full" @click="handleOpenConfirm">
        <Play class="size-3.5" aria-hidden="true" />
        {{ t('tools.bulkRename.applyCount', { count: runnableCount }) }}
      </Button>
    </div>

    <BulkRenameConfirmDialog
      :open="showConfirm"
      :library-name="selectedLibrary?.name ?? ''"
      :rename-count="runnableCount"
      :skipped-count="skippedCount"
      :held-back-count="bulk.totalByStatus.value.collision"
      :cannot-rename-count="cannotRenameCount"
      :untouched-count="bulk.totalByStatus.value.unchanged"
      @confirm="handleConfirmRun"
      @cancel="handleCancelConfirm"
    />

    <BulkRenameRunDialog :open="bulk.executing.value" :done="bulk.renamedCount.value" :total="runDialogTotal" @stop="handleStopRun" />
  </div>
</template>
