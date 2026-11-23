import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useLibraries } from './useLibraries'

/**
 * Re-reads the library list and the sidebar Browse counts after this client removed books. No
 * socket event announces a delete, so the client that made it refreshes what counts books.
 */
export function useLibraryCountsRefresh(): () => void {
  const { refreshLibraries } = useLibraries()
  const { refreshCounts } = useBrowseCounts()
  return () => {
    void refreshLibraries()
    void refreshCounts()
  }
}
