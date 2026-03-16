import { api } from '@/lib/api'

export function useBookMetadataFetchActions() {
  async function triggerGlobal(): Promise<{ queued: number }> {
    const res = await api('/api/v1/book-metadata-fetch/run', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to trigger run')
    return res.json()
  }

  async function triggerForLibrary(libraryId: number): Promise<{ queued: number }> {
    const res = await api(`/api/v1/book-metadata-fetch/run/${libraryId}`, { method: 'POST' })
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
