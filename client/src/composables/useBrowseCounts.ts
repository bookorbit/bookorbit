import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BrowseCounts } from '@bookorbit/types'

const counts = ref<BrowseCounts | null>(null)
let fetchPromise: Promise<void> | null = null
let requestGeneration = 0

export function resetBrowseCounts(): void {
  requestGeneration += 1
  counts.value = null
  fetchPromise = null
}

/**
 * Totals behind the sidebar Browse badges. One request per shell mount, refetched only when a
 * scan or upload changed the library; a failed request leaves the badges hidden rather than
 * showing a stale or zero count.
 */
export function useBrowseCounts() {
  function fetchCounts(force = false): Promise<void> {
    if (!force && counts.value) return Promise.resolve()
    if (fetchPromise) return fetchPromise
    const generation = requestGeneration
    fetchPromise = api('/api/v1/browse-counts')
      .then(async (res) => {
        if (!res.ok) return
        const next: BrowseCounts = await res.json()
        if (generation !== requestGeneration) return
        counts.value = next
      })
      .catch(() => {
        // Badges are supplementary; a failure just leaves them out.
      })
      .finally(() => {
        if (generation === requestGeneration) fetchPromise = null
      })
    return fetchPromise
  }

  function refreshCounts(): Promise<void> {
    return fetchCounts(true)
  }

  return { counts, fetchCounts, refreshCounts }
}
