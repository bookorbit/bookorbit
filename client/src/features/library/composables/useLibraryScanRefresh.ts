import { watch } from 'vue'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'
import { useLibraries } from './useLibraries'

const REFRESH_COOLDOWN_MS = 5000

/**
 * Refreshes the library list and the sidebar Browse counts when a scan finishes so the
 * sidebar totals stay current. Mount this once per app; a second instance would double every refresh.
 */
export function useLibraryScanRefresh(): void {
  const { refreshLibraries } = useLibraries()
  const { refreshCounts } = useBrowseCounts()
  const { progressMap } = useScanProgress()
  const refreshedFor = new Set<number>()

  watch(progressMap, (map) => {
    for (const [libraryId, event] of map.entries()) {
      if (event.status === 'completed' && !refreshedFor.has(libraryId)) {
        refreshedFor.add(libraryId)
        void refreshLibraries()
        void refreshCounts()
        setTimeout(() => refreshedFor.delete(libraryId), REFRESH_COOLDOWN_MS)
      }
    }
  })
}
