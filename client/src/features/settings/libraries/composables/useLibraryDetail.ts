import { ref } from 'vue'
import type { LibraryAccessEntry, LibraryScanHistoryEntry } from '@bookorbit/types'
import { api } from '@/lib/api'

interface LibraryDetail {
  history: LibraryScanHistoryEntry[]
  accessCount: number
}

/**
 * Scan history and access are only worth fetching once a row is opened, so they load lazily and
 * stay cached per library for the life of the page.
 */
export function useLibraryDetail() {
  const details = ref<Map<number, LibraryDetail>>(new Map())
  const loading = ref<Set<number>>(new Set())
  const failed = ref<Set<number>>(new Set())
  const inFlight = new Map<number, Promise<void>>()
  /** Bumped by invalidate() so a request issued before a scan finished cannot write stale data. */
  let generation = 0

  async function load(libraryId: number): Promise<void> {
    if (details.value.has(libraryId)) return
    const existing = inFlight.get(libraryId)
    if (existing) return existing

    const requestGeneration = generation
    loading.value = new Set(loading.value).add(libraryId)
    const request = (async () => {
      try {
        const [historyRes, accessRes] = await Promise.all([
          api(`/api/v1/scanner/libraries/${libraryId}/scan-history?limit=5`),
          api(`/api/v1/libraries/${libraryId}/access`),
        ])
        if (!historyRes.ok || !accessRes.ok) throw new Error('Failed to load library detail')
        const history = (await historyRes.json()) as LibraryScanHistoryEntry[]
        const access = (await accessRes.json()) as LibraryAccessEntry[]
        if (requestGeneration !== generation) return
        details.value = new Map(details.value).set(libraryId, {
          history: Array.isArray(history) ? history : [],
          accessCount: Array.isArray(access) ? access.length : 0,
        })
        const nextFailed = new Set(failed.value)
        nextFailed.delete(libraryId)
        failed.value = nextFailed
      } catch {
        if (requestGeneration === generation) failed.value = new Set(failed.value).add(libraryId)
      } finally {
        const nextLoading = new Set(loading.value)
        nextLoading.delete(libraryId)
        loading.value = nextLoading
        inFlight.delete(libraryId)
      }
    })()
    inFlight.set(libraryId, request)
    return request
  }

  /** A finished scan adds a history row, so a reopened panel must not serve the stale list. */
  function invalidate(): void {
    generation += 1
    inFlight.clear()
    details.value = new Map()
    failed.value = new Set()
  }

  function get(libraryId: number): LibraryDetail | undefined {
    return details.value.get(libraryId)
  }

  return { details, loading, failed, load, invalidate, get }
}
