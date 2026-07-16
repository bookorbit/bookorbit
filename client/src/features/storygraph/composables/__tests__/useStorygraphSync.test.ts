import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorygraphActiveSyncStatus, StorygraphSettings, StorygraphSyncPendingSummary } from '@bookorbit/types'

vi.mock('../../api/storygraph.api', () => ({
  startStorygraphSync: vi.fn<() => Promise<{ runId: number }>>(),
  cancelStorygraphSync: vi.fn<() => Promise<void>>(),
  fetchStorygraphSyncStatus: vi.fn<() => Promise<StorygraphActiveSyncStatus | null>>(),
  fetchStorygraphSyncPendingSummary: vi.fn<() => Promise<StorygraphSyncPendingSummary>>(),
  streamStorygraphSyncStatus: vi.fn<(onStatus: (s: StorygraphActiveSyncStatus | null) => void, signal?: AbortSignal) => Promise<void>>(),
  fetchStorygraphSettings: vi.fn<() => Promise<StorygraphSettings>>(),
}))

import {
  cancelStorygraphSync,
  fetchStorygraphSettings,
  fetchStorygraphSyncStatus,
  fetchStorygraphSyncPendingSummary,
  startStorygraphSync,
  streamStorygraphSyncStatus,
} from '../../api/storygraph.api'

const mockStart = vi.mocked(startStorygraphSync)
const mockCancel = vi.mocked(cancelStorygraphSync)
const mockStatus = vi.mocked(fetchStorygraphSyncStatus)
const mockPendingSummary = vi.mocked(fetchStorygraphSyncPendingSummary)
const mockStream = vi.mocked(streamStorygraphSyncStatus)
const mockFetchSettings = vi.mocked(fetchStorygraphSettings)

const RUNNING_STATUS: StorygraphActiveSyncStatus = {
  runId: 1,
  status: 'running',
  totalBooks: 10,
  syncedBooks: 3,
  skippedBooks: 0,
  failedBooks: 0,
  processedBooks: 3,
}

const SETTINGS: StorygraphSettings = {
  cookiesConfigured: true,
  enabled: true,
  effectiveEnabled: true,
  disabledReason: null,
  bookSyncMode: 'all_eligible',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  lastSyncedAt: null,
}

async function loadComposable() {
  const { useStorygraphSync } = await import('../useStorygraphSync')
  return useStorygraphSync()
}

describe('useStorygraphSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.useFakeTimers()
    mockStatus.mockResolvedValue(null)
    mockPendingSummary.mockResolvedValue({ totalBooks: 0, pendingBooks: 0 })
    mockStream.mockResolvedValue(undefined)
    mockFetchSettings.mockResolvedValue(SETTINGS)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('startSync sets activeSyncStatus and starts stream', async () => {
    mockStart.mockResolvedValue({ runId: 1 })
    const c = await loadComposable()
    await c.startSync()
    expect(c.activeSyncStatus.value).toEqual({
      runId: 1,
      status: 'running',
      syncedBooks: 0,
      skippedBooks: 0,
      failedBooks: 0,
      processedBooks: 0,
      totalBooks: 0,
    })
    expect(c.isSyncing.value).toBe(true)
    c.stopSyncTracking()
  })

  it('startSync sets error on failure', async () => {
    mockStart.mockRejectedValue(new Error('Server busy'))
    const c = await loadComposable()
    await c.startSync()
    expect(c.error.value).toBe('Server busy')
  })

  it('startSync does not mark a run active when the server reports no run', async () => {
    mockStart.mockResolvedValue({ runId: 0 })
    const c = await loadComposable()
    await c.startSync()
    expect(c.activeSyncStatus.value).toBeNull()
    expect(c.error.value).toBe('StoryGraph sync is not available right now')
    expect(mockFetchSettings).toHaveBeenCalled()
  })

  it('cancelSync clears status and stops stream tracking', async () => {
    mockCancel.mockResolvedValue(undefined)
    const c = await loadComposable()
    c.activeSyncStatus.value = RUNNING_STATUS
    await c.cancelSync()
    expect(c.activeSyncStatus.value).toBeNull()
  })

  it('fetchStatus starts stream if sync is running', async () => {
    mockStatus.mockResolvedValue({ runId: 2, status: 'running', totalBooks: 10, syncedBooks: 3, skippedBooks: 0, failedBooks: 0, processedBooks: 3 })
    const c = await loadComposable()
    await c.fetchStatus()
    expect(c.isSyncing.value).toBe(true)
    expect(c.activeSyncStatus.value?.runId).toBe(2)
    c.stopSyncTracking()
  })

  it('fetchStatus loads pending summary', async () => {
    mockPendingSummary.mockResolvedValue({ totalBooks: 6, pendingBooks: 2 })
    const c = await loadComposable()
    await c.fetchStatus()
    expect(c.pendingSummary.value).toEqual({ totalBooks: 6, pendingBooks: 2 })
  })

  it('syncProgress is 0 when no sync', async () => {
    const c = await loadComposable()
    expect(c.syncProgress.value).toBe(0)
  })

  it('syncProgress is calculated correctly', async () => {
    const c = await loadComposable()
    c.activeSyncStatus.value = RUNNING_STATUS
    expect(c.syncProgress.value).toBe(30)
    c.stopSyncTracking()
  })

  it('ignores stale stream responses after stream stops', async () => {
    mockStart.mockResolvedValue({ runId: 1 })
    let onStatusFromStream: ((status: StorygraphActiveSyncStatus | null) => void | Promise<void>) | null = null
    mockStream.mockImplementationOnce(async (onStatus) => {
      onStatusFromStream = onStatus
      return new Promise<void>(() => {
        // keep stream open
      })
    })

    const c = await loadComposable()
    await c.startSync()
    expect(onStatusFromStream).not.toBeNull()

    c.stopSyncTracking()
    c.activeSyncStatus.value = null

    const streamCallback = onStatusFromStream as ((status: StorygraphActiveSyncStatus | null) => void | Promise<void>) | null
    if (streamCallback) {
      await streamCallback(RUNNING_STATUS)
    }

    expect(c.activeSyncStatus.value).toBeNull()
  })
})
