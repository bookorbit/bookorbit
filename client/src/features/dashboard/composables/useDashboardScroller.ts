import { onMounted, ref } from 'vue'

import type { BookCard, ScrollerType } from '@projectx/types'
import { api } from '@/lib/api'

export function useDashboardScroller(type: ScrollerType, limit = 20, lensId?: number) {
  const books = ref<BookCard[]>([])
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (type === 'lens' && lensId) params.set('lensId', String(lensId))
      const res = await api(`/api/v1/dashboard/scrollers/${type}?${params}`)
      if (!res.ok) throw new Error()
      books.value = await res.json()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { books, loading, error, refresh: load }
}
