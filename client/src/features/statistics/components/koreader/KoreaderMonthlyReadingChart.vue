<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { BarChart2 } from 'lucide-vue-next'

import { useKoreaderMonthlyReading } from '../../composables/useKoreaderMonthlyReading'
import ChartCard from '../ChartCard.vue'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const { data, loading, error } = useKoreaderMonthlyReading()
const option = shallowRef({})

const isEmpty = computed(() => data.value.every((p) => p.durationSeconds === 0))

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !data.value.length) return

  const labels = data.value.map((p) => `${MONTH_NAMES[p.month - 1]} ${String(p.year).slice(-2)}`)
  const values = data.value.map((p) => Math.round(p.durationSeconds / 60))

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const p = params[0]
        if (!p) return ''
        const h = Math.floor(p.data / 60)
        const m = p.data % 60
        const label = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`
        return `${p.axisValue}<br/><strong>${label}</strong> read`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '12%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: { fontSize: 10, rotate: 40, interval: 0 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: {
        fontSize: 11,
        formatter: (v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`),
      },
    },
    series: [{ type: 'bar', data: values, barMaxWidth: 28 }],
  }
})
</script>

<template>
  <ChartCard title="Monthly Reading Time" :icon="BarChart2" :color-index="2" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
