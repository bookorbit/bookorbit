<script setup lang="ts">
import { computed, onMounted, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { useThemeStore } from '@/stores/theme'
import { getBookorbitThemeName, initChartThemes } from '@/lib/echarts'

const props = defineProps<{
  dailySummary: { day: string; durationSeconds: number }[]
  loading: boolean
}>()

const themeStore = useThemeStore()
const chartTheme = computed(() => getBookorbitThemeName(themeStore.theme, themeStore.accent))
const hasData = computed(() => props.dailySummary.length > 0)
const option = shallowRef({})

onMounted(() => initChartThemes())

watchEffect(() => {
  if (!hasData.value) return

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ''
        const minutes = Math.round(p.value / 60)
        return `${p.name}: <strong>${minutes} min</strong>`
      },
    },
    grid: { left: '2%', right: '2%', top: '6%', bottom: '12%', containLabel: true },
    xAxis: {
      type: 'category',
      data: props.dailySummary.map((d) => d.day),
      axisTick: { show: false },
      axisLabel: {
        fontSize: 10,
        interval: Math.max(0, Math.floor(props.dailySummary.length / 6) - 1),
        formatter: (val: string) => val.slice(5),
      },
    },
    yAxis: {
      type: 'value',
      minInterval: 60,
      axisLabel: { fontSize: 10, formatter: (v: number) => `${Math.round(v / 60)}m` },
    },
    series: [
      {
        type: 'bar',
        data: props.dailySummary.map((d) => d.durationSeconds),
        barMaxWidth: 12,
        itemStyle: { borderRadius: [2, 2, 0, 0] },
      },
    ],
  }
})
</script>

<template>
  <div>
    <div v-if="loading && !hasData" class="h-36 rounded-lg bg-muted animate-shimmer sm:h-40" />
    <div v-else-if="hasData" class="h-36 w-full sm:h-40">
      <VChart :option="option" :theme="chartTheme" autoresize class="h-full w-full" />
    </div>
  </div>
</template>
