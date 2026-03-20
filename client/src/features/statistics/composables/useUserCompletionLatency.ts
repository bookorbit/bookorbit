import type { UserCompletionLatencyDistribution } from '@projectx/types'

import { fetchUserCompletionLatency } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserCompletionLatencyDistribution = {
  totalCompletions: 0,
  medianDays: null,
  percentile75Days: null,
  percentile90Days: null,
  buckets: [],
}

export function useUserCompletionLatency() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserCompletionLatency,
  })
}
