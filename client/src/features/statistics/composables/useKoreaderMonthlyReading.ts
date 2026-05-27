import type { KoreaderMonthlyPoint } from '@bookorbit/types'
import { fetchKoreaderMonthlyReading } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderMonthlyPoint[] = []

export function useKoreaderMonthlyReading() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderMonthlyReading)
}
