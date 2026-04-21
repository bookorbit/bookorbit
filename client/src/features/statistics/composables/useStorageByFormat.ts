import type { StatisticsResult, StorageByFormatItem } from '@bookorbit/types'

import { fetchStorageByFormat } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<StorageByFormatItem> = { items: [], unknownCount: 0 }

export function useStorageByFormat() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchStorageByFormat,
  })
}
