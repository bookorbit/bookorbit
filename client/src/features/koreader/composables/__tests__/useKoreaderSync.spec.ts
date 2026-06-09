import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CreateKoreaderCredentialsPayload, KoreaderCredentials, KoreaderSyncStatus, UpdateKoreaderCredentialsPayload } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeCredentials(overrides: Partial<KoreaderCredentials> = {}): KoreaderCredentials {
  return {
    username: 'reader-user',
    syncEnabled: true,
    discardBackwardProgress: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeSyncStatus(overrides: Partial<KoreaderSyncStatus> = {}): KoreaderSyncStatus {
  return {
    credentials: makeCredentials(),
    devices: [
      {
        device: 'Kobo Libra 2',
        deviceId: 'device-1',
        lastSyncAt: '2026-01-02T00:00:00.000Z',
        lastBookTitle: 'Project Hail Mary',
      },
    ],
    totalSyncedBooks: 14,
    lastSyncAt: '2026-01-02T00:00:00.000Z',
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

describe('useKoreaderSync', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('fetchSyncStatus makes GET request and updates syncStatus and credentials refs', async () => {
    const status = makeSyncStatus()
    apiMock.mockResolvedValueOnce(makeResponse(status))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, credentials, fetchSyncStatus } = useKoreaderSync()

    await fetchSyncStatus()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/sync-status')
    expect(syncStatus.value).toEqual(status)
    expect(credentials.value).toEqual(status.credentials)
  })

  it('fetchSyncStatus sets loading to true during fetch and false after', async () => {
    const status = makeSyncStatus()
    let resolveResponse: ((value: Response) => void) | undefined
    apiMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { loading, fetchSyncStatus } = useKoreaderSync()

    const fetchPromise = fetchSyncStatus()
    expect(loading.value).toBe(true)

    resolveResponse?.(makeResponse(status))
    await fetchPromise

    expect(loading.value).toBe(false)
  })

  it('createCredentials makes POST with payload and refreshes status', async () => {
    const payload: CreateKoreaderCredentialsPayload = {
      username: 'new-user',
      password: 'secret',
    }
    const refreshedStatus = makeSyncStatus({ credentials: makeCredentials({ username: payload.username }) })
    apiMock.mockResolvedValueOnce(makeResponse({})).mockResolvedValueOnce(makeResponse(refreshedStatus))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, credentials, createCredentials } = useKoreaderSync()

    await createCredentials(payload)

    const [url, request] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/koreader/credentials')
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(request.body))).toEqual(payload)
    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/v1/koreader/sync-status')
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(credentials.value).toEqual(refreshedStatus.credentials)
  })

  it('createCredentials throws error on non-ok response with message', async () => {
    const payload: CreateKoreaderCredentialsPayload = {
      username: 'new-user',
      password: 'bad-secret',
    }
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'Invalid KOReader credentials' }, { ok: false, status: 400 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { createCredentials } = useKoreaderSync()

    await expect(createCredentials(payload)).rejects.toThrow('Invalid KOReader credentials')
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('updateCredentials makes PATCH with payload and refreshes status', async () => {
    const payload: UpdateKoreaderCredentialsPayload = {
      username: 'updated-user',
      syncEnabled: false,
      discardBackwardProgress: true,
    }
    const refreshedStatus = makeSyncStatus({
      credentials: makeCredentials({ username: 'updated-user', syncEnabled: false, discardBackwardProgress: true }),
    })
    apiMock.mockResolvedValueOnce(makeResponse({})).mockResolvedValueOnce(makeResponse(refreshedStatus))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, credentials, updateCredentials } = useKoreaderSync()

    await updateCredentials(payload)

    const [url, request] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/koreader/credentials')
    expect(request.method).toBe('PATCH')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(request.body))).toEqual(payload)
    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/v1/koreader/sync-status')
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(credentials.value).toEqual(refreshedStatus.credentials)
  })

  it('deleteCredentials makes DELETE and clears refs', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, credentials, deleteCredentials } = useKoreaderSync()
    syncStatus.value = makeSyncStatus()
    credentials.value = syncStatus.value.credentials

    await deleteCredentials()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/credentials', { method: 'DELETE' })
    expect(syncStatus.value).toBeNull()
    expect(credentials.value).toBeNull()
  })

  it('testConnection returns true on success response', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ success: true }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { testConnection } = useKoreaderSync()

    await expect(testConnection('reader-user', 'secret')).resolves.toBe(true)
    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'reader-user', password: 'secret' }),
    })
  })

  it('testConnection returns false on failure response', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ success: false }, { ok: false, status: 500 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { testConnection } = useKoreaderSync()

    await expect(testConnection('reader-user', 'secret')).resolves.toBe(false)
  })

  it('getSyncUrl returns current origin plus koreader endpoint', async () => {
    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { getSyncUrl } = useKoreaderSync()

    expect(getSyncUrl()).toBe(`${window.location.origin}/api/v1/koreader`)
  })
})
