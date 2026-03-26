import type { ChordDiagramData } from '@projectx/types'

import { fetchGenreCooccurrence } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: ChordDiagramData = { nodes: [], links: [] }

export function useGenreCooccurrence() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchGenreCooccurrence,
  })
}
