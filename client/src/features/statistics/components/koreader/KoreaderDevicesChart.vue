<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Tablet } from 'lucide-vue-next'

import { useKoreaderDevices } from '../../composables/useKoreaderDevices'
import ChartCard from '../ChartCard.vue'

const { data, loading, error } = useKoreaderDevices()
const option = shallowRef({})

const isEmpty = computed(() => data.value.length === 0)

watchEffect(() => {
  option.value = {}
  if (isEmpty.value || !data.value.length) return

  option.value = {
    tooltip: {
      trigger: 'item',
      formatter: (params: { name: string; value: number; percent: number }) => {
        const label = params.value === 1 ? 'book' : 'books'
        return `${params.name}<br/><strong>${params.value}</strong> ${label} synced (${params.percent}%)`
      },
    },
    legend: { bottom: 0, left: 'center', textStyle: { fontSize: 11 } },
    series: [
      {
        type: 'pie',
        radius: ['44%', '70%'],
        center: ['50%', '46%'],
        minAngle: 3,
        label: { formatter: '{b}', fontSize: 10 },
        data: data.value.map((item) => ({
          name: item.device,
          value: item.booksTracked,
        })),
      },
    ],
  }
})
</script>

<template>
  <ChartCard title="Synced Books by Device" :icon="Tablet" :color-index="8" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
