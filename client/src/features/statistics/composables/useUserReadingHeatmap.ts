import type { UserDailyReadingStat } from '@bookorbit/types'

import { fetchUserReadingHeatmap } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserDailyReadingStat[] = []

export function useUserReadingHeatmap() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserReadingHeatmap,
  })
}
