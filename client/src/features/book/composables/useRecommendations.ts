import { ref } from 'vue'

import type { BookRecommendation } from '@projectx/types'
import { api } from '@/lib/api'

export function useRecommendations() {
  const recommendations = ref<BookRecommendation[]>([])
  const loading = ref(false)

  async function fetch(bookId: number) {
    loading.value = true
    recommendations.value = []
    try {
      const res = await api(`/api/v1/books/${bookId}/recommendations`)
      if (!res.ok) return
      recommendations.value = await res.json()
    } catch {
      // recommendations are non-critical, fail silently
    } finally {
      loading.value = false
    }
  }

  return { recommendations, loading, fetch }
}
