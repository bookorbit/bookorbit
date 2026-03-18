<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { PieChart } from 'lucide-vue-next'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'

import { useFormatDistribution } from '../composables/useFormatDistribution'
import ChartCard from './ChartCard.vue'

const { data, loading, error } = useFormatDistribution()
const { md } = useBreakpoints(breakpointsTailwind)

const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return
  option.value = {
    tooltip: { trigger: 'item', confine: true, enterable: false },
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
        cursor: 'default',
        label: { show: false },
        emphasis: { disabled: true },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    title="Format Distribution"
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
