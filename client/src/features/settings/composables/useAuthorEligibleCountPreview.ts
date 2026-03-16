import { ref, watch, type Ref } from 'vue'
import type { AuthorEnrichmentConditions } from '@projectx/types'
import { api } from '@/lib/api'

export function useAuthorEligibleCountPreview(conditions: Ref<AuthorEnrichmentConditions | null>) {
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
      const res = await api('/api/v1/authors/enrichment/preview-count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: current }),
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
