<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import VChart from 'vue-echarts'
import { CalendarRange } from '@lucide/vue'

import { useUserCompletionTimeline } from '../../composables/useUserCompletionTimeline'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'
import { historyRouteForChartClick } from '@/features/reading-history/lib/chart-month-link'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MIN_COMPLETIONS = 3

const { t } = useI18n()
const router = useRouter()
const chartRef = ref<InstanceType<typeof VChart> | null>(null)

const { data, loading, error } = useUserCompletionTimeline()
const option = shallowRef({})

/** A month on the chart opens History on the reads behind it. */
function handleChartClick(event: { offsetX: number; offsetY: number }) {
  const route = historyRouteForChartClick(chartRef.value, event, data.value)
  if (route) void router.push(route)
}

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
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const point = params[0]
        if (!point) return ''
        const bookLabel = point.data === 1 ? 'book' : 'books'
        return `${point.axisValue}<br/><strong>${point.data}</strong> completed ${bookLabel}<br/><span style="color:var(--muted-foreground)">${t('readingHistory.links.chartHint')}</span>`
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
      },
    ],
  }
})
</script>

<template>
  <ChartCard :title="t('statistics.charts.completionTimeline.title')" :icon="CalendarRange" :color-index="8" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="CalendarRange"
      :title="t('statistics.empty.notEnoughData')"
      :description="t('statistics.charts.completionTimeline.notEnoughData', { count: MIN_COMPLETIONS })"
    />
    <VChart v-else ref="chartRef" :option autoresize class="cursor-pointer" style="height: 100%" @zr:click="handleChartClick" />
  </ChartCard>
</template>
