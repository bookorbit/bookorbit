<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { TrendingUp } from '@lucide/vue'

import { useFormatShareOverTime } from '../../composables/useFormatShareOverTime'
import ChartCard from '../ChartCard.vue'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const { t } = useI18n()

const { data, loading, error } = useFormatShareOverTime()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return

  const keys = [...new Set(data.value.items.map((d) => `${d.year}-${String(d.month).padStart(2, '0')}`))].sort()
  const labels = keys.map((k) => {
    const [year, month] = k.split('-')
    return `${MONTH_NAMES[Number(month) - 1]} ${year}`
  })

  const formats = [...new Set(data.value.items.map((d) => d.format))].sort()
  const counts = new Map(data.value.items.map((d) => [`${d.year}-${String(d.month).padStart(2, '0')}|${d.format}`, d.count]))
  const totalsByKey = new Map<string, number>()
  for (const key of keys) totalsByKey.set(key, 0)
  for (const item of data.value.items) {
    const key = `${item.year}-${String(item.month).padStart(2, '0')}`
    totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + item.count)
  }

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { dataIndex: number; marker: string; seriesName: string }[]) => {
        const first = params[0]
        if (!first) return ''
        const dataIndex = first.dataIndex
        const key = keys[dataIndex]
        if (!key) return ''
        const total = totalsByKey.get(key) ?? 0
        const rows = params
          .map((p) => {
            const count = counts.get(`${key}|${p.seriesName}`) ?? 0
            const percent = total > 0 ? (count / total) * 100 : 0
            return { html: `${p.marker}${p.seriesName}: <strong>${percent.toFixed(1)}%</strong> (${count})`, percent }
          })
          .sort((a, b) => b.percent - a.percent)
          .map((r) => r.html)
        return `${labels[dataIndex] ?? key}<br/>${rows.join('<br/>')}`
      },
    },
    legend: { type: 'scroll', top: 0 },
    grid: { left: '3%', right: '3%', bottom: '6%', top: '16%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, rotate: 45, interval: Math.max(0, Math.floor(labels.length / 10) - 1) },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { fontSize: 11, formatter: '{value}%' },
    },
    series: formats.map((format) => ({
      name: format,
      type: 'line',
      stack: 'formats',
      smooth: true,
      showSymbol: false,
      areaStyle: { opacity: 0.8 },
      emphasis: { focus: 'series' },
      data: keys.map((k) => {
        const count = counts.get(`${k}|${format}`) ?? 0
        const total = totalsByKey.get(k) ?? 0
        return total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0
      }),
    })),
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.formatShareOverTime.title')"
    :icon="TrendingUp"
    :color-index="3"
    :loading
    :error
    :empty="!data.items.length"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
