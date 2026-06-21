<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Calendar } from '@lucide/vue'
import { READING_SESSION_SOURCE_BUCKETS, READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'

import { buildHeatmapPalette } from '@/lib/heatmap-palette'
import { useUserReadingHeatmap } from '../../composables/useUserReadingHeatmap'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MIN_ACTIVE_DAYS = 5

const themeStore = useThemeStore()
const { data, loading, error } = useUserReadingHeatmap()
const option = shallowRef({})

const totalEvents = computed(() => data.value.reduce((sum, item) => sum + item.eventsCount, 0))
const activeDays = computed(() => data.value.filter((item) => item.eventsCount > 0).length)
const isEmpty = computed(() => totalEvents.value === 0)
const lowConfidence = computed(() => totalEvents.value > 0 && activeDays.value < MIN_ACTIVE_DAYS)
const heatmapPaletteState = computed(() => ({
  accent: themeStore.accent,
  palette: buildHeatmapPalette({ theme: themeStore.theme, profile: 'github' }),
}))

function buildContributionPieces(scale: string[]) {
  // Fixed bins (minutes/day) for stronger, stable contrast across datasets.
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
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  const now = new Date()
  const year = now.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const yearEnd = new Date(Date.UTC(year, 11, 31))
  const yearStartKey = yearStart.toISOString().slice(0, 10)
  const yearEndKey = yearEnd.toISOString().slice(0, 10)

  const palette = heatmapPaletteState.value.palette

  const byDay = new Map(data.value.map((item) => [item.day, item]))
  const values: Array<readonly [string, number, number]> = []
  for (const cursor = new Date(yearStart); cursor <= yearEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10)
    const item = byDay.get(day)
    values.push([day, Number(((item?.readingSeconds ?? 0) / 60).toFixed(1)), item?.eventsCount ?? 0] as const)
  }
  const pieces = buildContributionPieces(palette.scale)

  option.value = {
    tooltip: {
      appendToBody: true,
      backgroundColor: palette.tooltipBackground,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (params: { value: [string, number, number] }) => {
        const [day, minutes, events] = params.value
        const minuteLabel = minutes === 1 ? 'minute' : 'minutes'
        const eventLabel = events === 1 ? 'event' : 'events'
        const bySource = byDay.get(day)?.bySource
        const sourceRows = bySource
          ? READING_SESSION_SOURCE_BUCKETS.filter((bucket) => (bySource[bucket] ?? 0) > 0)
              .map((bucket) => `${READING_SESSION_SOURCE_BUCKET_LABELS[bucket]}: ${Math.round((bySource[bucket] ?? 0) / 60)}m`)
              .join('<br/>')
          : ''
        const base = `${day}<br/><strong>${minutes}</strong> ${minuteLabel}<br/>${events} ${eventLabel}`
        return sourceRows ? `${base}<br/>${sourceRows}` : base
      },
    },
    visualMap: {
      type: 'piecewise',
      show: true,
      calculable: false,
      dimension: 1,
      pieces,
      orient: 'horizontal',
      left: 'center',
      top: 10,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 8,
      textStyle: {
        color: palette.axisColor,
        fontSize: 12,
      },
    },
    calendar: {
      top: 100,
      left: 25,
      right: 0,
      bottom: 20,
      cellSize: ['auto', 13],
      range: [yearStartKey, yearEndKey],
      yearLabel: { show: false },
      splitLine: { show: false },
      monthLabel: {
        show: true,
        fontSize: 11,
        color: palette.axisColor,
        margin: 10,
        nameMap: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      },
      dayLabel: {
        show: true,
        firstDay: 0,
        fontSize: 10,
        color: palette.axisColor,
        margin: 8,
        nameMap: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
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
  <ChartCard title="Reading Heatmap" :icon="Calendar" :color-index="4" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="Calendar"
      title="Not enough data yet"
      :description="`Need activity on at least ${MIN_ACTIVE_DAYS} days for this chart.`"
    />
    <div v-else class="h-full min-h-0 rounded-md px-2 py-2">
      <VChart :option autoresize class="h-full w-full" />
    </div>
  </ChartCard>
</template>
