<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Clock3 } from '@lucide/vue'
import type { ReadingSessionSourceBucket } from '@bookorbit/types'

import { useThemeStore } from '@/stores/theme'
import { getBreakdownSeries, type BreakdownDimension } from '../../lib/breakdown'
import { useUserPeakReadingHours } from '../../composables/useUserPeakReadingHours'
import BreakdownSelect from '../BreakdownSelect.vue'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MIN_EVENTS = 20

const themeStore = useThemeStore()
const { data, loading, error } = useUserPeakReadingHours()
const option = shallowRef({})
const dimension = ref<BreakdownDimension>('source')

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

  const formatKeys = [...new Set(data.value.flatMap((item) => Object.keys(item.byFormat)))].sort()
  const seriesMeta = getBreakdownSeries(dimension.value, `${themeStore.theme}:${themeStore.accent}`, formatKeys)
  const series = seriesMeta.map((meta) => ({
    type: 'bar',
    name: meta.label,
    stack: 'hours',
    data: data.value.map(
      (item) => ((dimension.value === 'source' ? item.bySource?.[meta.key as ReadingSessionSourceBucket] : item.byFormat?.[meta.key]) ?? 0) / 60,
    ),
    barMaxWidth: 24,
    itemStyle: { color: meta.color },
  }))

  option.value = {
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number; dataIndex: number; seriesName: string; marker: string }>) => {
        const first = params[0]
        if (!first) return ''
        const item = data.value[first.dataIndex]
        const events = item?.eventsCount ?? 0
        const readingSeconds = item?.readingSeconds ?? 0
        const eventLabel = events === 1 ? 'event' : 'events'
        const header = `${first.axisValue}<br/><strong>${formatDuration(readingSeconds)}</strong> · ${events} ${eventLabel}`
        const rows = params
          .filter((p) => p.data > 0)
          .map((p) => `${p.marker} ${p.seriesName}: ${formatDuration(p.data * 60)}`)
          .join('<br/>')
        return rows ? `${header}<br/>${rows}` : header
      },
    },
    grid: { left: '3%', right: '3%', bottom: 36, top: '8%', containLabel: true },
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
    series,
  }
})
</script>

<template>
  <ChartCard title="Peak Reading Hours" :icon="Clock3" :color-index="5" :loading :error :empty="isEmpty">
    <template #controls>
      <BreakdownSelect v-model="dimension" />
    </template>
    <ChartEmptyState
      v-if="lowConfidence"
      :icon="Clock3"
      title="Not enough data yet"
      :description="`Need at least ${MIN_EVENTS} reading events for this chart.`"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
