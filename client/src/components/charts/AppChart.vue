<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import VChart from 'vue-echarts'
import '@/lib/echarts-setup'
import { useChartTokens } from '@/composables/useChartTokens'
import { buildChartTheme } from '@/lib/chart-theme'

// The only door to echarts: importing it here instead of from the app shell keeps the chart
// library out of the first page load, so it arrives with the first route that draws a chart.
defineOptions({ inheritAttrs: false })

const INIT_OPTIONS = { renderer: 'svg' } as const

const chartTokens = useChartTokens()
const theme = computed(() => buildChartTheme(chartTokens.value))
const chart = useTemplateRef<InstanceType<typeof VChart>>('chart')

defineExpose({
  get instance() {
    return chart.value
  },
})
</script>

<template>
  <VChart ref="chart" :theme :init-options="INIT_OPTIONS" v-bind="$attrs" />
</template>
