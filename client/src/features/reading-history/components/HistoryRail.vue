<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, TriangleAlert } from '@lucide/vue'
import type { ReadingHistoryRecord, ReadingHistorySummary } from '@bookorbit/types'
import { READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { formatKeyCode } from '@/features/book/lib/book-formats'
import HistoryCover from './HistoryCover.vue'
import { formatDay, formatHours, formatMonthName } from '../lib/history-format'
import { sourceBucketColor } from '../lib/read-facts'

const props = defineProps<{
  summary: ReadingHistorySummary | null
  year: number | null
  quarter: number | null
  periodLabel: string
  /** Today's month in the reader's calendar: later months of this year have not happened yet. */
  today: { year: number; month: number }
}>()

const emit = defineEmits<{ jumpMonth: [month: string]; quarter: [quarter: number]; showUndated: [] }>()

const { t } = useI18n()

const months = computed(() => props.summary?.months ?? [])
const maxMonth = computed(() => Math.max(1, ...months.value.map((month) => month.reads)))
const bestMonth = computed(() => [...months.value].sort((a, b) => b.reads - a.reads)[0] ?? null)
const quarters = computed(() =>
  [1, 2, 3, 4].map((quarter) => {
    const quarterMonths = months.value.filter((month) => Math.ceil(month.month / 3) === quarter)
    return {
      quarter,
      reads: quarterMonths.reduce((sum, month) => sum + month.reads, 0),
      seconds: quarterMonths.reduce((sum, month) => sum + month.seconds, 0),
    }
  }),
)
const maxQuarter = computed(() => Math.max(1, ...quarters.value.map((quarter) => quarter.reads)))

const goalPercent = computed(() => {
  const goal = props.summary?.goal
  return goal ? Math.min(1, goal.reached / goal.target) : 0
})
const goalCircle = 2 * Math.PI * 18
const goalDetail = computed(() => {
  const goal = props.summary?.goal
  if (!goal) return ''
  return [goal.metOn ? t('readingHistory.rail.goalMet', { date: formatDay(goal.metOn) }) : '', t('readingHistory.rail.goalRereads')]
    .filter(Boolean)
    .join(' ')
})

const averageLabel = computed(() => {
  const average = props.summary?.averageRating
  return average == null
    ? '-'
    : t('readingHistory.rail.averageRating', { rating: formatNumber(average, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
})

const records = computed(() => {
  const value = props.summary?.records
  if (!value) return []
  const out: { key: string; label: string; record: ReadingHistoryRecord; value: string }[] = []
  if (value.fastest)
    out.push({
      key: 'fastest',
      label: t('readingHistory.rail.fastest'),
      record: value.fastest,
      value: t('readingHistory.rail.pagesPerDay', { count: value.fastest.value }),
    })
  if (value.longestBook)
    out.push({
      key: 'longest',
      label: t('readingHistory.rail.longestBook'),
      record: value.longestBook,
      value: t('readingHistory.rail.pages', { count: value.longestBook.value }),
    })
  if (value.mostReread)
    out.push({
      key: 'reread',
      label: t('readingHistory.rail.mostReread'),
      record: value.mostReread,
      value: t('readingHistory.rail.times', { count: value.mostReread.value }),
    })
  if (value.longestRead)
    out.push({
      key: 'read',
      label: t('readingHistory.rail.longestRead'),
      record: value.longestRead,
      value: t('readingHistory.rail.days', { count: value.longestRead.value }),
    })
  return out
})

const formatTotal = computed(() =>
  Math.max(
    1,
    (props.summary?.formats ?? []).reduce((sum, format) => sum + format.reads, 0),
  ),
)
const sourceTotal = computed(() =>
  Math.max(
    1,
    (props.summary?.sources ?? []).reduce((sum, source) => sum + source.reads, 0),
  ),
)

function isFuture(month: number) {
  return props.year !== null && (props.year > props.today.year || (props.year === props.today.year && month > props.today.month))
}

/** With a quarter chosen, the year's other months stay in the chart but recede. */
function inQuarter(month: number) {
  return props.quarter === null || Math.ceil(month / 3) === props.quarter
}

function monthKey(month: number) {
  return `${props.year}-${String(month).padStart(2, '0')}`
}

function recordCover(record: ReadingHistoryRecord) {
  return { ...record.item, authors: [], format: null, seriesName: null, seriesIndex: null }
}

function handleJump(month: number) {
  emit('jumpMonth', monthKey(month))
}

function handleQuarter(quarter: number) {
  emit('quarter', quarter)
}

function handleShowUndated() {
  emit('showUndated')
}
</script>

<template>
  <aside
    class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('readingHistory.rail.label', { period: periodLabel })"
  >
    <header class="flex h-[42px] flex-none items-center border-b border-border px-3">
      <h2 class="truncate text-[13px] font-bold text-foreground">{{ t('readingHistory.rail.inNumbers', { period: periodLabel }) }}</h2>
    </header>

    <div class="grid md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:block">
      <section class="border-b border-border px-3 pt-2.5 pb-3 md:border-e xl:border-e-0">
        <h3 class="mb-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('readingHistory.rail.totals') }}</h3>
        <dl class="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          <div class="flex min-w-0 flex-col bg-card px-2.5 py-2">
            <dt class="order-2 truncate text-[11px] text-muted-foreground">{{ t('readingHistory.rail.reads') }}</dt>
            <dd class="text-lg leading-[22px] font-bold text-foreground tabular-nums">{{ formatNumber(summary?.reads ?? 0) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col bg-card px-2.5 py-2">
            <dt class="order-2 truncate text-[11px] text-muted-foreground">{{ t('readingHistory.rail.books') }}</dt>
            <dd class="text-lg leading-[22px] font-bold text-foreground tabular-nums">{{ formatNumber(summary?.books ?? 0) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col bg-card px-2.5 py-2">
            <dt class="order-2 truncate text-[11px] text-muted-foreground">{{ t('readingHistory.rail.rereads') }}</dt>
            <dd class="text-lg leading-[22px] font-bold text-foreground tabular-nums">{{ formatNumber(summary?.rereads ?? 0) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col bg-card px-2.5 py-2">
            <dt class="order-2 truncate text-[11px] text-muted-foreground">{{ t('readingHistory.rail.pagesLabel') }}</dt>
            <dd class="text-lg leading-[22px] font-bold text-foreground tabular-nums">{{ formatNumber(summary?.pages ?? 0) }}</dd>
          </div>
          <div class="flex min-w-0 flex-col bg-card px-2.5 py-2">
            <dt class="order-2 truncate text-[11px] text-muted-foreground">
              {{ t('readingHistory.rail.daysRead', { count: summary?.daysRead ?? 0 }) }}
            </dt>
            <dd class="text-lg leading-[22px] font-bold text-foreground tabular-nums">
              {{ t('readingHistory.rail.hours', { hours: formatNumber(formatHours(summary?.seconds ?? 0)) }) }}
            </dd>
          </div>
          <div class="flex min-w-0 flex-col bg-card px-2.5 py-2">
            <dt class="order-2 truncate text-[11px] text-muted-foreground">
              {{ t('readingHistory.rail.rated', { count: summary?.ratedReads ?? 0 }) }}
            </dt>
            <dd class="text-lg leading-[22px] font-bold text-foreground tabular-nums">
              {{ averageLabel }}
            </dd>
          </div>
        </dl>
        <p v-if="summary?.notCounted" class="mt-2 text-[11.5px] leading-4 text-muted-foreground">
          {{ t('readingHistory.rail.notCounted', { count: summary.notCounted }) }}
        </p>
      </section>

      <section v-if="year !== null && months.length" class="border-b border-border px-3 pt-2.5 pb-3">
        <h3 class="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
          {{ t('readingHistory.rail.byMonth') }}
          <span v-if="bestMonth && bestMonth.reads" class="ms-auto text-[11px] font-semibold tracking-normal normal-case">{{
            t('readingHistory.rail.best', { month: formatMonthName(bestMonth.month), count: bestMonth.reads })
          }}</span>
        </h3>
        <div class="grid h-[78px] grid-cols-12 items-end gap-[3px] border-b border-border pt-3.5">
          <template v-for="month in months" :key="month.month">
            <span
              v-if="isFuture(month.month)"
              class="h-full rounded-t-[3px] bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--border)_3px_4px)] opacity-70"
              aria-hidden="true"
            />
            <button
              v-else
              type="button"
              class="group/bar relative flex h-full flex-col justify-end rounded-t-[3px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="t('readingHistory.rail.monthBar', { month: formatMonthName(month.month, 'long'), count: month.reads })"
              :disabled="month.reads === 0"
              @click="handleJump(month.month)"
            >
              <span
                v-if="month.reads"
                class="absolute inset-x-0 bottom-[calc(100%+1px)] text-center text-[9.5px] font-bold text-muted-foreground tabular-nums"
                aria-hidden="true"
                >{{ month.reads }}</span
              >
              <span
                class="flex min-h-0.5 flex-col justify-end overflow-hidden rounded-t-[3px] group-hover/bar:brightness-110"
                :class="inQuarter(month.month) ? 'bg-primary' : 'bg-[color-mix(in_oklch,var(--primary)_30%,var(--card))]'"
                :style="{ height: `${(month.reads / maxMonth) * 100}%` }"
              >
                <span
                  v-if="month.rereads"
                  class="bg-[color-mix(in_oklch,var(--primary)_45%,var(--card))]"
                  :style="{ height: `${(month.rereads / Math.max(1, month.reads)) * 100}%` }"
                />
              </span>
            </button>
          </template>
        </div>
        <div class="mt-1 grid grid-cols-12 gap-[3px]" aria-hidden="true">
          <span v-for="month in months" :key="month.month" class="text-center text-[9.5px] text-muted-foreground">{{
            formatMonthName(month.month, 'narrow')
          }}</span>
        </div>
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <span class="inline-flex items-center gap-1.5"
            ><span class="size-2 rounded-[2px] bg-primary" aria-hidden="true" />{{ t('readingHistory.rail.firstReads') }}</span
          >
          <span class="inline-flex items-center gap-1.5"
            ><span class="size-2 rounded-[2px] bg-[color-mix(in_oklch,var(--primary)_45%,var(--card))]" aria-hidden="true" />{{
              t('readingHistory.rail.rereads')
            }}</span
          >
        </div>
      </section>
    </div>

    <section v-if="year !== null && months.length" class="hidden border-b border-border px-3 pt-2.5 pb-3 xl:block">
      <h3 class="mb-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('readingHistory.rail.quarters') }}</h3>
      <button
        v-for="row in quarters"
        :key="row.quarter"
        type="button"
        class="-mx-1.5 grid h-7 w-[calc(100%+0.75rem)] grid-cols-[26px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-md px-1.5 text-start text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="quarter === row.quarter ? 'bg-primary/12' : undefined"
        :aria-pressed="quarter === row.quarter"
        @click="handleQuarter(row.quarter)"
      >
        <b class="font-bold text-foreground">{{ t('readingHistory.period.quarter', { quarter: row.quarter }) }}</b>
        <span class="flex h-[5px] overflow-hidden rounded-full bg-muted" aria-hidden="true"
          ><span class="h-full bg-primary" :style="{ width: `${(row.reads / maxQuarter) * 100}%` }"
        /></span>
        <span class="min-w-[4.5em] text-end font-semibold text-foreground tabular-nums">{{
          t('readingHistory.month.reads', { count: row.reads })
        }}</span>
        <span class="min-w-[3em] text-end tabular-nums">{{ t('readingHistory.rail.hours', { hours: formatNumber(formatHours(row.seconds)) }) }}</span>
      </button>
    </section>

    <section v-if="summary?.goal" class="hidden border-b border-border px-3 pt-2.5 pb-3 xl:block">
      <h3 class="mb-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('readingHistory.rail.goal', { year }) }}</h3>
      <div class="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-2.5">
        <span class="relative size-11">
          <svg viewBox="0 0 44 44" class="size-11 -rotate-90" aria-hidden="true">
            <circle cx="22" cy="22" r="18" fill="none" stroke="var(--muted)" stroke-width="5" />
            <circle
              cx="22"
              cy="22"
              r="18"
              fill="none"
              stroke="var(--primary)"
              stroke-width="5"
              stroke-linecap="round"
              :stroke-dasharray="`${goalPercent * goalCircle} ${goalCircle}`"
            />
          </svg>
          <span class="absolute inset-0 grid place-items-center text-[11px] font-bold text-foreground">
            <Check v-if="summary.goal.reached >= summary.goal.target" class="size-4" :stroke-width="3" aria-hidden="true" />
            <template v-else>{{ summary.goal.reached }}</template>
          </span>
        </span>
        <p class="text-xs leading-[17px] text-muted-foreground">
          <b class="font-semibold text-foreground">{{
            t('readingHistory.rail.goalProgress', { reached: summary.goal.reached, target: summary.goal.target })
          }}</b
          >{{ ` ${goalDetail}` }}
        </p>
      </div>
    </section>

    <section v-if="records.length" class="hidden border-b border-border px-3 pt-2.5 pb-2 xl:block">
      <h3 class="mb-1 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('readingHistory.rail.records') }}</h3>
      <dl>
        <div
          v-for="row in records"
          :key="row.key"
          class="grid min-h-[30px] grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 border-t border-border/50 text-xs first:border-t-0"
        >
          <dt class="whitespace-nowrap text-muted-foreground">{{ row.label }}</dt>
          <dd class="flex min-w-0 items-center justify-end gap-1.5 text-end font-semibold text-foreground">
            <HistoryCover :item="recordCover(row.record)" class="h-[27px] w-[18px] rounded-[2px]" />
            <span class="truncate" :title="row.record.item.title ?? ''">{{ row.record.item.title ?? t('readingHistory.row.untitled') }}</span>
            <small class="shrink-0 text-[11px] font-medium text-muted-foreground">{{ row.value }}</small>
          </dd>
        </div>
      </dl>
    </section>

    <section v-if="summary?.formats.length" class="hidden border-b border-border px-3 pt-2.5 pb-3 xl:block">
      <h3 class="mb-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('readingHistory.rail.formats') }}</h3>
      <div class="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          v-for="format in summary.formats"
          :key="format.format"
          class="h-full"
          :style="{ width: `${(format.reads / formatTotal) * 100}%`, backgroundColor: formatColorVar(format.format) }"
        />
      </div>
      <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li v-for="format in summary.formats.slice(0, 8)" :key="format.format" class="inline-flex items-center gap-1.5">
          <span class="size-2 rounded-[2px]" :style="{ backgroundColor: formatColorVar(format.format) }" aria-hidden="true" />{{
            formatKeyCode(format.format)
          }}
          <b class="font-semibold text-foreground tabular-nums">{{ format.reads }}</b>
        </li>
      </ul>
    </section>

    <section v-if="summary?.sources.length" class="hidden border-b border-border px-3 pt-2.5 pb-3 xl:block">
      <h3 class="mb-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('readingHistory.rail.whereYouRead') }}</h3>
      <div class="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span
          v-for="source in summary.sources"
          :key="source.source"
          class="h-full"
          :style="{ width: `${(source.reads / sourceTotal) * 100}%`, backgroundColor: sourceBucketColor(source.source) }"
        />
      </div>
      <ul class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li v-for="source in summary.sources" :key="source.source" class="inline-flex items-center gap-1.5">
          <span class="size-1.5 rounded-full" :style="{ backgroundColor: sourceBucketColor(source.source) }" aria-hidden="true" />{{
            READING_SESSION_SOURCE_BUCKET_LABELS[source.source]
          }}
          <b class="font-semibold text-foreground tabular-nums">{{ source.reads }}</b>
        </li>
      </ul>
    </section>

    <section v-if="year !== null && summary?.undatedReads" class="hidden px-3 py-3 xl:block">
      <div
        class="grid grid-cols-[14px_minmax(0,1fr)] gap-2 rounded-lg border border-[var(--pill-repaired)]/30 bg-[var(--pill-repaired)]/10 px-2.5 py-2"
      >
        <TriangleAlert class="mt-px size-3.5 text-[var(--pill-repaired)]" aria-hidden="true" />
        <div>
          <p class="text-[11.5px] leading-4 font-bold text-foreground">{{ t('readingHistory.rail.undated', { count: summary.undatedReads }) }}</p>
          <button
            type="button"
            class="mt-0.5 text-[11.5px] font-semibold text-[var(--pill-repaired)] underline underline-offset-2"
            @click="handleShowUndated"
          >
            {{ t('readingHistory.rail.showUndated') }}
          </button>
        </div>
      </div>
    </section>
  </aside>
</template>
