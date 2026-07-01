<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { CalendarDays } from '@lucide/vue'

import { usePublicationDecade } from '../../composables/usePublicationDecade'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = usePublicationDecade()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return
  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ''
        return `${p.name}: <strong>${p.value}</strong> books`
      },
    },
    grid: { left: '3%', right: '4%', bottom: '12%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.value.items.map((d) => `${d.decade}s`),
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
        data: data.value.items.map((d) => d.count),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 48,
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.publicationDecade.title')"
    :icon="CalendarDays"
    :color-index="5"
    :loading
    :error
    :empty="!data.items.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
