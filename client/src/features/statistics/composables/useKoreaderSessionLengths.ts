import type { KoreaderSessionLengthBin } from '@bookorbit/types'
import { fetchKoreaderSessionLengths } from '../api/koreader-statistics.api'
import { useKoreaderStatisticsQuery } from './useKoreaderStatisticsQuery'

const EMPTY: KoreaderSessionLengthBin[] = []

export function useKoreaderSessionLengths() {
  return useKoreaderStatisticsQuery(EMPTY, fetchKoreaderSessionLengths)
}
