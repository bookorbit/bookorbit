<script setup lang="ts">
import { computed, shallowRef, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import * as echarts from 'echarts'
import { Globe } from '@lucide/vue'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { api } from '@/lib/api'
import worldJson from '../../../../public/maps/world.json'

import ChartCard from '../ChartCard.vue'

const { t, getLocaleMessage } = useI18n()
const { md } = useBreakpoints(breakpointsTailwind)

const rawItems = ref<Array<Record<string, unknown>>>([])
const isLoading = ref(true)
const hasError = ref(false)

// Registra o mapa imediatamente de forma síncrona
try {
  if (worldJson) {
    echarts.registerMap('world', worldJson as echarts.GeoJSONSourceInput)
  }
} catch {
  hasError.value = true
}

const option = shallowRef({})

onMounted(async () => {
  isLoading.value = true
  try {
    const endpoint = '/api/v1/statistics/country-distribution?libraryIds=1'
    const res = await api(endpoint)

    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>
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

computed(() => {
  const maxVal = aggregatedItems.value.length ? Math.max(...aggregatedItems.value.map((d) => d.value), 5) : 5

  option.value = {
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
}).value
</script>

<template>
  <ChartCard
    :color-index="2"
    :empty="false"
    :error="hasError"
    :icon="Globe"
    :loading="isLoading"
    :title="t('statistics.charts.countryDistribution.title')"
  >
    <VChart :option="option" autoresize style="height: 100%" />
  </ChartCard>
</template>
