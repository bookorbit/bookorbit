<script setup lang="ts">
import { computed, ref, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Zap } from '@lucide/vue'

import { useThemeStore } from '@/stores/theme'
import { getBreakdownSeries, type BreakdownDimension } from '../../lib/breakdown'
import { useUserReadingPace } from '../../composables/useUserReadingPace'
import BreakdownSelect from '../BreakdownSelect.vue'
import ChartCard from '../ChartCard.vue'
import ChartEmptyState from '../ChartEmptyState.vue'

const MIN_SESSIONS = 10

const themeStore = useThemeStore()
const { data, loading, error } = useUserReadingPace()

const isEmpty = computed(() => data.value.length === 0)
const hasEnoughData = computed(() => data.value.length >= MIN_SESSIONS)

const option = shallowRef({})
const dimension = ref<BreakdownDimension>('source')

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !hasEnoughData.value || !data.value.length) return

  const visible = data.value.filter((p) => p.durationSeconds > 0 && p.durationSeconds <= 14400 && p.progressDelta > 0 && p.progressDelta <= 100)
  const formatKeys = [...new Set(visible.map((p) => p.format))].sort()
  const seriesMeta = getBreakdownSeries(dimension.value, `${themeStore.theme}:${themeStore.accent}`, formatKeys)
  const series = seriesMeta.map((meta) => ({
    type: 'scatter',
    name: meta.label,
    data: visible
      .filter((p) => (dimension.value === 'source' ? p.bucket : p.format) === meta.key)
      .map((p) => [+(p.durationSeconds / 60).toFixed(1), +p.progressDelta.toFixed(2)]),
    symbolSize: 5,
    itemStyle: { color: meta.color, opacity: 0.5 },
  }))

  option.value = {
    legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
    tooltip: {
      trigger: 'item',
      formatter: (params: { seriesName: string; data: [number, number] }) => {
        const [mins, pct] = params.data
        return `${params.seriesName}<br/>${mins} min session<br/><strong>${pct}%</strong> progress made`
      },
    },
    grid: { left: '3%', right: '5%', bottom: '8%', top: 30, containLabel: true },
    xAxis: {
      type: 'value',
      name: 'Duration (min)',
      nameLocation: 'middle',
      nameGap: 28,
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      name: 'Progress %',
      nameLocation: 'middle',
      nameGap: 40,
      axisLabel: { fontSize: 11 },
    },
    series,
  }
})
</script>

<template>
  <ChartCard title="Reading Pace" :icon="Zap" :color-index="2" :loading :error :empty="isEmpty">
    <template #controls>
      <BreakdownSelect v-model="dimension" />
    </template>
    <ChartEmptyState
      v-if="!hasEnoughData"
      :icon="Zap"
      title="Not enough data yet"
      :description="`Need at least ${MIN_SESSIONS} sessions with progress data for this chart.`"
    />
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
