import type { UserFavoriteDayStat } from '@projectx/types'

import { fetchUserFavoriteReadingDays } from '../api/statistics.api'
import { useStatisticsQuery } from './useStatisticsQuery'

const EMPTY: UserFavoriteDayStat[] = []

export function useUserFavoriteReadingDays() {
  return useStatisticsQuery({
    initialData: EMPTY,
    fetcher: fetchUserFavoriteReadingDays,
  })
}
