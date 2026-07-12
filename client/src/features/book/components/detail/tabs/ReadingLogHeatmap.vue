<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { CalendarDays } from '@lucide/vue'
import type { BookReadingSessionStats } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'
import { buildHeatmapPalette } from '@/lib/heatmap-palette'

const props = withDefaults(
  defineProps<{
    stats: BookReadingSessionStats | null
    loading: boolean
    quickFilter: 'all' | 'last30' | 'last90' | 'thisYear'
    embedded?: boolean
  }>(),
  { embedded: false },
)

const { t } = useI18n()

const DAY_MS = 24 * 60 * 60 * 1000
const dayLabels = computed(
  () =>
    [
      t('book.detail.readingLog.weekdays.sun'),
      t('book.detail.readingLog.weekdays.mon'),
      t('book.detail.readingLog.weekdays.tue'),
      t('book.detail.readingLog.weekdays.wed'),
      t('book.detail.readingLog.weekdays.thu'),
      t('book.detail.readingLog.weekdays.fri'),
      t('book.detail.readingLog.weekdays.sat'),
    ] as const,
)
const monthLabels = computed(() => [
  t('book.detail.readingLog.months.jan'),
  t('book.detail.readingLog.months.feb'),
  t('book.detail.readingLog.months.mar'),
  t('book.detail.readingLog.months.apr'),
  t('book.detail.readingLog.months.may'),
  t('book.detail.readingLog.months.jun'),
  t('book.detail.readingLog.months.jul'),
  t('book.detail.readingLog.months.aug'),
  t('book.detail.readingLog.months.sep'),
  t('book.detail.readingLog.months.oct'),
  t('book.detail.readingLog.months.nov'),
  t('book.detail.readingLog.months.dec'),
])

const themeStore = useThemeStore()
const option = shallowRef({})

function toUtcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function parseDayKeyToUtcStart(dayKey: string): number | null {
  const [yy, mm, dd] = dayKey.split('-').map(Number)
  if (!yy || !mm || !dd) return null
  return Date.UTC(yy, mm - 1, dd)
}

const todayUtcStart = computed(() => toUtcDayStart(new Date()))

const rangeStart = computed(() => {
  const rangeEnd = todayUtcStart.value
  if (props.quickFilter === 'last30') return rangeEnd - 29 * DAY_MS
  if (props.quickFilter === 'last90') return rangeEnd - 89 * DAY_MS
  if (props.quickFilter === 'thisYear') return Date.UTC(new Date().getUTCFullYear(), 0, 1)
  return rangeEnd - 364 * DAY_MS
})

const consistencyWindowDays = computed(() => Math.floor((todayUtcStart.value - rangeStart.value) / DAY_MS) + 1)

const rangeLabel = computed(() => {
  if (props.quickFilter === 'last30') return 'last 30 days'
  if (props.quickFilter === 'last90') return 'last 90 days'
  if (props.quickFilter === 'thisYear') return 'this year'
  return 'last 12 months'
})

const activeDays = computed(() => {
  if (consistencyWindowDays.value <= 0) return 0
  const windowStart = todayUtcStart.value - (consistencyWindowDays.value - 1) * DAY_MS
  let count = 0
  for (const row of props.stats?.dailySummary ?? []) {
    const dayStart = parseDayKeyToUtcStart(row.day)
    if (dayStart == null) continue
    if (dayStart < windowStart || dayStart > todayUtcStart.value) continue
    if (row.totalMinutes > 0) count += 1
  }
  return count
})

const subtitle = computed(() => {
  if (consistencyWindowDays.value <= 0) return ''
  const ratio = Math.round((activeDays.value / consistencyWindowDays.value) * 100)
  const dayWord = activeDays.value === 1 ? 'day' : 'days'
  return `${activeDays.value} active ${dayWord} · ${ratio}% of ${rangeLabel.value}`
})

const hasData = computed(() => (props.stats?.dailySummary ?? []).some((row) => row.totalMinutes > 0))

