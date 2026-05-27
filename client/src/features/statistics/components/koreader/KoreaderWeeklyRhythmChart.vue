<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Repeat } from 'lucide-vue-next'

import { useKoreaderWeeklyRhythm } from '../../composables/useKoreaderWeeklyRhythm'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useKoreaderWeeklyRhythm()
const option = shallowRef({})

const isEmpty = computed(() => data.value.every((p) => p.durationSeconds === 0))

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !data.value.length) return

  const labels = data.value.map((p) => p.label)
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
        return `${p.axisValue}<br/><strong>${label}</strong> total`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '8%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: { fontSize: 12 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: {
        fontSize: 11,
        formatter: (v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`),
      },
    },
    series: [{ type: 'bar', data: values, barMaxWidth: 40 }],
  }
})
</script>

<template>
  <ChartCard title="Weekly Reading Rhythm" :icon="Repeat" :color-index="7" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
