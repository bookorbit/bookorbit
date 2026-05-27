import type { KoreaderStatsSummary } from '@bookorbit/types'
import { fetchKoreaderStatsSummary } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderStatsSummary = {
  totalReadSecs: 0,
  totalSessions: 0,
  totalHighlights: 0,
  totalNotes: 0,
  booksWithStats: 0,
  currentStreak: 0,
  longestStreak: 0,
}

export function useKoreaderStatsSummary() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderStatsSummary)
}
