import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HardcoverActiveSyncStatus } from '@bookorbit/types'

type ApiFn = (input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }) => Promise<Response>
type SyncStatusCallback = (status: HardcoverActiveSyncStatus | null) => void

vi.mock('@/lib/api', () => ({
  api: vi.fn<ApiFn>(),
}))

import { api } from '@/lib/api'
import {
  applyHardcoverImport,
  cancelHardcoverSync,
  disconnectHardcover,
  fetchHardcoverBookSyncState,
  fetchHardcoverEditions,
  fetchHardcoverLinkedBooks,
  fetchHardcoverSettings,
  fetchHardcoverSyncPendingSummary,
  fetchHardcoverSyncStatus,
  previewHardcoverImport,
  setHardcoverEdition,
  startHardcoverBookSync,
  startHardcoverSync,
  streamHardcoverSyncStatus,
  updateHardcoverBookSyncState,
  upsertHardcoverSettings,
  validateHardcoverToken,
} from '../hardcover.api'

const mockApi = vi.mocked(api)

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

describe('hardcover.api', () => {
  beforeEach(() => {
    mockApi.mockReset()
  })

  it('fetches and saves settings', async () => {
    mockApi
      .mockResolvedValueOnce(jsonResponse({ tokenConfigured: true, bookSyncMode: 'all_eligible' }))
      .mockResolvedValueOnce(jsonResponse({ enabled: true, bookSyncMode: 'selected_only' }))

    await expect(fetchHardcoverSettings()).resolves.toEqual({ tokenConfigured: true, bookSyncMode: 'all_eligible' })
    await expect(upsertHardcoverSettings({ enabled: true, bookSyncMode: 'selected_only' })).resolves.toEqual({
      enabled: true,
      bookSyncMode: 'selected_only',
    })

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/v1/hardcover/settings')
    expect(mockApi).toHaveBeenNthCalledWith(
      2,
      '/api/v1/hardcover/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ enabled: true, bookSyncMode: 'selected_only' }),
      }),
    )
  })

  it('disconnects and validates tokens', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse(null)).mockResolvedValueOnce(jsonResponse({ valid: true, hardcoverUsername: 'neon' }))

    await expect(disconnectHardcover()).resolves.toBeUndefined()
    await expect(validateHardcoverToken('tok')).resolves.toEqual({ valid: true, hardcoverUsername: 'neon' })

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/v1/hardcover/settings', { method: 'DELETE' })
    expect(mockApi).toHaveBeenNthCalledWith(
      2,
      '/api/v1/hardcover/validate-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 'tok' }),
      }),
    )
  })

  it('starts, cancels, and reads sync status', async () => {
    mockApi
      .mockResolvedValueOnce(jsonResponse({ runId: 42 }))
      .mockResolvedValueOnce(jsonResponse(null))
      .mockResolvedValueOnce(jsonResponse({ runId: 42, syncedBooks: 1, totalBooks: 2, status: 'running' }))
      .mockResolvedValueOnce(jsonResponse({ totalBooks: 10, pendingBooks: 3 }))

    await expect(startHardcoverSync()).resolves.toEqual({ runId: 42 })
    await expect(cancelHardcoverSync()).resolves.toBeUndefined()
    await expect(fetchHardcoverSyncStatus()).resolves.toEqual({ runId: 42, syncedBooks: 1, totalBooks: 2, status: 'running' })
    await expect(fetchHardcoverSyncPendingSummary()).resolves.toEqual({ totalBooks: 10, pendingBooks: 3 })
  })

  it('returns null or empty summaries for non-ok status endpoints', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({}, false)).mockResolvedValueOnce(jsonResponse({}, false))

    await expect(fetchHardcoverSyncStatus()).resolves.toBeNull()
    await expect(fetchHardcoverSyncPendingSummary()).resolves.toEqual({ totalBooks: 0, pendingBooks: 0 })
  })

  it('fetches and updates per-book sync state', async () => {
    mockApi
      .mockResolvedValueOnce(
        jsonResponse({
          bookId: 12,
          syncOverride: null,
          syncEnabled: true,
          canSyncNow: true,
          effectiveReason: null,
          lastSyncedAt: null,
          syncError: null,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          bookId: 12,
          syncOverride: 'excluded',
          syncEnabled: false,
          canSyncNow: false,
          effectiveReason: 'excluded',
          lastSyncedAt: null,
          syncError: null,
        }),
      )

    await expect(fetchHardcoverBookSyncState(12)).resolves.toEqual({
      bookId: 12,
      syncOverride: null,
      syncEnabled: true,
      canSyncNow: true,
      effectiveReason: null,
      lastSyncedAt: null,
      syncError: null,
    })
    await expect(updateHardcoverBookSyncState(12, { syncEnabled: false })).resolves.toEqual({
      bookId: 12,
      syncOverride: 'excluded',
      syncEnabled: false,
      canSyncNow: false,
      effectiveReason: 'excluded',
      lastSyncedAt: null,
      syncError: null,
    })

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/v1/hardcover/books/12/sync-state')
    expect(mockApi).toHaveBeenNthCalledWith(
      2,
      '/api/v1/hardcover/books/12/sync-state',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ syncEnabled: false }),
      }),
    )
  })

  it('starts a manual sync for a single book', async () => {
    mockApi.mockResolvedValueOnce(
      jsonResponse({
        result: 'synced',
        state: {
          bookId: 12,
          syncOverride: 'included',
          syncEnabled: true,
          canSyncNow: false,
          effectiveReason: null,
          lastSyncedAt: '2026-06-24T18:00:00.000Z',
          syncError: null,
        },
      }),
    )

    await expect(startHardcoverBookSync(12)).resolves.toEqual({
      result: 'synced',
      state: {
        bookId: 12,
        syncOverride: 'included',
        syncEnabled: true,
        canSyncNow: false,
        effectiveReason: null,
        lastSyncedAt: '2026-06-24T18:00:00.000Z',
        syncError: null,
      },
    })

    expect(mockApi).toHaveBeenCalledWith('/api/v1/hardcover/books/12/sync', { method: 'POST' })
  })

  it('fetches linked books and editions, and sets an edition', async () => {
    mockApi
      .mockResolvedValueOnce(jsonResponse([{ bookId: 12, title: 'Book', authorName: 'Author', hardcoverBookId: 100, hardcoverEditionId: null }]))
      .mockResolvedValueOnce(jsonResponse([{ id: 200, format: 'Physical Book' }]))
      .mockResolvedValueOnce(jsonResponse({ success: true }))

    await expect(fetchHardcoverLinkedBooks()).resolves.toEqual([
      { bookId: 12, title: 'Book', authorName: 'Author', hardcoverBookId: 100, hardcoverEditionId: null },
    ])
    await expect(fetchHardcoverEditions(12)).resolves.toEqual([{ id: 200, format: 'Physical Book' }])
    await expect(setHardcoverEdition(12, 200)).resolves.toEqual({ success: true })

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/v1/hardcover/books')
    expect(mockApi).toHaveBeenNthCalledWith(2, '/api/v1/hardcover/books/12/editions')
    expect(mockApi).toHaveBeenNthCalledWith(
      3,
      '/api/v1/hardcover/books/12/edition',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ editionId: 200 }),
      }),
    )
  })

  it('returns an empty array when fetching editions fails', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({}, false))
    await expect(fetchHardcoverEditions(12)).resolves.toEqual([])
  })

  it('throws when fetching linked books or setting an edition fails', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({}, false)).mockResolvedValueOnce(jsonResponse({}, false))

    await expect(fetchHardcoverLinkedBooks()).rejects.toThrow('Failed to fetch Hardcover linked books')
    await expect(setHardcoverEdition(12, 200)).rejects.toThrow('Failed to set Hardcover edition')
  })

  it('previews and applies Hardcover import payloads', async () => {
    mockApi
      .mockResolvedValueOnce(jsonResponse({ summary: { willUpdate: 1 }, rows: [] }))
      .mockResolvedValueOnce(jsonResponse({ applied: 1, failed: 0 }))

    await expect(previewHardcoverImport()).resolves.toEqual({ summary: { willUpdate: 1 }, rows: [] })
    await expect(applyHardcoverImport({ hardcoverUserBookIds: [1000], importProgress: true })).resolves.toEqual({ applied: 1, failed: 0 })

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/v1/hardcover/import/preview', { method: 'POST' })
    expect(mockApi).toHaveBeenNthCalledWith(
      2,
      '/api/v1/hardcover/import/apply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ hardcoverUserBookIds: [1000], importProgress: true }),
      }),
    )
  })

  it('surfaces server messages for import failures', async () => {
    mockApi
      .mockResolvedValueOnce(jsonResponse({ message: 'No token' }, false))
      .mockResolvedValueOnce(jsonResponse({ message: 'Apply failed' }, false))

    await expect(previewHardcoverImport()).rejects.toThrow('No token')
    await expect(applyHardcoverImport()).rejects.toThrow('Apply failed')
  })

  it('uses default messages when import failure bodies do not include a message', async () => {
    mockApi
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))

    await expect(startHardcoverSync()).rejects.toThrow('Failed to start sync')
    await expect(previewHardcoverImport()).rejects.toThrow('Failed to preview Hardcover import')
    await expect(applyHardcoverImport()).rejects.toThrow('Failed to import Hardcover read status')
  })

  it('streams sync status events', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"activeSyncStatus":{"runId":1,"syncedBooks":0,"totalBooks":2,"status":"running"}}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: malformed\n\n'))
        controller.close()
      },
    })
    mockApi.mockResolvedValueOnce({ ok: true, body: stream } as Response)
    const onStatus = vi.fn<SyncStatusCallback>()

    await streamHardcoverSyncStatus(onStatus)

    expect(onStatus).toHaveBeenCalledWith({ runId: 1, syncedBooks: 0, totalBooks: 2, status: 'running' })
    expect(onStatus).toHaveBeenCalledTimes(1)
  })

  it('streams fragmented events and ignores event blocks without data lines', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: ping\n\n'))
        controller.enqueue(new TextEncoder().encode('data: {"activeSyncStatus":'))
        controller.enqueue(new TextEncoder().encode('null}\n\n'))
        controller.close()
      },
    })
    mockApi.mockResolvedValueOnce({ ok: true, body: stream } as Response)
    const onStatus = vi.fn<SyncStatusCallback>()

    await streamHardcoverSyncStatus(onStatus)

    expect(onStatus).toHaveBeenCalledWith(null)
    expect(onStatus).toHaveBeenCalledTimes(1)
  })

  it('throws when required API calls fail without a server message', async () => {
    mockApi
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))
      .mockResolvedValueOnce(jsonResponse({}, false))

    await expect(fetchHardcoverSettings()).rejects.toThrow('Failed to fetch Hardcover settings')
    await expect(upsertHardcoverSettings({ enabled: true })).rejects.toThrow('Failed to save settings')
    await expect(disconnectHardcover()).rejects.toThrow('Failed to disconnect Hardcover')
    await expect(validateHardcoverToken()).rejects.toThrow('Failed to validate token')
    await expect(fetchHardcoverBookSyncState(12)).rejects.toThrow('Failed to fetch Hardcover book sync state')
    await expect(streamHardcoverSyncStatus(vi.fn<SyncStatusCallback>())).rejects.toThrow('Failed to stream Hardcover sync status')
  })

  it('surfaces per-book sync state save failures with server messages', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({ message: 'Forbidden' }, false))

    await expect(updateHardcoverBookSyncState(12, { syncEnabled: true })).rejects.toThrow('Forbidden')
  })

  it('surfaces start sync failures with server messages', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({ message: 'Already running' }, false))

    await expect(startHardcoverSync()).rejects.toThrow('Already running')
  })
})
