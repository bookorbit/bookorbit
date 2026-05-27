<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { BookOpen } from 'lucide-vue-next'

import { useKoreaderTopBooks } from '../../composables/useKoreaderTopBooks'
import ChartCard from '../ChartCard.vue'

const TOP_LIMIT = 20

const { data, loading, error } = useKoreaderTopBooks()
const option = shallowRef({})

const isEmpty = computed(() => data.value.length === 0)

function formatTime(secs: number): string {
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !data.value.length) return

  const top = data.value.slice(0, TOP_LIMIT)
  const labels = top.map((b) => (b.title.length > 30 ? `${b.title.slice(0, 30)}...` : b.title))
  const values = top.map((b) => Math.round(b.totalReadSecs / 60))
  const fullTitles = top.map((b) => b.title)

  option.value = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'none' },
      formatter: (params: Array<{ dataIndex: number; data: number }>) => {
        const p = params[0]
        if (!p) return ''
        return `${fullTitles[p.dataIndex]}<br/><strong>${formatTime(top[p.dataIndex]!.totalReadSecs)}</strong>`
      },
    },
    grid: { left: '3%', right: '8%', bottom: '3%', top: '4%', containLabel: true },
    xAxis: { type: 'value', axisLabel: { fontSize: 11, formatter: (v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`) } },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 }, inverse: true },
    series: [
      {
        type: 'bar',
        data: values,
        label: { show: true, position: 'right', fontSize: 10, formatter: (p: { dataIndex: number }) => formatTime(top[p.dataIndex]!.totalReadSecs) },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Top Books by Reading Time" :icon="BookOpen" :color-index="5" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
