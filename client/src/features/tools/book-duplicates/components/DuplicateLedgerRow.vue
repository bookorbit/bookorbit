<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, BookOpen, Check, ChevronDown, ChevronRight, Sparkles, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateGroup } from '@bookorbit/types'

import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/formatting'
import { formatDate, formatNumber, formatPercent } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { strongestReason } from '../utils/duplicate-diff'
import {
  copyFolderLabel,
  copyFormats,
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
}>()

const emit = defineEmits<{
  select: [groupId: number]
  expand: [groupId: number]
  keep: [groupId: number, bookId: number]
  dismiss: [groupId: number]
  deleteGroup: [groupId: number]
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
const freed = computed(() => reclaimableBytes(props.group, props.keeperId))
const atRisk = computed(() => protectedDiscards(props.group, props.keeperId))
const overridden = computed(() => props.keeperId !== recommendation.value.keeperId)

/** The rule states its reasoning in the row, so a keeper is never a silent choice. */
const keeperWhy = computed(() => {
  if (overridden.value) return t('tools.bookDuplicates.keeper.yourChoice')
  return recommendation.value.reasons.slice(0, 2).map(reasonText).join(' · ')
})

function reasonText(reason: KeeperReason): string {
  switch (reason.code) {
    case 'reading':
      return t('tools.bookDuplicates.keeper.reading', { percent: formatPercent(reason.percent) })
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
    return t('tools.bookDuplicates.keeper.riskReading', { percent: formatPercent(first.readingProgress) })
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

function handleDelete(): void {
  emit('deleteGroup', props.group.id)
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
          class="grid size-4 place-items-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-ring"
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
      <span class="duplicate-cell-free text-end text-[13px] font-semibold tabular-nums text-[var(--pill-success)]">{{ formatBytes(freed) }}</span>

      <span class="duplicate-cell-keeper grid min-w-0 gap-0.5">
        <span class="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
          <Sparkles v-if="!overridden" class="size-3 shrink-0 text-primary" aria-hidden="true" />
          <Check v-else class="size-3 shrink-0 text-primary" aria-hidden="true" />
          <span class="truncate">{{ keeperLabel }}</span>
        </span>
        <span class="truncate text-[11.5px] text-muted-foreground">{{ keeperWhy }}</span>
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
      <DuplicateCompareBench :group="group" :keeper-id="keeperId" :recommended-id="recommendation.keeperId" @keep="handleKeep" />
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" @click="handleDismiss">
          <X aria-hidden="true" />
          {{ t('tools.bookDuplicates.notDuplicates') }}
        </Button>
        <Button class="ms-auto" variant="destructive" size="sm" @click="handleDelete">
          {{ t('tools.bookDuplicates.deleteGroup', { count: books.length - 1, size: formatBytes(freed) }, books.length - 1) }}
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
