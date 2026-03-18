import { onMounted, ref, watch } from 'vue'

import type { FormatDistributionItem, StatisticsResult } from '@projectx/types'
import { fetchFormatDistribution } from '../api/statistics.api'
import { useStatisticsConfig } from './useStatisticsConfig'

export function useFormatDistribution() {
  const data = ref<StatisticsResult<FormatDistributionItem>>({ items: [], unknownCount: 0 })
  const loading = ref(true)
  const error = ref(false)

  const { filters } = useStatisticsConfig()

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchFormatDistribution(filters.value)
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
