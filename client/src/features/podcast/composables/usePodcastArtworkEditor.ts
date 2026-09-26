import { onScopeDispose, ref, type Ref } from 'vue'
import type { PodcastArtworkResult } from '@bookorbit/types'
import { apiJson, jsonBody } from '@/lib/api-json'

/**
 * Pending-then-confirm artwork editing, mirroring the book cover editor: a chosen file or URL is
 * only previewed until it is confirmed, so leaving the sheet never rewrites the stored artwork.
 */
export function usePodcastArtworkEditor(podcastId: Ref<number>) {
  const busy = ref(false)
  const error = ref<string | null>(null)
  const previewSrc = ref<string | null>(null)
  const pendingFile = ref<File | null>(null)
  const pendingUrl = ref<string | null>(null)

  function revokePreview() {
    if (previewSrc.value?.startsWith('blob:')) URL.revokeObjectURL(previewSrc.value)
  }

  function selectFile(file: File) {
    clearPending()
    pendingFile.value = file
    previewSrc.value = URL.createObjectURL(file)
  }

  function setUrl(url: string) {
    revokePreview()
    const normalized = url.trim()
    pendingFile.value = null
    pendingUrl.value = normalized || null
    previewSrc.value = null
    error.value = null
  }

  function clearPending() {
    revokePreview()
    previewSrc.value = null
    pendingFile.value = null
    pendingUrl.value = null
    error.value = null
  }

  async function confirm(): Promise<PodcastArtworkResult | null> {
    if (!pendingFile.value && !pendingUrl.value) return null
    busy.value = true
    error.value = null
    try {
      const result = pendingFile.value ? await uploadFile(pendingFile.value) : await uploadUrl(pendingUrl.value!)
      clearPending()
      return result
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : null
      return null
    } finally {
      busy.value = false
    }
  }

  async function revert(): Promise<PodcastArtworkResult | null> {
    busy.value = true
    error.value = null
    try {
      const result = await apiJson<PodcastArtworkResult>(
        `/api/v1/podcasts/${podcastId.value}/artwork`,
        { method: 'DELETE' },
        'podcast.errors.removeArtwork',
      )
      clearPending()
      return result
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : null
      return null
    } finally {
      busy.value = false
    }
  }

  function uploadFile(file: File): Promise<PodcastArtworkResult> {
    const body = new FormData()
    body.append('file', file)
    return apiJson(`/api/v1/podcasts/${podcastId.value}/artwork`, { method: 'POST', body }, 'podcast.errors.updateArtwork')
  }

  function uploadUrl(url: string): Promise<PodcastArtworkResult> {
    return apiJson(`/api/v1/podcasts/${podcastId.value}/artwork/from-url`, jsonBody('POST', { url }), 'podcast.errors.updateArtwork')
  }

  onScopeDispose(revokePreview)

  return { busy, error, previewSrc, pendingFile, pendingUrl, selectFile, setUrl, clearPending, confirm, revert }
}
