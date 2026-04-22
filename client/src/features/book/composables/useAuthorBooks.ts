import { ref } from 'vue'

import type { BookRecommendation } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useAuthorBooks() {
  const authorBooks = ref<BookRecommendation[]>([])
  const loading = ref(false)

  async function fetch(bookId: number) {
    loading.value = true
    authorBooks.value = []
    try {
      const res = await api(`/api/v1/books/${bookId}/author-books`)
      if (!res.ok) return
      authorBooks.value = await res.json()
    } catch {
      // author books are non-critical, fail silently
    } finally {
      loading.value = false
    }
  }

  return { authorBooks, loading, fetch }
}
