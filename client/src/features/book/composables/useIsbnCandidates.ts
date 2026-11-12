import { ref } from 'vue'
import type { BookIsbnCandidates } from '@bookorbit/types'
import { api } from '@/lib/api'

/** The ISBNs printed in a book's primary file, read on demand for the edit screen. */
export function useIsbnCandidates() {
  const loading = ref(false)
  const result = ref<BookIsbnCandidates | null>(null)
  const failed = ref(false)
  let request = 0

  async function load(bookId: number): Promise<void> {
    const current = ++request
    loading.value = true
    failed.value = false
    try {
      const res = await api(`/api/v1/books/${bookId}/isbn-candidates`)
      if (current !== request) return
      if (!res.ok) {
        result.value = null
        failed.value = true
        return
      }
      const data = (await res.json()) as BookIsbnCandidates
      if (current === request) result.value = data
    } catch {
      if (current !== request) return
      result.value = null
      failed.value = true
    } finally {
      if (current === request) loading.value = false
    }
  }

  return { loading, result, failed, load }
}
