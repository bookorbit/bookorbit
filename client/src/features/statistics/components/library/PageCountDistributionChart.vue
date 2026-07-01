<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { BookOpen } from '@lucide/vue'

import { usePageCountDistribution } from '../../composables/usePageCountDistribution'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = usePageCountDistribution()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return

  option.value = {
    tooltip: {
      trigger: 'item',
      formatter: (params: { dataIndex: number }) => {
        const row = data.value.items[params.dataIndex]
        if (!row) return ''
        return [
          `${row.format} (${row.count} books)`,
          `Min: ${row.min}`,
          `Q1: ${Math.round(row.q1)}`,
          `Median: ${Math.round(row.median)}`,
          `Q3: ${Math.round(row.q3)}`,
          `Max: ${row.max}`,
        ].join('<br/>')
      },
    },
    grid: { left: '3%', right: '3%', bottom: '4%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.value.items.map((item) => item.format),
      axisTick: { show: false },
      axisLabel: { fontSize: 11, rotate: 35, interval: 0 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'boxplot',
        data: data.value.items.map((item) => [item.min, item.q1, item.median, item.q3, item.max]),
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.pageCountDistribution.title')"
    :icon="BookOpen"
    :color-index="1"
    :loading
    :error
    :empty="!data.items.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
