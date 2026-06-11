import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnnotations, type Annotation } from '../useAnnotations'

interface ApiResponse {
  ok: boolean
  json: () => Promise<unknown>
}

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<ApiResponse>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeAnnotation(id: number, cfi = `epubcfi(/6/${id})`): Annotation {
  return {
    id,
    bookId: 9,
    cfi,
    jumpFileId: 33,
    pageno: null,
    text: `Selection ${id}`,
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: 'Intro',
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function response(ok: boolean, payload: unknown = null): ApiResponse {
  return {
    ok,
    json: async () => payload,
  }
}

describe('useAnnotations', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads annotations when API succeeds', async () => {
    const list = [makeAnnotation(1), makeAnnotation(2)]
    apiMock.mockResolvedValueOnce(response(true, list))

    const store = useAnnotations()
    await store.load(9)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/9/annotations')
    expect(store.loadError.value).toBeNull()
    expect(store.annotations.value).toEqual(list)
  })

  it('sets loadError when loading annotations fails', async () => {
    apiMock.mockResolvedValueOnce(response(false))

    const store = useAnnotations()
    await store.load(9)

    expect(store.loadError.value).toBe('Failed to load')
    expect(store.annotations.value).toEqual([])
  })

  it('creates and appends annotation on success', async () => {
    const created = makeAnnotation(3)
    const createdCfi = created.cfi ?? 'epubcfi(/6/3)'
    apiMock.mockResolvedValueOnce(response(true, created))

    const store = useAnnotations()
    const result = await store.create(9, {
      cfi: createdCfi,
      text: created.text,
      color: created.color,
      style: created.style,
      note: 'test',
      chapterTitle: 'Chapter 1',
    })

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/9/annotations')
    expect(req.method).toBe('POST')
    expect(JSON.parse(String(req.body))).toEqual({
      cfi: createdCfi,
      text: created.text,
      color: created.color,
      style: created.style,
      note: 'test',
      chapterTitle: 'Chapter 1',
    })
    expect(result).toEqual(created)
    expect(store.annotations.value).toEqual([created])
  })

  it('returns null and does not append annotation on create failure', async () => {
    apiMock.mockResolvedValueOnce(response(false))

    const store = useAnnotations()
    const result = await store.create(9, {
      cfi: 'epubcfi(/6/18)',
      text: 'x',
      color: '#fff',
      style: 'highlight',
    })

    expect(result).toBeNull()
    expect(store.annotations.value).toEqual([])
  })

  it('updates only the target annotation when updateNote succeeds', async () => {
    const existing = [makeAnnotation(1), makeAnnotation(2)]
    const updated = { ...existing[1]!, note: 'New note' }
    apiMock.mockResolvedValueOnce(response(true, updated))

    const store = useAnnotations()
    store.annotations.value = existing

    await store.updateNote(9, 2, 'New note')

    expect(store.annotations.value).toEqual([existing[0], updated])
  })

  it('removes annotation when delete succeeds', async () => {
    apiMock.mockResolvedValueOnce(response(true))

    const store = useAnnotations()
    store.annotations.value = [makeAnnotation(1), makeAnnotation(2)]

    await store.remove(9, 1)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/9/annotations/1', { method: 'DELETE' })
    expect(store.annotations.value.map((a) => a.id)).toEqual([2])
  })
})
