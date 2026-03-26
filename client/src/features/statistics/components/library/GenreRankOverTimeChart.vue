<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Tag } from 'lucide-vue-next'

import { useGenreRankOverTime } from '../../composables/useGenreRankOverTime'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useGenreRankOverTime()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return

  const years = [...new Set(data.value.items.map((item) => item.year))].sort((a, b) => a - b)
  const genres = [...new Set(data.value.items.map((item) => item.genre))]
  const isSingleYear = years.length === 1

  const rankByGenreYear = new Map(data.value.items.map((item) => [`${item.genre}|${item.year}`, item.rank]))
  const countByGenreYear = new Map(data.value.items.map((item) => [`${item.genre}|${item.year}`, item.count]))

  if (isSingleYear) {
    const year = years[0]
    const rows = genres
      .map((genre) => ({
        genre,
        rank: rankByGenreYear.get(`${genre}|${year}`) ?? Number.MAX_SAFE_INTEGER,
        count: countByGenreYear.get(`${genre}|${year}`) ?? 0,
      }))
      .sort((a, b) => a.rank - b.rank)

    option.value = {
      tooltip: {
        trigger: 'axis',
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0]
          if (!p) return ''
          return `${p.name}: <strong>${p.value}</strong> books`
        },
      },
      grid: { left: '3%', right: '3%', bottom: '8%', top: '8%', containLabel: true },
      xAxis: {
        type: 'category',
        data: rows.map((r) => r.genre),
        axisTick: { show: false },
        axisLabel: { fontSize: 11, rotate: 35, interval: 0 },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((r) => r.count),
          barMaxWidth: 38,
          itemStyle: { borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
    return
  }

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { seriesName: string; data: number; axisValue: number }[]) => {
        const rows = params
          .filter((p) => Number.isFinite(p.data))
          .sort((a, b) => a.data - b.data)
          .map((p) => {
            const count = countByGenreYear.get(`${p.seriesName}|${p.axisValue}`) ?? 0
            return `${p.seriesName}: #${p.data} (${count})`
          })
        return `${params[0]?.axisValue ?? ''}<br/>${rows.join('<br/>')}`
      },
    },
    legend: { type: 'scroll', top: 0 },
    grid: { left: '3%', right: '15%', bottom: '6%', top: '16%', containLabel: true },
    xAxis: {
      type: 'category',
      data: years,
      boundaryGap: false,
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      inverse: true,
      min: 1,
      max: genres.length,
      interval: 1,
      axisLabel: { formatter: '#{value}', fontSize: 11 },
    },
    series: genres.map((genre) => ({
      name: genre,
      type: 'line',
      smooth: true,
      showSymbol: true,
      symbolSize: 6,
      endLabel: {
        show: true,
        formatter: genre,
      },
      data: years.map((year) => rankByGenreYear.get(`${genre}|${year}`) ?? null),
      emphasis: { focus: 'series' },
    })),
  }
})
</script>

<template>
  <ChartCard title="Genre Rank Over Time" :icon="Tag" :color-index="8" :loading :error :empty="!data.items.length">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
