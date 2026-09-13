import { ref } from 'vue'
import type { BookRequestSummary } from '@bookorbit/types'
import { api } from '@/lib/api'

const summary = ref<BookRequestSummary | null>(null)
let fetchPromise: Promise<void> | null = null
/** A forced refresh waiting on the fetch that was already in flight when it was asked for. */
let queuedRefresh: Promise<void> | null = null
let requestGeneration = 0

export function resetBookRequestSummary(): void {
  requestGeneration += 1
  summary.value = null
  fetchPromise = null
  queuedRefresh = null
}

export function useBookRequestSummary() {
  function fetchSummary(force = false): Promise<void> {
    if (!force && summary.value) return Promise.resolve()
    if (fetchPromise) return fetchPromise
    const generation = requestGeneration
    fetchPromise = api('/api/v1/book-requests/summary')
      .then(async (res) => {
        if (!res.ok) return
        const next: BookRequestSummary = await res.json()
        if (generation !== requestGeneration) return
        summary.value = next
      })
      .catch(() => {
        // The badge is supplementary, so a failed refresh leaves it hidden or stale.
      })
      .finally(() => {
        if (generation === requestGeneration) fetchPromise = null
      })
    return fetchPromise
  }

  /**
   * The counts as they are *after* whatever the caller just did.
   *
   * Joining the fetch already in flight would answer with counts the server produced before the
   * action, and the badge would then sit on a pre-action number until something else moved. One
   * fresh fetch is queued behind it instead, and every caller in the same window shares that one.
   */
  function refreshSummary(): Promise<void> {
    if (!fetchPromise) return fetchSummary(true)
    if (queuedRefresh) return queuedRefresh

    const generation = requestGeneration
    queuedRefresh = fetchPromise.then(() => {
      queuedRefresh = null
      if (generation !== requestGeneration) return
      return fetchSummary(true)
    })
    return queuedRefresh
  }

  return { summary, fetchSummary, refreshSummary }
}
