import { onMounted, ref, watch } from 'vue'

import type { MetadataCompletenessItem, StatisticsResult } from '@projectx/types'
import { fetchMetadataCompleteness } from '../api/statistics.api'
import { useStatisticsConfig } from './useStatisticsConfig'

export function useMetadataCompleteness() {
  const data = ref<StatisticsResult<MetadataCompletenessItem>>({ items: [], unknownCount: 0 })
  const loading = ref(true)
  const error = ref(false)

  const { filters } = useStatisticsConfig()

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchMetadataCompleteness(filters.value)
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  watch(() => filters.value.libraryIds.join(','), load)
  onMounted(load)
  return { data, loading, error }
}
