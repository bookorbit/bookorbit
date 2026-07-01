<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { BarChart3 } from '@lucide/vue'

import { useMetadataScoreDistribution } from '../../composables/useMetadataScoreDistribution'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useMetadataScoreDistribution()
const option = shallowRef({})

function percentileToIndex(value: number | null): number | null {
  if (value == null) return null
  return Math.max(0, Math.min(9, Math.floor(value / 10)))
}

watchEffect(() => {
  if (!data.value.bins.length) return

  const p25Index = percentileToIndex(data.value.percentile25)
  const p50Index = percentileToIndex(data.value.percentile50)
  const p75Index = percentileToIndex(data.value.percentile75)
  const p90Index = percentileToIndex(data.value.percentile90)

  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ''
        return `${p.name}: <strong>${p.value}</strong> books`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '8%', top: '6%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.value.bins.map((b) => `${b.minScore}-${b.maxScore}`),
      axisTick: { show: false },
      axisLabel: { fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { fontSize: 11 },
    },
    series: [
      {
        type: 'bar',
        data: data.value.bins.map((b) => b.count),
        barMaxWidth: 44,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        markArea:
          p25Index != null && p75Index != null
            ? {
                itemStyle: { color: 'rgba(128, 128, 128, 0.12)' },
                data: [[{ xAxis: p25Index }, { xAxis: p75Index }]],
              }
            : undefined,
        markLine: {
          symbol: ['none', 'none'],
          lineStyle: { type: 'dashed' },
          label: { show: true, formatter: '{b}', position: 'insideEndTop' },
          data: [...(p50Index != null ? [{ xAxis: p50Index, name: 'P50' }] : []), ...(p90Index != null ? [{ xAxis: p90Index, name: 'P90' }] : [])],
        },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.metadataScoreDistribution.title')"
    :icon="BarChart3"
    :color-index="2"
    :loading
    :error
    :empty="!data.bins.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
