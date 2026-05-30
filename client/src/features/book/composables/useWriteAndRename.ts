import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookWriteAndRenameResult } from '@bookorbit/types'

export function useWriteAndRename() {
  const loading = ref(false)
  const result = ref<BookWriteAndRenameResult | null>(null)
  const error = ref<string | null>(null)

  async function writeAndRename(bookId: number): Promise<BookWriteAndRenameResult | null> {
    loading.value = true
    result.value = null
    error.value = null
    try {
      const res = await api(`/api/v1/books/${bookId}/write-and-rename`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        error.value = (body as { message?: string }).message ?? `Request failed (${res.status})`
        return null
      }
      const data = (await res.json()) as BookWriteAndRenameResult
      result.value = data
      return data
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unknown error'
      return null
    } finally {
      loading.value = false
    }
  }

  function dismiss() {
    result.value = null
    error.value = null
  }

  return { loading, result, error, writeAndRename, dismiss }
}
