import { ref } from 'vue'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type { BookRequestDownloadItem } from '@bookorbit/types'

/**
 * Every release a request has been sent to, refusals included.
 *
 * Read on demand rather than carried on the request: the queue only ever shows the current
 * attempt, and the earlier ones are of interest to one person looking at one request. What makes
 * them worth a call at all is the refusals - a request that downloaded from its second source
 * looks unremarkable on its own row, and nothing else records that the first one said no.
 */
export function useRequestAttempts(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  const attempts = ref<BookRequestDownloadItem[]>([])
  const loading = ref(false)
  const failed = ref(false)
  /** Bumped per fetch, so stepping to the next request cannot be answered with the last one's. */
  let generation = 0

  async function fetchAttempts(requestId: number): Promise<void> {
    const current = ++generation
    loading.value = true
    failed.value = false
    try {
      const res = await api(`${basePath()}/${requestId}/attempts`)
      if (current !== generation) return
      if (!res.ok) {
        failed.value = true
        attempts.value = []
        return
      }
      const payload = (await res.json()) as BookRequestDownloadItem[]
      if (current !== generation) return
      attempts.value = payload
    } catch {
      if (current !== generation) return
      failed.value = true
      attempts.value = []
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reset(): void {
    generation++
    attempts.value = []
    failed.value = false
    loading.value = false
  }

  return { attempts, loading, failed, fetchAttempts, reset }
}
