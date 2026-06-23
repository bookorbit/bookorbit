import { computed } from 'vue'
import type { DashboardConfig, UserGoalTrajectory } from '@bookorbit/types'

import { useAuth } from '@/features/auth/composables/useAuth'
import { fetchUserGoalTrajectory } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const DEFAULT_GOAL = 12

const EMPTY: UserGoalTrajectory = {
  goalBooks: DEFAULT_GOAL,
  points: [],
}

export function useUserGoalTrajectory() {
  const { user } = useAuth()
  const readingGoal = computed(() => (user.value?.settings?.dashboardConfig as DashboardConfig | undefined)?.readingGoal ?? DEFAULT_GOAL)

  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: (filters) => fetchUserGoalTrajectory(filters, readingGoal.value),
    extraWatchSources: [() => readingGoal.value],
  })
}
