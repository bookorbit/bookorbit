<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Tag } from 'lucide-vue-next'

import { useGenreDistribution } from '../../composables/useGenreDistribution'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useGenreDistribution()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return
  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ''
        return `${p.name}: <strong>${p.value}</strong> books`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '28%', top: '8%', containLabel: false },
    xAxis: {
      type: 'category',
      data: data.value.items.map((d) => d.genre),
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        rotate: 45,
        interval: 0,
        overflow: 'truncate',
        width: 80,
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        data: data.value.items.map((d) => d.count),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 32,
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Genre Distribution" :icon="Tag" :color-index="8" :loading :error :empty="!data.items.length" :unknown-count="data.unknownCount">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
