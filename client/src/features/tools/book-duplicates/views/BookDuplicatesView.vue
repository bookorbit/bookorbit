<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { AlertCircle, CopyCheck, ListChecks, Loader2, Search } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  BOOK_DUPLICATE_KINDS,
  BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS,
  type BookDuplicateAction,
  type BookDuplicateBookAction,
  type BookDuplicateGroup,
  type BookDuplicateGroupSort,
  type BookDuplicateKind,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useLibraries } from '@/features/library/composables/useLibraries'
import type { BookMergeJobState } from '@/features/book/composables/useBookMerge'
import { mergedSourceIds } from '@/features/book/lib/book-merge'
import { formatBytes } from '@/lib/formatting'
import { formatNumber } from '@/i18n/formatters'
import { useBookDuplicates } from '../../composables/useBookDuplicates'
import { DUPLICATE_KEEP_RULES, type DuplicateKeepRule } from '../utils/duplicate-keeper'
import DismissedDuplicatesSection from '../components/DismissedDuplicatesSection.vue'
import DuplicateLedgerRow from '../components/DuplicateLedgerRow.vue'
import DuplicateReviewSheet from '../components/DuplicateReviewSheet.vue'
import DuplicateScanStrip from '../components/DuplicateScanStrip.vue'
import DuplicateSummaryBand from '../components/DuplicateSummaryBand.vue'

const { t } = useI18n()
const { libraries, fetchLibraries } = useLibraries()
const duplicates = useBookDuplicates()

const selectedLibraryId = ref('')
const similarityPercent = ref(85)
const focusedGroupId = ref<number | null>(null)
const reviewOpen = ref(false)
const reviewGroups = ref<BookDuplicateGroup[]>([])
const reviewAllGroups = ref(false)
const ledger = ref<HTMLElement | null>(null)

const canUseTool = computed(() => duplicates.canUseTool.value)
const kinds = BOOK_DUPLICATE_KINDS
/** The latest copy of each group under review, so a changed action or keeper shows at once. */
const reviewedGroups = computed(() => reviewGroups.value.map((group) => groups.value.find((candidate) => candidate.id === group.id) ?? group))
const groups = computed(() => duplicates.visibleGroups.value)
const showEmpty = computed(() => duplicates.scanFinished.value && duplicates.loaded.value && groups.value.length === 0)
const keepRules = DUPLICATE_KEEP_RULES
const sorts: BookDuplicateGroupSort[] = ['reclaimable', 'copies', 'confidence', 'title']

onMounted(() => {
  if (!canUseTool.value) return
  void Promise.all([fetchLibraries(), duplicates.resumeActiveScan(), duplicates.fetchDismissals()])
})

function handleStartScan(): void {
  const libraryId = selectedLibraryId.value ? Number(selectedLibraryId.value) : undefined
  void duplicates.startScan(libraryId, similarityPercent.value)
}

function handleLibraryChange(value: string): void {
  selectedLibraryId.value = value
}

function handleSimilarityChange(value: number): void {
  similarityPercent.value = value
}

function handleRuleChange(value: string | number): void {
  duplicates.setKeepRule(value as DuplicateKeepRule)
}

function handleSortChange(value: string | number): void {
  void duplicates.setSort(value as BookDuplicateGroupSort, value === 'title' ? 'asc' : 'desc')
}

function handleReviewSelection(): void {
  duplicates.resolution.reset()
  reviewGroups.value = duplicates.selectedGroups.value
  reviewAllGroups.value = duplicates.allGroupsSelected.value
  reviewOpen.value = true
}

function handleReviewGroup(groupId: number): void {
  const group = groups.value.find((candidate) => candidate.id === groupId)
  if (!group) return
  duplicates.resolution.reset()
  reviewGroups.value = [group]
  reviewAllGroups.value = false
  reviewOpen.value = true
}

function handleCancelReview(): void {
  if (duplicates.resolving.value) return
  reviewOpen.value = false
  reviewGroups.value = []
  reviewAllGroups.value = false
  duplicates.resolution.reset()
}

function handleConfirmReview(options: { removeIdenticalCopies: boolean }): void {
  void duplicates.resolveGroups(reviewedGroups.value, { allGroups: reviewAllGroups.value, removeIdenticalCopies: options.removeIdenticalCopies })
}

