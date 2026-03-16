import { api } from '@/lib/api'

export function useAuthorEnrichmentActions() {
  async function pause(): Promise<void> {
    const res = await api('/api/v1/authors/enrichment/pause', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to pause')
  }

  async function resume(): Promise<void> {
    const res = await api('/api/v1/authors/enrichment/resume', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to resume')
  }

  async function cancelPending(): Promise<void> {
    const res = await api('/api/v1/authors/enrichment/cancel', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to cancel')
  }

  async function retryFailed(): Promise<{ requeued: number }> {
    const res = await api('/api/v1/authors/enrichment/retry-failed', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to retry')
    return res.json()
  }

  return { pause, resume, cancelPending, retryFailed }
}
