import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SmartScope } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeSmartScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return {
    id: 11,
    userId: 3,
    name: 'Unread Sci-Fi',
    icon: null,
    filter: null,
    defaultSort: [],
    isPublic: false,
    syncToKobo: false,
    koboSyncEnabled: false,
    isOwner: true,
    displayOrder: 0,
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

describe('useSmartScopes', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('replaces the smartScope array when creating a smartScope', async () => {
    const created = makeSmartScope()
    apiMock.mockResolvedValueOnce(makeResponse(created))

    const { useSmartScopes } = await import('../useSmartScopes')
    const { smartScopes, createSmartScope } = useSmartScopes()
    const previous = smartScopes.value

    await createSmartScope({ name: created.name, icon: 'Aperture', defaultSort: [] })

    expect(smartScopes.value).toEqual([created])
    expect(smartScopes.value).not.toBe(previous)
  })

  it('replaces the smartScope array when updating a smartScope', async () => {
    const created = makeSmartScope()
    const updated = makeSmartScope({ name: 'Updated SmartScope' })
    apiMock.mockResolvedValueOnce(makeResponse(created)).mockResolvedValueOnce(makeResponse(updated))

    const { useSmartScopes } = await import('../useSmartScopes')
    const { smartScopes, createSmartScope, updateSmartScope } = useSmartScopes()

    await createSmartScope({ name: created.name, icon: 'Aperture', defaultSort: [] })
    const previous = smartScopes.value
    await updateSmartScope(created.id, { name: updated.name })

    expect(smartScopes.value).toEqual([updated])
    expect(smartScopes.value).not.toBe(previous)
  })

  it('patches the sharing flag and reflects the shared scope returned by the server', async () => {
    const created = makeSmartScope({ isPublic: false })
    const shared = makeSmartScope({ isPublic: true })
    apiMock.mockResolvedValueOnce(makeResponse(created)).mockResolvedValueOnce(makeResponse(shared))

    const { useSmartScopes } = await import('../useSmartScopes')
    const { smartScopes, createSmartScope, updateSmartScope } = useSmartScopes()

    await createSmartScope({ name: created.name, icon: 'Aperture', defaultSort: [] })
    await updateSmartScope(created.id, { name: created.name, icon: 'Aperture', defaultSort: [], isPublic: true, syncToKobo: false })

    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/smart-scopes/11', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: created.name, icon: 'Aperture', defaultSort: [], isPublic: true, syncToKobo: false }),
    })
    expect(smartScopes.value).toEqual([shared])
  })

  it('sends the Kobo sync opt-in and merges the response without dropping the cached book count', async () => {
    const shared = { ...makeSmartScope({ id: 11, userId: 4, isOwner: false, isPublic: true }), bookCount: 42 }
    apiMock
      .mockResolvedValueOnce(makeResponse([shared]))
      .mockResolvedValueOnce(makeResponse(makeSmartScope({ id: 11, userId: 4, isOwner: false, isPublic: true, koboSyncEnabled: true })))

    const { useSmartScopes } = await import('../useSmartScopes')
    const { smartScopes, fetchSmartScopes, setKoboSync } = useSmartScopes()

    await fetchSmartScopes()
    await setKoboSync(11, true)

    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/smart-scopes/11/kobo-sync', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })
    expect(smartScopes.value[0]).toEqual(expect.objectContaining({ id: 11, koboSyncEnabled: true, bookCount: 42 }))
  })

  it('leaves cached smartScopes untouched when the Kobo sync opt-in fails', async () => {
    const shared = makeSmartScope({ id: 11, userId: 4, isOwner: false, isPublic: true })
    apiMock.mockResolvedValueOnce(makeResponse([shared])).mockResolvedValueOnce({ ok: false, status: 403, json: async () => undefined } as Response)

    const { useSmartScopes } = await import('../useSmartScopes')
    const { smartScopes, fetchSmartScopes, setKoboSync } = useSmartScopes()

    await fetchSmartScopes()
    await expect(setKoboSync(11, true)).rejects.toThrow('HTTP 403')

    expect(smartScopes.value).toEqual([shared])
  })

  it('resets cached smartScopes so the next fetch reloads them', async () => {
    const first = makeSmartScope({ id: 1, name: 'Owner Scope' })
    const second = makeSmartScope({ id: 2, userId: 4, name: 'Next User Scope' })
    apiMock.mockResolvedValueOnce(makeResponse([first])).mockResolvedValueOnce(makeResponse([second]))

    const { resetSmartScopes, useSmartScopes } = await import('../useSmartScopes')
    const { smartScopes, loaded, fetchSmartScopes } = useSmartScopes()

    await fetchSmartScopes()
    await fetchSmartScopes()
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(smartScopes.value).toEqual([first])
    expect(loaded.value).toBe(true)

    resetSmartScopes()

    expect(smartScopes.value).toEqual([])
    expect(loaded.value).toBe(false)

    await fetchSmartScopes()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(smartScopes.value).toEqual([second])
    expect(loaded.value).toBe(true)
  })

  it('ignores an in-flight fetch after smartScopes are reset', async () => {
    const stale = makeSmartScope({ id: 1, name: 'Stale Scope' })
    let resolveFetch!: (response: Response) => void
    apiMock.mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFetch = resolve)))

    const { resetSmartScopes, useSmartScopes } = await import('../useSmartScopes')
    const { smartScopes, loaded, loading, fetchSmartScopes } = useSmartScopes()

    const fetchPromise = fetchSmartScopes()
    expect(loading.value).toBe(true)

    resetSmartScopes()
    resolveFetch(makeResponse([stale]))
    await fetchPromise

    expect(smartScopes.value).toEqual([])
    expect(loaded.value).toBe(false)
    expect(loading.value).toBe(false)
  })
})
