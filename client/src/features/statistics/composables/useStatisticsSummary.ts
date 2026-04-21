import { ref, watch } from 'vue'

import type { StatisticsSummary } from '@bookorbit/types'

import { fetchStatisticsSummary } from '../api/statistics.api'
import { useStatisticsConfig } from './useStatisticsConfig'

export function useStatisticsSummary() {
  const { filters } = useStatisticsConfig()
  const data = ref<StatisticsSummary | null>(null)
  const loading = ref(true)

  async function load() {
    loading.value = true
    try {
      data.value = await fetchStatisticsSummary(filters.value)
    } catch {
      // leave stale data on error — header degrades gracefully with dashes
    } finally {
      loading.value = false
    }
  }

  watch(() => filters.value.libraryIds.join(','), load, { immediate: true })

  return { data, loading }
}
