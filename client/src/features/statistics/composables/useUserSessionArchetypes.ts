import type { UserSessionArchetypePoint } from '@projectx/types'

import { fetchUserSessionArchetypes } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserSessionArchetypePoint[] = []

export function useUserSessionArchetypes() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserSessionArchetypes,
  })
}
