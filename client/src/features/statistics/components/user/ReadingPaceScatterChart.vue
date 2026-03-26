<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Zap } from 'lucide-vue-next'

import { useUserReadingPace } from '../../composables/useUserReadingPace'
import ChartCard from '../ChartCard.vue'

const MIN_SESSIONS = 10

const { data, loading, error } = useUserReadingPace()

const isEmpty = computed(() => data.value.length === 0)
const hasEnoughData = computed(() => data.value.length >= MIN_SESSIONS)

const option = shallowRef({})

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !hasEnoughData.value || !data.value.length) return

  const points = data.value
    .filter((p) => p.durationSeconds > 0 && p.durationSeconds <= 14400 && p.progressDelta > 0 && p.progressDelta <= 100)
    .map((p) => [+(p.durationSeconds / 60).toFixed(1), +p.progressDelta.toFixed(2)])

  option.value = {
    tooltip: {
      trigger: 'item',
      formatter: (params: { data: [number, number] }) => {
        const [mins, pct] = params.data
        return `${mins} min session<br/><strong>${pct}%</strong> progress made`
      },
    },
    grid: { left: '3%', right: '5%', bottom: '8%', top: '6%', containLabel: true },
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
    series: [
      {
        type: 'scatter',
        data: points,
        symbolSize: 5,
        itemStyle: { opacity: 0.45 },
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Reading Pace" :icon="Zap" :color-index="2" :loading :error :empty="isEmpty">
    <div v-if="!hasEnoughData" class="text-muted-foreground flex h-full items-center justify-center text-sm">
      Need at least {{ MIN_SESSIONS }} sessions with progress data
    </div>
    <VChart v-else :option autoresize style="height: 100%" />
  </ChartCard>
</template>
