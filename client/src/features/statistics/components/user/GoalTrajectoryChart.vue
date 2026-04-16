<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Goal } from 'lucide-vue-next'

import { useUserGoalTrajectory } from '../../composables/useUserGoalTrajectory'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MIN_COMPLETIONS = 2

const { data, loading, error } = useUserGoalTrajectory()
const option = shallowRef({})

const totalActual = computed(() => data.value.points[data.value.points.length - 1]?.actualCumulative ?? 0)
const isEmpty = computed(() => data.value.points.length === 0)
const lowConfidence = computed(() => totalActual.value > 0 && totalActual.value < MIN_COMPLETIONS)
const noCompletionsYet = computed(() => !isEmpty.value && totalActual.value === 0)

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || noCompletionsYet.value || !data.value.points.length) return

  const labels = data.value.points.map((item) => `${MONTH_NAMES[item.month - 1]} ${item.year}`)

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ seriesName: string; data: number; axisValue: string }>) => {
        const lines = params.map((item) => `${item.seriesName}: <strong>${item.data}</strong>`)
        return `${params[0]?.axisValue ?? ''}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { top: 0 },
    grid: { left: '3%', right: '3%', bottom: '8%', top: '16%', containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      boundaryGap: false,
      axisTick: { show: false },
      axisLabel: { fontSize: 11, rotate: 35, interval: Math.max(0, Math.floor(labels.length / 10) - 1) },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        name: 'Actual',
        type: 'line',
        data: data.value.points.map((item) => item.actualCumulative),
        smooth: 0.2,
        showSymbol: true,
        symbolSize: 5,
        lineStyle: { width: 2.5 },
        areaStyle: { opacity: 0.15 },
      },
      {
        name: `Goal (${data.value.goalBooks}/yr)`,
        type: 'line',
        data: data.value.points.map((item) => item.targetCumulative),
        smooth: 0.2,
        showSymbol: true,
        symbolSize: 5,
        lineStyle: { width: 2, type: 'dashed' },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Pace vs Goal" :icon="Goal" :color-index="9" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="noCompletionsYet"
      :icon="Goal"
      title="No completed books yet"
      description="Complete a book in this period to compare your pace against your yearly goal."
    />
    <ChartEmptyState
      v-else-if="lowConfidence"
      :icon="Goal"
      title="Not enough data yet"
      :description="`Need at least ${MIN_COMPLETIONS} completed books for this chart.`"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
