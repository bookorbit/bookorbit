import { computed, ref, watch, type Ref } from 'vue'
import type { LibraryScanHistoryEntry, LibraryStats } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'

/**
 * The library facts the title row states beside the count: its size for every reader, and when it
 * was last scanned for the people who can scan it (scan history is an admin route). Both reload
 * when a scan of this library finishes.
 */
export function useLibraryHeaderFacts(libraryId: Ref<number | null>, canSeeScans: Ref<boolean>) {
  const sizeBytes = ref<number | null>(null)
  const lastScanAt = ref<string | null>(null)
  const { isScanning } = useScanProgress()
  let generation = 0

  async function load() {
    const id = libraryId.value
    const run = ++generation
    if (id === null) {
      sizeBytes.value = null
      lastScanAt.value = null
      return
    }
    const [stats, history] = await Promise.all([
      api(`/api/v1/libraries/${id}/stats`)
        .then((res) => (res.ok ? (res.json() as Promise<LibraryStats>) : null))
        .catch(() => null),
      canSeeScans.value
        ? api(`/api/v1/scanner/libraries/${id}/scan-history?limit=5`)
            .then((res) => (res.ok ? (res.json() as Promise<LibraryScanHistoryEntry[]>) : null))
            .catch(() => null)
        : Promise.resolve(null),
    ])
    if (run !== generation) return
    sizeBytes.value = stats?.totalSizeBytes ?? null
    lastScanAt.value = history?.find((entry) => entry.status === 'completed' && entry.completedAt)?.completedAt ?? null
  }

  const scanning = computed(() => libraryId.value !== null && isScanning(libraryId.value))

  watch([libraryId, canSeeScans], () => void load(), { immediate: true })
  watch(scanning, (now, before) => {
    if (before && !now) void load()
  })

  return { sizeBytes, lastScanAt, scanning, refresh: load }
}
