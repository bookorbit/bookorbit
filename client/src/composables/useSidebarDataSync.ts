import { computed, onMounted, onUnmounted, watch } from 'vue'
import { Permission } from '@bookorbit/types'
import { useBrowseCounts } from '@/composables/useBrowseCounts'
import { useSidebarLibraryActivity } from '@/composables/useSidebarLibraryActivity'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookDockSummary } from '@/features/book-dock/composables/useBookDockSummary'
import { useBookRequestProgress } from '@/features/book-requests/composables/useBookRequestProgress'
import { useBookRequestSummary } from '@/features/book-requests/composables/useBookRequestSummary'
import { useBookRequestVisibility } from '@/features/book-requests/composables/useBookRequestVisibility'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryScanRefresh } from '@/features/library/composables/useLibraryScanRefresh'
import { useLibraryUploadEvents } from '@/features/library/composables/useLibraryUploadEvents'
import { getSocket } from '@/features/scanner/composables/useScanProgress'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'

/**
 * Loads what the app sidebar lists and badges, and keeps it current while the shell is mounted.
 * Call once, from the sidebar: the scan refresh and live listeners it registers are app-wide.
 */
export function useSidebarDataSync() {
  const { hasPermission } = usePermissions()
  const { showBookRequests } = useBookRequestVisibility()
  const { libraries, fetchLibraries, refreshLibraries } = useLibraries()
  const { fetchSmartScopes } = useSmartScopes()
  const { fetchCollections } = useCollections()
  const { fetchCounts: fetchBrowseCounts, refreshCounts: refreshBrowseCounts } = useBrowseCounts()
  const { loadAppInfo } = useAppInfo()
  const { fetchSummary: fetchBookDockSummary, subscribe: subscribeBookDockSummary } = useBookDockSummary()
  const { summary: bookRequestSummary, fetchSummary: fetchBookRequestSummary, refreshSummary: refreshBookRequestSummary } = useBookRequestSummary()
  const { subscribe: subscribeLibraryActivity } = useSidebarLibraryActivity()
  const { onLibraryUploadCompleted } = useLibraryUploadEvents()
  const requestProgress = hasPermission(Permission.BookRequestAccess) ? useBookRequestProgress() : null
  useLibraryScanRefresh()

  const outstandingRequestTotal = computed(() =>
    hasPermission(Permission.ManageBookRequests) ? (bookRequestSummary.value?.active ?? 0) : (bookRequestSummary.value?.mine ?? 0),
  )

  onMounted(async () => {
    getSocket()
    await fetchLibraries()
    for (const library of libraries.value) {
      subscribeLibraryActivity(library)
    }
    void fetchSmartScopes()
    void fetchCollections()
    void fetchBrowseCounts()
    if (showBookRequests.value && hasPermission(Permission.BookRequestAccess)) void fetchBookRequestSummary()
    void loadAppInfo()
    if (hasPermission('book_dock_access')) {
      void fetchBookDockSummary()
      subscribeBookDockSummary()
    }
  })

  requestProgress?.onRequestsChanged(() => {
    if (showBookRequests.value) void refreshBookRequestSummary()
  })

  if (requestProgress) {
    watch(requestProgress.connected, (connected) => {
      if (connected && showBookRequests.value) void refreshBookRequestSummary()
    })
  }

  watch(showBookRequests, (visible) => {
    if (visible && hasPermission(Permission.BookRequestAccess)) void fetchBookRequestSummary()
  })

  const stopLibraryUploadListener = onLibraryUploadCompleted((event) => {
    if (event.uploadedCount === 0) return
    void refreshLibraries()
    void refreshBrowseCounts()
  })

  onUnmounted(() => stopLibraryUploadListener())

  return { outstandingRequestTotal }
}
