import type { AcquisitionLagPoint, StatisticsResult } from '@bookorbit/types'

import { fetchAcquisitionLagScatter } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: StatisticsResult<AcquisitionLagPoint> = { items: [], unknownCount: 0 }

export function useAcquisitionLagScatter() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchAcquisitionLagScatter,
  })
}
