<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, Loader2, NotebookPen } from '@lucide/vue'
import type { ReadingHistoryItem, ReadingHistoryMarks } from '@bookorbit/types'
import HistoryStars from './HistoryStars.vue'
import { formatInstantDay } from '../lib/history-format'

type MarksState = { status: 'loading' } | { status: 'ready'; marks: ReadingHistoryMarks } | { status: 'error' } | undefined

const props = defineProps<{
  item: ReadingHistoryItem
  marks: MarksState
  ratingBusy: boolean
}>()

const emit = defineEmits<{ load: [attemptId: number]; rate: [rating: number | null] }>()

const { t } = useI18n()

const hasMarks = computed(() => props.item.highlightCount + props.item.journalCount > 0)
const ready = computed(() => (props.marks?.status === 'ready' ? props.marks.marks : null))

const highlightsRoute = computed(() =>
  props.item.bookId === null
    ? null
    : {
        name: 'annotations',
        query: {
          bookId: String(props.item.bookId),
          from: props.item.startedOn ?? props.item.endedOn ?? undefined,
          to: props.item.endedOn ?? undefined,
        },
      },
)
const readingLogRoute = computed(() =>
  props.item.bookId === null ? null : { name: 'book-detail', params: { bookId: props.item.bookId }, query: { tab: 'reading-log' } },
)

// By read, not on mount: the side panel keeps this block when another cover is picked.
watch(
  () => props.item.id,
  (id) => {
    if (hasMarks.value) emit('load', id)
  },
  { immediate: true },
)

function handleRate(rating: number | null) {
  emit('rate', rating)
}

function handleRetry() {
  emit('load', props.item.id)
}
</script>

<template>
  <div class="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/35 p-3">
    <template v-if="hasMarks">
      <p v-if="marks?.status === 'loading' || !marks" class="flex items-center gap-2 text-[11.5px] text-muted-foreground" role="status">
        <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />{{ t('readingHistory.notes.loading') }}
      </p>
      <p v-else-if="marks.status === 'error'" class="text-[11.5px] text-muted-foreground" role="alert">
        {{ t('readingHistory.notes.failed') }}
        <button type="button" class="ms-1 font-semibold text-primary underline-offset-2 hover:underline" @click="handleRetry">
          {{ t('readingHistory.retry') }}
        </button>
      </p>
      <template v-else-if="ready">
        <figure v-for="mark in ready.highlights" :key="`h-${mark.id}`" class="grid grid-cols-[3px_minmax(0,1fr)] gap-x-3">
          <span class="row-span-3 rounded-full" :style="{ backgroundColor: mark.color }" aria-hidden="true" />
          <blockquote class="line-clamp-3 text-sm leading-relaxed text-foreground">{{ mark.text }}</blockquote>
          <figcaption v-if="mark.note" class="mt-1 text-xs text-foreground">
            <span class="me-1.5 text-[9.5px] font-bold tracking-[0.12em] text-primary uppercase">{{ t('readingHistory.notes.note') }}</span
            >{{ mark.note }}
          </figcaption>
          <p class="mt-0.5 text-[10.5px] text-muted-foreground">
            <template v-if="mark.chapterTitle">{{ mark.chapterTitle }} · </template>{{ formatInstantDay(mark.createdAt) }}
          </p>
        </figure>
        <figure v-for="entry in ready.journal" :key="`j-${entry.id}`" class="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5">
          <NotebookPen class="mt-0.5 size-3.5 text-muted-foreground" aria-hidden="true" />
          <div class="min-w-0">
            <p class="line-clamp-4 text-[13px] leading-relaxed text-foreground">{{ entry.body }}</p>
            <p class="mt-0.5 text-[10.5px] text-muted-foreground">
              {{ t('readingHistory.notes.journal') }} · {{ formatInstantDay(entry.createdAt) }}
            </p>
          </div>
        </figure>
      </template>
    </template>
    <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2" :class="hasMarks ? 'border-t border-border pt-2.5' : undefined">
      <span class="text-[11px] font-semibold text-muted-foreground">{{ t('readingHistory.notes.thisRead') }}</span>
      <HistoryStars :rating="item.rating" interactive :size="14" :busy="ratingBusy" @rate="handleRate" />
      <span class="flex-1" aria-hidden="true" />
      <RouterLink
        v-if="highlightsRoute && item.highlightCount > 0"
        :to="highlightsRoute"
        class="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
      >
        {{ t('readingHistory.notes.allHighlights', { count: item.highlightCount }) }}<ArrowRight class="size-3" aria-hidden="true" />
      </RouterLink>
      <RouterLink
        v-if="readingLogRoute"
        :to="readingLogRoute"
        class="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary hover:underline"
      >
        {{ t('readingHistory.notes.readingLog') }}<ArrowRight class="size-3" aria-hidden="true" />
      </RouterLink>
    </div>
  </div>
</template>
