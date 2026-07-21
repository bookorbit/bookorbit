<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Gauge } from '@lucide/vue'

import { readCssColor } from '@/lib/echarts'
import { useMetadataFreshnessGauge } from '../../composables/useMetadataFreshnessGauge'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useMetadataFreshnessGauge()
const option = shallowRef({})

const totalBooks = computed(() => data.value.totalBooks)
const statCards = computed(() => {
  const total = totalBooks.value
  const percent = (count: number) => (total > 0 ? `${Math.round((count / total) * 100)}%` : '0%')

  return [
    { label: 'Total', value: data.value.totalBooks, sub: 'Books' },
    { label: 'Fresh ≤30d', value: data.value.fresh30dCount, sub: percent(data.value.fresh30dCount) },
    { label: 'Never fetched', value: data.value.neverFetchedCount, sub: percent(data.value.neverFetchedCount) },
  ]
})

function scoreColor(score: number): string {
  if (score < 20) return '#ef4444'
  if (score < 40) return '#f97316'
  if (score < 60) return '#eab308'
  if (score < 80) return '#22c55e'
  return '#3b82f6'
}

watchEffect(() => {
  if (data.value.totalBooks === 0) {
    option.value = {}
    return
  }
  const foreground = readCssColor('--foreground')
  const activeColor = scoreColor(data.value.freshnessScore)

  option.value = {
    tooltip: {
      formatter: () =>
        [
          `<strong>Freshness Score: ${data.value.freshnessScore}%</strong>`,
          `<=30d: ${data.value.fresh30dCount}`,
          `31-90d: ${data.value.stale31To90dCount}`,
          `91-180d: ${data.value.stale91To180dCount}`,
          `>180d: ${data.value.staleOver180dCount}`,
          `Never fetched: ${data.value.neverFetchedCount}`,
        ].join('<br/>'),
    },
    series: [
      {
        type: 'gauge',
        min: 0,
        max: 100,
        startAngle: 210,
        endAngle: -30,
        center: ['50%', '58%'],
        radius: '95%',
        splitNumber: 5,
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [0.2, '#ef4444'],
              [0.4, '#f97316'],
              [0.6, '#eab308'],
              [0.8, '#22c55e'],
              [1, '#3b82f6'],
            ],
          },
        },
        // Keep the 5-band ramp visible; progress overlay picks theme primary color.
        progress: { show: false },
        pointer: { show: true, width: 4, length: '70%', itemStyle: { color: activeColor } },
        axisTick: { show: false },
        splitLine: { distance: -16, length: 6 },
        axisLabel: { distance: -24, fontSize: 10 },
        detail: { valueAnimation: true, formatter: '{value}%', fontSize: 24, fontWeight: 700, color: activeColor, offsetCenter: [0, '22%'] },
        title: { show: true, offsetCenter: [0, '44%'], fontSize: 11, color: foreground },
        data: [{ value: data.value.freshnessScore, name: 'Freshness' }],
      },
    ],
  }
})
</script>

<template>
  <ChartCard :title="t('statistics.charts.metadataFreshness.title')" :icon="Gauge" :color-index="2" :loading :error :empty="totalBooks === 0">
    <div class="flex h-full flex-col">
      <VChart :option="option" autoresize style="height: 76%" />
      <div class="mt-0 grid grid-cols-3 gap-2 px-1">
        <div v-for="card in statCards" :key="card.label" class="bg-muted/40 border-border/60 rounded-md border px-2 py-1 text-center">
          <p class="text-muted-foreground text-[10px] leading-none">{{ card.label }}</p>
          <p class="mt-1 text-sm leading-none font-semibold tabular-nums">{{ card.value }}</p>
          <p class="text-muted-foreground text-[10px] leading-none">{{ card.sub }}</p>
        </div>
      </div>
    </div>
  </ChartCard>
</template>
