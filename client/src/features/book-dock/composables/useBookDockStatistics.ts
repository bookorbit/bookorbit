import { ref } from 'vue'
import type { BookDockStatistics } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useBookDockStatistics() {
  const statistics = ref<BookDockStatistics | null>(null)

  async function fetchStatistics() {
    try {
      const res = await api('/api/v1/book-dock/statistics')
      if (res.ok) statistics.value = await res.json()
    } catch {
      statistics.value = null
    }
  }

  return { statistics, fetchStatistics }
}
