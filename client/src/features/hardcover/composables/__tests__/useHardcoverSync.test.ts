import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HardcoverActiveSyncStatus, HardcoverSettings, HardcoverSyncPendingSummary } from '@bookorbit/types'

vi.mock('../../api/hardcover.api', () => ({
  startHardcoverSync: vi.fn<() => Promise<{ runId: number }>>(),
  cancelHardcoverSync: vi.fn<() => Promise<void>>(),
  fetchHardcoverSyncStatus: vi.fn<() => Promise<HardcoverActiveSyncStatus | null>>(),
  fetchHardcoverSyncPendingSummary: vi.fn<() => Promise<HardcoverSyncPendingSummary>>(),
  streamHardcoverSyncStatus: vi.fn<(onStatus: (s: HardcoverActiveSyncStatus | null) => void, signal?: AbortSignal) => Promise<void>>(),
  fetchHardcoverSettings: vi.fn<() => Promise<HardcoverSettings>>(),
}))

import {
  cancelHardcoverSync,
  fetchHardcoverSettings,
  fetchHardcoverSyncStatus,
  fetchHardcoverSyncPendingSummary,
  startHardcoverSync,
  streamHardcoverSyncStatus,
} from '../../api/hardcover.api'

const mockStart = vi.mocked(startHardcoverSync)
const mockCancel = vi.mocked(cancelHardcoverSync)
const mockStatus = vi.mocked(fetchHardcoverSyncStatus)
const mockPendingSummary = vi.mocked(fetchHardcoverSyncPendingSummary)
const mockStream = vi.mocked(streamHardcoverSyncStatus)
const mockFetchSettings = vi.mocked(fetchHardcoverSettings)

const RUNNING_STATUS: HardcoverActiveSyncStatus = {
  runId: 1,
  status: 'running',
  totalBooks: 10,
  syncedBooks: 3,
}

const SETTINGS: HardcoverSettings = {
  tokenConfigured: true,
  enabled: true,
  effectiveEnabled: true,
  disabledReason: null,
  bookSyncMode: 'all_eligible',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  privacySettingId: 3,
  excludedLibraryIds: [],
  lastSyncedAt: null,
}

async function loadComposable() {
  const { useHardcoverSync } = await import('../useHardcoverSync')
  return useHardcoverSync()
}

describe('useHardcoverSync', () => {
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
    expect(c.error.value).toBe('Hardcover sync is not available right now')
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
    mockStatus.mockResolvedValue({ runId: 2, status: 'running', totalBooks: 10, syncedBooks: 3 })
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

  it('refreshes settings and pending counts when the stream reports a completed status', async () => {
    mockStart.mockResolvedValue({ runId: 1 })
    mockStream.mockImplementationOnce(async (onStatus) => {
      onStatus({
        runId: 1,
        status: 'completed',
        totalBooks: 10,
        syncedBooks: 10,
      })
      return new Promise<void>(() => {})
    })

    const c = await loadComposable()
    await c.startSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(mockPendingSummary).toHaveBeenCalled()
    expect(mockFetchSettings).toHaveBeenCalled()
    expect(c.isSyncing.value).toBe(false)
    expect(c.activeSyncStatus.value).toEqual({
      runId: 1,
      status: 'completed',
      totalBooks: 10,
      syncedBooks: 10,
    })
  })

  it('restarts stream tracking when the stream fails while sync is still active', async () => {
    mockStart.mockResolvedValue({ runId: 1 })
    mockStream.mockRejectedValueOnce(new Error('stream closed')).mockImplementationOnce(async () => new Promise<void>(() => {}))

    const c = await loadComposable()
    await c.startSync()
    await Promise.resolve()
    await Promise.resolve()

    expect(mockStream).toHaveBeenCalledTimes(2)
    expect(c.activeSyncStatus.value).toEqual({
      runId: 1,
      status: 'running',
      syncedBooks: 0,
      totalBooks: 0,
    })
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
    let onStatusFromStream: ((status: HardcoverActiveSyncStatus | null) => void | Promise<void>) | null = null
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

    const streamCallback = onStatusFromStream as ((status: HardcoverActiveSyncStatus | null) => void | Promise<void>) | null
    if (streamCallback) {
      await streamCallback(RUNNING_STATUS)
    }

    expect(c.activeSyncStatus.value).toBeNull()
  })
})
