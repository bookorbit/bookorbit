<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Users } from 'lucide-vue-next'

import { useTopAuthors } from '../../composables/useTopAuthors'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useTopAuthors()
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
      data: data.value.items.map((d) => d.name),
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
  <ChartCard title="Top 25 Authors" :icon="Users" :color-index="6" :loading :error :empty="!data.items.length">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
