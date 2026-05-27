import type { KoreaderHourPoint } from '@bookorbit/types'
import { fetchKoreaderTimeOfDay } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderHourPoint[] = []

export function useKoreaderTimeOfDay() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderTimeOfDay)
}
