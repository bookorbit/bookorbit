<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { Tag } from '@lucide/vue'

import { useThemeStore } from '@/stores/theme'
import { getThemePalette, readCssColor } from '@/lib/echarts'
import { useGenreDistribution } from '../../composables/useGenreDistribution'
import ChartCard from '../ChartCard.vue'

const themeStore = useThemeStore()
const { t } = useI18n()

const { data, loading, error } = useGenreDistribution()

const total = computed(() => data.value.items.reduce((s, d) => s + d.count, 0))
const option = shallowRef({})

watchEffect(() => {
  if (!data.value.items.length) return

  const palette = getThemePalette(themeStore.theme, themeStore.accent, 0.85, 0.85)
  const background = readCssColor('--background')

  option.value = {
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      formatter: (params: { name: string; value: number }) => {
        const pct = total.value > 0 ? ((params.value / total.value) * 100).toFixed(1) : '0'
        return `<strong>${params.name}</strong><br/>${params.value} books &nbsp;&nbsp; ${pct}% of library`
      },
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        top: 10,
        bottom: 10,
        left: 10,
        right: 10,
        data: [...data.value.items]
          .sort((a, b) => b.count - a.count)
          .map((item, i) => ({
            name: item.genre,
            value: item.count,
            itemStyle: {
              color: palette[i % palette.length],
              borderWidth: 2,
              borderColor: background,
            },
          })),
        label: {
          show: true,
          fontSize: 12,
          fontWeight: 500,
          overflow: 'truncate',
          color: '#fff',
          formatter: (p: { name: string; value: number }) => {
            const pct = total.value > 0 ? ((p.value / total.value) * 100).toFixed(1) : '0'
            return `${p.name}\n${p.value} (${pct}%)`
          },
        },
        emphasis: { disabled: true },
        upperLabel: { show: false },
        levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 } }],
      },
    ],
  }
})
</script>

<template>
  <ChartCard
    :title="t('statistics.charts.genreDistribution.title')"
    :icon="Tag"
    :color-index="8"
    :loading
    :error
    :empty="!data.items.length"
    :unknown-count="data.unknownCount"
  >
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
