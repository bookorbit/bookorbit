import { ref } from 'vue'

import type { AuthorDuplicateSuggestion } from '@projectx/types'
import { fetchDuplicateAuthorSuggestions } from '../api/author'

export function useDuplicateSuggestions() {
  const suggestions = ref<AuthorDuplicateSuggestion[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(libraryId: number | null) {
    loading.value = true
    error.value = null
    try {
      suggestions.value = await fetchDuplicateAuthorSuggestions({
        libraryId,
        limit: 12,
        poolSize: 260,
        minConfidence: 0.82,
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load duplicate suggestions'
      suggestions.value = []
    } finally {
      loading.value = false
    }
  }

  return { suggestions, loading, error, load }
}