function handleBookAction(groupId: number, bookId: number, action: BookDuplicateBookAction): void {
  duplicates.setBookAction(groupId, bookId, action)
}

function handleMerged(job: BookMergeJobState): void {
  const merged = mergedSourceIds(job).length
  if (job.status === 'done' && merged === job.sourceBookIds.length) {
    toast.success(t('tools.bookDuplicates.resolution.success', { count: 1 }, 1))
    reviewOpen.value = false
    reviewGroups.value = []
  } else if (merged > 0) toast.warning(t('book.merge.toast.partial', { merged, total: job.sourceBookIds.length }))
  else toast.error(t('book.merge.toast.failed'))
  duplicates.clearSelection()
  void duplicates.fetchGroups()
}

function handleLinkInstead(groupId: number): void {
  duplicates.setAction(groupId, 'link')
}

function handleAction(groupId: number, action: BookDuplicateAction | null): void {
  duplicates.setAction(groupId, action)
}

function handleKindChange(kind: BookDuplicateKind): void {
  void duplicates.setKind(kind)
}

function handleSelectAllGroups(): void {
  duplicates.selectAllGroups()
}

function handleDismiss(groupId: number): void {
  void duplicates.dismissGroup(groupId)
}

function handleRestore(bookIdA: number, bookIdB: number, kind: BookDuplicateKind): void {
  void duplicates.restoreDismissal(bookIdA, bookIdB, kind)
}

function handleKeep(groupId: number, bookId: number): void {
  duplicates.setKeeper(groupId, bookId)
}

function handleSelect(groupId: number): void {
  duplicates.toggleSelected(groupId)
}

function handleExpand(groupId: number): void {
  duplicates.toggleExpanded(groupId)
  focusedGroupId.value = groupId
}

function handleToggleAll(): void {
  duplicates.toggleSelectAll()
}

function handleClearSelection(): void {
  duplicates.clearSelection()
}

function handlePreviousPage(): void {
  void duplicates.setPage(duplicates.page.value - 1)
}

function handleNextPage(): void {
  void duplicates.setPage(duplicates.page.value + 1)
}

function handleFilter(reason: Parameters<typeof duplicates.setReason>[0]): void {
  void duplicates.setReason(reason)
}

async function focusRow(groupId: number): Promise<void> {
  focusedGroupId.value = groupId
  await nextTick()
  ledger.value?.querySelector<HTMLElement>(`[data-group-id="${groupId}"]`)?.scrollIntoView({ block: 'nearest' })
}

/**
 * A review pass is hundreds of small decisions, so the whole flow has to work without the mouse:
 * move, open, pick a keeper, select, and hand the selection to the review sheet.
 */
function handleKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && event.key !== 'Escape') return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  const list = groups.value
  if (list.length === 0) return
  const index = list.findIndex((group) => group.id === focusedGroupId.value)
  const current = list[index] ?? list[0]
  if (!current) return

  if (event.key === 'j' || event.key === 'ArrowDown') {
    event.preventDefault()
    void focusRow(list[Math.min(list.length - 1, index + 1)]?.id ?? current.id)
    return
  }
  if (event.key === 'k' || event.key === 'ArrowUp') {
    event.preventDefault()
    void focusRow(list[Math.max(0, index - 1)]?.id ?? current.id)
    return
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    const isOpen = duplicates.expandedGroupIds.value.has(current.id)
    if ((event.key === 'ArrowRight') !== isOpen) {
      event.preventDefault()
      duplicates.toggleExpanded(current.id)
      focusedGroupId.value = current.id
    }
    return
  }
  if (event.key === ' ') {
    event.preventDefault()
    duplicates.toggleSelected(current.id)
    focusedGroupId.value = current.id
    return
  }
  if (event.key === 'x') {
    event.preventDefault()
    handleDismiss(current.id)
    return
  }
  if (event.key === 'Enter' && duplicates.selectedGroupIds.value.size > 0) {
    event.preventDefault()
    handleReviewSelection()
    return
  }
  if (/^[1-9]$/.test(event.key)) {
    const pick = current.books[Number(event.key) - 1]
    if (pick) {
      event.preventDefault()
      duplicates.setKeeper(current.id, pick.id)
      focusedGroupId.value = current.id
    }
  }
}
</script>

