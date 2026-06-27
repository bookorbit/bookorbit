import type { UserReadingSourceDistribution } from '@bookorbit/types'

import { fetchUserReadingSourceDistribution } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserReadingSourceDistribution = { totalSeconds: 0, slices: [] }

export function useUserReadingSourceDistribution() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserReadingSourceDistribution,
  })
}
