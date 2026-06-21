<script setup lang="ts">
import { computed, onMounted, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { TrendingUp } from '@lucide/vue'
import type { BookReadingSessionStats } from '@bookorbit/types'
import { useThemeStore } from '@/stores/theme'
import { getBookorbitThemeName, initChartThemes } from '@/lib/echarts'

const props = defineProps<{
  stats: BookReadingSessionStats | null
  loading: boolean
}>()

const themeStore = useThemeStore()
const chartTheme = computed(() => getBookorbitThemeName(themeStore.theme, themeStore.accent))
const option = shallowRef({})

onMounted(() => initChartThemes())

const hasData = computed(() => {
  const stats = props.stats
  if (!stats) return false
  return stats.progressSummary.length > 0 || stats.dailySummary.length > 0
})

watchEffect(() => {
  const stats = props.stats
  if (!stats || !hasData.value) {
    option.value = {}
    return
  }

  const progressPoints = stats.progressSummary.map((p) => [p.day, p.endProgress])
  const minutesBars = stats.dailySummary.map((d) => [d.day, d.totalMinutes])

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { seriesName: string; value: [string, number] }[]) => {
        if (!params.length) return ''
        const day = params[0]!.value[0]
        const lines = params.map((p) =>
          p.seriesName === 'Progress' ? `Progress: <strong>${p.value[1].toFixed(1)}%</strong>` : `Reading: <strong>${p.value[1]} min</strong>`,
        )
        return [day, ...lines].join('<br/>')
      },
    },
    grid: { left: '2%', right: '2%', top: '8%', bottom: '6%', containLabel: true },
    xAxis: {
      type: 'time',
      axisTick: { show: false },
      axisLabel: { fontSize: 10 },
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        max: 100,
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v}%` },
      },
      {
        type: 'value',
        minInterval: 1,
        splitLine: { show: false },
        axisLabel: { fontSize: 10, formatter: (v: number) => `${v}m` },
      },
    ],
    series: [
      {
        name: 'Reading',
        type: 'bar',
        yAxisIndex: 1,
        data: minutesBars,
        barMaxWidth: 10,
        itemStyle: { borderRadius: [2, 2, 0, 0], opacity: 0.45 },
      },
      {
        name: 'Progress',
        type: 'line',
        yAxisIndex: 0,
        data: progressPoints,
        showSymbol: progressPoints.length <= 30,
        symbolSize: 5,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.12 },
        z: 3,
      },
    ],
  }
})
</script>

<template>
  <div class="flex h-full flex-col rounded-lg border border-border bg-card p-3 sm:p-4">
    <div class="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
      <TrendingUp class="size-4 text-muted-foreground" />
      Progress journey
    </div>
    <div v-if="hasData" class="relative min-h-0 flex-1 transition-opacity" :class="{ 'opacity-50': loading }" style="min-height: 220px">
      <VChart :theme="chartTheme" :option autoresize class="absolute inset-0" />
    </div>
    <div v-else class="flex flex-1 items-center justify-center py-12 text-sm text-muted-foreground" style="min-height: 220px">
      No progress data in this window.
    </div>
  </div>
</template>
