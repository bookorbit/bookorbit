<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { HardDrive } from 'lucide-vue-next'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'

import { useStorageByFormat } from '../../composables/useStorageByFormat'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useStorageByFormat()
const { md } = useBreakpoints(breakpointsTailwind)

const option = shallowRef({})

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

watchEffect(() => {
  if (!data.value.items.length) return
  option.value = {
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number; percent: number }) => `${params.name}: ${formatBytes(params.value)} (${params.percent}%)`,
    },
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
        data: data.value.items.map((item) => ({ name: item.format.toUpperCase(), value: item.sizeBytes })),
        label: { show: false },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    title="Storage by Format"
    :icon="HardDrive"
    :color-index="4"
    :loading
    :error
    :empty="!data.items.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
