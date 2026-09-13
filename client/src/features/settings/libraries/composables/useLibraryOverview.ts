import { computed, ref } from 'vue'
import type { LibraryOverviewEntry } from '@bookorbit/types'
import { api } from '@/lib/api'

/**
 * One request for every library's counts and last scan, replacing a per-library fan-out that had no
 * concurrency bound and dropped failures silently. Reloads are coalesced because scan-completion
 * events can arrive for several libraries at once.
 */
export function useLibraryOverview() {
  const entries = ref<Map<number, LibraryOverviewEntry>>(new Map())
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  let inFlight: Promise<void> | null = null
  let reloadTimer: ReturnType<typeof setTimeout> | null = null

  async function load(): Promise<void> {
    if (inFlight) return inFlight
    loading.value = true
    inFlight = (async () => {
      try {
        const res = await api('/api/v1/libraries/overview')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: unknown = await res.json()
        if (!Array.isArray(data)) throw new Error('Invalid overview response')
        entries.value = new Map((data as LibraryOverviewEntry[]).map((entry) => [entry.libraryId, entry]))
        loaded.value = true
        error.value = null
      } catch (cause: unknown) {
        error.value = cause instanceof Error ? cause.message : 'Failed to load library stats'
      } finally {
        loading.value = false
        inFlight = null
      }
    })()
    return inFlight
  }

  /**
   * Collapses a burst of scan completions into a single refetch. Waiting on any request already in
   * flight matters because load() de-duplicates: without it a reload asked for mid-flight would
   * resolve against the older response and the post-scan counts would never arrive.
   */
  function scheduleReload(delayMs = 750): void {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = setTimeout(() => {
      reloadTimer = null
      void (async () => {
        if (inFlight) await inFlight
        await load()
      })()
    }, delayMs)
  }

  function dispose(): void {
    if (reloadTimer) clearTimeout(reloadTimer)
    reloadTimer = null
  }

  function get(libraryId: number): LibraryOverviewEntry | undefined {
    return entries.value.get(libraryId)
  }

  const totalBooks = computed(() => [...entries.value.values()].reduce((sum, entry) => sum + entry.totalBooks, 0))
  const totalSizeBytes = computed(() => [...entries.value.values()].reduce((sum, entry) => sum + entry.totalSizeBytes, 0))

  return { entries, loading, loaded, error, load, scheduleReload, dispose, get, totalBooks, totalSizeBytes }
}
