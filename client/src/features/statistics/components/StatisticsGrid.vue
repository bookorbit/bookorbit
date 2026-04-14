<script setup lang="ts">
import { type Component, defineAsyncComponent } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'

import type { ChartConfigEntry, StatisticsChartId } from '@projectx/types'
import { STATISTICS_CHART_META, type StatisticsChartSize } from '../statistics-chart-meta'
import { useStatisticsConfig } from '../composables/useStatisticsConfig'

defineProps<{ charts: ChartConfigEntry[] }>()

const CHART_COMPONENTS: Record<StatisticsChartId, Component> = {
  'format-distribution': defineAsyncComponent(() => import('./library/FormatDistributionChart.vue')),
  'language-distribution': defineAsyncComponent(() => import('./library/LanguageDistributionChart.vue')),
  'books-added-over-time': defineAsyncComponent(() => import('./library/BooksAddedOverTimeChart.vue')),
  'storage-by-format': defineAsyncComponent(() => import('./library/StorageByFormatChart.vue')),
  'publication-decade': defineAsyncComponent(() => import('./library/PublicationDecadeChart.vue')),
  'top-authors': defineAsyncComponent(() => import('./library/TopAuthorsChart.vue')),
  'metadata-completeness': defineAsyncComponent(() => import('./library/MetadataCompletenessChart.vue')),
  'genre-distribution': defineAsyncComponent(() => import('./library/GenreDistributionChart.vue')),
  'genre-cooccurrence': defineAsyncComponent(() => import('./library/GenreCooccurrenceChart.vue')),
  'metadata-score-distribution': defineAsyncComponent(() => import('./library/MetadataScoreDistributionChart.vue')),
  'library-metadata-completeness': defineAsyncComponent(() => import('./library/LibraryMetadataCompletenessHeatmapChart.vue')),
  'format-share-over-time': defineAsyncComponent(() => import('./library/FormatShareOverTimeChart.vue')),
  'page-count-distribution': defineAsyncComponent(() => import('./library/PageCountDistributionChart.vue')),
  'metadata-freshness-gauge': defineAsyncComponent(() => import('./library/MetadataFreshnessGaugeChart.vue')),
  'library-integrity-gauge': defineAsyncComponent(() => import('./library/LibraryIntegrityGaugeChart.vue')),
  'acquisition-lag-scatter': defineAsyncComponent(() => import('./library/AcquisitionLagScatterChart.vue')),
  'largest-books': defineAsyncComponent(() => import('./library/LargestBooksChart.vue')),
  'top-series': defineAsyncComponent(() => import('./library/TopSeriesChart.vue')),
  'publication-year-timeline': defineAsyncComponent(() => import('./library/PublicationYearTimelineChart.vue')),
  'reading-heatmap': defineAsyncComponent(() => import('./user/ReadingHeatmapChart.vue')),
  'peak-reading-hours': defineAsyncComponent(() => import('./user/PeakReadingHoursChart.vue')),
  'favorite-reading-days': defineAsyncComponent(() => import('./user/FavoriteReadingDaysChart.vue')),
  'completion-timeline': defineAsyncComponent(() => import('./user/CompletionTimelineChart.vue')),
  'goal-trajectory': defineAsyncComponent(() => import('./user/GoalTrajectoryChart.vue')),
  'progress-funnel': defineAsyncComponent(() => import('./user/ProgressFunnelChart.vue')),
  'completion-latency': defineAsyncComponent(() => import('./user/CompletionLatencyChart.vue')),
  'genre-reading-time': defineAsyncComponent(() => import('./user/GenreReadingTimeTreemapChart.vue')),
  'reading-pace': defineAsyncComponent(() => import('./user/ReadingPaceScatterChart.vue')),
  'books-completed': defineAsyncComponent(() => import('./user/BooksCompletedChart.vue')),
  'reading-clock': defineAsyncComponent(() => import('./user/ReadingClockChart.vue')),
  'reading-session-timeline': defineAsyncComponent(() => import('./user/ReadingSessionTimelineChart.vue')),
  'session-archetypes': defineAsyncComponent(() => import('./user/SessionArchetypesChart.vue')),
}

const { reorder } = useStatisticsConfig()

function handleReorder(newList: ChartConfigEntry[]) {
  reorder(newList)
}

function tileClass(size: StatisticsChartSize): string {
  if (size === '2x1') return 'md:col-span-2 md:row-span-1'
  if (size === '2x2') return 'md:col-span-2 md:row-span-2'
  if (size === '1x2') return 'md:col-span-1 md:row-span-2'
  if (size === '3x1') return 'md:col-span-2 xl:col-span-3 md:row-span-1'
  if (size === '4x1') return 'md:col-span-2 xl:col-span-4 md:row-span-1'
  return 'md:col-span-1 md:row-span-1'
}
</script>

<template>
  <VueDraggable
    :model-value="charts"
    class="grid grid-flow-row-dense grid-cols-1 gap-4 md:grid-cols-2 md:auto-rows-[360px] xl:grid-cols-4"
    handle=".drag-handle"
    :animation="200"
    @update:model-value="handleReorder"
  >
    <div
      v-for="(chart, index) in charts"
      :key="chart.id"
      :class="tileClass(STATISTICS_CHART_META[chart.id].size)"
      class="animate-fade-up"
      :style="{ animationDelay: `${index * 60}ms` }"
    >
      <component :is="CHART_COMPONENTS[chart.id]" />
    </div>
  </VueDraggable>
</template>
