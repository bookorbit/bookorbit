import type { MetadataCompletenessItem, StatisticsResult } from '@projectx/types'

import { fetchMetadataCompleteness } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<MetadataCompletenessItem> = { items: [], unknownCount: 0 }

export function useMetadataCompleteness() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchMetadataCompleteness,
  })
}
