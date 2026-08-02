<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import * as echarts from 'echarts'
import { Globe } from '@lucide/vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { api } from '@/lib/api'

import ChartCard from '../ChartCard.vue'

const { t, getLocaleMessage } = useI18n()
const { md } = useBreakpoints(breakpointsTailwind)

const rawItems = ref<Array<Record<string, unknown>>>([])
const isLoading = ref(true)
const hasError = ref(false)
const isMapReady = ref(false)

onMounted(async () => {
  isLoading.value = true
  try {
    const [mapRes, apiRes] = await Promise.all([fetch('/maps/world.json'), api('/api/v1/statistics/country-distribution?libraryIds=1')])

    if (mapRes.ok) {
      const worldJson = await mapRes.json()
      echarts.registerMap('world', worldJson as echarts.GeoJSONSourceInput)
      isMapReady.value = true
    } else {
      hasError.value = true
    }

    if (apiRes.ok) {
      const json = (await apiRes.json()) as Record<string, unknown>
      const items = json.items ?? json.data ?? (Array.isArray(json) ? json : [])
      rawItems.value = items as Array<Record<string, unknown>>
    } else {
      hasError.value = true
    }
  } catch {
    hasError.value = true
  } finally {
    isLoading.value = false
  }
})

const aggregatedItems = computed(() => {
  if (!rawItems.value.length) return []

  return rawItems.value
    .filter((item) => {
      const countryVal = item.country
      const code = typeof countryVal === 'string' ? countryVal.trim() : ''
      return code && code.toLowerCase() !== 'unknown'
    })
    .map((item) => {
      const countryVal = item.country
      const code = typeof countryVal === 'string' ? countryVal.trim().toUpperCase() : ''

      const enMessages = getLocaleMessage('en') as Record<string, Record<string, string>>
      const englishName = enMessages?.countryCodes?.[code] || code

      const localizedName = t(`countryCodes.${code}`, code)

      const countVal = item.count ?? item.value
      const value = typeof countVal === 'number' ? countVal : 0

      return {
        name: englishName,
        value,
        localizedName,
      }
    })
})

const chartOption = computed(() => {
  // Impede que o ECharts processe propriedades vazias prematuramente
  if (!isMapReady.value) return {}

  const maxVal = aggregatedItems.value.length ? Math.max(...aggregatedItems.value.map((d) => d.value), 5) : 5

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: unknown) => {
        const p = params as { name?: string; value?: number }
        const found = aggregatedItems.value.find((a) => a.name === p.name)
        const name = found ? found.localizedName : (p.name ?? '')
        const value = p.value ?? 0
        return `${name}: ${value} books`
      },
    },
    visualMap: {
      min: 0,
      max: maxVal,
      left: md.value ? 'left' : 'center',
      bottom: md.value ? 'bottom' : 0,
      orient: md.value ? 'vertical' : 'horizontal',
      text: [t('common.high', 'High'), t('common.low', 'Low')],
      calculable: true,
      inRange: {
        color: ['#e0f2fe', '#38bdf8', '#0284c7', '#0369a1'],
      },
    },
    series: [
      {
        name: 'Country Distribution',
        type: 'map',
        map: 'world',
        roam: true,
        zoom: 1.25,
        center: [15, 20],
        emphasis: {
          label: {
            show: true,
            formatter: (params: unknown) => {
              const p = params as { name?: string }
              const found = aggregatedItems.value.find((a) => a.name === p.name)
              return found ? found.localizedName : (p.name ?? '')
            },
          },
          itemStyle: {
            areaColor: '#f43f5e',
          },
        },
        data: aggregatedItems.value,
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :color-index="2"
    :empty="false"
    :error="hasError"
    :icon="Globe"
    :loading="isLoading || !isMapReady"
    :title="t('statistics.charts.countryDistribution.title')"
  >
    <!-- O v-if robusto garante que o renderizador canvas só suba com os dados em mãos -->
    <VChart v-if="isMapReady && chartOption.series" :option="chartOption" autoresize style="height: 100%" />
  </ChartCard>
</template>
