<script setup lang="ts">
import { computed } from 'vue'
import type { BookReadingSessionStats } from '@bookorbit/types'

const props = defineProps<{
  stats: BookReadingSessionStats | null
  loading: boolean
  quickFilter: 'all' | 'last30' | 'last90' | 'thisYear'
}>()

const DAY_MS = 24 * 60 * 60 * 1000
const CARD_COUNT = 8
const CARD_CLASS = 'rounded-md border border-border bg-card px-2.5 py-2 sm:px-3 sm:py-2.5'

function toUtcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function toUtcDayKey(dayStartMs: number): string {
  return new Date(dayStartMs).toISOString().slice(0, 10)
}

function parseDayKeyToUtcStart(dayKey: string): number | null {
  const [yy, mm, dd] = dayKey.split('-').map(Number)
  if (!yy || !mm || !dd) return null
  return Date.UTC(yy, mm - 1, dd)
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '-'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const yr = Math.floor(mo / 12)
  return `${yr} year${yr === 1 ? '' : 's'} ago`
}

const dailyMap = computed(() => {
  const map = new Map<string, number>()
  for (const row of props.stats?.dailySummary ?? []) {
    map.set(row.day, row.totalMinutes)
  }
  return map
})

const todayUtcStart = computed(() => toUtcDayStart(new Date()))

const consistencyWindowDays = computed(() => {
  if (props.quickFilter === 'last30') return 30
  if (props.quickFilter === 'last90') return 90
  if (props.quickFilter === 'thisYear') {
    const jan1 = Date.UTC(new Date().getUTCFullYear(), 0, 1)
    return Math.floor((todayUtcStart.value - jan1) / DAY_MS) + 1
  }
  if (!props.stats?.firstSessionAt) return 0
  const firstDay = toUtcDayStart(new Date(props.stats.firstSessionAt))
  return Math.max(1, Math.floor((todayUtcStart.value - firstDay) / DAY_MS) + 1)
})

const consistencyWindowStart = computed(() => {
  if (consistencyWindowDays.value <= 0) return null
  return todayUtcStart.value - (consistencyWindowDays.value - 1) * DAY_MS
})

const activeDays = computed(() => {
  const windowStart = consistencyWindowStart.value
  if (windowStart == null) return 0
  let count = 0
  for (const row of props.stats?.dailySummary ?? []) {
    const dayStart = parseDayKeyToUtcStart(row.day)
    if (dayStart == null) continue
    if (dayStart < windowStart || dayStart > todayUtcStart.value) continue
    if (row.totalMinutes > 0) count += 1
  }
  return count
})

const consistencyLabel = computed(() => {
  if (consistencyWindowDays.value <= 0) return '-'
  const ratio = Math.round((activeDays.value / consistencyWindowDays.value) * 100)
  return `${activeDays.value}/${consistencyWindowDays.value} (${ratio}%)`
})

const momentum = computed(() => {
  const map = dailyMap.value
  let last7 = 0
  let prev7 = 0
  for (let offset = 0; offset < 7; offset += 1) {
    last7 += map.get(toUtcDayKey(todayUtcStart.value - offset * DAY_MS)) ?? 0
    prev7 += map.get(toUtcDayKey(todayUtcStart.value - (offset + 7) * DAY_MS)) ?? 0
  }

  if (last7 === 0 && prev7 === 0) return { text: '-', tone: 'text-muted-foreground' }
  if (prev7 <= 0) return { text: 'New activity', tone: 'text-green-600' }

  const pct = ((last7 - prev7) / prev7) * 100
  const rounded = Math.round(pct)
  if (rounded > 0) return { text: `+${rounded}%`, tone: 'text-green-600' }
  if (rounded < 0) return { text: `${rounded}%`, tone: 'text-destructive' }
  return { text: '0%', tone: 'text-muted-foreground' }
})

const statCards = computed(() => [
  {
    label: 'Consistency',
    value: consistencyLabel.value,
    tone: 'text-foreground',
  },
  {
    label: 'Active Days',
    value: String(activeDays.value),
    tone: 'text-foreground',
  },
  {
    label: 'Momentum',
    value: momentum.value.text,
    tone: momentum.value.tone,
  },
  {
    label: 'Total Time',
    value: props.stats ? formatDuration(props.stats.totalSeconds) : '0s',
    tone: 'text-foreground',
  },
  {
    label: 'Sessions',
    value: String(props.stats?.totalSessions ?? 0),
    tone: 'text-foreground',
  },
  {
    label: 'Avg Session',
    value: props.stats ? formatDuration(props.stats.avgDurationSeconds) : '0s',
    tone: 'text-foreground',
  },
  {
    label: 'Last Read',
    value: props.stats ? formatRelative(props.stats.lastSessionAt) : '-',
    tone: 'text-foreground',
  },
  {
    label: 'First Read',
    value: props.stats ? formatRelative(props.stats.firstSessionAt) : '-',
    tone: 'text-foreground',
  },
])
</script>

<template>
  <div
    class="grid grid-cols-2 gap-1.5 transition-opacity sm:gap-2 md:grid-cols-8"
    :class="{ 'opacity-50 pointer-events-none': loading && stats !== null }"
  >
    <template v-if="stats === null && loading">
      <div v-for="i in CARD_COUNT" :key="i" :class="CARD_CLASS">
        <div class="h-3 w-16 rounded bg-muted animate-shimmer mb-2" />
        <div class="h-6 w-12 rounded bg-muted animate-shimmer" />
      </div>
    </template>
    <template v-else>
      <div v-for="card in statCards" :key="card.label" data-testid="stat-card" :class="CARD_CLASS">
        <p class="mb-0.5 text-[10px] text-muted-foreground sm:text-[11px]">{{ card.label }}</p>
        <p class="text-base font-semibold sm:text-lg" :class="card.tone">{{ card.value }}</p>
      </div>
    </template>
  </div>
</template>
