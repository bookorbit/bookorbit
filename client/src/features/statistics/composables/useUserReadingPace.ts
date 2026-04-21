import type { UserReadingPacePoint } from '@bookorbit/types'

import { fetchUserReadingPace } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserReadingPacePoint[] = []

export function useUserReadingPace() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserReadingPace,
  })
}
