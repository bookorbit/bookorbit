<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertTriangle, BookOpen, Check, Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import {
  BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS,
  type BookDuplicateAction,
  type BookDuplicateBookAction,
  type BookDuplicateBookOutcome,
  type BookDuplicateGroup,
  type BookDuplicateGroupOutcome,
  type BookDuplicateResolutionJob,
} from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { BookMergeJobState } from '@/features/book/composables/useBookMerge'
import { formatBytes } from '@/lib/formatting'
import { formatNumber } from '@/i18n/formatters'
import { formatCopyProgress } from '../utils/copy-progress'
import { copyBytes, copyFolderLabel, crossLibraryMergeLibrary, isProtectedCopy, reclaimableBytes } from '../utils/duplicate-keeper'
import DuplicateMergeReview from './DuplicateMergeReview.vue'

const props = defineProps<{
  open: boolean
  groups: BookDuplicateGroup[]
  /** The selection also covers every matching group on other pages, resolved on the server (H8). */
  allGroups: boolean
  totalGroups: number
  keeperFor: (group: BookDuplicateGroup) => number
  actionFor: (group: BookDuplicateGroup) => BookDuplicateAction | null
  actionsFor: (group: BookDuplicateGroup) => BookDuplicateAction[]
  bookActionFor: (group: BookDuplicateGroup, bookId: number) => BookDuplicateBookAction | null
  canDelete: boolean
  job: BookDuplicateResolutionJob | null
  running: boolean
  error: string | null
}>()

const emit = defineEmits<{
  confirm: [options: { removeIdenticalCopies: boolean }]
  cancel: []
  'book-action': [groupId: number, bookId: number, action: BookDuplicateBookAction]
  merged: [job: BookMergeJobState]
  'link-instead': [groupId: number]
}>()

const { t, te } = useI18n()
const removeIdenticalCopies = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) removeIdenticalCopies.value = false
  },
)

/** One group set to merge, and no run under way: the full merge review replaces the list. */
const mergeGroup = computed(() => {
  if (props.allGroups || props.groups.length !== 1 || props.job) return null
  const group = props.groups[0]!
  return props.actionFor(group) === 'merge' ? group : null
})
const actionable = computed(() => props.groups.filter((group) => props.actionFor(group) !== null))
/** One run stops at the cap, so a larger every-page selection covers only that many. */
const capped = computed(() => props.allGroups && props.totalGroups > BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS)
const allGroupsCount = computed(() => Math.min(props.totalGroups, BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS))
const groupCount = computed(() => (props.allGroups ? allGroupsCount.value : actionable.value.length))
const otherPages = computed(() => (props.allGroups ? Math.max(0, allGroupsCount.value - props.groups.length) : 0))
const anyAction = (wanted: BookDuplicateAction) =>
  props.groups.some((group) => group.books.some((book) => book.id !== props.keeperFor(group) && props.bookActionFor(group, book.id) === wanted))
const deletes = computed(() => anyAction('delete'))
const merges = computed(() => props.allGroups || anyAction('merge'))
const freed = computed(() =>
  props.groups.reduce((bytes, group) => bytes + (props.actionFor(group) === 'delete' ? reclaimableBytes(group, props.keeperFor(group)) : 0), 0),
)
const riskCount = computed(
  () =>
    props.groups.filter((group) =>
      group.books.some((book) => book.id !== props.keeperFor(group) && props.bookActionFor(group, book.id) === 'delete' && isProtectedCopy(book)),
    ).length,
)
/** Merges that move files from one library into another, listed apart so none is confirmed unnoticed. */
const crossLibraryMerges = computed(() =>
  props.groups.flatMap((group) => {
    const keeperId = props.keeperFor(group)
    const merged = group.books.filter((book) => book.id === keeperId || props.bookActionFor(group, book.id) === 'merge')
    if (merged.length < 2) return []
    const destination = crossLibraryMergeLibrary(merged, keeperId)
    return destination ? [{ id: group.id, title: group.books[0]?.title || t('book.untitled'), library: destination.libraryName }] : []
  }),
)
const outcomes = computed(() => new Map((props.job?.outcomes ?? []).map((outcome) => [outcome.groupId, outcome])))
const progressPercent = computed(() => (props.job && props.job.total > 0 ? Math.round((props.job.processed / props.job.total) * 100) : 0))
const finished = computed(() => props.job !== null && props.job.status !== 'running')

function handleOpenChange(open: boolean): void {
  if (!open && !props.running) emit('cancel')
}

function handleCancel(): void {
  if (!props.running) emit('cancel')
}

function handleConfirm(): void {
  emit('confirm', { removeIdenticalCopies: removeIdenticalCopies.value })
}

function handleRemoveIdentical(event: Event): void {
  removeIdenticalCopies.value = (event.target as HTMLInputElement).checked
}

function handleMerged(job: BookMergeJobState): void {
  emit('merged', job)
}

