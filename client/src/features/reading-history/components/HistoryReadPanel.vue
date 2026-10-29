<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookX, X } from '@lucide/vue'
import type { ReadingHistoryItem, ReadingHistoryMarks } from '@bookorbit/types'
import { formatList, formatNumber } from '@/i18n/formatters'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import HistoryCover from './HistoryCover.vue'
import HistoryReadNotes from './HistoryReadNotes.vue'
import { formatDayLong, formatDayWithWeekday, formatReadingTime, readSpanDays } from '../lib/history-format'
import { sourceBadges } from '../lib/read-facts'

type MarksState = { status: 'loading' } | { status: 'ready'; marks: ReadingHistoryMarks } | { status: 'error' } | undefined

const props = defineProps<{ item: ReadingHistoryItem; marks: MarksState; ratingBusy: boolean }>()
const emit = defineEmits<{ close: []; loadMarks: [attemptId: number]; rate: [attemptId: number, rating: number | null] }>()

const { t } = useI18n()
const panel = ref<HTMLElement | null>(null)

const heading = computed(() => {
  if (props.item.outcome === 'abandoned') return t('readingHistory.row.abandoned')
  if (props.item.outcome === 'skimmed') return t('readingHistory.row.skimmed')
  if ((props.item.readNumber ?? 1) <= 1) return t('readingHistory.panel.firstRead')
  return t('readingHistory.panel.readOf', { n: props.item.readNumber, count: props.item.completedReads })
})
const title = computed(() => props.item.title ?? t('readingHistory.row.untitled'))
const authors = computed(() => formatList(props.item.authors))
const bookRoute = computed(() => (props.item.bookId === null ? null : { name: 'book-detail', params: { bookId: props.item.bookId } }))
const took = computed(() => {
  const span = readSpanDays(props.item)
  if (span === null) return null
  return span === 1 ? t('readingHistory.row.sameDay') : t('readingHistory.rail.days', { count: span })
})
const timeRead = computed(() => {
  const time = formatReadingTime(props.item.seconds, t)
  return time ? t('readingHistory.panel.timeReadValue', { time, count: props.item.sessions }) : null
})
const facts = computed(() =>
  [
    {
      key: 'finished',
      label: t('readingHistory.panel.finished'),
      value: props.item.endedOn ? formatDayWithWeekday(props.item.endedOn) : t('readingHistory.row.noDate'),
    },
    {
      key: 'started',
      label: t('readingHistory.panel.started'),
      value: props.item.startedOn ? formatDayLong(props.item.startedOn) : t('readingHistory.panel.notRecorded'),
    },
    { key: 'took', label: t('readingHistory.panel.took'), value: took.value },
    { key: 'time', label: t('readingHistory.panel.timeRead'), value: timeRead.value },
    { key: 'pages', label: t('readingHistory.rail.pagesLabel'), value: props.item.pageCount ? formatNumber(props.item.pageCount) : null },
    {
      key: 'where',
      label: t('readingHistory.panel.where'),
      value: formatList(sourceBadges(props.item.sources).map((source) => source.label)) || null,
    },
  ].filter((fact) => fact.value),
)

watch(
  () => props.item.id,
  () => void nextTick(() => panel.value?.focus()),
)
onMounted(() => panel.value?.focus())

function handleClose() {
  emit('close')
}

function handleLoadMarks(attemptId: number) {
  emit('loadMarks', attemptId)
}

function handleRate(rating: number | null) {
  emit('rate', props.item.id, rating)
}
</script>

<template>
  <div class="fixed inset-0 z-[60] bg-scrim xl:hidden" aria-hidden="true" @click="handleClose" />
  <aside
    ref="panel"
    tabindex="-1"
    role="dialog"
    :aria-label="t('readingHistory.panel.label', { title })"
    class="fixed inset-x-0 bottom-0 z-[61] flex max-h-[75svh] flex-col overflow-y-auto rounded-t-2xl border-t border-border bg-card shadow-2xl outline-none md:inset-y-0 md:start-auto md:end-0 md:max-h-none md:w-[min(24rem,100vw)] md:rounded-none md:border-s md:border-t-0 xl:sticky xl:top-3 xl:z-auto xl:max-h-[calc(100svh-1.5rem)] xl:w-auto xl:rounded-xl xl:border xl:shadow-none"
    @keydown.esc="handleClose"
  >
    <header class="flex h-[42px] flex-none items-center gap-2 border-b border-border px-3">
      <h2 class="truncate text-[13px] font-bold text-foreground">{{ heading }}</h2>
      <button
        type="button"
        class="ms-auto grid size-8 place-items-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('readingHistory.panel.close')"
        @click="handleClose"
      >
        <X class="size-4" aria-hidden="true" />
      </button>
    </header>
    <div class="grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b border-border p-3">
      <HistoryCover :item="item" class="h-24 w-16 rounded-sm" />
      <div class="min-w-0">
        <RouterLink v-if="bookRoute" :to="bookRoute" class="line-clamp-2 text-sm leading-[19px] font-semibold text-foreground hover:text-primary">{{
          title
        }}</RouterLink>
        <span v-else class="line-clamp-2 text-sm leading-[19px] font-semibold text-muted-foreground">{{ title }}</span>
        <p v-if="authors" class="mt-0.5 text-xs text-muted-foreground">{{ authors }}</p>
        <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <BookFormatChip v-if="item.format" :format-key="item.format" class="h-[17px] rounded-xs px-1.5 text-[9.5px] tracking-wider" />
          <span
            v-if="item.removedAt"
            class="inline-flex h-[18px] items-center gap-1 rounded-full border border-border bg-muted px-1.5 text-[10.5px] font-bold text-muted-foreground"
          >
            <BookX class="size-[11px]" aria-hidden="true" />{{ t('readingHistory.row.removed') }}
          </span>
        </div>
      </div>
    </div>
    <dl class="border-b border-border px-3 py-1">
      <div
        v-for="fact in facts"
        :key="fact.key"
        class="grid min-h-[30px] grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t border-border/50 text-xs first:border-t-0"
      >
        <dt class="text-muted-foreground">{{ fact.label }}</dt>
        <dd class="truncate text-end font-semibold text-foreground">{{ fact.value }}</dd>
      </div>
    </dl>
    <div class="p-3">
      <HistoryReadNotes :item="item" :marks="marks" :rating-busy="ratingBusy" @load="handleLoadMarks" @rate="handleRate" />
    </div>
  </aside>
</template>