<template>
  <div v-if="!canUseTool" role="alert" class="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
    {{ t('tools.bookDuplicates.accessDenied') }}
  </div>

  <div v-else class="flex h-full min-h-0 w-full flex-col gap-3">
    <DuplicateScanStrip
      :libraries="libraries"
      :library-id="selectedLibraryId"
      :similarity-percent="similarityPercent"
      :scan="duplicates.scan.value"
      :scanning="duplicates.scanning.value"
      :busy="duplicates.loading.value"
      @update:library-id="handleLibraryChange"
      @update:similarity-percent="handleSimilarityChange"
      @scan="handleStartScan"
    />

    <div
      v-if="duplicates.error.value"
      role="alert"
      class="flex shrink-0 items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle class="size-4 shrink-0" aria-hidden="true" />
      {{ duplicates.error.value }}
    </div>

    <template v-if="duplicates.scanFinished.value">
      <div class="flex shrink-0 gap-1 border-b border-border" role="tablist" :aria-label="t('tools.bookDuplicates.kinds.label')">
        <button
          v-for="kind in kinds"
          :key="kind"
          type="button"
          role="tab"
          class="-mb-px border-b-2 px-3 py-1.5 text-[13px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :class="duplicates.kind.value === kind ? 'border-primary text-primary' : 'border-transparent text-foreground hover:text-primary'"
          :aria-selected="duplicates.kind.value === kind"
          :data-testid="`duplicate-kind-${kind}`"
          @click="handleKindChange(kind)"
        >
          {{ t(`tools.bookDuplicates.kinds.${kind}`) }}
          <span
            v-if="kind === 'other_format' && duplicates.scan.value?.totalOtherFormatPairs"
            class="ms-1 rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground"
            >{{ formatNumber(duplicates.scan.value.totalOtherFormatPairs) }}</span
          >
        </button>
      </div>

      <DuplicateSummaryBand
        :kind="duplicates.kind.value"
        :groups="groups"
        :total-groups="duplicates.total.value"
        :total-extra-copies="duplicates.scan.value?.totalExtraCopies ?? null"
        :total-reclaimable-bytes="duplicates.scan.value?.totalReclaimableBytes ?? null"
        :active-reason="duplicates.reason.value"
        @filter="handleFilter"
      />

      <div v-if="!showEmpty" class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <label class="flex items-center gap-1.5">
          <span class="text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground">{{ t('tools.bookDuplicates.keepRule.label') }}</span>
          <Select class="h-8 w-auto min-w-[9rem] text-[12.5px]" :model-value="duplicates.keepRule.value" @update:model-value="handleRuleChange">
            <option v-for="rule in keepRules" :key="rule" :value="rule">{{ t(`tools.bookDuplicates.keepRule.${rule}`) }}</option>
          </Select>
        </label>
        <p class="hidden text-[12px] text-muted-foreground lg:block">{{ t('tools.bookDuplicates.keepRule.hint') }}</p>
        <label class="flex items-center gap-1.5 sm:ms-auto">
          <span class="text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground">{{ t('tools.bookDuplicates.sort.label') }}</span>
          <Select class="h-8 w-auto min-w-[9rem] text-[12.5px]" :model-value="duplicates.sortBy.value" @update:model-value="handleSortChange">
            <option v-for="sort in sorts" :key="sort" :value="sort">{{ t(`tools.bookDuplicates.sort.${sort}`) }}</option>
          </Select>
        </label>
      </div>

      <div v-if="duplicates.loading.value && !duplicates.loaded.value" class="flex flex-1 items-center justify-center" role="status">
        <Loader2 class="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span class="sr-only">{{ t('common.loading') }}</span>
      </div>

      <section
        v-else-if="showEmpty"
        class="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-card/20 p-10 text-center"
      >
        <div class="grid size-14 place-items-center rounded-full bg-muted/70">
          <CopyCheck class="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div class="space-y-1">
          <p class="text-base font-semibold text-foreground">{{ t('tools.bookDuplicates.empty.title') }}</p>
          <p class="max-w-md text-sm text-muted-foreground">{{ t('tools.bookDuplicates.empty.description') }}</p>
        </div>
      </section>

      <div
        v-else
        ref="ledger"
        class="duplicates-ledger flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card"
        @keydown="handleKeydown"
      >
        <div
          class="duplicates-head flex h-[34px] shrink-0 items-center gap-2.5 border-b border-border bg-surface-2 px-3 text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground"
        >
          <label class="grid size-8 cursor-pointer place-items-center">
            <input type="checkbox" class="peer sr-only" :checked="duplicates.allVisibleSelected.value" @change="handleToggleAll" />
            <span class="sr-only">{{ t('tools.bookDuplicates.selectAll') }}</span>
            <span
              class="grid size-4 place-items-center rounded-xs border peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
              :class="duplicates.allVisibleSelected.value ? 'border-primary bg-primary' : 'border-muted-foreground/50'"
              aria-hidden="true"
            />
          </label>
          <span class="duplicate-cell-match">{{ t('tools.bookDuplicates.columns.match') }}</span>
          <span>{{ t('tools.bookDuplicates.columns.book') }}</span>
          <span class="duplicate-cell-copies text-center">{{ t('tools.bookDuplicates.columns.copies') }}</span>
          <span class="duplicate-cell-library">{{ t('tools.bookDuplicates.columns.libraries') }}</span>
          <span class="duplicate-cell-free text-end">{{ t('tools.bookDuplicates.columns.reclaimable') }}</span>
          <span class="duplicate-cell-keeper">{{ t('tools.bookDuplicates.columns.keeping') }}</span>
          <span />
        </div>

        <ul class="min-h-0 flex-1 overflow-y-auto">
          <DuplicateLedgerRow
            v-for="group in groups"
            :key="group.id"
            :group="group"
            :keeper-id="duplicates.keeperIdFor(group)"
            :keep-rule="duplicates.keepRule.value"
            :selected="duplicates.selectedGroupIds.value.has(group.id)"
            :expanded="duplicates.expandedGroupIds.value.has(group.id)"
            :focused="focusedGroupId === group.id"
            :action="duplicates.actionFor(group)"
            :actions="duplicates.actionsFor(group)"
            :merge-unavailable-reason="duplicates.permissions.value.canMerge ? duplicates.mergeAvailabilityFor(group).reason : null"
            @select="handleSelect"
            @expand="handleExpand"
            @keep="handleKeep"
            @dismiss="handleDismiss"
            @action="handleAction"
            @review="handleReviewGroup"
          />
        </ul>
      </div>

      <div
        v-if="!showEmpty"
        class="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-[12.5px]"
        :class="duplicates.selectedGroupIds.value.size > 0 ? 'border-primary/22 bg-primary/7' : 'border-border bg-secondary'"
      >
        <template v-if="duplicates.selectedGroupIds.value.size > 0">
          <p aria-live="polite">
            {{ t('tools.bookDuplicates.selection.groups', { count: duplicates.selectionGroupCount.value }, duplicates.selectionGroupCount.value) }}
            <template v-if="duplicates.selectionBytes.value > 0">
              {{ t('tools.bookDuplicates.selection.frees', { size: formatBytes(duplicates.selectionBytes.value) }) }}
            </template>
            <span v-if="duplicates.allGroupsCapped.value" class="block text-muted-foreground" data-testid="duplicate-selection-capped">
              {{ t('tools.bookDuplicates.selection.capped', { max: formatNumber(BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS) }) }}
            </span>
          </p>
          <Button
            v-if="duplicates.canSelectAllGroups.value"
            variant="link"
            size="sm"
            data-testid="duplicate-select-all-groups"
            @click="handleSelectAllGroups"
          >
            {{ t('tools.bookDuplicates.selection.selectAllGroups', { count: duplicates.total.value }, duplicates.total.value) }}
          </Button>
          <Button class="ms-auto" variant="ghost" size="sm" @click="handleClearSelection">{{ t('tools.bookDuplicates.selection.clear') }}</Button>
          <Button size="sm" :disabled="duplicates.resolving.value" @click="handleReviewSelection">
            <ListChecks aria-hidden="true" />
            {{
              t('tools.bookDuplicates.selection.reviewGroups', { count: duplicates.selectionGroupCount.value }, duplicates.selectionGroupCount.value)
            }}
          </Button>
        </template>
        <template v-else>
          <p class="text-muted-foreground">{{ t('tools.bookDuplicates.selection.hint') }}</p>
          <p class="ms-auto hidden items-center gap-3 text-[11.5px] text-muted-foreground md:flex">
            <span class="flex items-center gap-1"
              ><kbd class="duplicate-key">j</kbd><kbd class="duplicate-key">k</kbd>{{ t('tools.bookDuplicates.keys.move') }}</span
            >
            <span class="flex items-center gap-1"><kbd class="duplicate-key">&rarr;</kbd>{{ t('tools.bookDuplicates.keys.expand') }}</span>
            <span class="flex items-center gap-1"
              ><kbd class="duplicate-key">1</kbd>&ndash;<kbd class="duplicate-key">9</kbd>{{ t('tools.bookDuplicates.keys.keep') }}</span
            >
            <span class="flex items-center gap-1"><kbd class="duplicate-key">space</kbd>{{ t('tools.bookDuplicates.keys.select') }}</span>
          </p>
        </template>
      </div>

      <nav
        v-if="duplicates.totalPages.value > 1"
        class="flex shrink-0 items-center justify-center gap-3"
        :aria-label="t('tools.bookDuplicates.pagination.label')"
      >
        <Button variant="outline" size="sm" :disabled="duplicates.page.value <= 1 || duplicates.loading.value" @click="handlePreviousPage">
          {{ t('common.previous') }}
        </Button>
        <span class="text-sm text-muted-foreground">
          {{ t('tools.bookDuplicates.pagination.page', { page: duplicates.page.value, total: duplicates.totalPages.value }) }}
        </span>
        <Button
          variant="outline"
          size="sm"
          :disabled="duplicates.page.value >= duplicates.totalPages.value || duplicates.loading.value"
          @click="handleNextPage"
        >
          {{ t('common.next') }}
        </Button>
      </nav>

      <DismissedDuplicatesSection :dismissals="duplicates.dismissals.value" @restore="handleRestore" />
    </template>

    <section
      v-else-if="!duplicates.scanning.value && !duplicates.error.value"
      class="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border/60 bg-card/20 p-10 text-center"
    >
      <div class="grid size-14 place-items-center rounded-full bg-muted/70">
        <Search class="size-6 text-muted-foreground" aria-hidden="true" />
      </div>
      <div class="space-y-1">
        <p class="text-base font-semibold text-foreground">{{ t('tools.bookDuplicates.initial.title') }}</p>
        <p class="max-w-md text-sm text-muted-foreground">{{ t('tools.bookDuplicates.initial.descriptionActions') }}</p>
      </div>
      <DismissedDuplicatesSection :dismissals="duplicates.dismissals.value" @restore="handleRestore" />
    </section>

    <DuplicateReviewSheet
      :open="reviewOpen"
      :groups="reviewedGroups"
      :all-groups="reviewAllGroups"
      :total-groups="duplicates.total.value"
      :keeper-for="duplicates.keeperIdFor"
      :action-for="duplicates.actionFor"
      :actions-for="duplicates.actionsFor"
      :book-action-for="duplicates.bookActionFor"
      :can-delete="duplicates.permissions.value.canDelete"
      :job="duplicates.resolution.job.value"
      :running="duplicates.resolving.value"
      :error="duplicates.resolution.error.value"
      @confirm="handleConfirmReview"
      @cancel="handleCancelReview"
      @book-action="handleBookAction"
      @merged="handleMerged"
      @link-instead="handleLinkInstead"
    />
  </div>
