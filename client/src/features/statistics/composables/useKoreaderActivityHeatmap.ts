import type { KoreaderHeatmapPoint } from '@bookorbit/types'
import { fetchKoreaderActivityHeatmap } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderHeatmapPoint[] = []

export function useKoreaderActivityHeatmap() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderActivityHeatmap)
}
