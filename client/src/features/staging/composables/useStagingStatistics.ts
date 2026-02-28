import { ref } from 'vue'
import type { StagingStatistics } from '@projectx/types'
import { api } from '@/lib/api'

export function useStagingStatistics() {
  const statistics = ref<StagingStatistics | null>(null)

  async function fetchStatistics() {
    try {
      const res = await api('/api/v1/staging/statistics')
      if (res.ok) statistics.value = await res.json()
    } catch {
      statistics.value = null
    }
  }

  return { statistics, fetchStatistics }
}
