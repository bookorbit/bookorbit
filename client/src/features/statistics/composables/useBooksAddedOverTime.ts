import { onMounted, ref, watch } from 'vue'

import type { BooksAddedDataPoint, StatisticsResult } from '@projectx/types'
import { fetchBooksAddedOverTime } from '../api/statistics.api'
import { useStatisticsConfig } from './useStatisticsConfig'

export function useBooksAddedOverTime() {
  const data = ref<StatisticsResult<BooksAddedDataPoint>>({ items: [], unknownCount: 0 })
  const loading = ref(true)
  const error = ref(false)

  const { filters } = useStatisticsConfig()

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchBooksAddedOverTime(filters.value)
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  watch([() => filters.value.libraryIds.join(','), () => filters.value.booksOverTimeGranularity, () => filters.value.booksOverTimeRange], load)
  onMounted(load)
  return { data, loading, error }
}
