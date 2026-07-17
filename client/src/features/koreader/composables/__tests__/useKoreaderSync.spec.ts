import { describe, it, expect, vi, beforeEach } from 'vitest'
import type {
  CreateKoreaderCredentialsPayload,
  KoreaderCredentials,
  KoreaderManualHashLink,
  KoreaderSyncStatus,
  KoreaderUnmatchedBook,
  UpdateKoreaderCredentialsPayload,
} from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeCredentials(overrides: Partial<KoreaderCredentials> = {}): KoreaderCredentials {
  return {
    username: 'reader-user',
    syncEnabled: true,
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
    latestPluginVersion: '0.5.0',
    pluginUpdateAvailable: false,
    sweeps: [],
    pluginTotals: {
      matchedBooks: 0,
      trashedAnnotations: 0,
      pendingDeletes: 0,
      failedPositions: 0,
      pageStatEvents: 0,
      annotations: 0,
      unmatchedBooks: 0,
    },
    ...overrides,
  }
}

function makeUnmatchedBook(overrides: Partial<KoreaderUnmatchedBook> = {}): KoreaderUnmatchedBook {
  return {
    hash: 'a'.repeat(32),
    title: 'Unmatched Title',
    authors: 'Author One',
    lastOpen: 1700000000,
    firstSeenAt: '2026-06-01T00:00:00.000Z',
    lastSeenAt: '2026-06-02T00:00:00.000Z',
    ...overrides,
  }
}

