import type { UserGenreReadingTimeItem } from '@bookorbit/types'

import { fetchUserGenreReadingTime } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserGenreReadingTimeItem[] = []

export function useUserGenreReadingTime() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserGenreReadingTime,
  })
}
