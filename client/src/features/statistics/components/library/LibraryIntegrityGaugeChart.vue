<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { ShieldCheck } from '@lucide/vue'

import { readCssColor } from '@/lib/echarts'
import { useLibraryIntegrityGauge } from '../../composables/useLibraryIntegrityGauge'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useLibraryIntegrityGauge()
const option = shallowRef({})

const totalBooks = computed(() => data.value.totalBooks)

const presentPercent = computed(() => (data.value.totalBooks > 0 ? Math.round((data.value.presentCount / data.value.totalBooks) * 100) : 0))
const primaryPercent = computed(() => (data.value.totalBooks > 0 ? Math.round((data.value.primaryFileCount / data.value.totalBooks) * 100) : 0))
const metadataPercent = computed(() => (data.value.totalBooks > 0 ? Math.round((data.value.metadataCount / data.value.totalBooks) * 100) : 0))
const statCards = computed(() => [
  {
    label: 'Present',
    percent: presentPercent.value,
    ratio: `${data.value.presentCount}/${data.value.totalBooks}`,
  },
  {
    label: 'Primary',
    percent: primaryPercent.value,
    ratio: `${data.value.primaryFileCount}/${data.value.totalBooks}`,
  },
  {
    label: 'Metadata',
    percent: metadataPercent.value,
    ratio: `${data.value.metadataCount}/${data.value.totalBooks}`,
  },
])

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
  const activeColor = scoreColor(data.value.integrityScore)

  option.value = {
    tooltip: {
      formatter: () =>
        [
          `<strong>Integrity Score: ${data.value.integrityScore}%</strong>`,
          `Present: ${data.value.presentCount} / ${data.value.totalBooks}`,
          `Primary file: ${data.value.primaryFileCount} / ${data.value.totalBooks}`,
          `Metadata row: ${data.value.metadataCount} / ${data.value.totalBooks}`,
        ].join('<br/>'),
    },
    series: [
      {
        type: 'gauge',
        min: 0,
        max: 100,
        startAngle: 210,
        endAngle: -30,
        center: ['50%', '57%'],
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
        progress: { show: false },
        pointer: { show: true, width: 4, length: '70%', itemStyle: { color: activeColor } },
        axisTick: { show: false },
        splitLine: { distance: -16, length: 6 },
        axisLabel: { distance: -24, fontSize: 10 },
        detail: { valueAnimation: true, formatter: '{value}%', fontSize: 24, fontWeight: 700, color: activeColor, offsetCenter: [0, '22%'] },
        title: { show: true, offsetCenter: [0, '44%'], fontSize: 11, color: foreground },
        data: [{ value: data.value.integrityScore, name: 'Integrity' }],
      },
    ],
  }
})
</script>

<template>
  <ChartCard :title="t('statistics.charts.libraryIntegrity.title')" :icon="ShieldCheck" :color-index="4" :loading :error :empty="totalBooks === 0">
    <div class="flex h-full flex-col">
      <VChart :option="option" autoresize style="height: 76%" />
      <div class="mt-0 grid grid-cols-3 gap-2 px-1">
        <div v-for="card in statCards" :key="card.label" class="bg-muted/40 border-border/60 rounded-md border px-2 py-1 text-center">
          <p class="text-muted-foreground text-[10px] leading-none">{{ card.label }}</p>
          <p class="mt-1 text-sm leading-none font-semibold tabular-nums">{{ card.percent }}%</p>
          <p class="text-muted-foreground mt-0.5 text-[10px] leading-none">{{ card.ratio }}</p>
        </div>
      </div>
    </div>
  </ChartCard>
</template>
