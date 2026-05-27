<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Highlighter } from 'lucide-vue-next'

import { useKoreaderTopAnnotated } from '../../composables/useKoreaderTopAnnotated'
import ChartCard from '../ChartCard.vue'

const TOP_LIMIT = 20

const { data, loading, error } = useKoreaderTopAnnotated()
const option = shallowRef({})

const isEmpty = computed(() => data.value.length === 0)

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !data.value.length) return

  const top = data.value.slice(0, TOP_LIMIT)
  const labels = top.map((b) => (b.title.length > 30 ? `${b.title.slice(0, 30)}...` : b.title))
  const highlights = top.map((b) => b.highlightsCount)
  const notes = top.map((b) => b.notesCount)
  const fullTitles = top.map((b) => b.title)

  option.value = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'none' },
      formatter: (params: Array<{ seriesName: string; dataIndex: number; data: number }>) => {
        const i = params[0]?.dataIndex ?? 0
        return `${fullTitles[i]}<br/>${highlights[i]} highlights, ${notes[i]} notes`
      },
    },
    legend: { data: ['Highlights', 'Notes'], top: 0, textStyle: { fontSize: 11 } },
    grid: { left: '3%', right: '8%', bottom: '3%', top: '28px', containLabel: true },
    xAxis: { type: 'value', axisLabel: { fontSize: 11 }, minInterval: 1 },
    yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 11 }, inverse: true },
    series: [
      { name: 'Highlights', type: 'bar', stack: 'total', data: highlights },
      { name: 'Notes', type: 'bar', stack: 'total', data: notes },
    ],
  }
})
</script>

<template>
  <ChartCard title="Most Annotated Books" :icon="Highlighter" :color-index="6" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
