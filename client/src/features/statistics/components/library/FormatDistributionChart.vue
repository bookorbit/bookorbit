<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { PieChart } from '@lucide/vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'

import { useFormatDistribution } from '../../composables/useFormatDistribution'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useFormatDistribution()
const { md } = useBreakpoints(breakpointsTailwind)

const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return
  option.value = {
    tooltip: { trigger: 'item' },
    legend: {
      orient: md.value ? 'vertical' : 'horizontal',
      right: md.value ? '2%' : 'auto',
      bottom: md.value ? 'auto' : 0,
      top: md.value ? 'middle' : 'auto',
    },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        center: md.value ? ['38%', '50%'] : ['50%', '44%'],
        data: data.value.items.map((item) => ({ name: item.format.toUpperCase(), value: item.count })),
        label: { show: false },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.formatDistribution.title')"
    :icon="PieChart"
    :color-index="1"
    :loading
    :error
    :empty="!data.items.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
