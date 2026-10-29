<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import type { ChapterHealthBook } from '@bookorbit/types'

import { formatList, formatNumber } from '@/i18n/formatters'
import { formatChapterClock } from '@/features/book/lib/chapter-time'

const props = defineProps<{ book: ChapterHealthBook; selectable: boolean; selected: boolean }>()
const emit = defineEmits<{ toggle: [bookId: number]; dismiss: [bookId: number] }>()

const { t } = useI18n()

const title = computed(() => props.book.title ?? t('tools.chapterHealth.untitled'))
const facts = computed(() =>
  t('tools.chapterHealth.row.facts', {
    files: props.book.audioFiles,
    chapters: props.book.chapterCount,
    library: props.book.libraryName,
  }),
)
const chaptersLink = computed(() => ({ name: 'book-detail', params: { bookId: props.book.bookId }, query: { tab: 'chapters' } }))
const reviewLink = computed(() => ({ name: 'book-detail', params: { bookId: props.book.bookId }, query: { tab: 'chapters', find: 'audible' } }))

const reviewReason = computed(() => {
  const review = props.book.review
  if (!review?.reason) return null
  if (review.reason === 'runtime_mismatch' && (!review.summary?.runtimeMs || !review.summary.totalDurationMs)) {
    return t('tools.chapterHealth.reasons.runtime_unknown')
  }
  if (review.reason === 'runtime_mismatch' && review.summary?.runtimeMs && review.summary.totalDurationMs) {
    const differenceMs = Math.abs(review.summary.totalDurationMs - review.summary.runtimeMs)
    // Past a minute and a half a clock reads better than a count of seconds.
    return differenceMs < 90_000
      ? t('tools.chapterHealth.reasons.runtime_mismatch', { seconds: formatNumber(differenceMs / 1000, { maximumFractionDigits: 1 }) })
      : t('tools.chapterHealth.reasons.runtime_mismatch_long', { duration: formatChapterClock(differenceMs, { withMs: false }) })
  }
  return t(`tools.chapterHealth.reasons.${review.reason}`)
})

function handleToggle(): void {
  emit('toggle', props.book.bookId)
}
function handleDismiss(): void {
  emit('dismiss', props.book.bookId)
}
</script>

<template>
  <li class="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
    <input
      v-if="selectable"
      type="checkbox"
      class="mt-0.5 shrink-0 rounded accent-primary"
      :checked="selected"
      :disabled="!book.audibleId"
      :aria-label="t('tools.chapterHealth.row.select', { title })"
      @change="handleToggle"
    />
    <div class="min-w-0 flex-1">
      <RouterLink
        :to="chaptersLink"
        class="block truncate text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {{ title }}
      </RouterLink>
      <p v-if="book.authors.length > 0" class="truncate text-xs text-muted-foreground">{{ formatList(book.authors) }}</p>
      <p class="truncate text-xs text-muted-foreground">{{ facts }}</p>
      <p v-if="reviewReason" class="mt-1 text-xs text-foreground">{{ reviewReason }}</p>
    </div>
    <div class="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
      <span v-if="book.audibleId" class="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        {{ book.audibleId }}
      </span>
      <span v-else class="text-xs text-muted-foreground">{{ t('tools.chapterHealth.row.noAsin') }}</span>
      <template v-if="book.review">
        <RouterLink
          :to="reviewLink"
          class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {{ t('tools.chapterHealth.row.review') }}
        </RouterLink>
        <button
          type="button"
          class="inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleDismiss"
        >
          {{ t('tools.chapterHealth.row.dismiss') }}
        </button>
      </template>
    </div>
  </li>
</template>
