import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Collection } from '@bookorbit/types'

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

  it('fetches collections with per-selection membership counts', async () => {
    const withMembership = [makeCollection({ id: 3, memberCount: 1 })]
    apiMock.mockResolvedValueOnce(makeResponse(withMembership))

    const { useCollections } = await import('../useCollections')
    const { fetchCollectionsWithMembership } = useCollections()

    const result = await fetchCollectionsWithMembership({ query: { libraryId: 5, q: 'dune' } })

    expect(apiMock).toHaveBeenCalledWith('/api/v1/collections/membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { libraryId: 5, q: 'dune' } }),
    })
    expect(result).toEqual(withMembership)
  })

  it('removes books from a collection via DELETE and updates local state', async () => {
    const created = makeCollection({ id: 11, bookCount: 2 })
    const updated = makeCollection({ id: 11, bookCount: 1 })
    apiMock.mockResolvedValueOnce(makeResponse(created)).mockResolvedValueOnce(makeResponse(updated))

    const { useCollections } = await import('../useCollections')
    const { collections, createCollection, removeBooksFromCollection } = useCollections()

    await createCollection(created.name, created.icon ?? 'FolderOpen')
    const result = await removeBooksFromCollection(created.id, { bookIds: [7] })

    expect(apiMock).toHaveBeenLastCalledWith(`/api/v1/collections/${created.id}/books`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: [7] }),
    })
    expect(result).toEqual(updated)
    expect(collections.value).toEqual([updated])
  })

  it('throws when removeBooksFromCollection receives a non-ok response', async () => {
    apiMock.mockResolvedValueOnce(makeResponse(undefined, false))

    const { useCollections } = await import('../useCollections')
    const { removeBooksFromCollection } = useCollections()

    await expect(removeBooksFromCollection(1, { bookIds: [9] })).rejects.toThrow('Failed to remove books from collection')
  })

  it('resets cached collections so the next fetch reloads them', async () => {
    const first = makeCollection({ id: 1, name: 'Owner Collection' })
    const second = makeCollection({ id: 2, name: 'Next User Collection' })
    apiMock.mockResolvedValueOnce(makeResponse([first])).mockResolvedValueOnce(makeResponse([second]))

    const { resetCollections, useCollections } = await import('../useCollections')
    const { collections, loaded, fetchCollections } = useCollections()

    await fetchCollections()
    await fetchCollections()
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(collections.value).toEqual([first])
    expect(loaded.value).toBe(true)

    resetCollections()

    expect(collections.value).toEqual([])
    expect(loaded.value).toBe(false)

    await fetchCollections()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(collections.value).toEqual([second])
    expect(loaded.value).toBe(true)
  })
})
