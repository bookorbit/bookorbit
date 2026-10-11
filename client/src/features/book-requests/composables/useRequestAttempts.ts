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
/** The last answer per request, so returning to one shows its attempts at once. Bounded like the seed cache. */
const attemptsCache = new Map<string, BookRequestDownloadItem[]>()
const ATTEMPTS_CACHE_LIMIT = 50

function remember(key: string, value: BookRequestDownloadItem[]): void {
  attemptsCache.delete(key)
  attemptsCache.set(key, value)
  if (attemptsCache.size > ATTEMPTS_CACHE_LIMIT) attemptsCache.delete(attemptsCache.keys().next().value!)
}

/** Reads one request's attempts ahead of time, so opening it shows them straight away. */
export async function prefetchRequestAttempts(canManage: boolean, requestId: number): Promise<void> {
  const path = `${fulfilmentBase(canManage)}/${requestId}/attempts`
  try {
    const res = await api(path)
    if (res.ok) remember(path, (await res.json()) as BookRequestDownloadItem[])
  } catch {
    // The panel asks again when it opens.
  }
}

export function useRequestAttempts(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  const attempts = ref<BookRequestDownloadItem[]>([])
  const loading = ref(false)
  const failed = ref(false)
  /** Bumped per fetch, so stepping to the next request cannot be answered with the last one's. */
  let generation = 0

  async function fetchAttempts(requestId: number): Promise<void> {
    const current = ++generation
    const path = `${basePath()}/${requestId}/attempts`
    const cached = attemptsCache.get(path)
    loading.value = cached === undefined
    failed.value = false
    if (cached) attempts.value = cached
    try {
      const res = await api(path)
      if (current !== generation) return
      if (!res.ok) {
        failed.value = true
        attempts.value = []
        return
      }
      const payload = (await res.json()) as BookRequestDownloadItem[]
      if (current !== generation) return
      remember(path, payload)
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