function handleLinkInstead(): void {
  if (mergeGroup.value) emit('link-instead', mergeGroup.value.id)
}

function handleBookAction(group: BookDuplicateGroup, bookId: number, value: string | number): void {
  const action = [...props.actionsFor(group), 'skip' as const].find((candidate) => candidate === value)
  if (action) emit('book-action', group.id, bookId, action)
}

function label(book: BookDuplicateGroup['books'][number]): string {
  return copyFolderLabel(book) || book.title || t('book.untitled')
}

function reasonText(reason: string | null): string {
  if (!reason) return ''
  const key = `tools.bookDuplicates.outcomeReasons.${reason}`
  return te(key) ? t(key) : t('tools.bookDuplicates.outcomeReasons.other', { code: reason })
}

function groupOutcomeText(outcome: BookDuplicateGroupOutcome): string {
  const status = t(`tools.bookDuplicates.outcomes.${outcome.status}`)
  return outcome.reason ? t('tools.bookDuplicates.outcomes.withReason', { status, reason: reasonText(outcome.reason) }) : status
}

function bookOutcome(group: BookDuplicateGroup, bookId: number): BookDuplicateBookOutcome | null {
  return outcomes.value.get(group.id)?.books.find((book) => book.bookId === bookId) ?? null
}

function bookOutcomeText(outcome: BookDuplicateBookOutcome): string {
  const status = t(`tools.bookDuplicates.bookOutcomes.${outcome.status}`)
  return outcome.reason && outcome.status !== 'merged' && outcome.status !== 'deleted' && outcome.status !== 'linked'
    ? t('tools.bookDuplicates.outcomes.withReason', { status, reason: reasonText(outcome.reason) })
    : status
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" class="w-full gap-0 sm:max-w-xl" hide-close>
      <SheetHeader class="border-b border-border px-5 py-4">
        <SheetTitle class="text-base">
          {{
            mergeGroup
              ? t('tools.bookDuplicates.review.mergeTitle')
              : t('tools.bookDuplicates.review.resolveTitle', { count: groupCount }, groupCount)
          }}
        </SheetTitle>
        <SheetDescription class="text-[13px]">
          {{ mergeGroup ? t('tools.bookDuplicates.review.mergeDescription') : t('tools.bookDuplicates.review.resolveDescription') }}
        </SheetDescription>
      </SheetHeader>

      <DuplicateMergeReview
        v-if="mergeGroup && open"
        :group="mergeGroup"
        :keeper-id="keeperFor(mergeGroup)"
        :can-delete-books="canDelete"
        @cancel="handleCancel"
        @finished="handleMerged"
        @link-instead="handleLinkInstead"
      />

      <template v-else>
        <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div v-if="job" class="mb-3 space-y-1.5" data-testid="duplicate-resolution-progress">
            <div
              class="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              :aria-valuenow="job.processed"
              :aria-valuemin="0"
              :aria-valuemax="job.total"
              :aria-label="t('tools.bookDuplicates.resolution.progressLabel')"
            >
              <div class="h-full bg-primary transition-[width] motion-reduce:transition-none" :style="{ width: `${progressPercent}%` }" />
            </div>
            <p class="text-[12.5px] text-muted-foreground" aria-live="polite">
              {{
                finished
                  ? t('tools.bookDuplicates.resolution.finished', { processed: formatNumber(job.processed), total: formatNumber(job.total) })
                  : t('tools.bookDuplicates.resolution.progress', { processed: formatNumber(job.processed), total: formatNumber(job.total) })
              }}
            </p>
          </div>

          <p v-if="error" class="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive" role="alert">{{ error }}</p>

          <p
            v-if="riskCount > 0 && !job"
            class="mb-3 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklch,var(--pill-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--pill-warning)_12%,transparent)] px-3 py-2 text-[12.5px] text-[var(--pill-warning)]"
          >
            <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{{ t('tools.bookDuplicates.review.riskWarning', { count: riskCount }, riskCount) }}</span>
          </p>

          <section
            v-if="crossLibraryMerges.length > 0 && !job"
            class="mb-3 space-y-1.5 rounded-lg border border-border px-3 py-2"
            data-testid="duplicate-cross-library-merges"
          >
            <h3 class="text-[12.5px] font-semibold text-foreground">
              {{ t('tools.bookDuplicates.crossLibrary.bulkHeading', { count: crossLibraryMerges.length }, crossLibraryMerges.length) }}
            </h3>
            <p class="text-[12px] text-muted-foreground">{{ t('tools.bookDuplicates.crossLibrary.bulkHint') }}</p>
            <ul class="grid gap-1">
              <li v-for="merge in crossLibraryMerges" :key="merge.id" class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px]">
                <span class="min-w-0 truncate font-medium text-foreground" dir="auto">{{ merge.title }}</span>
                <span class="text-muted-foreground" dir="auto">{{ t('tools.bookDuplicates.crossLibrary.into', { library: merge.library }) }}</span>
              </li>
            </ul>
          </section>

          <ul class="grid gap-3">
            <li v-for="group in groups" :key="group.id" class="rounded-lg border border-border">
              <p class="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
                <span class="truncate text-[13px] font-semibold text-foreground">{{ group.books[0]?.title || t('book.untitled') }}</span>
                <span v-if="outcomes.get(group.id)" class="shrink-0 text-[12px] font-medium text-foreground" data-testid="duplicate-group-outcome">
                  {{ groupOutcomeText(outcomes.get(group.id)!) }}
                </span>
                <span v-else class="shrink-0 text-[12px] text-muted-foreground">
                  {{ actionFor(group) ? t(`tools.bookDuplicates.actions.${actionFor(group)}`) : t('tools.bookDuplicates.actions.none') }}
                </span>
              </p>
              <ul class="grid gap-1 px-3 py-2">
                <li v-for="book in group.books" :key="book.id" class="flex min-h-8 items-center gap-2 text-[12.5px]">
                  <Check v-if="book.id === keeperFor(group)" class="size-3.5 shrink-0 text-[var(--pill-success)]" aria-hidden="true" />
                  <span v-else class="size-3.5 shrink-0" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate" :class="book.id === keeperFor(group) ? 'text-foreground' : 'text-muted-foreground'">
                    {{ label(book) }}
                  </span>
                  <span
                    v-if="book.readingProgress !== null && book.readingProgress > 0"
                    class="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[var(--pill-warning)]"
                  >
                    <BookOpen class="size-3" aria-hidden="true" />
                    {{ formatCopyProgress(book.readingProgress) }}
                  </span>
                  <span class="shrink-0 tabular-nums text-muted-foreground">{{ formatBytes(copyBytes(book)) }}</span>
                  <span v-if="book.id === keeperFor(group)" class="w-36 shrink-0 text-end text-[12px] font-medium text-foreground">{{
                    t('tools.bookDuplicates.keeping')
                  }}</span>
                  <span v-else-if="bookOutcome(group, book.id)" class="w-36 shrink-0 text-end text-[12px] text-foreground">
                    {{ bookOutcomeText(bookOutcome(group, book.id)!) }}
                  </span>
                  <label v-else-if="actionFor(group)" class="shrink-0">
                    <span class="sr-only">{{ t('tools.bookDuplicates.review.bookAction', { name: label(book) }) }}</span>
                    <Select
                      class="h-8 w-36 text-[12px]"
                      :model-value="bookActionFor(group, book.id) ?? ''"
                      :disabled="running"
                      @update:model-value="handleBookAction(group, book.id, $event)"
                    >
                      <option v-for="option in actionsFor(group)" :key="option" :value="option">
                        {{ t(`tools.bookDuplicates.actions.${option}`) }}
                      </option>
                      <option value="skip">{{ t('tools.bookDuplicates.actions.skip') }}</option>
                    </Select>
                  </label>
                </li>
              </ul>
            </li>
          </ul>

          <p v-if="otherPages > 0" class="mt-3 text-[12.5px] text-muted-foreground">
            {{ t('tools.bookDuplicates.review.otherPages', { count: otherPages }, otherPages) }}
          </p>
          <p v-if="capped && !job" class="mt-2 text-[12.5px] text-muted-foreground" data-testid="duplicate-review-capped">
            {{ t('tools.bookDuplicates.selection.capped', { max: formatNumber(BOOK_DUPLICATE_RESOLUTION_MAX_GROUPS) }) }}
          </p>

          <label v-if="canDelete && merges && !job" class="mt-4 flex items-start gap-2 text-[12.5px] text-foreground">
            <input type="checkbox" class="mt-0.5 size-4 accent-primary" :checked="removeIdenticalCopies" @change="handleRemoveIdentical" />
            <span>
              {{ t('tools.bookDuplicates.review.removeIdentical') }}
              <span class="block text-muted-foreground">{{ t('tools.bookDuplicates.review.removeIdenticalHint') }}</span>
            </span>
          </label>

          <p v-if="deletes && !job" class="mt-4 text-[12.5px] text-muted-foreground">{{ t('tools.bookDuplicates.deleteDialog.warning') }}</p>
        </div>

        <div class="flex flex-row items-center gap-2 border-t border-border px-5 py-3">
          <span v-if="freed > 0 && !job" class="text-[12.5px] text-muted-foreground">
            {{ t('tools.bookDuplicates.review.footer', { size: formatBytes(freed) }) }}
          </span>
          <Button class="ms-auto" variant="outline" :disabled="running" @click="handleCancel">
            {{ t(job ? 'common.close' : 'common.cancel') }}
          </Button>
          <Button v-if="!job" :variant="deletes ? 'destructive' : 'default'" :disabled="running || groupCount === 0" @click="handleConfirm">
            <Loader2 v-if="running" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ t('tools.bookDuplicates.review.confirm', { count: groupCount }, groupCount) }}
          </Button>
        </div>
      </template>
    </SheetContent>
  </Sheet>
</template>
