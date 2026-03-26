<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Calendar } from 'lucide-vue-next'
import { useThemeStore } from '@/stores/theme'

import { buildHeatmapPalette } from '../../heatmap-palette'
import { useUserReadingHeatmap } from '../../composables/useUserReadingHeatmap'
import ChartCard from '../ChartCard.vue'

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
const legendSwatches = computed(() => {
  return heatmapPaletteState.value.palette.scale
})

function buildContributionPieces(scale: string[]) {
  // Fixed bins (minutes/day) for stronger, stable contrast across datasets.
  const b1 = 15
  const b2 = 30
  const b3 = 60
  return [
    { value: 0, color: scale[0] },
    { gt: 0, lte: b1, color: scale[1] },
    { gt: b1, lte: b2, color: scale[2] },
    { gt: b2, lte: b3, color: scale[3] },
    { gt: b3, color: scale[4] },
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
        return `${day}<br/><strong>${minutes}</strong> ${minuteLabel}<br/>${events} ${eventLabel}`
      },
    },
    visualMap: {
      type: 'piecewise',
      show: false,
      calculable: false,
      dimension: 1,
      pieces,
    },
    calendar: {
      top: 40,
      left: 32,
      right: 12,
      bottom: 20,
      cellSize: ['auto', 12],
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
        firstDay: 1,
        fontSize: 10,
        color: palette.axisColor,
        margin: 10,
        nameMap: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
      },
      itemStyle: {
        color: 'transparent',
        borderWidth: 0.8,
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
    <div v-if="lowConfidence" class="text-muted-foreground flex h-full items-center justify-center text-sm">
      Need activity on at least {{ MIN_ACTIVE_DAYS }} days to show a reliable pattern
    </div>
    <div v-else class="flex h-full min-h-0 flex-col">
      <div class="min-h-0 flex-1 rounded-md px-2 py-3">
        <VChart :option autoresize class="h-full w-full" />
      </div>
      <div class="text-muted-foreground mt-2 flex items-center justify-center gap-2 text-xs">
        <span>Less</span>
        <div class="flex items-center gap-1" aria-hidden="true">
          <span
            v-for="(swatch, idx) in legendSwatches"
            :key="idx"
            class="border-border/60 inline-block size-2.5 rounded-[3px] border"
            :style="{ backgroundColor: swatch }"
          />
        </div>
        <span>More</span>
      </div>
    </div>
  </ChartCard>
</template>
