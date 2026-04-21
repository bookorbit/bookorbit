import type { LibraryMetadataCompletenessItem, StatisticsResult } from '@bookorbit/types'

import { fetchLibraryMetadataCompleteness } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<LibraryMetadataCompletenessItem> = { items: [], unknownCount: 0 }

export function useLibraryMetadataCompleteness() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchLibraryMetadataCompleteness,
  })
}