function buildContributionPieces(scale: string[]) {
  const b1 = 15
  const b2 = 30
  const b3 = 60
  return [
    { value: 0, label: '0m', color: scale[0] },
    { gt: 0, lte: b1, label: `1-${b1}m`, color: scale[1] },
    { gt: b1, lte: b2, label: `${b1 + 1}-${b2}m`, color: scale[2] },
    { gt: b2, lte: b3, label: `${b2 + 1}-${b3}m`, color: scale[3] },
    { gt: b3, label: `${b3}m+`, color: scale[4] },
  ]
}

watchEffect(() => {
  option.value = {}
  if (!hasData.value) return

  const palette = buildHeatmapPalette({ theme: themeStore.theme, profile: 'github' })
  // Touching accent makes this effect re-run when the palette source changes.
  void themeStore.accent

  const rangeEnd = todayUtcStart.value
  const rangeStartValue = rangeStart.value
  const rangeStartKey = new Date(rangeStartValue).toISOString().slice(0, 10)
  const rangeEndKey = new Date(rangeEnd).toISOString().slice(0, 10)

  const byDay = new Map((props.stats?.dailySummary ?? []).map((row) => [row.day, row.totalMinutes]))
  const values: Array<readonly [string, number]> = []
  for (let cursor = rangeStartValue; cursor <= rangeEnd; cursor += DAY_MS) {
    const day = new Date(cursor).toISOString().slice(0, 10)
    values.push([day, byDay.get(day) ?? 0] as const)
  }

  option.value = {
    tooltip: {
      appendToBody: true,
      backgroundColor: palette.tooltipBackground,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (params: { value: [string, number] }) => {
        const [day, minutes] = params.value
        return `${day}<br/><strong>${minutes}</strong> ${t('book.detail.readingLog.heatmap.minutesUnit')}`
      },
    },
    visualMap: {
      type: 'piecewise',
      show: true,
      calculable: false,
      dimension: 1,
      pieces: buildContributionPieces(palette.scale),
      orient: 'horizontal',
      left: 'center',
      top: 0,
      itemWidth: 9,
      itemHeight: 9,
      itemGap: 6,
      textStyle: { color: palette.axisColor, fontSize: 10 },
    },
    calendar: {
      top: 50,
      left: 34,
      right: 4,
      bottom: 4,
      cellSize: ['auto', 'auto'],
      range: [rangeStartKey, rangeEndKey],
      yearLabel: { show: false },
      splitLine: { show: false },
      monthLabel: {
        show: true,
        fontSize: 9,
        color: palette.axisColor,
        margin: 6,
        nameMap: monthLabels.value,
      },
      dayLabel: {
        show: true,
        firstDay: 1,
        fontSize: 8,
        color: palette.axisColor,
        margin: 6,
        nameMap: dayLabels.value,
      },
      itemStyle: {
        color: 'transparent',
        borderWidth: 0.5,
        borderColor: palette.borderColor,
        borderRadius: 1,
      },
    },
    series: [
      {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: values,
        emphasis: { disabled: true },
      },
    ],
  }
})
</script>

<template>
  <section
    :class="['flex h-full flex-col', embedded ? '' : 'rounded-xl border border-border bg-card p-4 shadow-[var(--elevation-xs)]']"
    aria-labelledby="reading-activity-heading"
  >
    <div class="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span class="flex items-center gap-2 text-sm font-semibold text-foreground">
        <CalendarDays class="size-4 text-muted-foreground" />
        <span id="reading-activity-heading">{{ t('book.detail.readingLog.heatmap.title') }}</span>
      </span>
      <span v-if="subtitle" class="text-xs text-muted-foreground">{{ subtitle }}</span>
    </div>
    <div v-if="hasData" class="relative min-h-0 flex-1 transition-opacity" :class="{ 'opacity-50': loading }" style="min-height: 228px">
      <VChart :option autoresize class="absolute inset-0" />
    </div>
    <div v-else class="flex flex-1 flex-col items-center justify-center py-10 text-center" style="min-height: 228px">
      <p class="text-sm font-medium text-foreground">{{ t('book.detail.readingLog.heatmap.empty') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.readingLog.heatmap.emptyHint') }}</p>
    </div>
  </section>
</template>
