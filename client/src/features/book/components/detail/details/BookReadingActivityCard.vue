<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber, formatPercent, formatRelativeFromNow } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import type { BookReadingSession, BookReadingSessionStats } from '@bookorbit/types'

const props = withDefaults(
  defineProps<{
    stats: BookReadingSessionStats | null
    sessions?: BookReadingSession[]
    loading?: boolean
    /** Recent sessions listed under the summary. 0 hides the list entirely. */
    sessionRows?: number
  }>(),
  { sessions: () => [], loading: false, sessionRows: 4 },
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

function formatBadgeStyle(format: string) {
  const color = formatColorVar(format)
  return {
    color,
    borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
    backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
  }
}
</script>

<template>
  <section class="flex flex-col rounded-xl border border-border bg-card px-3.5 py-3" :aria-label="t('book.detail.details.yourReading')">
    <div class="flex items-baseline gap-2">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('book.detail.details.yourReading') }}
      </h3>
      <p class="ml-auto text-[11px] text-muted-foreground">
        <template v-if="hasActivity">{{ t('book.detail.details.lastRead', { when: relative(stats!.lastSessionAt) }) }}</template>
        <template v-else>{{ t('book.detail.details.notStarted') }}</template>
      </p>
    </div>

    <p v-if="loading" class="mt-3 text-[13px] text-muted-foreground">{{ t('common.loading') }}</p>

    <p v-else-if="!hasActivity" class="mt-3 text-[13px] leading-relaxed text-muted-foreground">
      {{ t('book.detail.details.noSessionsYet') }}
    </p>

    <template v-else>
      <div class="mt-3 flex items-end gap-6">
        <dl class="flex shrink-0 gap-6">
          <div v-for="stat in summaryStats" :key="stat.key">
            <dt class="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{{ stat.label }}</dt>
            <dd class="mt-0.5 text-sm font-semibold tabular-nums">{{ stat.value }}</dd>
          </div>
        </dl>

        <div class="ml-auto flex h-7 shrink-0 items-stretch gap-[3px]" aria-hidden="true">
          <span
            v-for="day in days"
            :key="day.day"
            :title="dayLabel(day.day, day.minutes)"
            class="flex w-2.5 items-end overflow-hidden rounded-[2px] bg-muted"
          >
            <span class="w-full rounded-[2px] bg-primary" :style="{ height: barHeight(day.minutes) }" />
          </span>
        </div>
      </div>

      <ul v-if="recentSessions.length > 0" class="mt-2.5 min-h-0 flex-1 overflow-y-auto">
        <li v-for="session in recentSessions" :key="session.id" class="flex items-center gap-2.5 border-t border-border py-1.5 first:border-t-0">
          <span class="w-24 shrink-0 truncate text-[11px] text-muted-foreground">{{ relative(session.startedAt) }}</span>
          <span class="w-12 shrink-0 text-[11px] font-semibold tabular-nums">{{ formatDuration(session.durationSeconds) }}</span>
          <span class="min-w-0 flex-1 truncate text-[11px] tabular-nums text-muted-foreground">
            {{ t('book.detail.details.activityReached', { percent: formatPercent((session.endProgress ?? 0) / 100) }) }}
          </span>
          <span
            v-if="session.format"
            class="inline-flex h-4.5 shrink-0 items-center rounded border px-1.5 text-[9px] font-bold uppercase leading-none tracking-wider"
            :style="formatBadgeStyle(session.format)"
          >
            {{ session.source ?? session.format }}
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>