function makeManualHashLink(overrides: Partial<KoreaderManualHashLink> = {}): KoreaderManualHashLink {
  return {
    hash: 'b'.repeat(32),
    bookId: 70,
    bookFileId: 71,
    bookTitle: 'Linked Book',
    bookAuthors: ['Linked Author'],
    koreaderTitle: 'KOReader Title',
    koreaderAuthors: 'Device Author',
    koreaderLastOpen: 1700000001,
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
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

function makeInvalidJsonResponse(): Response {
  return {
    ok: false,
    status: 500,
    json: async () => Promise.reject(new Error('not json')),
  } as unknown as Response
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

  it('fetchSyncStatus does not toggle loading when called silently', async () => {
    const status = makeSyncStatus()
    let resolveResponse: ((value: Response) => void) | undefined
    apiMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { loading, syncStatus, fetchSyncStatus } = useKoreaderSync()

    const fetchPromise = fetchSyncStatus(true)
    expect(loading.value).toBe(false)

    resolveResponse?.(makeResponse(status))
    await fetchPromise

    expect(loading.value).toBe(false)
    expect(syncStatus.value).toEqual(status)
  })

  it('createCredentials makes POST with payload and refreshes status without toggling the page loading flag', async () => {
    const payload: CreateKoreaderCredentialsPayload = {
      username: 'new-user',
      password: 'secret',
    }
    const refreshedStatus = makeSyncStatus({ credentials: makeCredentials({ username: payload.username }) })
    apiMock.mockResolvedValueOnce(makeResponse({})).mockResolvedValueOnce(makeResponse(refreshedStatus))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, credentials, loading, createCredentials } = useKoreaderSync()

    const createPromise = createCredentials(payload)
    expect(loading.value).toBe(false)
    await createPromise

    const [url, request] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/koreader/credentials')
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(request.body))).toEqual(payload)
    expect(apiMock).toHaveBeenNthCalledWith(2, '/api/v1/koreader/sync-status')
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(credentials.value).toEqual(refreshedStatus.credentials)
    expect(loading.value).toBe(false)
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

  it('createCredentials uses the fallback error when the response body is not JSON', async () => {
    const payload: CreateKoreaderCredentialsPayload = {
      username: 'new-user',
      password: 'bad-secret',
    }
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { createCredentials } = useKoreaderSync()

    await expect(createCredentials(payload)).rejects.toThrow('Failed to create credentials')
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('updateCredentials makes PATCH with payload and refreshes status', async () => {
    const payload: UpdateKoreaderCredentialsPayload = {
      username: 'updated-user',
      syncEnabled: false,
    }
    const refreshedStatus = makeSyncStatus({
      credentials: makeCredentials({ username: 'updated-user', syncEnabled: false }),
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

  it('updateCredentials throws error on non-ok response with message', async () => {
    const payload: UpdateKoreaderCredentialsPayload = {
      syncEnabled: false,
    }
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'Username is already taken' }, { ok: false, status: 409 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { updateCredentials } = useKoreaderSync()

    await expect(updateCredentials(payload)).rejects.toThrow('Username is already taken')
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('updateCredentials uses the fallback error when the response body is not JSON', async () => {
    const payload: UpdateKoreaderCredentialsPayload = {
      syncEnabled: false,
    }
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { updateCredentials } = useKoreaderSync()

    await expect(updateCredentials(payload)).rejects.toThrow('Failed to update credentials')
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('deleteCredentials makes DELETE and clears refs', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, credentials, unmatchedBooks, manualHashLinks, deleteCredentials } = useKoreaderSync()
    syncStatus.value = makeSyncStatus()
    credentials.value = syncStatus.value.credentials
    unmatchedBooks.value = [makeUnmatchedBook()]
    manualHashLinks.value = [makeManualHashLink()]

    await deleteCredentials()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/credentials', { method: 'DELETE' })
    expect(syncStatus.value).toBeNull()
    expect(credentials.value).toBeNull()
    expect(unmatchedBooks.value).toEqual([])
    expect(manualHashLinks.value).toEqual([])
  })

  it('deleteCredentials throws when the delete request fails', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { deleteCredentials } = useKoreaderSync()

    await expect(deleteCredentials()).rejects.toThrow('Failed to delete credentials')
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

  it('getSyncUrl returns current origin for plugin setup', async () => {
    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { getSyncUrl } = useKoreaderSync()

    expect(getSyncUrl()).toBe(window.location.origin)
  })

  it('downloadPluginPackage requests the zip with the current origin and triggers a download', async () => {
    const blob = new Blob(['zip'])
    apiMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), blob: async () => blob } as unknown as Response)

    const originalCreateObjectURL = URL.createObjectURL
    const originalRevokeObjectURL = URL.revokeObjectURL
    const createObjectURL = vi.fn<(obj: Blob | MediaSource) => string>(() => 'blob:plugin-zip')
    const revokeObjectURL = vi.fn<(url: string) => void>()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    try {
      const { useKoreaderSync } = await import('../useKoreaderSync')
      const { downloadPluginPackage } = useKoreaderSync()

      await downloadPluginPackage()

      expect(apiMock).toHaveBeenCalledWith(`/api/v1/koreader/plugin-package?origin=${encodeURIComponent(window.location.origin)}`)
      expect(createObjectURL).toHaveBeenCalledWith(blob)
      expect(clickSpy).toHaveBeenCalledTimes(1)
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:plugin-zip')
    } finally {
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
      clickSpy.mockRestore()
    }
  })

  it('downloadPluginPackage throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'Create KOReader sync credentials first' }, { ok: false, status: 404 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { downloadPluginPackage } = useKoreaderSync()

    await expect(downloadPluginPackage()).rejects.toThrow('Create KOReader sync credentials first')
  })

  it('downloadPluginPackage uses the fallback error when the response body is not JSON', async () => {
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { downloadPluginPackage } = useKoreaderSync()

    await expect(downloadPluginPackage()).rejects.toThrow('Failed to download the plugin')
  })

  it('fetchUnmatchedBooks updates unmatched state', async () => {
    const rows = [makeUnmatchedBook()]
    apiMock.mockResolvedValueOnce(makeResponse(rows))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { unmatchedBooks, fetchUnmatchedBooks } = useKoreaderSync()

    await fetchUnmatchedBooks()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/unmatched-books')
    expect(unmatchedBooks.value).toEqual(rows)
  })

  it('fetchUnmatchedBooks throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'No permission' }, { ok: false, status: 403 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { fetchUnmatchedBooks } = useKoreaderSync()

    await expect(fetchUnmatchedBooks()).rejects.toThrow('No permission')
  })

  it('fetchManualHashLinks updates manual link state', async () => {
    const rows = [makeManualHashLink()]
    apiMock.mockResolvedValueOnce(makeResponse(rows))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { manualHashLinks, fetchManualHashLinks } = useKoreaderSync()

    await fetchManualHashLinks()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/hash-links')
    expect(manualHashLinks.value).toEqual(rows)
  })

  it('fetchManualHashLinks throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'No permission' }, { ok: false, status: 403 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { fetchManualHashLinks } = useKoreaderSync()

    await expect(fetchManualHashLinks()).rejects.toThrow('No permission')
  })

  it('linkUnmatchedBook posts the target book, removes the linked row, and refreshes status and manual links', async () => {
    const linked = { hash: 'a'.repeat(32), bookId: 55, bookFileId: 44 }
    const refreshedStatus = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 0 } })
    const manualLinks = [makeManualHashLink({ hash: linked.hash, bookId: linked.bookId, bookFileId: linked.bookFileId })]
    apiMock
      .mockResolvedValueOnce(makeResponse(linked))
      .mockResolvedValueOnce(makeResponse(refreshedStatus))
      .mockResolvedValueOnce(makeResponse(manualLinks))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { unmatchedBooks, syncStatus, manualHashLinks, linkUnmatchedBook } = useKoreaderSync()
    unmatchedBooks.value = [makeUnmatchedBook({ hash: linked.hash }), makeUnmatchedBook({ hash: 'b'.repeat(32) })]

    await expect(linkUnmatchedBook(linked.hash, { bookId: linked.bookId })).resolves.toEqual(linked)

    const [url, request] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/v1/koreader/unmatched-books/${linked.hash}/link`)
    expect(request.method).toBe('POST')
    expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(String(request.body))).toEqual({ bookId: linked.bookId })
    expect(unmatchedBooks.value).toEqual([makeUnmatchedBook({ hash: 'b'.repeat(32) })])
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(manualHashLinks.value).toEqual(manualLinks)
  })

  it('linkUnmatchedBook throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'KOReader hash already matches a different book' }, { ok: false, status: 409 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { linkUnmatchedBook } = useKoreaderSync()

    await expect(linkUnmatchedBook('a'.repeat(32), { bookId: 55 })).rejects.toThrow('KOReader hash already matches a different book')
  })

  it('dismissUnmatchedBook deletes the entry, removes it locally, and refreshes sync status without toggling the page loading flag', async () => {
    const hash = 'a'.repeat(32)
    const refreshedStatus = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 0 } })
    apiMock.mockResolvedValueOnce(makeResponse({ hash })).mockResolvedValueOnce(makeResponse(refreshedStatus))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { unmatchedBooks, syncStatus, loading, dismissUnmatchedBook } = useKoreaderSync()
    unmatchedBooks.value = [makeUnmatchedBook({ hash }), makeUnmatchedBook({ hash: 'b'.repeat(32) })]

    const dismissPromise = dismissUnmatchedBook(hash)
    expect(loading.value).toBe(false)
    await expect(dismissPromise).resolves.toEqual({ hash })

    expect(apiMock).toHaveBeenCalledWith(`/api/v1/koreader/unmatched-books/${hash}`, { method: 'DELETE' })
    expect(unmatchedBooks.value).toEqual([makeUnmatchedBook({ hash: 'b'.repeat(32) })])
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(loading.value).toBe(false)
  })

  it('dismissUnmatchedBook throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'KOReader unmatched book not found' }, { ok: false, status: 404 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { dismissUnmatchedBook } = useKoreaderSync()

    await expect(dismissUnmatchedBook('a'.repeat(32))).rejects.toThrow('KOReader unmatched book not found')
  })

  it('dismissUnmatchedBook falls back to a generic message when the error body is not JSON', async () => {
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { dismissUnmatchedBook } = useKoreaderSync()

    await expect(dismissUnmatchedBook('a'.repeat(32))).rejects.toThrow('Failed to dismiss KOReader unmatched book')
  })

  it('dismissAllUnmatchedBooks deletes all entries, clears local state, and refreshes sync status', async () => {
    const refreshedStatus = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 0 } })
    apiMock.mockResolvedValueOnce(makeResponse({ count: 2 })).mockResolvedValueOnce(makeResponse(refreshedStatus))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { unmatchedBooks, syncStatus, dismissAllUnmatchedBooks } = useKoreaderSync()
    unmatchedBooks.value = [makeUnmatchedBook({ hash: 'a'.repeat(32) }), makeUnmatchedBook({ hash: 'b'.repeat(32) })]

    await expect(dismissAllUnmatchedBooks()).resolves.toEqual({ count: 2 })

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/unmatched-books', { method: 'DELETE' })
    expect(unmatchedBooks.value).toEqual([])
    expect(syncStatus.value).toEqual(refreshedStatus)
  })

  it('dismissAllUnmatchedBooks throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'Something went wrong' }, { ok: false, status: 500 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { dismissAllUnmatchedBooks } = useKoreaderSync()

    await expect(dismissAllUnmatchedBooks()).rejects.toThrow('Something went wrong')
  })

  it('dismissAllUnmatchedBooks falls back to a generic message when the error body is not JSON', async () => {
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { dismissAllUnmatchedBooks } = useKoreaderSync()

    await expect(dismissAllUnmatchedBooks()).rejects.toThrow('Failed to dismiss all KOReader unmatched books')
  })

  it('relinkManualHashLink patches the target book and refreshes status and manual links', async () => {
    const linked = { hash: 'b'.repeat(32), bookId: 88, bookFileId: 89 }
    const refreshedStatus = makeSyncStatus()
    const manualLinks = [makeManualHashLink({ hash: linked.hash, bookId: linked.bookId, bookFileId: linked.bookFileId })]
    apiMock
      .mockResolvedValueOnce(makeResponse(linked))
      .mockResolvedValueOnce(makeResponse(refreshedStatus))
      .mockResolvedValueOnce(makeResponse(manualLinks))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, manualHashLinks, relinkManualHashLink } = useKoreaderSync()

    await expect(relinkManualHashLink(linked.hash, { bookId: linked.bookId })).resolves.toEqual(linked)

    const [url, request] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/v1/koreader/hash-links/${linked.hash}`)
    expect(request.method).toBe('PATCH')
    expect(JSON.parse(String(request.body))).toEqual({ bookId: linked.bookId })
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(manualHashLinks.value).toEqual(manualLinks)
  })

  it('relinkManualHashLink throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'KOReader hash already matches a different book' }, { ok: false, status: 409 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { relinkManualHashLink } = useKoreaderSync()

    await expect(relinkManualHashLink('b'.repeat(32), { bookId: 88 })).rejects.toThrow('KOReader hash already matches a different book')
  })

  it('unlinkManualHashLink deletes the link, removes it locally, and refreshes unmatched books', async () => {
    const hash = 'b'.repeat(32)
    const refreshedStatus = makeSyncStatus({ pluginTotals: { ...makeSyncStatus().pluginTotals, unmatchedBooks: 1 } })
    const unmatched = [makeUnmatchedBook({ hash })]
    apiMock
      .mockResolvedValueOnce(makeResponse({ hash }))
      .mockResolvedValueOnce(makeResponse(refreshedStatus))
      .mockResolvedValueOnce(makeResponse(unmatched))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, manualHashLinks, unmatchedBooks, unlinkManualHashLink } = useKoreaderSync()
    manualHashLinks.value = [makeManualHashLink({ hash }), makeManualHashLink({ hash: 'c'.repeat(32) })]

    await expect(unlinkManualHashLink(hash)).resolves.toEqual({ hash })

    expect(apiMock).toHaveBeenCalledWith(`/api/v1/koreader/hash-links/${hash}`, { method: 'DELETE' })
    expect(manualHashLinks.value).toEqual([makeManualHashLink({ hash: 'c'.repeat(32) })])
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(unmatchedBooks.value).toEqual(unmatched)
  })

  it('unlinkManualHashLink throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'KOReader manual link not found' }, { ok: false, status: 404 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { unlinkManualHashLink } = useKoreaderSync()

    await expect(unlinkManualHashLink('b'.repeat(32))).rejects.toThrow('KOReader manual link not found')
  })

  it('removeDevice deletes the device and refreshes the sync status without toggling the page loading flag', async () => {
    const refreshedStatus = makeSyncStatus({ devices: [] })
    apiMock.mockResolvedValueOnce(makeResponse({ success: true })).mockResolvedValueOnce(makeResponse(refreshedStatus))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, loading, removeDevice } = useKoreaderSync()

    const removePromise = removeDevice('device-1')
    expect(loading.value).toBe(false)
    await expect(removePromise).resolves.toBeUndefined()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/devices/device-1', { method: 'DELETE' })
    expect(syncStatus.value).toEqual(refreshedStatus)
    expect(loading.value).toBe(false)
  })

  it('removeDevice throws the server message on failure', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'KOReader device not found' }, { ok: false, status: 404 }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { removeDevice } = useKoreaderSync()

    await expect(removeDevice('missing-device')).rejects.toThrow('KOReader device not found')
  })

  it('removeDevice falls back to a generic message when the error body is not JSON', async () => {
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { removeDevice } = useKoreaderSync()

    await expect(removeDevice('device-1')).rejects.toThrow('Failed to remove KOReader device')
  })

  it('fetchFileNamingPattern returns a stable localized-error code for validation failures', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: ['Pattern is invalid', 'Pattern is too long'] }, { ok: false, status: 400 }))

    const { KoreaderFileNamingRequestError, useKoreaderSync } = await import('../useKoreaderSync')
    const { fetchFileNamingPattern } = useKoreaderSync()

    await expect(fetchFileNamingPattern()).rejects.toEqual(new KoreaderFileNamingRequestError('load'))
  })

  it('fetchFileNamingPattern returns the same stable code for non-JSON errors', async () => {
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { KoreaderFileNamingRequestError, useKoreaderSync } = await import('../useKoreaderSync')
    const { fetchFileNamingPattern } = useKoreaderSync()

    await expect(fetchFileNamingPattern()).rejects.toEqual(new KoreaderFileNamingRequestError('load'))
  })

  it('saveFileNamingPattern returns a stable localized-error code for validation failures', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ message: 'Pattern contains an unsupported token' }, { ok: false, status: 400 }))

    const { KoreaderFileNamingRequestError, useKoreaderSync } = await import('../useKoreaderSync')
    const { saveFileNamingPattern } = useKoreaderSync()

    await expect(saveFileNamingPattern({ pattern: '{unknown}' })).rejects.toEqual(new KoreaderFileNamingRequestError('account-save'))
  })

  it('saveFileNamingPattern returns the same stable code for non-JSON errors', async () => {
    apiMock.mockResolvedValueOnce(makeInvalidJsonResponse())

    const { KoreaderFileNamingRequestError, useKoreaderSync } = await import('../useKoreaderSync')
    const { saveFileNamingPattern } = useKoreaderSync()

    await expect(saveFileNamingPattern({ pattern: '{title}' })).rejects.toEqual(new KoreaderFileNamingRequestError('account-save'))
  })

  it('fetches and saves the account file naming pattern', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ pattern: 'pattern-a' })).mockResolvedValueOnce(makeResponse({ success: true }))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { fileNamingPattern, fetchFileNamingPattern, saveFileNamingPattern } = useKoreaderSync()

    await fetchFileNamingPattern()
    expect(fileNamingPattern.value).toBe('pattern-a')
    await saveFileNamingPattern({ pattern: 'pattern-b' })
    expect(fileNamingPattern.value).toBe('pattern-b')
  })

  it('saves and clears device file naming patterns', async () => {
    const refreshedStatus = makeSyncStatus()
    apiMock
      .mockResolvedValueOnce(makeResponse({ success: true }))
      .mockResolvedValueOnce(makeResponse(refreshedStatus))
      .mockResolvedValueOnce(makeResponse({ success: true }))
      .mockResolvedValueOnce(makeResponse(refreshedStatus))

    const { useKoreaderSync } = await import('../useKoreaderSync')
    const { syncStatus, saveDeviceFileNamingPattern, clearDeviceFileNamingPattern } = useKoreaderSync()

    await saveDeviceFileNamingPattern('device-one', { pattern: 'device-pattern', seriesPattern: '', standalonePattern: '' })
    expect(syncStatus.value).toEqual(refreshedStatus)
    await clearDeviceFileNamingPattern('device-one')
    expect(syncStatus.value).toEqual(refreshedStatus)
  })

  it('reports device file naming save and reset failures', async () => {
    apiMock
      .mockResolvedValueOnce(makeResponse({ message: 'invalid device pattern' }, { ok: false, status: 400 }))
      .mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

    const { KoreaderFileNamingRequestError, useKoreaderSync } = await import('../useKoreaderSync')
    const { saveDeviceFileNamingPattern, clearDeviceFileNamingPattern } = useKoreaderSync()

    await expect(saveDeviceFileNamingPattern('device-1', { pattern: 'bad', seriesPattern: '', standalonePattern: '' })).rejects.toEqual(
      new KoreaderFileNamingRequestError('device-save'),
    )
    await expect(clearDeviceFileNamingPattern('device-1')).rejects.toEqual(new KoreaderFileNamingRequestError('device-reset'))
  })
})
