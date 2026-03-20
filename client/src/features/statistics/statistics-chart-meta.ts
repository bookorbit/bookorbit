import type { Component } from 'vue'
import {
  BarChart3,
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock3,
  BookOpen,
  Goal,
  Globe,
  HardDrive,
  ListChecks,
  PieChart,
  Rabbit,
  Tag,
  TrendingUp,
  Users,
  Waypoints,
} from 'lucide-vue-next'

import { DEFAULT_STATISTICS_CHART_ORDER, type StatisticsChartId } from '@projectx/types'

export type StatisticsChartSize = '1x1' | '2x1' | '2x2' | '1x2' | '3x1'

export interface StatisticsChartMetaEntry {
  label: string
  icon: Component
  size: StatisticsChartSize
}

export const STATISTICS_CHART_META: Record<StatisticsChartId, StatisticsChartMetaEntry> = {
  'format-distribution': {
    label: 'Format Distribution',
    icon: PieChart,
    size: '1x1',
  },
  'language-distribution': {
    label: 'Language Distribution',
    icon: Globe,
    size: '1x1',
  },
  'books-added-over-time': {
    label: 'Books Added Over Time',
    icon: TrendingUp,
    size: '2x1',
  },
  'storage-by-format': {
    label: 'Storage by Format',
    icon: HardDrive,
    size: '1x1',
  },
  'publication-decade': {
    label: 'Publication Decade',
    icon: CalendarDays,
    size: '1x1',
  },
  'top-authors': {
    label: 'Top 25 Authors',
    icon: Users,
    size: '2x1',
  },
  'metadata-completeness': {
    label: 'Metadata Completeness',
    icon: ListChecks,
    size: '1x1',
  },
  'genre-distribution': {
    label: 'Genre Distribution',
    icon: Tag,
    size: '2x1',
  },
  'metadata-score-distribution': {
    label: 'Metadata Score Distribution',
    icon: BarChart3,
    size: '1x1',
  },
  'library-metadata-completeness': {
    label: 'Library Metadata Completeness',
    icon: ListChecks,
    size: '2x1',
  },
  'format-share-over-time': {
    label: 'Format Share Over Time',
    icon: TrendingUp,
    size: '2x1',
  },
  'genre-rank-over-time': {
    label: 'Genre Rank Over Time',
    icon: Tag,
    size: '2x1',
  },
  'page-count-distribution': {
    label: 'Page Count Distribution',
    icon: BookOpen,
    size: '1x1',
  },
  'reading-heatmap': {
    label: 'Reading Heatmap',
    icon: Calendar,
    size: '2x1',
  },
  'peak-reading-hours': {
    label: 'Peak Reading Hours',
    icon: Clock3,
    size: '2x1',
  },
  'favorite-reading-days': {
    label: 'Favorite Reading Days',
    icon: CalendarDays,
    size: '1x1',
  },
  'completion-timeline': {
    label: 'Completion Timeline',
    icon: CalendarRange,
    size: '2x1',
  },
  'goal-trajectory': {
    label: 'Pace vs Goal',
    icon: Goal,
    size: '2x1',
  },
  'progress-funnel': {
    label: 'Progress Funnel',
    icon: Waypoints,
    size: '1x1',
  },
  'completion-latency': {
    label: 'Completion Latency',
    icon: Rabbit,
    size: '1x1',
  },
}

export const STATISTICS_CHART_IDS: StatisticsChartId[] = DEFAULT_STATISTICS_CHART_ORDER.filter(
  (id): id is StatisticsChartId => id in STATISTICS_CHART_META,
)
