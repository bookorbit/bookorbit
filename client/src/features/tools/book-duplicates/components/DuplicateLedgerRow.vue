<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, Sparkles, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateAction, BookDuplicateGroup, BookDuplicateMergeUnavailableReason } from '@bookorbit/types'

import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatBytes } from '@/lib/formatting'
import { formatDate, formatNumber } from '@/i18n/formatters'
import { formatCopyProgress } from '../utils/copy-progress'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { strongestReason } from '../utils/duplicate-diff'
import {
  copyFolderLabel,
  copyFormats,
  crossLibraryMergeLibrary,
  protectedDiscards,
  reclaimableBytes,
  recommendKeeper,
  type DuplicateKeepRule,
  type KeeperReason,
} from '../utils/duplicate-keeper'
import DuplicateCompareBench from './DuplicateCompareBench.vue'
import DuplicateConfidenceChip from './DuplicateConfidenceChip.vue'

const props = defineProps<{
  group: BookDuplicateGroup
  keeperId: number
  keepRule: DuplicateKeepRule
  selected: boolean
  expanded: boolean
  focused: boolean
  /** The action this group resolves with; null until the user picks one. */
  action: BookDuplicateAction | null
  /** The actions the user may pick for this group. */
  actions: BookDuplicateAction[]
  /** Why merging is not offered, shown only to a user who could otherwise merge (H3, H4). */
  mergeUnavailableReason: BookDuplicateMergeUnavailableReason | null
}>()

const emit = defineEmits<{
  select: [groupId: number]
  expand: [groupId: number]
  keep: [groupId: number, bookId: number]
  dismiss: [groupId: number]
  action: [groupId: number, action: BookDuplicateAction | null]
  review: [groupId: number]
}>()

const { t } = useI18n()

const books = computed(() => props.group.books)
const title = computed(() => books.value[0]?.title?.trim() || t('book.untitled'))
const authors = computed(() => books.value[0]?.authors ?? [])
const libraries = computed(() => [...new Set(books.value.map((book) => book.libraryName))])
const formats = computed(() => [...new Set(books.value.flatMap(copyFormats))])
const fileCount = computed(() => books.value[0]?.files.length ?? 1)
const reason = computed(() => strongestReason(props.group))
const keeper = computed(() => books.value.find((book) => book.id === props.keeperId) ?? books.value[0])
const recommendation = computed(() => recommendKeeper(props.group, props.keepRule))
const keeperLabel = computed(() => (keeper.value ? copyFolderLabel(keeper.value) || title.value : title.value))
/** The scan's own figure, keeping the largest copy: what the scan total adds up and the space sort orders by. */
const reclaimable = computed(() => (props.group.kind === 'duplicate' ? props.group.reclaimableBytes : 0))
/** What deleting the extras frees with the chosen keeper, stated where the deletion is confirmed. */
const freed = computed(() => reclaimableBytes(props.group, props.keeperId))
const atRisk = computed(() => (props.action === 'delete' ? protectedDiscards(props.group, props.keeperId) : []))
const actionText = computed(() => (props.action ? t(`tools.bookDuplicates.actions.${props.action}`) : t('tools.bookDuplicates.actions.none')))
const linkOffered = computed(() => props.actions.includes('link'))
/** A merge across libraries moves files into one library; the row names it before anything is confirmed. */
const crossLibraryDestination = computed(() => (props.action === 'merge' ? crossLibraryMergeLibrary(books.value, props.keeperId) : null))
const reviewLabel = computed(() => {
  if (props.action === 'delete') {
    return t('tools.bookDuplicates.deleteGroup', { count: books.value.length - 1, size: formatBytes(freed.value) }, books.value.length - 1)
  }
  if (props.action === 'merge') return t('tools.bookDuplicates.reviewMerge')
  if (props.action === 'link') return t('tools.bookDuplicates.reviewLink')
  return t('tools.bookDuplicates.actions.none')
})
const overridden = computed(() => props.keeperId !== recommendation.value.keeperId)

/** The rule states its reasoning in the row, so a keeper is never a silent choice. */
const keeperWhy = computed(() => {
  if (overridden.value) return t('tools.bookDuplicates.keeper.yourChoice')
  return recommendation.value.reasons.slice(0, 2).map(reasonText).join(' · ')
})

function reasonText(reason: KeeperReason): string {
  switch (reason.code) {
    case 'reading':
      return t('tools.bookDuplicates.keeper.reading', { percent: formatCopyProgress(reason.percent) })
    case 'collection':
      return t('tools.bookDuplicates.keeper.collection', { name: reason.name })
    case 'metadata':
      return t('tools.bookDuplicates.keeper.metadata', { score: formatNumber(reason.score) })
    case 'largest':
      return t('tools.bookDuplicates.keeper.largest', { size: formatBytes(reason.bytes) })
    case 'formats':
      return t('tools.bookDuplicates.keeper.formats', { count: formatNumber(reason.count) })
    case 'isbn':
      return t('tools.bookDuplicates.keeper.isbn')
    case 'added':
      return t('tools.bookDuplicates.keeper.added', { date: formatDate(new Date(reason.at)) })
  }
}

