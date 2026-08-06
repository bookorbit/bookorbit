import { useQuery } from '@tanstack/vue-query'
import { computed, type MaybeRef, unref } from 'vue'
import { fetchCountryDistribution } from '../api/statistics.api'
import type { StatisticsFilterConfig } from '@bookorbit/types'

export function useCountryDistribution(filters: MaybeRef<StatisticsFilterConfig>) {
  const query = useQuery({
    queryKey: computed(() => ['statistics', 'country-distribution', unref(filters)]),
    queryFn: () => fetchCountryDistribution(unref(filters)),
  })

  return {
    ...query,
    items: computed(() => query.data.value?.items ?? []),
  }
}
