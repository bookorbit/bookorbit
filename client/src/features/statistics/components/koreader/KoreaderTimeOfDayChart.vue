<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Sun } from 'lucide-vue-next'

import { useKoreaderTimeOfDay } from '../../composables/useKoreaderTimeOfDay'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useKoreaderTimeOfDay()
const option = shallowRef({})

const isEmpty = computed(() => data.value.every((p) => p.durationSeconds === 0))

function hourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !data.value.length) return

  const labels = data.value.map((p) => hourLabel(p.hour))
  const values = data.value.map((p) => Math.round(p.durationSeconds / 60))

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const p = params[0]
        if (!p) return ''
        return `${p.axisValue}<br/><strong>${p.data}m</strong> read`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '12%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: { fontSize: 10, rotate: 45, interval: 2 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: {
        fontSize: 11,
        formatter: (v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`),
      },
    },
    series: [{ type: 'bar', data: values, barMaxWidth: 20 }],
  }
})
</script>

<template>
  <ChartCard title="Time of Day" :icon="Sun" :color-index="3" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
