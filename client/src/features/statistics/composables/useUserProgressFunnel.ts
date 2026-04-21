import type { UserProgressFunnelComparison } from '@bookorbit/types'

import { fetchUserProgressFunnel } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserProgressFunnelComparison = {
  days: 365,
  current: {
    started: 0,
    reached25: 0,
    reached50: 0,
    reached75: 0,
    completed: 0,
  },
  previous: null,
}

export function useUserProgressFunnel() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserProgressFunnel,
  })
}
