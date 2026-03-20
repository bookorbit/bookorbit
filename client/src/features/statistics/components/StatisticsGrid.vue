<script setup lang="ts">
import { type Component, defineAsyncComponent } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

import type { ChartConfigEntry, StatisticsChartId } from '@projectx/types'
import { STATISTICS_CHART_META, type StatisticsChartSize } from '../statistics-chart-meta'
import { useStatisticsConfig } from '../composables/useStatisticsConfig'

const CHART_COMPONENTS: Record<StatisticsChartId, Component> = {
  'format-distribution': defineAsyncComponent(() => import('./FormatDistributionChart.vue')),
  'language-distribution': defineAsyncComponent(() => import('./LanguageDistributionChart.vue')),
  'books-added-over-time': defineAsyncComponent(() => import('./BooksAddedOverTimeChart.vue')),
  'storage-by-format': defineAsyncComponent(() => import('./StorageByFormatChart.vue')),
  'publication-decade': defineAsyncComponent(() => import('./PublicationDecadeChart.vue')),
  'top-authors': defineAsyncComponent(() => import('./TopAuthorsChart.vue')),
  'metadata-completeness': defineAsyncComponent(() => import('./MetadataCompletenessChart.vue')),
  'genre-distribution': defineAsyncComponent(() => import('./GenreDistributionChart.vue')),
  'metadata-score-distribution': defineAsyncComponent(() => import('./MetadataScoreDistributionChart.vue')),
  'library-metadata-completeness': defineAsyncComponent(() => import('./LibraryMetadataCompletenessHeatmapChart.vue')),
  'format-share-over-time': defineAsyncComponent(() => import('./FormatShareOverTimeChart.vue')),
  'genre-rank-over-time': defineAsyncComponent(() => import('./GenreRankOverTimeChart.vue')),
  'page-count-distribution': defineAsyncComponent(() => import('./PageCountDistributionChart.vue')),
  'reading-heatmap': defineAsyncComponent(() => import('./ReadingHeatmapChart.vue')),
  'peak-reading-hours': defineAsyncComponent(() => import('./PeakReadingHoursChart.vue')),
  'favorite-reading-days': defineAsyncComponent(() => import('./FavoriteReadingDaysChart.vue')),
  'completion-timeline': defineAsyncComponent(() => import('./CompletionTimelineChart.vue')),
  'goal-trajectory': defineAsyncComponent(() => import('./GoalTrajectoryChart.vue')),
  'progress-funnel': defineAsyncComponent(() => import('./ProgressFunnelChart.vue')),
  'completion-latency': defineAsyncComponent(() => import('./CompletionLatencyChart.vue')),
}

const { visibleCharts, reorder } = useStatisticsConfig()

function handleReorder(newList: ChartConfigEntry[]) {
  reorder(newList)
}

function tileClass(size: StatisticsChartSize): string {
  if (size === '2x1') return 'md:col-span-2 md:row-span-1'
  if (size === '2x2') return 'md:col-span-2 md:row-span-2'
  if (size === '1x2') return 'md:col-span-1 md:row-span-2'
  if (size === '3x1') return 'md:col-span-2 xl:col-span-3 md:row-span-1'
  return 'md:col-span-1 md:row-span-1'
}
</script>

<template>
  <VueDraggable
    :model-value="visibleCharts"
    class="grid grid-flow-row-dense grid-cols-1 gap-4 md:grid-cols-2 md:auto-rows-[360px] xl:grid-cols-4"
    handle=".drag-handle"
    :animation="200"
    @update:model-value="handleReorder"
  >
    <div v-for="chart in visibleCharts" :key="chart.id" :class="tileClass(STATISTICS_CHART_META[chart.id].size)">
      <component :is="CHART_COMPONENTS[chart.id]" />
    </div>
  </VueDraggable>
</template>
