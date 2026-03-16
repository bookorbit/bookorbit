import { ref, watch, type Ref } from 'vue'
import type { BookMetadataFetchConditions } from '@projectx/types'
import { api } from '@/lib/api'

export function useEligibleCountPreview(conditions: Ref<BookMetadataFetchConditions | null>, libraryId?: number) {
  const count = ref<number | null>(null)
  const loading = ref(false)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function fetchCount() {
    const current = conditions.value
    if (!current) {
      count.value = null
      return
    }
    loading.value = true
    try {
      const body: { conditions: BookMetadataFetchConditions; libraryId?: number } = { conditions: current }
      if (libraryId !== undefined) body.libraryId = libraryId
      const res = await api('/api/v1/book-metadata-fetch/preview-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data: { count: number } = await res.json()
        count.value = data.count
      }
    } finally {
      loading.value = false
    }
  }

  watch(
    conditions,
    () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(fetchCount, 400)
    },
    { deep: true, immediate: true },
  )

  return { count, loading }
}
