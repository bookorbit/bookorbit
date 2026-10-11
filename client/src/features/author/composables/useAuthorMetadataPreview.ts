import { computed, ref, shallowRef, type Ref } from 'vue'

import type { AuthorMetadataCandidate, MetadataCandidateCacheInfo } from '@bookorbit/types'
import { METADATA_CACHE_REFRESH, summarizeCandidateCache } from '@/features/metadata-cache/lib/metadata-cache'
import { streamAuthorMetadataCandidates } from '../api/author'

export interface AuthorMetadataPreviewLoadOptions {
  /** Skips saved answers and asks every provider live. */
  fresh?: boolean
}

export function useAuthorMetadataPreview(authorName: Ref<string>) {
  const preview = ref<AuthorMetadataCandidate | null>(null)
  /** Set when the metadata cache answered for the candidate shown as the preview. */
  const previewCache = ref<MetadataCandidateCacheInfo | null>(null)
  const candidateCaches = shallowRef<(MetadataCandidateCacheInfo | null)[]>([])
  const loading = ref(false)
  /** True once a lookup has finished, even with nothing found, so a fresh one can be offered. */
  const searched = ref(false)
  const error = ref<string | null>(null)
  let abortController: AbortController | null = null
  let requestSeq = 0

  const cacheSummary = computed(() => summarizeCandidateCache(candidateCaches.value))

  function cancel() {
    abortController?.abort()
    abortController = null
    loading.value = false
  }

  function showCandidate(candidate: AuthorMetadataCandidate, cache: MetadataCandidateCacheInfo | null) {
    preview.value = candidate
    previewCache.value = cache
  }

  function clearPreview() {
    preview.value = null
    previewCache.value = null
    candidateCaches.value = []
  }

  async function load(options: AuthorMetadataPreviewLoadOptions = {}) {
    const name = authorName.value.trim()
    if (!name) {
      clearPreview()
      error.value = null
      return
    }

    const seq = ++requestSeq
    loading.value = true
    searched.value = false
    error.value = null
    abortController?.abort()
    abortController = new AbortController()

    try {
      clearPreview()
      await streamAuthorMetadataCandidates(
        {
          q: name,
          region: 'us',
          limit: 6,
          ...(options.fresh ? { cache: METADATA_CACHE_REFRESH } : {}),
        },
        (candidate, cache) => {
          if (seq !== requestSeq) return
          candidateCaches.value = [...candidateCaches.value, cache]
          if (!preview.value) {
            showCandidate(candidate, cache)
            return
          }
          if (!preview.value.imageUrl && candidate.imageUrl) {
            showCandidate(candidate, cache)
          }
        },
        abortController.signal,
      )
      if (seq === requestSeq) searched.value = true
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      if (seq !== requestSeq) return
      preview.value = null
      previewCache.value = null
      error.value = err instanceof Error ? err.message : 'Failed to load author metadata'
    } finally {
      if (seq === requestSeq) {
        loading.value = false
      }
      abortController = null
    }
  }

  function loadFresh() {
    return load({ fresh: true })
  }

  return {
    preview,
    previewCache,
    cacheSummary,
    loading,
    searched,
    error,
    cancel,
    load,
    loadFresh,
  }
}
