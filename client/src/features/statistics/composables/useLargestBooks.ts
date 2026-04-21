import type { LargestBookItem, StatisticsResult } from '@bookorbit/types'

import { fetchLargestBooks } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<LargestBookItem> = { items: [], unknownCount: 0 }

export function useLargestBooks() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchLargestBooks,
  })
}
