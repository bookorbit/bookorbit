import type { GenreDistributionItem, StatisticsResult } from '@projectx/types'

import { fetchGenreDistribution } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<GenreDistributionItem> = { items: [], unknownCount: 0 }

export function useGenreDistribution() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchGenreDistribution,
  })
}
