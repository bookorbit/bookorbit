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
    fileWritePdfEnabled: false,
    fileWritePdfMaxFileSizeMb: 50,
    fileWriteCbxEnabled: false,
    fileWriteCbxMaxFileSizeMb: 50,
    fileWriteAudioEnabled: false,
    fileWriteAudioMaxFileSizeMb: 50,
    fileRenameEnabled: false,
    folders: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeResponse(data?: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

describe('useLibraries', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('resets cached libraries so the next fetch reloads them', async () => {
    const first = makeLibrary({ id: 1, name: 'Owner Library' })
    const second = makeLibrary({ id: 2, name: 'Next User Library' })
    apiMock.mockResolvedValueOnce(makeResponse([first])).mockResolvedValueOnce(makeResponse([second]))

    const { resetLibraries, useLibraries } = await import('../useLibraries')
    const { libraries, loaded, fetchLibraries } = useLibraries()

    await fetchLibraries()
    await fetchLibraries()
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(libraries.value).toEqual([first])
    expect(loaded.value).toBe(true)

    resetLibraries()

    expect(libraries.value).toEqual([])
    expect(loaded.value).toBe(false)

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
})
