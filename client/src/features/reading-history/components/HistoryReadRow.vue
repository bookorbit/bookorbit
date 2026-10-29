<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ban, BookX, ChevronDown, ChevronUp, Highlighter, Repeat2, SkipForward } from '@lucide/vue'
import type { ReadingHistoryItem, ReadingHistoryMarks } from '@bookorbit/types'
import { formatList, formatPercent } from '@/i18n/formatters'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import HistoryCover from './HistoryCover.vue'
import HistoryReadNotes from './HistoryReadNotes.vue'
import HistoryStars from './HistoryStars.vue'
import { formatDay, formatDayLong, formatReadingTime, formatWeekday, readSpanLabel } from '../lib/history-format'
import { isReread, sourceBadges } from '../lib/read-facts'

type MarksState = { status: 'loading' } | { status: 'ready'; marks: ReadingHistoryMarks } | { status: 'error' } | undefined

const props = defineProps<{
  item: ReadingHistoryItem
  open: boolean
  marks: MarksState
  ratingBusy: boolean
}>()

const emit = defineEmits<{ toggle: [attemptId: number]; loadMarks: [attemptId: number]; rate: [attemptId: number, rating: number | null] }>()

const { t } = useI18n()

const subline = computed(() =>
  [
    formatList(props.item.authors),
    props.item.seriesName ? `${props.item.seriesName}${props.item.seriesIndex ? ` #${props.item.seriesIndex}` : ''}` : '',
  ]
    .filter(Boolean)
    .join(' · '),
)
const sources = computed(() => sourceBadges(props.item.sources))
const sourceLine = computed(() => {
  const labels = sources.value.map((source) => source.label)
  return labels.length > 2
    ? t('readingHistory.row.sourcesMore', { names: formatList(labels.slice(0, 2)), count: labels.length - 2 })
    : formatList(labels)
})
const sourceTitle = computed(() => sources.value.map((source) => source.label).join(', '))
const abandonedLabel = computed(() =>
  props.item.progressPercent !== null
    ? t('readingHistory.row.abandonedAt', { percent: formatPercent(props.item.progressPercent / 100) })
    : t('readingHistory.row.abandoned'),
)
const span = computed(() => readSpanLabel(props.item, t))
const time = computed(() => {
  const duration = formatReadingTime(props.item.seconds, t)
  if (!props.item.sessions) return duration
  const sessions = t('readingHistory.row.sessions', { count: props.item.sessions })
  return duration ? t('readingHistory.row.sessionsTime', { sessions, time: duration }) : sessions
})
const hasMarks = computed(() => props.item.highlightCount + props.item.journalCount > 0)
/** A read with nothing marked keeps its notes-and-rating control out of sight until the row is pointed at. */
const toggleClass = computed(() => [
  props.open ? 'bg-muted text-primary' : undefined,
  hasMarks.value || props.open ? undefined : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
])
const marksLabel = computed(() => {
  const parts = [
    props.item.highlightCount ? t('readingHistory.row.highlights', { count: props.item.highlightCount }) : '',
    props.item.journalCount ? t('readingHistory.row.journal', { count: props.item.journalCount }) : '',
  ].filter(Boolean)
  return parts.length ? formatList(parts) : t('readingHistory.row.notesAndRating')
})
const bookRoute = computed(() => (props.item.bookId === null ? null : { name: 'book-detail', params: { bookId: props.item.bookId } }))
const removedTitle = computed(() =>
  props.item.removedAt ? t('readingHistory.row.removedTitle', { date: formatDayLong(props.item.removedAt.slice(0, 10)) }) : '',
)
const title = computed(() => props.item.title ?? t('readingHistory.row.untitled'))

function handleToggle() {
  emit('toggle', props.item.id)
}

function handleLoadMarks(attemptId: number) {
  emit('loadMarks', attemptId)
}

function handleRate(rating: number | null) {
  emit('rate', props.item.id, rating)
}
</script>

