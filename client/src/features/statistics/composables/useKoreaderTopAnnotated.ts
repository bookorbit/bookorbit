import type { KoreaderTopAnnotatedItem } from '@bookorbit/types'
import { fetchKoreaderTopAnnotated } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderTopAnnotatedItem[] = []

export function useKoreaderTopAnnotated() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderTopAnnotated)
}
