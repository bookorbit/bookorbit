<script setup lang="ts">
import { shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Globe } from '@lucide/vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'

import { useLanguageDistribution } from '../../composables/useLanguageDistribution'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useLanguageDistribution()
const { md } = useBreakpoints(breakpointsTailwind)

const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return
  option.value = {
    tooltip: { trigger: 'item' },
    legend: {
      type: 'scroll',
      orient: md.value ? 'vertical' : 'horizontal',
      left: md.value ? '56%' : 'center',
      right: md.value ? 0 : 'auto',
      top: md.value ? 8 : 'auto',
      bottom: md.value ? 8 : 0,
      itemWidth: 12,
      itemHeight: 8,
      pageIconSize: 10,
      pageButtonGap: 4,
    },
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: md.value ? ['27%', '50%'] : ['50%', '38%'],
        data: data.value.items.map((item) => ({ name: item.language.toUpperCase(), value: item.count })),
        label: { show: false },
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.languageDistribution.title')"
    :icon="Globe"
    :color-index="2"
    :loading
    :error
    :empty="!data.items.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
