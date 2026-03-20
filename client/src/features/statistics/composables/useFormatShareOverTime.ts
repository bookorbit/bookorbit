import type { FormatShareOverTimeItem, StatisticsResult } from '@projectx/types'

import { fetchFormatShareOverTime } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<FormatShareOverTimeItem> = { items: [], unknownCount: 0 }

export function useFormatShareOverTime() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchFormatShareOverTime,
  })
}
