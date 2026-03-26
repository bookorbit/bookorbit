import type { UserGenreReadingTimeItem } from '@projectx/types'

import { fetchUserGenreReadingTime } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserGenreReadingTimeItem[] = []

export function useUserGenreReadingTime() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserGenreReadingTime,
  })
}
