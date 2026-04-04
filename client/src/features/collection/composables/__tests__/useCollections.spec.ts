import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '@projectx/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 7,
    name: 'Favorites',
    icon: 'FolderOpen',
    description: null,
    syncToKobo: false,
    displayOrder: 0,
    bookCount: 0,
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

describe('useCollections', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('creates collections with the provided icon', async () => {
    const created = makeCollection()
    apiMock.mockResolvedValueOnce(makeResponse(created))

    const { useCollections } = await import('../useCollections')
    const { collections, createCollection } = useCollections()

    await createCollection('Favorites', 'FolderOpen')

    const [, request] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(request.body))).toEqual({
      name: 'Favorites',
      icon: 'FolderOpen',
    })
    expect(collections.value).toEqual([created])
  })

  it('removes deleted collections from local state', async () => {
    const created = makeCollection()
    apiMock.mockResolvedValueOnce(makeResponse(created)).mockResolvedValueOnce(makeResponse())

    const { useCollections } = await import('../useCollections')
    const { collections, createCollection, deleteCollection } = useCollections()

    await createCollection(created.name, created.icon ?? 'FolderOpen')
    await deleteCollection(created.id)

    expect(apiMock).toHaveBeenLastCalledWith(`/api/v1/collections/${created.id}`, { method: 'DELETE' })
    expect(collections.value).toEqual([])
  })
})
