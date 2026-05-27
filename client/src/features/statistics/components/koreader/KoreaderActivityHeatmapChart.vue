<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Calendar } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'

import { buildHeatmapPalette } from '../../heatmap-palette'
import { useKoreaderActivityHeatmap } from '../../composables/useKoreaderActivityHeatmap'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MIN_ACTIVE_DAYS = 5
const HEATMAP_DAYS = 364

const themeStore = useThemeStore()
const { data, loading, error } = useKoreaderActivityHeatmap()
const option = shallowRef({})

const activeDays = computed(() => data.value.length)
const isEmpty = computed(() => activeDays.value === 0)
const lowConfidence = computed(() => activeDays.value > 0 && activeDays.value < MIN_ACTIVE_DAYS)

const paletteState = computed(() => ({
  accent: themeStore.accent,
  palette: buildHeatmapPalette({ theme: themeStore.theme, profile: 'github' }),
}))

function buildPieces(scale: string[]) {
  return [
    { value: 0, label: '0m', color: scale[0] },
    { gt: 0, lte: 15, label: '1-15m', color: scale[1] },
    { gt: 15, lte: 30, label: '16-30m', color: scale[2] },
    { gt: 30, lte: 60, label: '31-60m', color: scale[3] },
    { gt: 60, label: '60m+', color: scale[4] },
  ]
}

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  const endDay = new Date()
  endDay.setUTCHours(0, 0, 0, 0)
  const startDay = new Date(endDay)
  startDay.setUTCDate(startDay.getUTCDate() - HEATMAP_DAYS)
  const startDayKey = startDay.toISOString().slice(0, 10)
  const endDayKey = endDay.toISOString().slice(0, 10)

  const palette = paletteState.value.palette
  const byDay = new Map(data.value.map((d) => [d.date, d.durationSeconds]))

  const values: Array<[string, number]> = []
  for (const cursor = new Date(startDay); cursor <= endDay; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10)
    const minutes = Math.round((byDay.get(day) ?? 0) / 60)
    values.push([day, minutes])
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
        return `${day}<br/><strong>${minutes}</strong> min read`
      },
    },
    visualMap: {
      type: 'piecewise',
      show: true,
      dimension: 1,
      pieces: buildPieces(palette.scale),
      orient: 'horizontal',
      left: 'center',
      top: 10,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { color: palette.axisColor, fontSize: 12 },
    },
    calendar: {
      top: 100,
      left: 25,
      right: 0,
      bottom: 20,
      cellSize: ['auto', 13],
      range: [startDayKey, endDayKey],
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
        firstDay: 1,
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
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: values, emphasis: { disabled: true } }],
  }
})
</script>

<template>
  <ChartCard title="Reading Activity Heatmap" :icon="Calendar" :color-index="1" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="Calendar"
      title="Not enough data yet"
      :description="`Need activity on at least ${MIN_ACTIVE_DAYS} days.`"
    />
    <div v-else class="h-full min-h-0 rounded-md px-2 py-2">
      <VChart :option autoresize class="h-full w-full" />
    </div>
  </ChartCard>
</template>
