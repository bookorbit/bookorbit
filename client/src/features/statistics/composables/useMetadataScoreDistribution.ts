import type { MetadataScoreDistribution } from '@projectx/types'

import { fetchMetadataScoreDistribution } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: MetadataScoreDistribution = {
  bins: [],
  unknownCount: 0,
  totalCount: 0,
  percentile25: null,
  percentile50: null,
  percentile75: null,
  percentile90: null,
}

export function useMetadataScoreDistribution() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchMetadataScoreDistribution,
  })
}
