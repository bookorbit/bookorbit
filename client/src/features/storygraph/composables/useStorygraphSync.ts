import { computed, ref } from 'vue'
import type { StorygraphActiveSyncStatus, StorygraphSyncFailure, StorygraphSyncPendingSummary } from '@bookorbit/types'
import {
  cancelStorygraphSync,
  fetchStorygraphSyncFailures,
  fetchStorygraphSyncPendingSummary,
  fetchStorygraphSyncStatus,
  startStorygraphSync,
  streamStorygraphSyncStatus,
} from '../api/storygraph.api'
import { useStorygraphSettings } from './useStorygraphSettings'

const activeSyncStatus = ref<StorygraphActiveSyncStatus | null>(null)
const lastRunSummary = ref<StorygraphActiveSyncStatus | null>(null)
const syncFailures = ref<StorygraphSyncFailure[]>([])
const pendingSummary = ref<StorygraphSyncPendingSummary>({ totalBooks: 0, pendingBooks: 0 })
const syncing = ref(false)
const loadingPending = ref(true)
const error = ref<string | null>(null)

let streamAbortController: AbortController | null = null
let streamGeneration = 0

const isSyncing = computed(() => activeSyncStatus.value?.status === 'running')
const syncProgress = computed(() => {
  const s = activeSyncStatus.value
  if (!s || s.totalBooks === 0) return 0
  return Math.round((s.processedBooks / s.totalBooks) * 100)
})

export function useStorygraphSync() {
  function startSyncTracking(): void {
    stopSyncTracking()
    const generation = ++streamGeneration
    const controller = new AbortController()
    streamAbortController = controller

    void streamStorygraphSyncStatus(async (status) => {
      if (generation !== streamGeneration) return
      if (status && status.status !== 'running') {
        lastRunSummary.value = status
      }
      activeSyncStatus.value = status
      if (status?.status !== 'running') {
        stopSyncTracking()
        await Promise.all([fetchPendingSummary(), fetchSyncFailures()])
        await useStorygraphSettings().fetchSettings()
      }
    }, controller.signal)
      .then(async () => {
        if (generation !== streamGeneration) return
        await fetchPendingSummary()
        await useStorygraphSettings().fetchSettings()
      })
      .catch(async () => {
        if (generation !== streamGeneration) return
        if (controller.signal.aborted) return
        await fetchPendingSummary()
        if (activeSyncStatus.value?.status === 'running') {
          startSyncTracking()
        }
      })
  }

  function stopSyncTracking(): void {
    streamGeneration++
    if (streamAbortController !== null) {
      streamAbortController.abort()
      streamAbortController = null
    }
  }

  async function startSync(): Promise<void> {
    syncing.value = true
    error.value = null
    lastRunSummary.value = null
    try {
      const { runId } = await startStorygraphSync()
      if (runId <= 0) {
        error.value = 'StoryGraph sync is not available right now'
        await Promise.all([fetchPendingSummary(), useStorygraphSettings().fetchSettings()])
        return
      }
      activeSyncStatus.value = {
        runId,
        status: 'running',
        syncedBooks: 0,
        skippedBooks: 0,
        failedBooks: 0,
        processedBooks: 0,
        totalBooks: 0,
      }
      startSyncTracking()
      await fetchPendingSummary()
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to start sync'
    } finally {
      syncing.value = false
    }
  }

  async function cancelSync(): Promise<void> {
    await cancelStorygraphSync().catch(() => null)
    stopSyncTracking()
    activeSyncStatus.value = null
    await fetchPendingSummary()
  }

  async function fetchStatus(): Promise<void> {
    const [status] = await Promise.all([fetchStorygraphSyncStatus(), fetchPendingSummary(), fetchSyncFailures()])
    activeSyncStatus.value = status
    if (status?.status === 'running') {
      startSyncTracking()
    }
  }

  async function fetchSyncFailures(): Promise<void> {
    try {
      syncFailures.value = await fetchStorygraphSyncFailures()
    } catch {
      // silent: the failure list is supplementary and must not break the sync card
    }
  }

  async function fetchPendingSummary(): Promise<void> {
    loadingPending.value = true
    try {
      pendingSummary.value = await fetchStorygraphSyncPendingSummary()
    } catch {
      // silent
    } finally {
      loadingPending.value = false
    }
  }

  return {
    activeSyncStatus,
    lastRunSummary,
    syncFailures,
    pendingSummary,
    syncing,
    loadingPending,
    error,
    isSyncing,
    syncProgress,
    startSync,
    cancelSync,
    fetchStatus,
    fetchPendingSummary,
    fetchSyncFailures,
    stopSyncTracking,
  }
}
