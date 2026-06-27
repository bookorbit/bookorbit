import type { Component } from 'vue'
import {
  BarChart3,
  BookCheck,
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock,
  Clock3,
  BookOpen,
  GitMerge,
  Goal,
  Globe,
  Gauge,
  HardDrive,
  Layers,
  ListChecks,
  MonitorSmartphone,
  PieChart,
  Rabbit,
  ShieldCheck,
  Tag,
  TrendingUp,
  Users,
  Waypoints,
  Zap,
} from '@lucide/vue'

import { DEFAULT_LIBRARY_CHART_ORDER, DEFAULT_USER_CHART_ORDER, type StatisticsChartId } from '@bookorbit/types'

export type StatisticsChartSize = '1x1' | '2x1' | '2x2' | '1x2' | '3x1' | '4x1'
export type StatisticsChartCategory = 'library' | 'user'

export interface StatisticsChartMetaEntry {
  label: string
  icon: Component
  size: StatisticsChartSize
  category: StatisticsChartCategory
}

export const STATISTICS_CHART_META: Record<StatisticsChartId, StatisticsChartMetaEntry> = {
  'format-distribution': {
    label: 'Format Distribution',
    icon: PieChart,
    size: '1x1',
    category: 'library',
  },
  'language-distribution': {
    label: 'Language Distribution',
    icon: Globe,
    size: '1x1',
    category: 'library',
  },
  'books-added-over-time': {
    label: 'Books Added Over Time',
    icon: TrendingUp,
    size: '2x1',
    category: 'library',
  },
  'storage-by-format': {
    label: 'Storage by Format',
    icon: HardDrive,
    size: '1x1',
    category: 'library',
  },
  'publication-decade': {
    label: 'Publication Decade',
    icon: CalendarDays,
    size: '1x1',
    category: 'library',
  },
  'top-authors': {
    label: 'Top 25 Authors',
    icon: Users,
    size: '2x1',
    category: 'library',
  },
  'metadata-completeness': {
    label: 'Metadata Completeness',
    icon: ListChecks,
    size: '1x1',
    category: 'library',
  },
  'genre-distribution': {
    label: 'Genre Distribution',
    icon: Tag,
    size: '2x1',
    category: 'library',
  },
  'metadata-score-distribution': {
    label: 'Metadata Score Distribution',
    icon: BarChart3,
    size: '1x1',
    category: 'library',
  },
  'library-metadata-completeness': {
    label: 'Library Metadata Completeness',
    icon: ListChecks,
    size: '2x1',
    category: 'library',
  },
  'genre-cooccurrence': {
    label: 'Genre Co-occurrence',
    icon: GitMerge,
    size: '2x2',
    category: 'library',
  },
  'format-share-over-time': {
    label: 'Format Share Over Time',
    icon: TrendingUp,
    size: '2x1',
    category: 'library',
  },
  'page-count-distribution': {
    label: 'Page Count Distribution',
    icon: BookOpen,
    size: '1x1',
    category: 'library',
  },
  'metadata-freshness-gauge': {
    label: 'Metadata Freshness',
    icon: Gauge,
    size: '1x1',
    category: 'library',
  },
  'library-integrity-gauge': {
    label: 'Library Integrity',
    icon: ShieldCheck,
    size: '1x1',
    category: 'library',
  },
  'acquisition-lag-scatter': {
    label: 'Acquisition Lag',
    icon: CalendarRange,
    size: '1x1',
    category: 'library',
  },
  'largest-books': {
    label: 'Top 50 Largest Books',
    icon: HardDrive,
    size: '2x1',
    category: 'library',
  },
  'top-series': {
    label: 'Top 50 Series',
    icon: Layers,
    size: '2x1',
    category: 'library',
  },
  'publication-year-timeline': {
    label: 'Publication Year Timeline',
    icon: TrendingUp,
    size: '4x1',
    category: 'library',
  },
  'reading-heatmap': {
    label: 'Reading Heatmap',
    icon: Calendar,
    size: '2x1',
    category: 'user',
  },
  'reading-source-distribution': {
    label: 'Where You Read',
    icon: MonitorSmartphone,
    size: '1x1',
    category: 'user',
  },
  'peak-reading-hours': {
    label: 'Peak Reading Hours',
    icon: Clock3,
    size: '2x1',
    category: 'user',
  },
  'favorite-reading-days': {
    label: 'Favorite Reading Days',
    icon: CalendarDays,
    size: '1x1',
    category: 'user',
  },
  'completion-timeline': {
    label: 'Completion Timeline',
    icon: CalendarRange,
    size: '2x1',
    category: 'user',
  },
  'goal-trajectory': {
    label: 'Pace vs Goal',
    icon: Goal,
    size: '2x1',
    category: 'user',
  },
  'progress-funnel': {
    label: 'Progress Funnel',
    icon: Waypoints,
    size: '1x1',
    category: 'user',
  },
  'completion-latency': {
    label: 'Completion Latency',
    icon: Rabbit,
    size: '1x1',
    category: 'user',
  },
  'genre-reading-time': {
    label: 'Genre Reading Time',
    icon: Tag,
    size: '2x1',
    category: 'user',
  },
  'reading-pace': {
    label: 'Reading Pace',
    icon: Zap,
    size: '2x1',
    category: 'user',
  },
  'books-completed': {
    label: 'Books Completed',
    icon: BookCheck,
    size: '2x1',
    category: 'user',
  },
  'reading-clock': {
    label: 'Reading Clock',
    icon: Clock,
    size: '1x1',
    category: 'user',
  },
  'reading-session-timeline': {
    label: 'Reading Session Timeline',
    icon: Clock3,
    size: '2x1',
    category: 'user',
  },
  'session-archetypes': {
    label: 'Session Archetypes',
    icon: Layers,
    size: '2x1',
    category: 'user',
  },
}

export const LIBRARY_CHART_IDS: StatisticsChartId[] = DEFAULT_LIBRARY_CHART_ORDER.filter((id): id is StatisticsChartId => id in STATISTICS_CHART_META)

export const USER_CHART_IDS: StatisticsChartId[] = DEFAULT_USER_CHART_ORDER.filter((id): id is StatisticsChartId => id in STATISTICS_CHART_META)

export const STATISTICS_CHART_IDS: StatisticsChartId[] = [...LIBRARY_CHART_IDS, ...USER_CHART_IDS]
