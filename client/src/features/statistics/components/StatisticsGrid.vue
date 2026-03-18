<script setup lang="ts">
import { type Component, defineAsyncComponent } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

import type { ChartConfigEntry, StatisticsChartId } from '@projectx/types'
import { useStatisticsConfig } from '../composables/useStatisticsConfig'

interface ChartRegistryEntry {
  component: Component
  label: string
  wide: boolean
  fullWidth?: boolean
}

const CHART_REGISTRY: Record<StatisticsChartId, ChartRegistryEntry> = {
  'format-distribution': {
    component: defineAsyncComponent(() => import('./FormatDistributionChart.vue')),
    label: 'Format Distribution',
    wide: false,
  },
  'language-distribution': {
    component: defineAsyncComponent(() => import('./LanguageDistributionChart.vue')),
    label: 'Language Distribution',
    wide: false,
  },
  'books-added-over-time': {
    component: defineAsyncComponent(() => import('./BooksAddedOverTimeChart.vue')),
    label: 'Books Added Over Time',
    wide: true,
  },
  'storage-by-format': {
    component: defineAsyncComponent(() => import('./StorageByFormatChart.vue')),
    label: 'Storage by Format',
    wide: false,
  },
  'publication-decade': {
    component: defineAsyncComponent(() => import('./PublicationDecadeChart.vue')),
    label: 'Publication Decade',
    wide: false,
  },
  'top-authors': {
    component: defineAsyncComponent(() => import('./TopAuthorsChart.vue')),
    label: 'Top Authors',
    wide: true,
  },
  'metadata-completeness': {
    component: defineAsyncComponent(() => import('./MetadataCompletenessChart.vue')),
    label: 'Metadata Completeness',
    wide: false,
  },
  'genre-distribution': {
    component: defineAsyncComponent(() => import('./GenreDistributionChart.vue')),
    label: 'Genre Distribution',
    wide: true,
  },
}

const { visibleCharts, reorder } = useStatisticsConfig()

function handleReorder(newList: ChartConfigEntry[]) {
  reorder(newList)
}
</script>

<template>
  <VueDraggable
    :model-value="visibleCharts"
    class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
    handle=".drag-handle"
    :animation="200"
    @update:model-value="handleReorder"
  >
    <div
      v-for="chart in visibleCharts"
      :key="chart.id"
      :class="
        CHART_REGISTRY[chart.id].fullWidth ? 'md:col-span-2 xl:col-span-3 2xl:col-span-4' : CHART_REGISTRY[chart.id].wide ? 'md:col-span-2' : ''
      "
    >
      <component :is="CHART_REGISTRY[chart.id].component" />
    </div>
  </VueDraggable>
</template>
