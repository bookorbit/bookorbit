<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { CalendarRange } from 'lucide-vue-next'

import { useUserCompletionTimeline } from '../composables/useUserCompletionTimeline'
import ChartCard from './ChartCard.vue'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MIN_COMPLETIONS = 3

const { data, loading, error } = useUserCompletionTimeline()
const option = shallowRef({})

const totalCompletions = computed(() => data.value.reduce((sum, item) => sum + item.count, 0))
const isEmpty = computed(() => totalCompletions.value === 0)
const lowConfidence = computed(() => totalCompletions.value > 0 && totalCompletions.value < MIN_COMPLETIONS)

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  const labels = data.value.map((item) => `${MONTH_NAMES[item.month - 1]} ${item.year}`)
  const values = data.value.map((item) => item.count)

  option.value = {
    tooltip: {
      trigger: 'axis',
      confine: true,
      enterable: false,
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const point = params[0]
        if (!point) return ''
        const bookLabel = point.data === 1 ? 'book' : 'books'
        return `${point.axisValue}<br/><strong>${point.data}</strong> completed ${bookLabel}`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '8%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        rotate: 40,
        interval: Math.max(0, Math.floor(labels.length / 10) - 1),
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'line',
        data: values,
        smooth: 0.2,
        showSymbol: false,
        areaStyle: { opacity: 0.2 },
        lineStyle: { width: 2 },
        cursor: 'default',
        emphasis: { disabled: true },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Completion Timeline" :icon="CalendarRange" :color-index="8" :loading :error :empty="isEmpty">
    <div v-if="lowConfidence" class="text-muted-foreground flex h-full items-center justify-center text-sm">
      Need at least {{ MIN_COMPLETIONS }} completed books for a reliable timeline
    </div>
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
