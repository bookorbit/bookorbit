<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CalendarDays, CornerUpLeft, Flame, Timer, Trophy, Zap } from '@lucide/vue'
import type { BookReadingSessionStats } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { useReadingLogInsights } from '@/features/book/composables/useReadingLogInsights'

const props = defineProps<{
  stats: BookReadingSessionStats | null
  /** Rows beyond this are dropped; the card never scrolls. */
  max?: number
}>()

const { t } = useI18n()
const statsRef = computed(() => props.stats)
const { bestDay, longestStreakDays, pacePercentPerHour } = useReadingLogInsights(statsRef)

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.readingLog.vitals.durationHm', { hours, minutes })
  if (minutes > 0) return t('book.detail.readingLog.vitals.durationM', { minutes })
  return t('book.detail.readingLog.vitals.durationS', { seconds: Math.floor(seconds) })
}

function shortDate(value: string | null): string {
  if (!value) return ''
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? '' : formatDate(parsed, { month: 'short', day: 'numeric' })
}

type RecordRow = { key: string; icon: unknown; label: string; value: string; detail: string }

const rows = computed<RecordRow[]>(() => {
  const stats = props.stats
  const out: RecordRow[] = []
  if (!stats) return out

  if (stats.longestSessionSeconds > 0) {
    out.push({
      key: 'longest',
      icon: Timer,
      label: t('book.detail.readingLog.records.longestSession'),
      value: formatDuration(stats.longestSessionSeconds),
      detail: shortDate(stats.longestSessionAt),
    })
  }
  if (bestDay.value) {
    out.push({
      key: 'bestDay',
      icon: Trophy,
      label: t('book.detail.readingLog.records.bestDay'),
      value: formatDuration(bestDay.value.minutes * 60),
      detail: '',
    })
  }
  if (longestStreakDays.value > 0) {
    out.push({
      key: 'streak',
      icon: Flame,
      label: t('book.detail.readingLog.records.longestStreak'),
      value: t('book.detail.readingLog.records.streakDays', { count: longestStreakDays.value }, longestStreakDays.value),
      detail: '',
    })
  }
  if (pacePercentPerHour.value != null) {
    out.push({
      key: 'pace',
      icon: Zap,
      label: t('book.detail.readingLog.records.pace'),
      value: t('book.detail.readingLog.vitals.pacePerHour', { percent: pacePercentPerHour.value.toFixed(1) }),
      detail: '',
    })
  }
  if (stats.backtrackCount > 0) {
    out.push({
      key: 'backtracks',
      icon: CornerUpLeft,
      label: t('book.detail.readingLog.records.jumpedBack'),
      value: t('book.detail.readingLog.records.jumpedBackTimes', { count: stats.backtrackCount }, stats.backtrackCount),
      detail: '',
    })
  }
  if (stats.firstSessionAt) {
    out.push({
      key: 'firstOpened',
      icon: CalendarDays,
      label: t('book.detail.readingLog.records.firstOpened'),
      value: shortDate(stats.firstSessionAt),
      detail: '',
    })
  }
  return out.slice(0, props.max ?? out.length)
})
</script>

<template>
  <section class="flex flex-col rounded-xl border border-border bg-card" :aria-label="t('book.detail.readingLog.records.title')">
    <header class="flex flex-none items-center border-b border-border px-3 py-2">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.readingLog.records.title') }}</h2>
    </header>
    <div v-if="rows.length === 0" class="px-3 py-4 text-center text-xs text-muted-foreground">
      {{ t('book.detail.readingLog.records.empty') }}
    </div>
    <dl v-else class="px-3 py-0.5">
      <div v-for="row in rows" :key="row.key" class="flex h-7 items-center gap-2 border-t border-border/60 first:border-t-0">
        <span class="inline-flex size-4.5 shrink-0 items-center justify-center rounded bg-primary/15 text-primary">
          <component :is="row.icon" class="size-3" />
        </span>
        <dt class="truncate text-[11px] leading-4 text-muted-foreground">{{ row.label }}</dt>
        <dd class="ml-auto shrink-0 text-[11.5px] font-semibold leading-4 tabular-nums text-foreground">
          {{ row.value }}
          <span v-if="row.detail" class="ml-1 text-[10.5px] font-normal leading-4 text-muted-foreground">{{ row.detail }}</span>
        </dd>
      </div>
    </dl>
  </section>
</template>
