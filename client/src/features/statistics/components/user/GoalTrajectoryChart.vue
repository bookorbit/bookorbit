<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Goal } from '@lucide/vue'

import { useUserGoalTrajectory } from '../../composables/useUserGoalTrajectory'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MIN_COMPLETIONS = 2

const { t } = useI18n()

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
  <ChartCard :title="t('statistics.charts.goalTrajectory.title')" :icon="Goal" :color-index="9" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="noCompletionsYet"
      :icon="Goal"
      :title="t('statistics.charts.goalTrajectory.noCompletedTitle')"
      :description="t('statistics.charts.goalTrajectory.noCompletedDescription')"
    />
    <ChartEmptyState
      v-else-if="lowConfidence"
      :icon="Goal"
      :title="t('statistics.empty.notEnoughData')"
      :description="t('statistics.charts.goalTrajectory.notEnoughData', { count: MIN_COMPLETIONS })"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
