import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Library } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeLibrary(overrides: Partial<Library> = {}): Library {
  return {
    id: 3,
    name: 'Main Library',
    icon: null,
    displayOrder: 0,
    coverAspectRatio: '2/3',
    watch: false,
    autoScanCronExpression: null,
    metadataPrecedence: [],
    formatPriority: [],
    allowedFormats: [],
    organizationMode: 'book_per_file',
    excludePatterns: [],
    readingThreshold: 10,
    markAsFinishedPercentComplete: 95,
    fileNamingPattern: null,
    fileWriteEnabled: false,
    fileWriteWriteCover: false,
    fileWriteEpubEnabled: false,
    fileWriteEpubMaxFileSizeMb: 50,
    fileWriteFb2Enabled: false,
    fileWriteFb2MaxFileSizeMb: 100,
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 50,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 50,
    fileWriteKindleEnabled: false,
    fileWriteKindleMaxFileSizeMb: 100,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 50,
    fileRenameEnabled: false,
    folders: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeResponse(data?: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

describe('useLibraries', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('loads libraries successfully and caches the result', async () => {
    const library = makeLibrary()
    apiMock.mockResolvedValueOnce(makeResponse([library]))

    const { useLibraries } = await import('../useLibraries')
    const { libraries, loaded, loading, error, fetchLibraries } = useLibraries()

    await fetchLibraries()
    await fetchLibraries()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(libraries.value).toEqual([library])
    expect(loaded.value).toBe(true)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('treats an empty successful response as a loaded library list', async () => {
    apiMock.mockResolvedValueOnce(makeResponse([]))

    const { useLibraries } = await import('../useLibraries')
    const { libraries, loaded, error, fetchLibraries } = useLibraries()

    await fetchLibraries()

    expect(libraries.value).toEqual([])
    expect(loaded.value).toBe(true)
    expect(error.value).toBeNull()
  })

  it('reports an HTTP failure without rejecting or claiming the library list loaded', async () => {
    apiMock.mockResolvedValueOnce(makeResponse(undefined, false, 503))

    const { useLibraries } = await import('../useLibraries')
    const { libraries, loaded, loading, error, fetchLibraries } = useLibraries()

    await expect(fetchLibraries()).resolves.toBeUndefined()

    expect(libraries.value).toEqual([])
    expect(loaded.value).toBe(false)
    expect(loading.value).toBe(false)
    expect(error.value).toBe('HTTP 503')
  })

  it('reports a network failure without rejecting', async () => {
    apiMock.mockRejectedValueOnce(new TypeError('Network request failed'))

    const { useLibraries } = await import('../useLibraries')
    const { loaded, loading, error, fetchLibraries } = useLibraries()

    await expect(fetchLibraries()).resolves.toBeUndefined()

    expect(loaded.value).toBe(false)
    expect(loading.value).toBe(false)
    expect(error.value).toBe('Network request failed')
  })

  it('rejects an invalid successful payload as a load error', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({ libraries: [] }))

    const { useLibraries } = await import('../useLibraries')
    const { libraries, loaded, error, fetchLibraries } = useLibraries()

    await fetchLibraries()

    expect(libraries.value).toEqual([])
    expect(loaded.value).toBe(false)
    expect(error.value).toBe('Invalid library response')
  })

  it('clears a load error after a successful retry', async () => {
    const library = makeLibrary()
    apiMock.mockResolvedValueOnce(makeResponse(undefined, false, 502)).mockResolvedValueOnce(makeResponse([library]))

    const { useLibraries } = await import('../useLibraries')
    const { libraries, loaded, error, fetchLibraries } = useLibraries()

    await fetchLibraries()
    expect(error.value).toBe('HTTP 502')

    await fetchLibraries()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(libraries.value).toEqual([library])
    expect(loaded.value).toBe(true)
    expect(error.value).toBeNull()
  })

  it('preserves loaded libraries when a refresh fails', async () => {
    const library = makeLibrary()
    apiMock.mockResolvedValueOnce(makeResponse([library])).mockResolvedValueOnce(makeResponse(undefined, false, 504))

    const { useLibraries } = await import('../useLibraries')
    const { libraries, loaded, error, fetchLibraries, refreshLibraries } = useLibraries()

    await fetchLibraries()
    await refreshLibraries()

    expect(libraries.value).toEqual([library])
    expect(loaded.value).toBe(true)
    expect(error.value).toBe('HTTP 504')
  })

  it('deduplicates concurrent library fetches', async () => {
    const library = makeLibrary()
    let resolveFetch!: (response: Response) => void
    apiMock.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFetch = resolve)))

    const { useLibraries } = await import('../useLibraries')
    const { libraries, fetchLibraries } = useLibraries()

    const firstFetch = fetchLibraries()
    const secondFetch = fetchLibraries()
    resolveFetch(makeResponse([library]))
    await Promise.all([firstFetch, secondFetch])

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(libraries.value).toEqual([library])
  })

  it('resets cached libraries so the next fetch reloads them', async () => {
    const first = makeLibrary({ id: 1, name: 'Owner Library' })
    const second = makeLibrary({ id: 2, name: 'Next User Library' })
    apiMock.mockResolvedValueOnce(makeResponse([first])).mockResolvedValueOnce(makeResponse([second]))

    const { resetLibraries, useLibraries } = await import('../useLibraries')
    const { libraries, loaded, error, fetchLibraries } = useLibraries()

    await fetchLibraries()
    await fetchLibraries()
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(libraries.value).toEqual([first])
    expect(loaded.value).toBe(true)

    resetLibraries()

    expect(libraries.value).toEqual([])
    expect(loaded.value).toBe(false)
    expect(error.value).toBeNull()

    await fetchLibraries()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(libraries.value).toEqual([second])
    expect(loaded.value).toBe(true)
  })

  it('ignores an in-flight fetch after libraries are reset', async () => {
    const stale = makeLibrary({ id: 1, name: 'Stale Library' })
    let resolveFetch!: (response: Response) => void
    apiMock.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFetch = resolve)))

    const { resetLibraries, useLibraries } = await import('../useLibraries')
    const { libraries, loaded, loading, fetchLibraries } = useLibraries()

    const fetchPromise = fetchLibraries()
    expect(loading.value).toBe(true)

    resetLibraries()
    resolveFetch(makeResponse([stale]))
    await fetchPromise

    expect(libraries.value).toEqual([])
    expect(loaded.value).toBe(false)
    expect(loading.value).toBe(false)
  })

  it('ignores an in-flight failure after libraries are reset', async () => {
    let rejectFetch!: (cause: unknown) => void
    apiMock.mockReturnValueOnce(new Promise<Response>((_resolve, reject) => (rejectFetch = reject)))

    const { resetLibraries, useLibraries } = await import('../useLibraries')
    const { loaded, loading, error, fetchLibraries } = useLibraries()

    const fetchPromise = fetchLibraries()
    expect(loading.value).toBe(true)

    resetLibraries()
    rejectFetch(new TypeError('Stale network failure'))
    await fetchPromise

    expect(loaded.value).toBe(false)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
  })
})
