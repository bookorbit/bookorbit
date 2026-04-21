import { ref, type Ref } from 'vue'

import type { AuthorMetadataCandidate } from '@bookorbit/types'
import { streamAuthorMetadataCandidates } from '../api/author'

export function useAuthorMetadataPreview(authorName: Ref<string>) {
  const preview = ref<AuthorMetadataCandidate | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let abortController: AbortController | null = null
  let requestSeq = 0

  function cancel() {
    abortController?.abort()
    abortController = null
    loading.value = false
  }

  async function load() {
    const name = authorName.value.trim()
    if (!name) {
      preview.value = null
      error.value = null
      return
    }

    const seq = ++requestSeq
    loading.value = true
    error.value = null
    abortController?.abort()
    abortController = new AbortController()

    try {
      preview.value = null
      await streamAuthorMetadataCandidates(
        {
          q: name,
          region: 'us',
          limit: 6,
        },
        (candidate) => {
          if (seq !== requestSeq) return
          if (!preview.value) {
            preview.value = candidate
            return
          }
          if (!preview.value.imageUrl && candidate.imageUrl) {
            preview.value = candidate
          }
        },
        abortController.signal,
      )
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      if (seq !== requestSeq) return
      preview.value = null
      error.value = err instanceof Error ? err.message : 'Failed to load author metadata'
    } finally {
      if (seq === requestSeq) {
        loading.value = false
      }
      abortController = null
    }
  }

  return {
    preview,
    loading,
    error,
    cancel,
    load,
  }
}
