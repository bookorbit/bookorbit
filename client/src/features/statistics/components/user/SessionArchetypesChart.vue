<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Layers } from '@lucide/vue'

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

const { t } = useI18n()

const { data, loading, error } = useUserSessionArchetypes()
const option = shallowRef({})

const isEmpty = () => data.value.length === 0

function formatHourLabel(hour: number, includeMinutes = false): string {
  if (!Number.isFinite(hour)) return ''
  const totalMinutes = Math.round(hour * 60)
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440
  const hour24 = Math.floor(normalizedMinutes / 60)
  const minute = normalizedMinutes % 60
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  const period = hour24 < 12 ? 'am' : 'pm'

  if (!includeMinutes || minute === 0) return `${hour12}${period}`
  return `${hour12}:${String(minute).padStart(2, '0')}${period}`
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return ''
  const roundedMinutes = Math.round(minutes)
  return `${roundedMinutes} ${roundedMinutes === 1 ? 'min' : 'mins'}`
}

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
        formatter: (v: number) => formatHourLabel(v),
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
        return `<strong>${params.seriesName} at ${formatHourLabel(hour, true)}</strong><br/>${formatDuration(mins)}`
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
  <ChartCard :title="t('statistics.charts.sessionArchetypes.title')" :icon="Layers" :color-index="8" :loading :error :empty="isEmpty()">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
