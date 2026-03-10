import { ref, type Ref } from 'vue'

import type { AuthorDetail } from '@projectx/types'
import { fetchAuthor } from '../api/author'

export function useAuthorDetail(authorId: Ref<number>) {
  const author = ref<AuthorDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    if (!authorId.value || Number.isNaN(authorId.value)) {
      author.value = null
      return
    }

    loading.value = true
    error.value = null

    try {
      author.value = await fetchAuthor(authorId.value)
    } catch (err) {
      author.value = null
      error.value = err instanceof Error ? err.message : 'Failed to load author'
    } finally {
      loading.value = false
    }
  }

  return { author, loading, error, load }
}
