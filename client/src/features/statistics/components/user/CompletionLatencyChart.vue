<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Rabbit } from 'lucide-vue-next'

import { useUserCompletionLatency } from '../../composables/useUserCompletionLatency'
import ChartCard from '../ChartCard.vue'

const MIN_COMPLETIONS = 5

const { data, loading, error } = useUserCompletionLatency()
const option = shallowRef({})

const isEmpty = computed(() => data.value.totalCompletions === 0)
const lowConfidence = computed(() => data.value.totalCompletions > 0 && data.value.totalCompletions < MIN_COMPLETIONS)

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || lowConfidence.value || !data.value.buckets.length) return

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{ axisValue: string; data: number }>) => {
        const point = params[0]
        if (!point) return ''
        const label = point.data === 1 ? 'book' : 'books'
        return `${point.axisValue}: <strong>${point.data}</strong> ${label}`
      },
    },
    grid: { left: '4%', right: '3%', bottom: '8%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.value.buckets.map((bucket) => bucket.label),
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        data: data.value.buckets.map((bucket) => bucket.count),
        barMaxWidth: 28,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
      },
    ],
  }
})

function metric(value: number | null): string {
  return value == null ? '-' : `${value}d`
}
</script>

<template>
  <ChartCard title="Completion Latency" :icon="Rabbit" :color-index="2" :loading :error :empty="isEmpty">
    <div v-if="lowConfidence" class="text-muted-foreground flex h-full items-center justify-center text-sm">
      Need at least {{ MIN_COMPLETIONS }} completions for reliable latency insights
    </div>
    <div v-else class="flex h-full flex-col gap-3">
      <div class="text-muted-foreground grid grid-cols-3 gap-2 text-xs">
        <div class="rounded-md border px-2 py-1">
          Median
          <div class="text-foreground text-sm font-semibold">{{ metric(data.medianDays) }}</div>
        </div>
        <div class="rounded-md border px-2 py-1">
          P75
          <div class="text-foreground text-sm font-semibold">{{ metric(data.percentile75Days) }}</div>
        </div>
        <div class="rounded-md border px-2 py-1">
          P90
          <div class="text-foreground text-sm font-semibold">{{ metric(data.percentile90Days) }}</div>
        </div>
      </div>
      <VChart :option autoresize style="height: 100%" />
    </div>
  </ChartCard>
</template>
