import type { BooksAddedDataPoint, StatisticsResult } from '@bookorbit/types'

import { fetchBooksAddedOverTime } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<BooksAddedDataPoint> = { items: [], unknownCount: 0 }

export function useBooksAddedOverTime() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchBooksAddedOverTime,
    watchFilterFields: [(filters) => filters.booksOverTimeGranularity, (filters) => filters.booksOverTimeRange],
  })
}
