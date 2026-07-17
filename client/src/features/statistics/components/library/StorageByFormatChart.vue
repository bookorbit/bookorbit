<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { HardDrive } from '@lucide/vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { formatBytes } from '@/lib/formatting'

import { useStorageByFormat } from '../../composables/useStorageByFormat'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useStorageByFormat()
const { md } = useBreakpoints(breakpointsTailwind)

const option = shallowRef({})

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
    :title="t('statistics.charts.storageByFormat.title')"
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
