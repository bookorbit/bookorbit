import type { UserPeakHourStat } from '@projectx/types'

import { fetchUserPeakReadingHours } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserPeakHourStat[] = []

export function useUserPeakReadingHours() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserPeakReadingHours,
  })
}
