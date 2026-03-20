import type { PublicationDecadeItem, StatisticsResult } from '@projectx/types'

import { fetchPublicationDecade } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<PublicationDecadeItem> = { items: [], unknownCount: 0 }

export function usePublicationDecade() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchPublicationDecade,
  })
}
