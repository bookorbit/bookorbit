<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { MonitorSmartphone } from '@lucide/vue'
import { READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'

import { useThemeStore } from '@/stores/theme'
import { resolveSourceBucketColors } from '../../lib/source-bucket-colors'
import { useUserReadingSourceDistribution } from '../../composables/useUserReadingSourceDistribution'
import ChartCard from '../ChartCard.vue'

const themeStore = useThemeStore()
const { data, loading, error } = useUserReadingSourceDistribution()
const { md } = useBreakpoints(breakpointsTailwind)

const isEmpty = computed(() => data.value.slices.length === 0)

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${mins}m`
  if (mins > 0) return `${mins}m`
  return `${total}s`
}

const option = shallowRef({})

watchEffect(() => {
  option.value = {}
  if (isEmpty.value) return

  const colors = resolveSourceBucketColors(`${themeStore.theme}:${themeStore.accent}`)

  option.value = {
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: (p: { name: string; value: number; percent: number; color: string }) =>
        `<div style="font-size:12px;line-height:1.5">` +
        `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.name}` +
        `<div><span style="font-weight:600">${formatDuration(p.value)}</span> · ${p.percent}%</div></div>`,
    },
    legend: {
      orient: md.value ? 'vertical' : 'horizontal',
      right: md.value ? '2%' : 'auto',
      bottom: md.value ? 'auto' : 0,
      top: md.value ? 'middle' : 'auto',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['45%', '72%'],
        center: md.value ? ['38%', '50%'] : ['50%', '44%'],
        data: data.value.slices.map((slice) => ({
          name: READING_SESSION_SOURCE_BUCKET_LABELS[slice.bucket],
          value: slice.readingSeconds,
          itemStyle: { color: colors[slice.bucket] },
        })),
        label: { show: false },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    title="Where You Read"
    :icon="MonitorSmartphone"
    :color-index="6"
    :loading
    :error
    :empty="isEmpty"
    empty-title="No reading activity yet"
    empty-description="Read on the web, KOReader, or Kobo to see your source split."
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
