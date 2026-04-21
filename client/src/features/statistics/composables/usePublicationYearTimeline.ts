import type { PublicationYearPoint, StatisticsResult } from '@bookorbit/types'

import { fetchPublicationYearTimeline } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<PublicationYearPoint> = { items: [], unknownCount: 0 }

export function usePublicationYearTimeline() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchPublicationYearTimeline,
  })
}
