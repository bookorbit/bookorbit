<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { ListChecks } from 'lucide-vue-next'

import { useLibraryMetadataCompleteness } from '../composables/useLibraryMetadataCompleteness'
import ChartCard from './ChartCard.vue'

const FIELD_ORDER = ['Cover', 'Author', 'Description', 'Publisher', 'Year', 'Language', 'Page Count', 'Rating', 'Series', 'ISBN']

const { data, loading, error } = useLibraryMetadataCompleteness()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return

  const libraries = [...new Set(data.value.items.map((item) => item.libraryName))]
  const fields = FIELD_ORDER.filter((field) => data.value.items.some((item) => item.field === field))

  const points = data.value.items.map((item) => {
    const x = fields.indexOf(item.field)
    const y = libraries.indexOf(item.libraryName)
    return [x, y, item.percent, item.presentCount, item.totalCount]
  })

  option.value = {
    tooltip: {
      confine: true,
      enterable: false,
      formatter: (params: { value: [number, number, number, number, number] }) => {
        const [x, y, pct, present, total] = params.value
        return `${libraries[y]}<br/>${fields[x]}: <strong>${pct}%</strong> (${present}/${total})`
      },
    },
    grid: { left: '3%', right: '8%', bottom: '6%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: fields,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, rotate: 35, interval: 0 },
    },
    yAxis: {
      type: 'category',
      data: libraries,
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    visualMap: {
      dimension: 2,
      min: 0,
      max: 100,
      orient: 'vertical',
      right: 0,
      top: 'middle',
      calculable: false,
      inRange: { color: ['#334155', '#475569', '#64748b', '#93c5fd', '#2563eb'] },
      text: ['100%', '0%'],
    },
    series: [
      {
        type: 'heatmap',
        data: points,
        encode: { x: 0, y: 1, value: 2, tooltip: [2, 3, 4] },
        label: {
          show: true,
          formatter: (params: { value: [number, number, number] }) => `${params.value[2]}%`,
          color: '#f8fafc',
          fontSize: 11,
          fontWeight: 600,
        },
        itemStyle: {
          borderColor: 'rgba(15, 23, 42, 0.7)',
          borderWidth: 1,
        },
        emphasis: { disabled: true },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Library Metadata Completeness" :icon="ListChecks" :color-index="7" :loading :error :empty="!data.items.length" tall>
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
