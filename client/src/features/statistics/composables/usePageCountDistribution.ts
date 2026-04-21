import type { PageCountDistributionItem, StatisticsResult } from '@bookorbit/types'

import { fetchPageCountDistribution } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<PageCountDistributionItem> = { items: [], unknownCount: 0 }

export function usePageCountDistribution() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchPageCountDistribution,
  })
}
