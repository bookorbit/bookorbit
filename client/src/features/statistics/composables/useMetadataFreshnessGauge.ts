import type { MetadataFreshnessGauge } from '@bookorbit/types'

import { fetchMetadataFreshnessGauge } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: MetadataFreshnessGauge = {
  totalBooks: 0,
  neverFetchedCount: 0,
  fresh30dCount: 0,
  stale31To90dCount: 0,
  stale91To180dCount: 0,
  staleOver180dCount: 0,
  freshnessScore: 0,
}

export function useMetadataFreshnessGauge() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchMetadataFreshnessGauge,
  })
}
