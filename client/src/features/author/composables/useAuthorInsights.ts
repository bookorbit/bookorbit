import { ref } from 'vue'

import type { AuthorInsights } from '@projectx/types'
import { fetchAuthorInsights } from '../api/author'

export function useAuthorInsights() {
  const insights = ref<AuthorInsights | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(libraryId: number | null) {
    loading.value = true
    error.value = null
    try {
      insights.value = await fetchAuthorInsights({
        libraryId,
        windowDays: 30,
        limit: 8,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load author insights'
    } finally {
      loading.value = false
    }
  }

  return { insights, loading, error, load }
}
