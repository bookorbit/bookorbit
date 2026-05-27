import type { KoreaderTopBookItem } from '@bookorbit/types'
import { fetchKoreaderTopBooks } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderTopBookItem[] = []

export function useKoreaderTopBooks() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderTopBooks)
}
