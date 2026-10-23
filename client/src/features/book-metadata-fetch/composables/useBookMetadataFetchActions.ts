import { api } from '@/lib/api'
import { ignoreCachePostInit, type IgnoreCacheOptions } from '@/features/metadata-cache/lib/metadata-cache'

export function useBookMetadataFetchActions() {
  async function triggerGlobal(options: IgnoreCacheOptions = {}): Promise<{ queued: number }> {
    const res = await api('/api/v1/book-metadata-fetch/run', ignoreCachePostInit(options))
    if (!res.ok) throw new Error('Failed to trigger run')
    return res.json()
  }

  async function triggerForLibrary(libraryId: number, options: IgnoreCacheOptions = {}): Promise<{ queued: number }> {
    const res = await api(`/api/v1/book-metadata-fetch/run/${libraryId}`, ignoreCachePostInit(options))
    if (!res.ok) throw new Error('Failed to trigger run')
    return res.json()
  }

  async function pause(): Promise<void> {
    const res = await api('/api/v1/book-metadata-fetch/pause', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to pause')
  }

  async function resume(): Promise<void> {
    const res = await api('/api/v1/book-metadata-fetch/resume', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to resume')
  }

  async function cancelPending(): Promise<void> {
    const res = await api('/api/v1/book-metadata-fetch/cancel', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to cancel')
  }

  async function retryFailed(): Promise<{ requeued: number }> {
    const res = await api('/api/v1/book-metadata-fetch/retry-failed', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to retry')
    return res.json()
  }

  return { triggerGlobal, triggerForLibrary, pause, resume, cancelPending, retryFailed }
}
