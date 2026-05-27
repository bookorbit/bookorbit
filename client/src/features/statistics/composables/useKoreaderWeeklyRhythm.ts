import type { KoreaderWeekdayPoint } from '@bookorbit/types'
import { fetchKoreaderWeeklyRhythm } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderWeekdayPoint[] = []

export function useKoreaderWeeklyRhythm() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderWeeklyRhythm)
}