<template>
  <article
    class="group relative grid grid-cols-[40px_minmax(0,1fr)] gap-x-3 rounded-lg px-1.5 py-3 transition-colors hover:bg-muted/45 md:grid-cols-[3.75rem_44px_minmax(0,1fr)_13rem] md:gap-x-3.5 md:px-2 2xl:grid-cols-[3.75rem_44px_minmax(0,1fr)_17rem_5.5rem]"
    :class="open ? 'bg-muted/30' : undefined"
    :data-read-id="item.id"
  >
    <div class="hidden pt-px text-end md:block">
      <template v-if="item.endedOn">
        <span class="block text-[11px] leading-[15px] font-semibold text-muted-foreground group-hover:text-foreground">{{
          formatDay(item.endedOn)
        }}</span>
        <span class="block text-[9.5px] leading-[14px] text-muted-foreground">{{ formatWeekday(item.endedOn) }}</span>
      </template>
      <span v-else class="block text-[11px] leading-[15px] font-semibold text-muted-foreground">{{ t('readingHistory.row.noDate') }}</span>
    </div>

    <HistoryCover :item="item" class="row-span-2 h-[60px] w-10 rounded-xs md:row-span-1 md:h-[66px] md:w-11" />

    <div class="min-w-0">
      <RouterLink
        v-if="bookRoute"
        :to="bookRoute"
        class="line-clamp-2 text-sm leading-[19px] font-semibold text-foreground transition-colors hover:text-primary"
        >{{ title }}</RouterLink
      >
      <span v-else class="line-clamp-2 text-sm leading-[19px] font-semibold text-muted-foreground">{{ title }}</span>
      <p v-if="subline" class="mt-px truncate text-xs leading-4 text-muted-foreground">{{ subline }}</p>
      <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <BookFormatChip v-if="item.format" :format-key="item.format" class="h-[17px] rounded-xs px-1.5 text-[9.5px] tracking-wider" />
        <span
          v-if="isReread(item)"
          class="inline-flex h-[18px] items-center gap-1 rounded-full border border-primary/30 bg-primary/12 px-1.5 text-[10.5px] font-bold whitespace-nowrap text-primary"
          :title="t('readingHistory.row.readNumberTitle', { count: item.completedReads })"
        >
          <Repeat2 class="size-[11px]" aria-hidden="true" />{{ t('readingHistory.row.readNumber', { n: item.readNumber }) }}
        </span>
        <span
          v-if="item.outcome === 'abandoned'"
          class="inline-flex h-[18px] items-center gap-1 rounded-full border border-[var(--pill-warning)]/45 bg-[var(--pill-warning)]/15 px-1.5 text-[10.5px] font-bold whitespace-nowrap text-foreground"
        >
          <Ban class="size-[11px] text-[var(--pill-warning)]" aria-hidden="true" />{{ abandonedLabel }}
        </span>
        <span
          v-else-if="item.outcome === 'skimmed'"
          class="inline-flex h-[18px] items-center gap-1 rounded-full border border-[var(--pill-info)]/40 bg-[var(--pill-info)]/15 px-1.5 text-[10.5px] font-bold whitespace-nowrap text-foreground"
        >
          <SkipForward class="size-[11px] text-[var(--pill-info)]" aria-hidden="true" />{{ t('readingHistory.row.skimmed') }}
        </span>
        <span
          v-if="item.removedAt"
          class="inline-flex h-[18px] items-center gap-1 rounded-full border border-border bg-muted px-1.5 text-[10.5px] font-bold whitespace-nowrap text-muted-foreground"
          :title="removedTitle"
        >
          <BookX class="size-[11px]" aria-hidden="true" />{{ t('readingHistory.row.removed') }}
        </span>
        <button
          type="button"
          class="inline-flex h-[22px] items-center gap-1.5 rounded-md px-1.5 text-[11px] font-semibold whitespace-nowrap text-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="toggleClass"
          :aria-expanded="open"
          :aria-label="hasMarks ? undefined : marksLabel"
          @click="handleToggle"
        >
          <Highlighter class="size-3 text-muted-foreground" aria-hidden="true" />
          <span v-if="hasMarks">{{ marksLabel }}</span>
          <ChevronUp v-if="open" class="size-3" aria-hidden="true" />
          <ChevronDown v-else class="size-3" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div
      class="col-start-2 mt-1.5 flex min-w-0 flex-col gap-[3px] text-[11.5px] leading-4 text-muted-foreground md:col-start-auto md:mt-0 md:border-s md:border-border/60 md:ps-3.5"
    >
      <span class="truncate text-foreground">
        <span v-if="item.endedOn" class="md:hidden">{{ formatDay(item.endedOn) }} · </span>{{ span }}
      </span>
      <span v-if="time" class="truncate">{{ time }}</span>
      <span v-if="sources.length" class="flex min-w-0 items-center gap-[3px]" :title="sourceTitle">
        <span
          v-for="source in sources"
          :key="source.bucket"
          class="size-1.5 shrink-0 rounded-full"
          :style="{ backgroundColor: source.color }"
          aria-hidden="true"
        />
        <span class="ms-1 truncate">{{ sourceLine }}</span>
      </span>
      <HistoryStars v-if="item.rating" :rating="item.rating" class="mt-0.5 2xl:hidden" />
    </div>

    <div class="hidden justify-end pt-0.5 2xl:flex">
      <HistoryStars v-if="item.rating" :rating="item.rating" />
      <HistoryStars
        v-else
        interactive
        :rating="null"
        :busy="ratingBusy"
        class="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        @rate="handleRate"
      />
    </div>

    <div v-if="open" class="col-span-full mt-2.5 md:col-start-3">
      <HistoryReadNotes :item="item" :marks="marks" :rating-busy="ratingBusy" @load="handleLoadMarks" @rate="handleRate" />
    </div>
  </article>
</template>
