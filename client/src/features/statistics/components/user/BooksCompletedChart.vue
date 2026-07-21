<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { BookCheck } from '@lucide/vue'

import { useUserBooksCompleted } from '../../composables/useUserBooksCompleted'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MIN_COMPLETIONS = 2

const { t } = useI18n()

const { data, loading, error } = useUserBooksCompleted()

const totalCompletions = computed(() => data.value.reduce((s, p) => s + p.count, 0))
const isEmpty = computed(() => totalCompletions.value === 0)
const hasEnoughData = computed(() => totalCompletions.value >= MIN_COMPLETIONS)

const option = shallowRef({})

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !hasEnoughData.value || !data.value.length) return

  const labels = data.value.map((p) => `${MONTH_NAMES[p.month - 1]} ${p.year}`)
  let running = 0
  const cumulative = data.value.map((p) => {
    running += p.count
    return running
  })

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const point = params[0]
        if (!point) return ''
        const label = point.data === 1 ? 'book' : 'books'
        return `${point.axisValue}<br/><strong>${point.data}</strong> ${label} completed`
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
        data: cumulative,
        smooth: 0.3,
        showSymbol: false,
        step: false,
        areaStyle: { opacity: 0.15 },
        lineStyle: { width: 2.5 },
      },
    ],
  }
})
</script>

<template>
  <ChartCard :title="t('statistics.charts.booksCompleted.title')" :icon="BookCheck" :color-index="3" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="!hasEnoughData"
      :icon="BookCheck"
      :title="t('statistics.empty.notEnoughData')"
      :description="t('statistics.charts.booksCompleted.notEnoughData', { count: MIN_COMPLETIONS })"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
