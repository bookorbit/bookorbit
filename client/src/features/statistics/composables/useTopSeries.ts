import type { StatisticsResult, TopSeriesItem } from '@projectx/types'

import { fetchTopSeries } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<TopSeriesItem> = { items: [], unknownCount: 0 }

export function useTopSeries() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchTopSeries,
  })
}
