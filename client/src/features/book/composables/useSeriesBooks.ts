import { ref } from 'vue'

import type { SeriesBookRecommendation } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useSeriesBooks() {
  const seriesBooks = ref<SeriesBookRecommendation[]>([])
  const loading = ref(false)

  async function fetch(bookId: number) {
    loading.value = true
    seriesBooks.value = []
    try {
      const res = await api(`/api/v1/books/${bookId}/series-books`)
      if (!res.ok) return
      seriesBooks.value = await res.json()
    } catch {
      // series books are non-critical, fail silently
    } finally {
      loading.value = false
    }
  }

  return { seriesBooks, loading, fetch }
}
