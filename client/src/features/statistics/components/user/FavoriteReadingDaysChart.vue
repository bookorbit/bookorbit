<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { CalendarDays } from '@lucide/vue'
import type { ReadingSessionSourceBucket } from '@bookorbit/types'

import { useThemeStore } from '@/stores/theme'
import { getBreakdownSeries, type BreakdownDimension } from '../../lib/breakdown'
import { useUserFavoriteReadingDays } from '../../composables/useUserFavoriteReadingDays'
import BreakdownSelect from '../BreakdownSelect.vue'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MIN_EVENTS = 14
const DAYS_WINDOW = 365

const themeStore = useThemeStore()
const { data, loading, error } = useUserFavoriteReadingDays()
const option = shallowRef({})

const totalEvents = computed(() => data.value.reduce((sum, item) => sum + item.eventsCount, 0))
const isEmpty = computed(() => totalEvents.value === 0)
const lowConfidence = computed(() => totalEvents.value > 0 && totalEvents.value < MIN_EVENTS)
const dimension = ref<BreakdownDimension>('source')

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
  const denominatorFor = (dayOfWeek: number) => Math.max(1, weekdayCounts[dayOfWeek] ?? 1)
  const formatKeys = [...new Set(data.value.flatMap((item) => Object.keys(item.byFormat)))].sort()
  const seriesMeta = getBreakdownSeries(dimension.value, `${themeStore.theme}:${themeStore.accent}`, formatKeys)

  const series = seriesMeta.map((meta) => ({
    type: 'bar',
    name: meta.label,
    stack: 'days',
    data: data.value.map((item, dayOfWeek) => {
      const seconds = (dimension.value === 'source' ? item.bySource?.[meta.key as ReadingSessionSourceBucket] : item.byFormat?.[meta.key]) ?? 0
      return Number((seconds / 60 / denominatorFor(dayOfWeek)).toFixed(1))
    }),
    barMaxWidth: 30,
    itemStyle: { color: meta.color },
  }))

  option.value = {
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number; dataIndex: number; seriesName: string; marker: string }>) => {
        const first = params[0]
        if (!first) return ''
        const row = data.value[first.dataIndex]
        if (!row) return ''
        const events = row.eventsCount
        const avgTotal = Number(params.reduce((sum, p) => sum + (p.data ?? 0), 0).toFixed(1))
        const avgMinuteLabel = avgTotal === 1 ? 'minute' : 'minutes'
        const totalMinutes = Math.round(row.readingSeconds / 60)
        const totalMinuteLabel = totalMinutes === 1 ? 'minute' : 'minutes'
        const eventLabel = events === 1 ? 'event' : 'events'
        const header = `${first.axisValue}<br/><strong>${avgTotal}</strong> avg ${avgMinuteLabel}<br/>${totalMinutes} total ${totalMinuteLabel}<br/>${events} ${eventLabel}`
        const rows = params
          .filter((p) => p.data > 0)
          .map((p) => `${p.marker} ${p.seriesName}: ${p.data} avg min`)
          .join('<br/>')
        return rows ? `${header}<br/>${rows}` : header
      },
    },
    grid: { left: '5%', right: '3%', bottom: 36, top: '8%', containLabel: true },
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
    series,
  }
})
</script>

<template>
  <ChartCard title="Favorite Reading Days" :icon="CalendarDays" :color-index="6" :loading :error :empty="isEmpty">
    <template #controls>
      <BreakdownSelect v-model="dimension" />
    </template>
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="CalendarDays"
      title="Not enough data yet"
      :description="`Need at least ${MIN_EVENTS} reading events for this chart.`"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
