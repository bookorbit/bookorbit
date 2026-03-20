import type { GenreRankOverTimeItem, StatisticsResult } from '@projectx/types'

import { fetchGenreRankOverTime } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<GenreRankOverTimeItem> = { items: [], unknownCount: 0 }

export function useGenreRankOverTime() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchGenreRankOverTime,
  })
}
