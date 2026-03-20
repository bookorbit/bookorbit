import type { FormatDistributionItem, StatisticsResult } from '@projectx/types'

import { fetchFormatDistribution } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<FormatDistributionItem> = { items: [], unknownCount: 0 }

export function useFormatDistribution() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchFormatDistribution,
  })
}
