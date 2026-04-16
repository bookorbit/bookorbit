<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Clock3 } from 'lucide-vue-next'

import { useUserPeakReadingHours } from '../../composables/useUserPeakReadingHours'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MIN_EVENTS = 20

const { data, loading, error } = useUserPeakReadingHours()
const option = shallowRef({})

const totalEvents = computed(() => data.value.reduce((sum, item) => sum + item.eventsCount, 0))
const isEmpty = computed(() => totalEvents.value === 0)
const lowConfidence = computed(() => totalEvents.value > 0 && totalEvents.value < MIN_EVENTS)

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number; dataIndex: number }>) => {
        const point = params[0]
        if (!point) return ''
        const events = data.value[point.dataIndex]?.eventsCount ?? 0
        const readingSeconds = data.value[point.dataIndex]?.readingSeconds ?? 0
        const eventLabel = events === 1 ? 'event' : 'events'
        return `${point.axisValue}<br/><strong>${formatDuration(readingSeconds)}</strong><br/>${events} ${eventLabel}`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '8%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.value.map((item) => `${String(item.hour).padStart(2, '0')}:00`),
      axisTick: { show: false },
      axisLabel: { fontSize: 11, interval: 1 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { fontSize: 11, formatter: '{value}m' },
      name: 'Minutes',
      nameTextStyle: { fontSize: 11, color: 'var(--muted-foreground)' },
    },
    series: [
      {
        type: 'bar',
        data: data.value.map((item) => item.readingSeconds / 60),
        barMaxWidth: 24,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Peak Reading Hours" :icon="Clock3" :color-index="5" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="Clock3"
      title="Not enough data yet"
      :description="`Need at least ${MIN_EVENTS} reading events for this chart.`"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
