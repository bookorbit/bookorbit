import type { LibraryIntegrityGauge } from '@bookorbit/types'

import { fetchLibraryIntegrityGauge } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: LibraryIntegrityGauge = {
  totalBooks: 0,
  presentCount: 0,
  primaryFileCount: 0,
  metadataCount: 0,
  integrityScore: 0,
}

export function useLibraryIntegrityGauge() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchLibraryIntegrityGauge,
  })
}
