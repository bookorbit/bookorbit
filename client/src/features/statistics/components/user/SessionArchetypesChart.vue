<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Layers } from 'lucide-vue-next'

import { useUserSessionArchetypes } from '../../composables/useUserSessionArchetypes'
import ChartCard from '../ChartCard.vue'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const DAY_COLORS = [
  '#f97316', // Sun
  '#3b82f6', // Mon
  '#22c55e', // Tue
  '#a855f7', // Wed
  '#ec4899', // Thu
  '#eab308', // Fri
  '#06b6d4', // Sat
]

const { data, loading, error } = useUserSessionArchetypes()
const option = shallowRef({})

const isEmpty = () => data.value.length === 0

watchEffect(() => {
  option.value = {}
  if (!data.value.length) return

  const seriesByDay = DAY_NAMES.map((name, dow) => ({
    name,
    type: 'scatter',
    data: data.value.filter((d) => d.dayOfWeek === dow).map((d) => [d.hour, d.durationMinutes]),
    itemStyle: { color: DAY_COLORS[dow], opacity: 0.7 },
    symbolSize: 6,
  }))

  option.value = {
    grid: { top: 24, right: 16, bottom: 40, left: 52 },
    xAxis: {
      type: 'value',
      min: 0,
      max: 23,
      interval: 3,
      axisLabel: {
        fontSize: 11,
        formatter: (v: number) => {
          if (v === 0) return '12am'
          if (v < 12) return `${v}am`
          if (v === 12) return '12pm'
          return `${v - 12}pm`
        },
      },
    },
    yAxis: {
      type: 'value',
      name: 'Duration (min)',
      nameLocation: 'middle',
      nameGap: 40,
      axisLabel: { fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: { seriesName: string; data: [number, number] }) => {
        const hour = params.data[0]
        const mins = params.data[1]
        const label = hour === 0 ? '12am' : hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`
        return `<strong>${params.seriesName} at ${label}</strong><br/>${mins} min`
      },
    },
    legend: {
      data: DAY_NAMES,
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 11 },
    },
    series: seriesByDay,
  }
})
</script>

<template>
  <ChartCard title="Session Archetypes" :icon="Layers" :color-index="8" :loading :error :empty="isEmpty()">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
