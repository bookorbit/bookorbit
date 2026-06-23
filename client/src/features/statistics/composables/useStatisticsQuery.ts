import { onMounted, ref, watch } from 'vue'

import type { StatisticsFilterConfig } from '@bookorbit/types'
import { useStatisticsConfig } from './useStatisticsConfig'

interface UseStatisticsQueryOptions<T> {
  initialData: T
  fetcher: (filters: StatisticsFilterConfig) => Promise<T>
  watchFilterFields?: Array<(filters: StatisticsFilterConfig) => string | number>
  extraWatchSources?: Array<() => string | number | null>
}

export function useStatisticsQuery<T>({ initialData, fetcher, watchFilterFields = [], extraWatchSources = [] }: UseStatisticsQueryOptions<T>) {
  const data = ref<T>(initialData)
  const loading = ref(true)
  const error = ref(false)
  let latestRequestId = 0

  const { filters } = useStatisticsConfig()

  async function load() {
    const requestId = ++latestRequestId
    loading.value = true
    error.value = false
    try {
      const nextData = await fetcher(filters.value)
      if (requestId !== latestRequestId) return
      data.value = nextData
    } catch {
      if (requestId !== latestRequestId) return
      error.value = true
    } finally {
      if (requestId === latestRequestId) {
        loading.value = false
      }
    }
  }

  const watchSources: Array<() => string | number | null> = [
    () => filters.value.libraryIds.join(','),
    ...watchFilterFields.map((selector) => () => selector(filters.value)),
    ...extraWatchSources,
  ]

  watch(watchSources, load)
  onMounted(load)

  return { data, loading, error }
}
