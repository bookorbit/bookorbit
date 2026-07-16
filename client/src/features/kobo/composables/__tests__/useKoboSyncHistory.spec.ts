import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KoboSyncHistoryEntry } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeHistoryEntry(overrides: Partial<KoboSyncHistoryEntry> = {}): KoboSyncHistoryEntry {
  return {
    id: 1,
    deviceId: 2,
    deviceName: 'Kobo Libra',
    event: 'library_sync',
    status: 'success',
    counts: { entitlements: 3, hasMore: false },
    durationMs: 25,
    errorClass: null,
    error: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

describe('useKoboSyncHistory', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('fetchHistory loads recent Kobo sync history', async () => {
    const history = [makeHistoryEntry()]
    apiMock.mockResolvedValueOnce(makeResponse(history))

    const { useKoboSyncHistory } = await import('../useKoboSyncHistory')
    const { history: loadedHistory, loading, fetchHistory } = useKoboSyncHistory()

    await fetchHistory()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/kobo/history?limit=20')
    expect(loadedHistory.value).toEqual(history)
    expect(loading.value).toBe(false)
  })

  it('sets loading while fetchHistory is in flight', async () => {
    let resolveResponse: ((value: Response) => void) | undefined
    apiMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const { useKoboSyncHistory } = await import('../useKoboSyncHistory')
    const { loading, fetchHistory } = useKoboSyncHistory()

    const promise = fetchHistory()
    expect(loading.value).toBe(true)

    resolveResponse?.(makeResponse([makeHistoryEntry()]))
    await promise

    expect(loading.value).toBe(false)
  })

  it('deduplicates concurrent fetches', async () => {
    apiMock.mockResolvedValueOnce(makeResponse([makeHistoryEntry({ id: 2 })]))

    const { useKoboSyncHistory } = await import('../useKoboSyncHistory')
    const { fetchHistory } = useKoboSyncHistory()

    await Promise.all([fetchHistory(), fetchHistory()])

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('throws a fallback error when the API request fails', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'nope' }, { ok: false, status: 500 }))

    const { useKoboSyncHistory } = await import('../useKoboSyncHistory')
    const { loading, fetchHistory } = useKoboSyncHistory()

    await expect(fetchHistory()).rejects.toThrow('Failed to fetch Kobo sync history')
    expect(loading.value).toBe(false)
  })
})
