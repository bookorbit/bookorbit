import { computed, ref } from 'vue'
import type { HardcoverActiveSyncStatus, HardcoverSyncPendingSummary } from '@bookorbit/types'
import {
  cancelHardcoverSync,
  fetchHardcoverSyncPendingSummary,
  fetchHardcoverSyncStatus,
  startHardcoverSync,
  streamHardcoverSyncStatus,
} from '../api/hardcover.api'
import { useHardcoverSettings } from './useHardcoverSettings'

const activeSyncStatus = ref<HardcoverActiveSyncStatus | null>(null)
const pendingSummary = ref<HardcoverSyncPendingSummary>({ totalBooks: 0, pendingBooks: 0 })
const syncing = ref(false)
const loadingPending = ref(true)
const error = ref<string | null>(null)

let streamAbortController: AbortController | null = null
let streamGeneration = 0

const isSyncing = computed(() => activeSyncStatus.value?.status === 'running')
const syncProgress = computed(() => {
  const s = activeSyncStatus.value
  if (!s || s.totalBooks === 0) return 0
  return Math.round((s.syncedBooks / s.totalBooks) * 100)
})

export function useHardcoverSync() {
  function startSyncTracking(): void {
    stopSyncTracking()
    const generation = ++streamGeneration
    const controller = new AbortController()
    streamAbortController = controller

    void streamHardcoverSyncStatus(async (status) => {
      if (generation !== streamGeneration) return
      activeSyncStatus.value = status
      if (status?.status !== 'running') {
        stopSyncTracking()
        await fetchPendingSummary()
        await useHardcoverSettings().fetchSettings()
      }
    }, controller.signal)
      .then(async () => {
        if (generation !== streamGeneration) return
        await fetchPendingSummary()
        await useHardcoverSettings().fetchSettings()
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
    try {
      const { runId } = await startHardcoverSync()
      activeSyncStatus.value = {
        runId,
        status: 'running',
        syncedBooks: 0,
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
    await cancelHardcoverSync().catch(() => null)
    stopSyncTracking()
    activeSyncStatus.value = null
    await fetchPendingSummary()
  }

  async function fetchStatus(): Promise<void> {
    const [status] = await Promise.all([fetchHardcoverSyncStatus(), fetchPendingSummary()])
    activeSyncStatus.value = status
    if (status?.status === 'running') {
      startSyncTracking()
    }
  }

  async function fetchPendingSummary(): Promise<void> {
    loadingPending.value = true
    try {
      pendingSummary.value = await fetchHardcoverSyncPendingSummary()
    } catch {
      // silent
    } finally {
      loadingPending.value = false
    }
  }

  return {
    activeSyncStatus,
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
    stopSyncTracking,
  }
}
