<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Timer } from 'lucide-vue-next'

import { useKoreaderSessionLengths } from '../../composables/useKoreaderSessionLengths'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useKoreaderSessionLengths()
const option = shallowRef({})

const isEmpty = computed(() => data.value.every((b) => b.count === 0))

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !data.value.length) return

  const labels = data.value.map((b) => b.label)
  const values = data.value.map((b) => b.count)

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const p = params[0]
        if (!p) return ''
        const label = p.data === 1 ? 'session' : 'sessions'
        return `${p.axisValue}<br/><strong>${p.data}</strong> ${label}`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '8%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [{ type: 'bar', data: values, barMaxWidth: 40 }],
  }
})
</script>

<template>
  <ChartCard title="Session Lengths" :icon="Timer" :color-index="4" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
