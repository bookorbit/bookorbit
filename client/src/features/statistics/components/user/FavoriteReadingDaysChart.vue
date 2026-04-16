<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { CalendarDays } from 'lucide-vue-next'

import { useUserFavoriteReadingDays } from '../../composables/useUserFavoriteReadingDays'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MIN_EVENTS = 14
const DAYS_WINDOW = 365

const { data, loading, error } = useUserFavoriteReadingDays()
const option = shallowRef({})

const totalEvents = computed(() => data.value.reduce((sum, item) => sum + item.eventsCount, 0))
const isEmpty = computed(() => totalEvents.value === 0)
const lowConfidence = computed(() => totalEvents.value > 0 && totalEvents.value < MIN_EVENTS)

function weekdayOccurrencesInWindow(days: number): number[] {
  const counts = Array.from({ length: 7 }, () => 0)
  const end = new Date()
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - days + 1)
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const dayIndex = cursor.getUTCDay()
    counts[dayIndex] = (counts[dayIndex] ?? 0) + 1
  }
  return counts
}

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.length) return

  const weekdayCounts = weekdayOccurrencesInWindow(DAYS_WINDOW)
  const averageMinutesByDay = data.value.map((item, dayOfWeek) => {
    const denominator = Math.max(1, weekdayCounts[dayOfWeek] ?? 1)
    return Number((item.readingSeconds / 60 / denominator).toFixed(1))
  })

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number; dataIndex: number }>) => {
        const point = params[0]
        if (!point) return ''
        const row = data.value[point.dataIndex]
        if (!row) return ''
        const events = row.eventsCount
        const avgMinuteLabel = point.data === 1 ? 'minute' : 'minutes'
        const totalMinutes = Math.round(row.readingSeconds / 60)
        const totalMinuteLabel = totalMinutes === 1 ? 'minute' : 'minutes'
        const eventLabel = events === 1 ? 'event' : 'events'
        return `${point.axisValue}<br/><strong>${point.data}</strong> avg ${avgMinuteLabel}<br/>${totalMinutes} total ${totalMinuteLabel}<br/>${events} ${eventLabel}`
      },
    },
    grid: { left: '5%', right: '3%', bottom: '8%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: WEEKDAYS,
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: { fontSize: 11, formatter: '{value}m' },
      name: 'Avg min/day',
      nameTextStyle: { fontSize: 11, color: 'var(--muted-foreground)' },
    },
    series: [
      {
        type: 'bar',
        data: averageMinutesByDay,
        barMaxWidth: 30,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Favorite Reading Days" :icon="CalendarDays" :color-index="6" :loading :error :empty="isEmpty">
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="CalendarDays"
      title="Not enough data yet"
      :description="`Need at least ${MIN_EVENTS} reading events for this chart.`"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
