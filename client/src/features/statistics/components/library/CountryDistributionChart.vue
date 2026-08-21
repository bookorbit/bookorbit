<script setup lang="ts">
import { computed, ref, onMounted, onActivated, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import * as echarts from 'echarts'
import { Globe } from '@lucide/vue'
import { breakpointsTailwind, useBreakpoints, useMutationObserver } from '@vueuse/core'
import { api } from '@/lib/api'
import { ECHARTS_COUNTRY_MAP } from '@/lib/country-map'

import ChartCard from '../ChartCard.vue'

const { t } = useI18n()
const { md } = useBreakpoints(breakpointsTailwind)
const route = useRoute()

const rawItems = ref<Array<Record<string, unknown>>>([])
const isLoading = ref(true)
const hasError = ref(false)
const isMapReady = ref(false)

// Estado do filtro
const statusFilter = ref('all')

const chartWrapper = ref<HTMLElement | null>(null)
const themeTrigger = ref(0)
const chartColors = ref({
  primary: 'rgba(2, 132, 199, 1)',
  primaryLight: 'rgba(2, 132, 199, 0.25)',
  empty: 'rgba(243, 244, 246, 1)',
  border: 'rgba(229, 231, 235, 1)',
})

useMutationObserver(
  typeof document !== 'undefined' ? document.documentElement : null,
  () => {
    themeTrigger.value += 1
    updateColors()
  },
  { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] },
)

function resolveEchartsColor(varNames: string[], alpha: number, fallback: string): string {
  if (typeof document === 'undefined') return fallback

  const target = chartWrapper.value || document.documentElement
  const styles = getComputedStyle(target)

  let val = ''
  for (const v of varNames) {
    val = styles.getPropertyValue(v).trim()
    if (val) break
  }

  if (!val) return fallback

  let cssColor = val
  if (!val.includes('(') && val.includes(' ')) {
    const formatted = val.replace(/(?:\s+|,+)/g, ', ')
    cssColor = val.includes('%') ? `hsl(${formatted})` : `rgb(${formatted})`
  }

  const cvs = document.createElement('canvas')
  cvs.width = 1
  cvs.height = 1
  const ctx = cvs.getContext('2d', { willReadFrequently: true })

  if (!ctx) return cssColor

  ctx.fillStyle = cssColor
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data

  if (a === 0 && cssColor !== 'transparent') return fallback

  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function updateColors() {
  chartColors.value.primary = resolveEchartsColor(['--chart-2', '--color-chart-2', '--primary'], 1, 'rgba(2, 132, 199, 1)')
  chartColors.value.primaryLight = resolveEchartsColor(['--chart-2', '--color-chart-2', '--primary'], 0.25, 'rgba(2, 132, 199, 0.25)')
  chartColors.value.empty = resolveEchartsColor(['--muted', '--color-muted', '--background'], 1, 'rgba(243, 244, 246, 1)')
  chartColors.value.border = resolveEchartsColor(['--border', '--color-border'], 1, 'rgba(229, 231, 235, 1)')
}

async function fetchMap() {
  if (isMapReady.value) return
  try {
    const mapRes = await fetch('/maps/world.json', { cache: 'force-cache' })
    if (mapRes.ok) {
      const worldJson = await mapRes.json()
      echarts.registerMap('world', worldJson as Parameters<typeof echarts.registerMap>[1])
      isMapReady.value = true
    } else {
      hasError.value = true
    }
  } catch {
    hasError.value = true
  }
}

async function fetchStats() {
  try {
    let endpoint = '/api/v1/statistics/country-distribution?libraryIds=1'
    if (statusFilter.value !== 'all') {
      endpoint += `&readStatus=${statusFilter.value}`
    }

    const apiRes = await api(endpoint, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
    })

    if (apiRes.ok) {
      const json = (await apiRes.json()) as Record<string, unknown>
      const items = json.items ?? json.data ?? (Array.isArray(json) ? json : [])
      rawItems.value = items as Array<Record<string, unknown>>
    } else {
      hasError.value = true
    }
  } catch {
    hasError.value = true
  }
}

async function loadData() {
  isLoading.value = true
  hasError.value = false
  await Promise.all([fetchMap(), fetchStats()])
  isLoading.value = false

  await nextTick()
  updateColors()
}

onMounted(loadData)
onActivated(loadData)

watch([() => route?.fullPath, statusFilter], () => {
  loadData()
})

const aggregatedItems = computed(() => {
  if (!rawItems.value.length) return []

  return rawItems.value
    .filter((item) => {
      const countryVal = item.country
      const code = typeof countryVal === 'string' ? countryVal.trim() : ''
      const countVal = item.count ?? item.value
      const value = typeof countVal === 'number' ? countVal : 0

      return code && code.toLowerCase() !== 'unknown' && value > 0
    })
    .map((item) => {
      const countryVal = item.country
      const code = typeof countryVal === 'string' ? countryVal.trim().toUpperCase() : ''
      const echartsName = ECHARTS_COUNTRY_MAP[code] || code
      const localizedName = t(`countryCodes.${code}`, code)
      const countVal = item.count ?? item.value
      const value = typeof countVal === 'number' ? countVal : 0

      return { name: echartsName, value, localizedName }
    })
})

const chartOption = computed(() => {
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
      min: 1,
      max: maxVal,
      left: md.value ? 'left' : 'center',
      bottom: md.value ? 'bottom' : 0,
      orient: md.value ? 'vertical' : 'horizontal',
      text: [t('common.high', 'High'), t('common.low', 'Low')],
      calculable: true,
      inRange: {
        color: [chartColors.value.primaryLight, chartColors.value.primary],
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
        itemStyle: {
          areaColor: chartColors.value.empty,
          borderColor: chartColors.value.border,
        },
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
            areaColor: chartColors.value.primary,
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
    <template #controls>
      <select
        v-model="statusFilter"
        class="h-8 cursor-pointer rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="all">Todos</option>
        <option value="READ">Lidos</option>
        <option value="UNREAD">Não Lidos</option>
        <option value="WANT_TO_READ">Quero Ler</option>
      </select>
    </template>

    <div ref="chartWrapper" style="height: 100%; width: 100%">
      <VChart v-if="isMapReady && chartOption.series" :option="chartOption" autoresize style="height: 100%" />
    </div>
  </ChartCard>
</template>
