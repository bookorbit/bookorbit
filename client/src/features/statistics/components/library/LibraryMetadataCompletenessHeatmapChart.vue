<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { ListChecks } from '@lucide/vue'
import { useThemeStore } from '@/stores/theme'

import { buildHeatmapPalette } from '@/lib/heatmap-palette'
import { useLibraryMetadataCompleteness } from '../../composables/useLibraryMetadataCompleteness'
import ChartCard from '../ChartCard.vue'

const FIELD_ORDER = [
  'Title',
  'Cover',
  'Author',
  'Genres',
  'Tags',
  'Description',
  'Publisher',
  'Year',
  'Language',
  'Page Count',
  'Rating',
  'Series',
  'ISBN',
]

const themeStore = useThemeStore()
const { data, loading, error } = useLibraryMetadataCompleteness()
const option = shallowRef({})
const heatmapPaletteState = computed(() => ({
  accent: themeStore.accent,
  palette: buildHeatmapPalette({ theme: themeStore.theme }),
}))

watchEffect(() => {
  if (!data.value.items.length) return

  const libraries = [...new Set(data.value.items.map((item) => item.libraryName))]
  const fields = FIELD_ORDER.filter((field) => data.value.items.some((item) => item.field === field))

  const points = data.value.items.map((item) => {
    const x = fields.indexOf(item.field)
    const y = libraries.indexOf(item.libraryName)
    return [x, y, item.percent, item.presentCount, item.totalCount]
  })
  const palette = heatmapPaletteState.value.palette
  const labelColor = themeStore.theme === 'dark' ? '#f8fafc' : '#0f172a'
  const pieces = [
    { value: 0, color: palette.scale[0] },
    { gt: 0, lte: 25, color: palette.scale[1] },
    { gt: 25, lte: 50, color: palette.scale[2] },
    { gt: 50, lte: 75, color: palette.scale[3] },
    { gt: 75, color: palette.scale[4] },
  ]

  option.value = {
    tooltip: {
      appendToBody: true,
      backgroundColor: palette.tooltipBackground,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: palette.tooltipText, fontSize: 12 },
      formatter: (params: { value: [number, number, number, number, number] }) => {
        const [x, y, pct, present, total] = params.value
        return `${libraries[y]}<br/>${fields[x]}: <strong>${pct}%</strong> (${present}/${total})`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '6%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: fields,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, rotate: 35, interval: 0, color: palette.axisColor },
    },
    yAxis: {
      type: 'category',
      data: libraries,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, color: palette.axisColor },
    },
    visualMap: {
      type: 'piecewise',
      show: false,
      calculable: false,
      dimension: 2,
      pieces,
    },
    series: [
      {
        type: 'heatmap',
        data: points,
        encode: { x: 0, y: 1, value: 2, tooltip: [2, 3, 4] },
        label: {
          show: true,
          formatter: (params: { value: [number, number, number] }) => `${params.value[2]}%`,
          color: labelColor,
          fontSize: 11,
          fontWeight: 500,
        },
        itemStyle: {
          borderColor: palette.borderColor,
          borderWidth: 0.8,
        },
        emphasis: { disabled: true },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Library Metadata Completeness" :icon="ListChecks" :color-index="7" :loading :error :empty="!data.items.length">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
