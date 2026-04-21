import type { UserCompletionTimelinePoint } from '@bookorbit/types'

import { fetchUserCompletionTimeline } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserCompletionTimelinePoint[] = []

export function useUserCompletionTimeline() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserCompletionTimeline,
  })
}
