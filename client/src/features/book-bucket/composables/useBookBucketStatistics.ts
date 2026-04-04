import { ref } from 'vue'
import type { BookBucketStatistics } from '@projectx/types'
import { api } from '@/lib/api'

export function useBookBucketStatistics() {
  const statistics = ref<BookBucketStatistics | null>(null)

  async function fetchStatistics() {
    try {
      const res = await api('/api/v1/book-bucket/statistics')
      if (res.ok) statistics.value = await res.json()
    } catch {
      statistics.value = null
    }
  }

  return { statistics, fetchStatistics }
}
