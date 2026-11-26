<script setup lang="ts">
import { computed, shallowRef, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { Tag } from '@lucide/vue'

import { useChartTokens } from '@/composables/useChartTokens'
import { useGenreDistribution } from '../../composables/useGenreDistribution'
import { useStatisticsConfig } from '../../composables/useStatisticsConfig'
import { drillDownLibraryQuery, type ChartDrillDownTarget } from '../../lib/chart-drill-down'
import ChartCard from '../ChartCard.vue'
import ChartDrillDown from '../ChartDrillDown.vue'

const chartTokens = useChartTokens()
const { t } = useI18n()
const { filters } = useStatisticsConfig()

const { data, loading, error } = useGenreDistribution()

const total = computed(() => data.value.items.reduce((s, d) => s + d.count, 0))
const sortedItems = computed(() => [...data.value.items].sort((a, b) => b.count - a.count))
const option = shallowRef({})

// The treemap numbers its virtual root 0, so the tiles start at 1.
const targets = computed<ChartDrillDownTarget[]>(() =>
  sortedItems.value.map((item, position) => ({
    dataIndex: position + 1,
    text: t('statistics.drillDown.entryBooks', { name: item.genre, count: item.count }),
    to: { name: 'genre-detail', params: { id: item.id }, query: drillDownLibraryQuery(filters.value.libraryIds) },
  })),
)

watchEffect(() => {
  if (!data.value.items.length) return

  const palette = chartTokens.value.palette(0.85, 0.85)
  const background = chartTokens.value.color('--background')

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
        cursor: 'pointer',
        breadcrumb: { show: false },
        top: 10,
        bottom: 10,
        left: 10,
        right: 10,
        data: sortedItems.value.map((item, i) => ({
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
    <ChartDrillDown :option :targets :label="t('statistics.charts.genreDistribution.title')" hit="item" />
  </ChartCard>
</template>
