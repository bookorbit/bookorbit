import type { UserGoalTrajectory } from '@projectx/types'

import { fetchUserGoalTrajectory } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserGoalTrajectory = {
  goalBooks: 12,
  points: [],
}

export function useUserGoalTrajectory() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserGoalTrajectory,
  })
}
