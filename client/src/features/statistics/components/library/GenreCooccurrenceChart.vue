<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import VChart from 'vue-echarts'
import { GitMerge } from '@lucide/vue'
import type { ChordDiagramData } from '@bookorbit/types'

import { useGenreCooccurrence } from '../../composables/useGenreCooccurrence'
import ChartCard from '../ChartCard.vue'

const { t } = useI18n()

const { data, loading, error } = useGenreCooccurrence()
const option = shallowRef({})

const isEmpty = computed(() => data.value.nodes.length === 0)

function buildOption(chordData: ChordDiagramData) {
  if (!chordData.nodes.length) return {}

  return {
    tooltip: {
      trigger: 'item',
      formatter: (params: { dataType: string; name: string; value: number; data: { source?: string; target?: string; value?: number } }) => {
        if (params.dataType === 'edge') {
          return `<strong>${params.data.source} + ${params.data.target}</strong><br/>${params.data.value} shared book${params.data.value === 1 ? '' : 's'}`
        }
        return `<strong>${params.name}</strong>`
      },
    },
    series: [
      {
        type: 'chord',
        clockwise: false,
        label: { show: true, fontSize: 11 },
        lineStyle: { color: 'target', opacity: 0.6 },
        itemStyle: { borderWidth: 1 },
        emphasis: { focus: 'adjacency' },
        data: chordData.nodes,
        links: chordData.links,
      },
    ],
  }
}

watch(
  () => data.value,
  (nextData) => {
    option.value = buildOption(nextData)
  },
  { immediate: true },
)
</script>

<template>
  <ChartCard :title="t('statistics.charts.genreCooccurrence.title')" :icon="GitMerge" :color-index="3" :loading :error :empty="isEmpty">
    <VChart :option autoresize style="height: 100%" />
  </ChartCard>
</template>
