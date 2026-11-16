<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { formatNumber, formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import type { BookReadingSession, BookReadingSessionStats } from '@bookorbit/types'

const props = withDefaults(
  defineProps<{
    stats: BookReadingSessionStats | null
    sessions?: BookReadingSession[]
    loading?: boolean
    /** Recent sessions listed under the summary. 0 hides the list entirely. */
    sessionRows?: number
  }>(),
  { sessions: () => [], loading: false, sessionRows: 3 },
)

const { t } = useI18n()

const hasActivity = computed(() => (props.stats?.totalSessions ?? 0) > 0)

/**
 * The bar strip covers the span the book was actually read over, not a fixed window: a book read
 * across two days should not render as two marks lost in a month of empty columns.
 */
const days = computed(() => {
  const summary = props.stats?.dailySummary ?? []
  const firstEntry = summary[0]
  const lastEntry = summary[summary.length - 1]
  if (!firstEntry || !lastEntry) return []
  const minutesByDay = new Map(summary.map((entry) => [entry.day, entry.totalMinutes]))
  const first = Date.parse(`${firstEntry.day}T00:00:00Z`)
  const last = Date.parse(`${lastEntry.day}T00:00:00Z`)
  const span = Math.round((last - first) / 86_400_000) + 1
  const count = Math.min(28, Math.max(7, span + 2))
  const result: { day: string; minutes: number }[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(last - offset * 86_400_000).toISOString().slice(0, 10)
    result.push({ day, minutes: minutesByDay.get(day) ?? 0 })
  }
  return result
})

const peakMinutes = computed(() => Math.max(1, ...days.value.map((day) => day.minutes)))

function barHeight(minutes: number): string {
  if (minutes <= 0) return '0%'
  return `${Math.max(16, Math.round((minutes / peakMinutes.value) * 100))}%`
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return t('book.detail.details.durationM', { minutes: 0 })
  if (seconds < 60) return t('book.detail.details.durationS', { seconds: Math.round(seconds) })
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? t('book.detail.details.durationHm', { hours, minutes }) : t('book.detail.details.durationM', { minutes })
}

const summaryStats = computed(() => {
  const stats = props.stats
  if (!stats) return []
  return [
    { key: 'sessions', label: t('book.detail.details.activitySessions'), value: formatNumber(stats.totalSessions) },
    { key: 'time', label: t('book.detail.details.activityTime'), value: formatDuration(stats.totalSeconds) },
    { key: 'avg', label: t('book.detail.details.activityAverage'), value: formatDuration(stats.avgDurationSeconds) },
    {
      key: 'progress',
      label: t('book.detail.details.activityProgress'),
      value: formatPercent((stats.latestEndProgress ?? 0) / 100),
    },
  ]
})

const recentSessions = computed(() => props.sessions.slice(0, props.sessionRows))

function relative(iso: string | null | undefined): string {
  if (!iso) return '-'
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? '-' : formatRelativeFromNow(parsed)
}

function dayLabel(day: string, minutes: number): string {
  return t('book.detail.details.activityDayTooltip', { day, minutes: Math.round(minutes) })
}

function reachedFraction(session: BookReadingSession): number {
  return Math.min(1, Math.max(0, (session.endProgress ?? 0) / 100))
}

function reachedPercent(session: BookReadingSession): string {
  return formatPercent(reachedFraction(session))
}

function reachedWidth(session: BookReadingSession): string {
  return `${Math.round(reachedFraction(session) * 100)}%`
}

function reachedLabel(session: BookReadingSession): string {
  return t('book.detail.details.activityReached', { percent: reachedPercent(session) })
}
</script>

<template>
  <section
    class="@container/reading flex flex-col rounded-xl border border-border bg-card px-3.5 py-3"
    :aria-label="t('book.detail.details.yourReading')"
  >
    <div class="flex items-baseline gap-2">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('book.detail.details.yourReading') }}
      </h3>
      <p v-if="hasActivity" class="ms-auto text-[11px] text-muted-foreground">
        {{ t('book.detail.details.lastRead', { when: relative(stats!.lastSessionAt) }) }}
      </p>
    </div>

    <p v-if="loading" class="mt-3 text-[13px] text-muted-foreground">{{ t('common.loading') }}</p>

    <div v-else-if="!hasActivity" class="mt-2.5 flex items-center gap-2.5" data-test="reading-not-started">
      <span class="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground" aria-hidden="true">
        <BookOpen class="size-[17px]" />
      </span>
      <div class="min-w-0">
        <p class="text-[13px] font-semibold leading-tight text-foreground">{{ t('book.detail.details.readingNotStarted') }}</p>
        <p class="mt-px text-[11.5px] leading-snug text-muted-foreground">{{ t('book.detail.details.readingNotStartedHint') }}</p>
      </div>
    </div>

    <template v-else>
      <!-- The stats and the daily bars share the width as equal columns; below 27.5rem the bars take their own row. -->
      <div class="mt-3 grid grid-cols-4 @min-[27.5rem]/reading:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.6fr)]" data-test="reading-summary">
        <dl class="col-span-4 grid grid-cols-subgrid">
          <div v-for="stat in summaryStats" :key="stat.key" class="min-w-0 border-s border-border px-3 first:border-s-0 first:ps-0">
            <dt class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{{ stat.label }}</dt>
            <dd class="mt-[3px] whitespace-nowrap text-base font-semibold leading-tight tabular-nums">{{ stat.value }}</dd>
          </div>
        </dl>

        <div
          v-if="days.length > 0"
          class="col-span-full mt-2.5 min-w-0 @min-[27.5rem]/reading:col-span-1 @min-[27.5rem]/reading:mt-0 @min-[27.5rem]/reading:border-s @min-[27.5rem]/reading:border-border @min-[27.5rem]/reading:ps-3"
          aria-hidden="true"
          data-test="reading-daily"
        >
          <p class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.details.activityDaily') }}</p>
          <div class="mt-[3px] flex h-[18px] items-stretch gap-0.5">
            <span
              v-for="day in days"
              :key="day.day"
              :title="dayLabel(day.day, day.minutes)"
              class="flex min-w-0.5 max-w-[9px] flex-1 basis-0 items-end overflow-hidden rounded-[2px] bg-muted"
            >
              <span class="w-full rounded-[2px] bg-primary" :style="{ height: barHeight(day.minutes) }" />
            </span>
          </div>
        </div>
      </div>

      <!-- One fixed-height row per session; the columns are shared so chips, times and bars line up. -->
      <ul v-if="recentSessions.length > 0" class="mt-2.5 grid grid-cols-[auto_auto_auto_minmax(0,1fr)] gap-x-3">
        <li
          v-for="session in recentSessions"
          :key="session.id"
          class="col-span-full grid h-[29px] grid-cols-subgrid items-center border-t border-border text-[11.5px]"
        >
          <span class="flex">
            <BookFormatChip
              v-if="session.format"
              :format-key="session.format"
              class="h-4.5 shrink-0 rounded-xs px-1.5 text-[9px] leading-none tracking-wider"
            />
          </span>
          <span class="whitespace-nowrap text-muted-foreground">{{ relative(session.startedAt) }}</span>
          <span class="whitespace-nowrap text-end font-semibold tabular-nums">{{ formatDuration(session.durationSeconds) }}</span>
          <span class="flex min-w-0 items-center gap-2" :title="reachedLabel(session)">
            <span class="h-1 min-w-6 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span class="block h-full rounded-full bg-primary/75" :style="{ width: reachedWidth(session) }" />
            </span>
            <span class="min-w-[30px] text-end tabular-nums text-muted-foreground" aria-hidden="true">{{ reachedPercent(session) }}</span>
            <span class="sr-only">{{ reachedLabel(session) }}</span>
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>
