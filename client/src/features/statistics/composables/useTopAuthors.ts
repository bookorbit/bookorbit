import type { StatisticsResult, TopAuthorItem } from '@projectx/types'

import { fetchTopAuthors } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<TopAuthorItem> = { items: [], unknownCount: 0 }

export function useTopAuthors() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchTopAuthors,
  })
}
