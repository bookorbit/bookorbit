<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Users } from '@lucide/vue'

import { useThemeStore } from '@/stores/theme'
import { getThemePalette, readCssColor } from '@/lib/echarts'
import { useTopAuthors } from '../../composables/useTopAuthors'
import ChartCard from '../ChartCard.vue'

const themeStore = useThemeStore()
const { t } = useI18n()

const { data, loading, error } = useTopAuthors()
const option = shallowRef({})

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

watchEffect(() => {
  if (!data.value.items.length) return

  const items = [...data.value.items].sort((a, b) => b.count - a.count)
  const total = items.reduce((s, d) => s + d.count, 0)

  let running = 0
  const cumulativePct = items.map((d) => {
    running += d.count
    return parseFloat(((running / total) * 100).toFixed(1))
  })

  const palette = getThemePalette(themeStore.theme, themeStore.accent)
  const primary = palette[0] ?? '#6b7280'
  const mutedColor = readCssColor('--muted-foreground')

  const barColors = items.map((_, i) => {
    if (i < 3) return primary
    if (i < 10) return withAlpha(primary, 0.65)
    return withAlpha(primary, 0.35)
  })

  option.value = {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'none' },
      formatter: (params: { seriesType: string; name: string; value: number }[]) => {
        const bar = params.find((p) => p.seriesType === 'bar')
        if (!bar) return ''
        const pct = total > 0 ? ((bar.value / total) * 100).toFixed(1) : '0'
        return `<strong>${bar.name}</strong><br/>${bar.value} books &nbsp;&nbsp; ${pct}% of top 25`
      },
    },
    legend: {
      data: ['Books', 'Cumulative %'],
      top: 0,
      right: 0,
      textStyle: { fontSize: 10 },
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: { left: 2, right: 55, bottom: 6, top: 26, containLabel: true },
    xAxis: [
      {
        type: 'value',
        minInterval: 1,
        axisLabel: { fontSize: 11 },
        splitLine: { lineStyle: { opacity: 0.4 } },
      },
      {
        type: 'value',
        position: 'top',
        min: 0,
        max: 100,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
        splitLine: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
      },
    ],
    yAxis: {
      type: 'category',
      data: items.map((d) => d.name),
      inverse: true,
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        overflow: 'truncate',
        width: 130,
      },
    },
    series: [
      {
        name: 'Books',
        type: 'bar',
        xAxisIndex: 0,
        data: items.map((d, i) => ({
          value: d.count,
          itemStyle: { color: barColors[i], borderRadius: [0, 3, 3, 0] },
        })),
        barMaxWidth: 22,
        label: {
          show: true,
          position: 'right',
          fontSize: 10,
          formatter: (p: { value: number }) => `${p.value}`,
        },
      },
      {
        name: 'Cumulative %',
        type: 'line',
        xAxisIndex: 1,
        data: cumulativePct,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: mutedColor, width: 1.5 },
        itemStyle: { color: mutedColor },
      },
    ],
  }
})
</script>

<template>
  <ChartCard :title="t('statistics.charts.topAuthors.title')" :icon="Users" :color-index="6" :loading :error :empty="!data.items.length">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