</template>

<style scoped>
/*
 * The ledger is the container its rows measure themselves against, so the columns answer "how much
 * room does this pane have" rather than "how wide is the window": a collapsed sidebar and a wide
 * screen are the same thing to it.
 */
.duplicates-ledger {
  container-type: inline-size;
  container-name: duplicates;
}

.duplicates-head {
  display: grid;
  grid-template-columns: 32px 124px minmax(0, 1fr) 58px 116px 92px 268px 30px;
}

@container duplicates (max-width: 1240px) {
  .duplicates-head {
    grid-template-columns: 32px 118px minmax(0, 1fr) 52px 88px 250px 30px;
  }
  .duplicates-head .duplicate-cell-library {
    display: none;
  }
}

@container duplicates (max-width: 1000px) {
  .duplicates-head {
    grid-template-columns: 32px 112px minmax(0, 1fr) 88px 30px;
  }
  .duplicates-head .duplicate-cell-copies,
  .duplicates-head .duplicate-cell-keeper {
    display: none;
  }
}

@container duplicates (max-width: 700px) {
  .duplicates-head {
    display: none;
  }
}

.duplicate-key {
  display: inline-grid;
  place-items: center;
  min-width: 17px;
  height: 17px;
  padding-inline: 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--muted);
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--muted-foreground);
}
</style>
