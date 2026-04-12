import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lens } from '@projectx/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeLens(overrides: Partial<Lens> = {}): Lens {
  return {
    id: 11,
    userId: 3,
    name: 'Unread Sci-Fi',
    icon: null,
    filter: null,
    defaultSort: [],
    isPublic: false,
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

describe('useLenses', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('replaces the lens array when creating a lens', async () => {
    const created = makeLens()
    apiMock.mockResolvedValueOnce(makeResponse(created))

    const { useLenses } = await import('../useLenses')
    const { lenses, createLens } = useLenses()
    const previous = lenses.value

    await createLens({ name: created.name, icon: 'Aperture', defaultSort: [] })

    expect(lenses.value).toEqual([created])
    expect(lenses.value).not.toBe(previous)
  })

  it('replaces the lens array when updating a lens', async () => {
    const created = makeLens()
    const updated = makeLens({ name: 'Updated Lens' })
    apiMock.mockResolvedValueOnce(makeResponse(created)).mockResolvedValueOnce(makeResponse(updated))

    const { useLenses } = await import('../useLenses')
    const { lenses, createLens, updateLens } = useLenses()

    await createLens({ name: created.name, icon: 'Aperture', defaultSort: [] })
    const previous = lenses.value
    await updateLens(created.id, { name: updated.name })

    expect(lenses.value).toEqual([updated])
    expect(lenses.value).not.toBe(previous)
  })
})
