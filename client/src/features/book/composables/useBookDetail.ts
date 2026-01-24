import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookDetail } from '@projectx/types'

export function useBookDetail() {
  const detail = ref<BookDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetch(bookId: number) {
    loading.value = true
    error.value = null
    detail.value = null
    try {
      const res = await api(`/api/books/${bookId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      detail.value = await res.json()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load book'
    } finally {
      loading.value = false
    }
  }

  return { detail, loading, error, fetch }
}
