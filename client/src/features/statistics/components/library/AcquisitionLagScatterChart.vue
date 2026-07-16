<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { CalendarRange } from '@lucide/vue'

import type { AcquisitionLagPoint } from '@bookorbit/types'
import { useAcquisitionLagScatter } from '../../composables/useAcquisitionLagScatter'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useAcquisitionLagScatter()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) {
    option.value = {}
    return
  }

  const maxCount = Math.max(...data.value.items.map((item) => item.count))
  const publishedYears = data.value.items.map((item) => item.addedYear - item.lagYears)
  const minYear = Math.min(...publishedYears)
  const maxYear = Math.max(...publishedYears)
  const minLag = Math.min(...data.value.items.map((item) => item.lagYears))
  const maxLag = Math.max(...data.value.items.map((item) => item.lagYears))

  const points = data.value.items.map((item: AcquisitionLagPoint) => [item.addedYear - item.lagYears, item.lagYears, item.count, item.addedYear])

  option.value = {
    tooltip: {
      formatter: (params: { value: [number, number, number, number] }) => {
        const [publishedYear, lagYears, count, addedYear] = params.value
        return `Published ${publishedYear}<br/>Added ${addedYear}<br/>Lag: <strong>${lagYears}</strong> years<br/>Books: <strong>${count}</strong>`
      },
    },
    grid: { left: '5%', right: '4%', top: '10%', bottom: '16%', containLabel: true },
    xAxis: {
      type: 'value',
      min: minYear,
      max: maxYear,
      axisLabel: { fontSize: 10, formatter: (value: number) => String(Math.round(value)) },
      splitNumber: 4,
      name: 'Published',
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      min: Math.min(-5, minLag),
      max: Math.max(30, maxLag),
      axisLabel: { fontSize: 10 },
      name: 'Lag (y)',
      nameLocation: 'middle',
      nameGap: 34,
      nameTextStyle: { fontSize: 10 },
    },
    visualMap: {
      show: false,
      min: minLag,
      max: maxLag,
      dimension: 1,
      inRange: { color: ['#22c55e', '#eab308', '#f97316', '#ef4444'] },
    },
    series: [
      {
        type: 'scatter',
        data: points,
        symbolSize: (value: number[]) => {
          const count = value[2] ?? 1
          const ratio = maxCount > 0 ? count / maxCount : 0
          return 6 + ratio * 14
        },
        itemStyle: { opacity: 0.82 },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.acquisitionLag.title')"
    :icon="CalendarRange"
    :color-index="6"
    :loading
    :error
    :empty="!data.items.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option="option" autoresize style="height: 100%" />
  </ChartCard>
</template>
