import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookBucketFinalizeResult, BookBucketFinalizeOverride } from '@projectx/types'

export function useBookBucketFinalize() {
  const result = ref<BookBucketFinalizeResult | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function finalize(payload: {
    fileIds?: number[]
    selectAll?: boolean
    excludedIds?: number[]
    status?: string
    search?: string
    defaultLibraryId?: number
    defaultFolderId?: number
    overrides?: BookBucketFinalizeOverride[]
  }) {
    loading.value = true
    error.value = null
    result.value = null

    try {
      const res = await api('/api/v1/book-bucket/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.ok) {
        result.value = await res.json()
      } else {
        const body = await res.json().catch(() => null)
        error.value = (body as { message?: string } | null)?.message ?? `Error ${res.status}`
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Finalize failed'
    } finally {
      loading.value = false
    }
  }

  function reset() {
    result.value = null
    error.value = null
  }

  return { result, loading, error, finalize, reset }
}
