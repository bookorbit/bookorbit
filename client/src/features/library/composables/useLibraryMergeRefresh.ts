import { onScopeDispose } from 'vue'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useLibraries } from './useLibraries'

const REFRESH_DEBOUNCE_MS = 500

/**
 * Refreshes the library list and the sidebar Browse counts after a merge, which removes books
 * without a scan. Mount this once per app, beside `useLibraryScanRefresh`.
 */
export function useLibraryMergeRefresh(): void {
  const { refreshLibraries } = useLibraries()
  const { refreshCounts } = useBrowseCounts()
  let timer: ReturnType<typeof setTimeout> | null = null

  const stop = useBookEvents().onBookMerged(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void refreshLibraries()
      void refreshCounts()
    }, REFRESH_DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    stop()
    if (timer) clearTimeout(timer)
  })
}