const riskText = computed(() => {
  const first = atRisk.value[0]
  if (!first) return null
  if (first.readingProgress !== null && first.readingProgress > 0) {
    return t('tools.bookDuplicates.keeper.riskReading', { percent: formatCopyProgress(first.readingProgress) })
  }
  return t('tools.bookDuplicates.keeper.riskCollection', { name: first.collections[0]?.name ?? '' })
})

function formatChipStyle(format: string): Record<string, string> {
  const color = formatColorVar(format)
  return { color, backgroundColor: `color-mix(in oklch, ${color} 13%, transparent)` }
}

function handleSelect(): void {
  emit('select', props.group.id)
}

function handleExpand(): void {
  emit('expand', props.group.id)
}

function handleKeep(bookId: number): void {
  emit('keep', props.group.id, bookId)
}

function handleDismiss(): void {
  emit('dismiss', props.group.id)
}

function handleReview(): void {
  emit('review', props.group.id)
}

function handleActionChange(value: string | number): void {
  const next = props.actions.find((action) => action === value) ?? null
  emit('action', props.group.id, next)
}
</script>

<template>
  <li
    class="border-b border-border/60 last:border-b-0"
    :class="[selected ? 'bg-primary/6' : '', focused ? 'ring-1 ring-inset ring-primary/40' : '']"
    :data-group-id="group.id"
  >
    <div class="duplicate-row items-center gap-2.5 px-3 py-2 transition-colors hover:bg-accent/60">
      <label class="duplicate-cell-check grid size-8 cursor-pointer place-items-center">
        <input type="checkbox" class="peer sr-only" :checked="selected" @change="handleSelect" />
        <span class="sr-only">{{ t('tools.bookDuplicates.selectGroup', { title }) }}</span>
        <span
          class="grid size-4 place-items-center rounded-xs border peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
          :class="selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'"
          aria-hidden="true"
        >
          <Check v-if="selected" class="size-3" />
        </span>
      </label>

      <DuplicateConfidenceChip class="duplicate-cell-match" :reason="reason" :similarity="group.maxTitleSimilarity" short />

      <div class="duplicate-cell-book flex min-w-0 items-center gap-2.5">
        <span class="flex shrink-0" aria-hidden="true">
          <span
            v-for="(book, index) in books.slice(0, 3)"
            :key="book.id"
            class="grid h-[34px] w-6 place-items-center overflow-hidden rounded-[3px] border border-border bg-muted"
            :class="index > 0 ? '-ms-3.5 shadow-[-2px_0_3px_oklch(0_0_0/0.25)]' : ''"
          >
            <BookCoverImage v-if="book.hasCover" :book-id="book.id" class="h-full w-full object-cover" alt="" />
            <BookOpen v-else class="size-3 text-muted-foreground" />
          </span>
        </span>
        <span class="min-w-0">
          <RouterLink
            :to="{ name: 'book-detail', params: { bookId: books[0]?.id } }"
            class="block truncate text-[13px] font-semibold text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {{ title }}
          </RouterLink>
          <span class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-muted-foreground">
            <span class="truncate">{{ authors.length > 0 ? authors.join(', ') : t('tools.bookDuplicates.unknownAuthor') }}</span>
            <span
              v-for="format in formats"
              :key="format"
              class="inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[10px] font-bold tracking-wide uppercase"
              :style="formatChipStyle(format)"
              >{{ format }}</span
            >
            <span v-if="fileCount > 1">{{ t('tools.bookDuplicates.filesEach', { count: fileCount }, fileCount) }}</span>
          </span>
        </span>
      </div>

      <span class="duplicate-cell-copies text-center text-[12.5px] tabular-nums text-muted-foreground">{{ formatNumber(books.length) }}</span>
      <span class="duplicate-cell-library truncate text-[12px] text-muted-foreground">{{ libraries.join(', ') }}</span>
      <span
        v-if="reclaimable > 0"
        class="duplicate-cell-free text-end text-[13px] font-semibold tabular-nums text-[var(--pill-success)]"
        data-testid="duplicate-row-reclaimable"
        >{{ formatBytes(reclaimable) }}</span
      >
      <span v-else class="duplicate-cell-free text-end text-[12px] text-muted-foreground" data-testid="duplicate-row-reclaimable">{{
        t('tools.bookDuplicates.none')
      }}</span>

      <span class="duplicate-cell-keeper grid min-w-0 gap-0.5">
        <span class="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
          <Sparkles v-if="!overridden" class="size-3 shrink-0 text-primary" aria-hidden="true" />
          <Check v-else class="size-3 shrink-0 text-primary" aria-hidden="true" />
          <span class="truncate">{{ keeperLabel }}</span>
        </span>
        <span class="truncate text-[11.5px] text-muted-foreground">{{ keeperWhy }}</span>
        <span class="truncate text-[11.5px] font-medium text-foreground" data-testid="duplicate-row-action">{{ actionText }}</span>
        <span v-if="crossLibraryDestination" class="truncate text-[11.5px] text-muted-foreground" dir="auto">{{
          t('tools.bookDuplicates.crossLibrary.into', { library: crossLibraryDestination.libraryName })
        }}</span>
        <span v-if="riskText" class="flex items-center gap-1 text-[11.5px] font-semibold text-[var(--pill-warning)]">
          <AlertTriangle class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ riskText }}</span>
        </span>
      </span>

      <button
        type="button"
        class="duplicate-cell-expand grid size-[30px] place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        :aria-expanded="expanded"
        :aria-label="t('tools.bookDuplicates.compareCopies', { title })"
        @click="handleExpand"
      >
        <ChevronDown v-if="expanded" class="size-4" aria-hidden="true" />
        <ChevronRight v-else class="size-4" aria-hidden="true" />
      </button>
    </div>

    <div v-if="expanded" class="border-t border-dashed border-border/80 bg-secondary/40 px-3 py-3 sm:ps-14">
      <DuplicateCompareBench :group="group" :keeper-id="keeperId" :recommended-id="recommendation.keeperId" :action="action" @keep="handleKeep" />
      <p
        v-if="mergeUnavailableReason"
        class="mt-3 flex items-start gap-1.5 text-[12px] text-muted-foreground"
        data-testid="duplicate-merge-unavailable"
      >
        <AlertTriangle class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {{ t(`tools.bookDuplicates.mergeUnavailable.${mergeUnavailableReason}`) }}
          <template v-if="linkOffered">{{ t('tools.bookDuplicates.mergeUnavailable.linkOffered') }}</template>
        </span>
      </p>
      <p v-if="crossLibraryDestination" class="mt-3 text-[12px] text-foreground" data-testid="duplicate-cross-library-merge">
        {{ t('tools.bookDuplicates.crossLibrary.rowNote', { library: crossLibraryDestination.libraryName }) }}
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" @click="handleDismiss">
          <X aria-hidden="true" />
          {{ t('tools.bookDuplicates.notDuplicates') }}
        </Button>
        <label v-if="actions.length > 0" class="flex items-center gap-1.5 sm:ms-auto">
          <span class="text-[12px] text-muted-foreground">{{ t('tools.bookDuplicates.actions.label') }}</span>
          <Select class="h-8 w-auto min-w-[10rem] text-[12.5px]" :model-value="action ?? ''" @update:model-value="handleActionChange">
            <option value="">{{ t('tools.bookDuplicates.actions.none') }}</option>
            <option v-for="option in actions" :key="option" :value="option">{{ t(`tools.bookDuplicates.actions.${option}`) }}</option>
          </Select>
        </label>
        <Button
          :class="actions.length > 0 ? '' : 'ms-auto'"
          :variant="action === 'delete' ? 'destructive' : 'default'"
          size="sm"
          :disabled="!action"
          @click="handleReview"
        >
          {{ reviewLabel }}
        </Button>
      </div>
    </div>
  </li>
