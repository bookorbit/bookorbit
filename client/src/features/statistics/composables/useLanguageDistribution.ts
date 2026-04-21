import type { LanguageDistributionItem, StatisticsResult } from '@bookorbit/types'

import { fetchLanguageDistribution } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<LanguageDistributionItem> = { items: [], unknownCount: 0 }

export function useLanguageDistribution() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchLanguageDistribution,
  })
}
