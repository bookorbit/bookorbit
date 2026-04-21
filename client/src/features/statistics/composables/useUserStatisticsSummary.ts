import { ref, watch } from 'vue'

import type { UserStatisticsSummary } from '@bookorbit/types'

import { fetchUserStatisticsSummary } from '../api/statistics.api'
import { useStatisticsConfig } from './useStatisticsConfig'

export function useUserStatisticsSummary() {
  const { filters } = useStatisticsConfig()
  const data = ref<UserStatisticsSummary | null>(null)
  const loading = ref(true)

  async function load() {
    loading.value = true
    try {
      data.value = await fetchUserStatisticsSummary(filters.value)
    } catch {
      // leave stale data on error so summary card can degrade gracefully
    } finally {
      loading.value = false
    }
  }

  watch(() => filters.value.libraryIds.join(','), load, { immediate: true })

  return { data, loading }
}
