<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { ListChecks } from '@lucide/vue'

import { useMetadataCompleteness } from '../../composables/useMetadataCompleteness'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useMetadataCompleteness()
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return
  option.value = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: { name: string; value: number }[]) => {
        const p = params[0]
        if (!p) return ''
        const item = data.value.items.find((i) => i.field === p.name)
        if (!item) return ''
        return `${p.name}: <strong>${p.value}%</strong> (${item.presentCount} / ${item.totalCount})`
      },
    },
    grid: { left: '3%', right: '3%', bottom: '24%', top: '8%', containLabel: false },
    xAxis: {
      type: 'category',
      data: [...data.value.items].reverse().map((d) => d.field),
      axisTick: { show: false },
      axisLabel: {
        fontSize: 11,
        rotate: 45,
        interval: 0,
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { fontSize: 11, formatter: '{value}%' },
    },
    series: [
      {
        type: 'bar',
        data: [...data.value.items].reverse().map((d) => (d.totalCount > 0 ? Math.round((d.presentCount / d.totalCount) * 100) : 0)),
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 40,
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.metadataCompleteness.title')"
    :icon="ListChecks"
    :color-index="7"
    :loading
    :error
    :empty="!data.items.length"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