</template>

<style scoped>
/*
 * One grid shared by the header and every row, so the columns line up without a table: the row
 * also has to open into a full-width comparison, which a table row cannot host cleanly.
 */
.duplicate-row {
  display: grid;
  grid-template-columns: 32px 124px minmax(0, 1fr) 58px 116px 92px 268px 30px;
}

@container duplicates (max-width: 1240px) {
  .duplicate-row {
    grid-template-columns: 32px 118px minmax(0, 1fr) 52px 88px 250px 30px;
  }
  .duplicate-cell-library {
    display: none;
  }
}

@container duplicates (max-width: 1000px) {
  .duplicate-row {
    grid-template-columns: 32px 112px minmax(0, 1fr) 88px 30px;
  }
  .duplicate-cell-copies,
  .duplicate-cell-keeper {
    display: none;
  }
}

/* Phone: the row folds into two lines, keeping the book and the space it frees on the first. */
@container duplicates (max-width: 700px) {
  .duplicate-row {
    grid-template-columns: 32px minmax(0, 1fr) auto;
    align-items: start;
    column-gap: 0.5rem;
  }
  .duplicate-cell-check {
    grid-row: 1 / span 2;
  }
  .duplicate-cell-match {
    grid-column: 2;
    grid-row: 2;
    justify-self: start;
    margin-top: 0.25rem;
  }
  .duplicate-cell-book {
    grid-column: 2;
    grid-row: 1;
  }
  .duplicate-cell-free {
    grid-column: 3;
    grid-row: 1;
  }
  .duplicate-cell-expand {
    grid-column: 3;
    grid-row: 2;
    justify-self: end;
  }
}
</style>
