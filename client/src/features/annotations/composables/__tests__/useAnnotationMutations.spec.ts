import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick, ref } from 'vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

import { useAnnotationMutations } from '../useAnnotationMutations'

function makeResponse(ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => ({}) } as Response
}

describe('useAnnotationMutations', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('optimistically patches the item and PATCHes the resolved book endpoint', async () => {
    apiMock.mockResolvedValue(makeResponse())
    const items = ref([{ id: 1, bookId: 7, note: 'old' }])
    const mutations = useAnnotationMutations(items, () => 7)

    await mutations.updateNote(1, 'new')

    expect(items.value[0]!.note).toBe('new')
    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/7/annotations/1')
    expect(req.method).toBe('PATCH')
    expect(JSON.parse(String(req.body))).toEqual({ note: 'new' })
    expect(mutations.savingIds.value.has(1)).toBe(false)
  })

  it('reverts the optimistic change on failure', async () => {
    apiMock.mockResolvedValue(makeResponse(false))
    const items = ref([{ id: 1, bookId: 7, color: '#000000' }])
    const mutations = useAnnotationMutations(items, () => 7)

    await mutations.updateColor(1, '#ffffff')

    expect(items.value[0]!.color).toBe('#000000')
  })

  it('does nothing when the book id cannot be resolved', async () => {
    const items = ref([{ id: 1, bookId: 7, style: 'highlight' }])
    const mutations = useAnnotationMutations(items, () => null)

    await mutations.updateStyle(1, 'underline')

    expect(apiMock).not.toHaveBeenCalled()
    expect(items.value[0]!.style).toBe('highlight')
  })

  it('prunes saving ids whose item leaves the list', async () => {
    const items = ref([
      { id: 1, bookId: 7 },
      { id: 2, bookId: 7 },
    ])
    const mutations = useAnnotationMutations(items, () => 7)

    mutations.setSaving(1, true)
    mutations.setSaving(2, true)
    expect(mutations.savingIds.value.size).toBe(2)

    items.value = [{ id: 2, bookId: 7 }]
    await nextTick()

    expect(mutations.savingIds.value.has(1)).toBe(false)
    expect(mutations.savingIds.value.size).toBe(1)
  })
})
