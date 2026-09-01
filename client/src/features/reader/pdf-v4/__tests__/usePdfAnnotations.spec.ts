import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnnotationItem, AnnotationPdfPosition } from '@bookorbit/types'
import { usePdfAnnotations } from '../composables/usePdfAnnotations'

interface ApiResponse {
  ok: boolean
  json: () => Promise<unknown>
}

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<ApiResponse>>())
const fetchMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<ApiResponse>>())
const getValidTokenMock = vi.hoisted(() => vi.fn<() => Promise<string | null>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
  getValidToken: getValidTokenMock,
}))

const PDF_POSITION: AnnotationPdfPosition = {
  page: 2,
  rect: { x: 10, y: 20, width: 30, height: 8 },
  rects: [{ x: 10, y: 20, width: 30, height: 8 }],
}

function makeAnnotation(id: number): AnnotationItem {
  return {
    id,
    bookId: 9,
    cfi: null,
    jumpFileId: 33,
    pageno: 3,
    text: `Selection ${id}`,
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    pdf: PDF_POSITION,
  }
}

function response(ok: boolean, payload: unknown = null): ApiResponse {
  return { ok, json: async () => payload }
}

describe('usePdfAnnotations', () => {
  beforeEach(() => {
    apiMock.mockReset()
    fetchMock.mockReset()
    getValidTokenMock.mockReset()
    getValidTokenMock.mockResolvedValue('access-token')
    vi.stubGlobal('fetch', fetchMock)
  })

  it('loads annotations for the book', async () => {
    fetchMock.mockResolvedValueOnce(
      response(true, {
        items: [makeAnnotation(1)],
        total: 1,
        page: 1,
        pageSize: 100,
        stats: {},
      }),
    )
    const store = usePdfAnnotations(9, 33)

    await store.load()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/books/9/annotations?page=1&pageSize=100&sortBy=position&sortDir=asc&bookFileId=33',
      expect.objectContaining({ credentials: 'include' }),
    )
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer access-token')
    expect(store.annotations.value).toHaveLength(1)
    expect(store.loadError.value).toBe(false)
  })

  it('records a load error without throwing', async () => {
    fetchMock.mockResolvedValueOnce(response(false))
    const store = usePdfAnnotations(9, 33)

    await store.load()

    expect(store.loadError.value).toBe(true)
  })

  it('posts a pdf position and appends the created annotation', async () => {
    const created = makeAnnotation(42)
    apiMock.mockResolvedValueOnce(response(true, created))
    const store = usePdfAnnotations(9, 33)

    const result = await store.create({
      pdf: PDF_POSITION,
      bookFileId: 33,
      text: 'Selection 42',
      color: '#FACC15',
      style: 'highlight',
      note: null,
    })

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/books/9/annotations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          pdf: PDF_POSITION,
          bookFileId: 33,
          text: 'Selection 42',
          color: '#FACC15',
          style: 'highlight',
          note: null,
        }),
      }),
    )
    expect(result).toEqual(created)
    expect(store.annotations.value).toContainEqual(created)
  })

  it('patches an existing annotation in place', async () => {
    const store = usePdfAnnotations(9, 33)
    store.annotations.value = [makeAnnotation(1)]
    apiMock.mockResolvedValueOnce(
      response(true, {
        ...makeAnnotation(1),
        color: '#38BDF8',
        style: 'underline',
      }),
    )

    const result = await store.update(1, {
      color: '#38BDF8',
      style: 'underline',
    })

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/9/annotations/1', expect.objectContaining({ method: 'PATCH' }))
    expect(result?.color).toBe('#38BDF8')
    expect(store.annotations.value[0].color).toBe('#38BDF8')
  })

  it('removes an annotation when the delete succeeds', async () => {
    const store = usePdfAnnotations(9, 33)
    store.annotations.value = [makeAnnotation(1), makeAnnotation(2)]
    apiMock.mockResolvedValueOnce(response(true))

    const removed = await store.remove(1)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/9/annotations/1', expect.objectContaining({ method: 'DELETE' }))
    expect(removed).toBe(true)
    expect(store.annotations.value.map((a) => a.id)).toEqual([2])
  })

  it('keeps the annotation when the delete fails', async () => {
    const store = usePdfAnnotations(9, 33)
    store.annotations.value = [makeAnnotation(1)]
    apiMock.mockResolvedValueOnce(response(false))

    const removed = await store.remove(1)

    expect(removed).toBe(false)
    expect(store.annotations.value).toHaveLength(1)
  })

  it('loads additional bounded pages without duplicating rows', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response(true, {
          items: [makeAnnotation(1)],
          total: 2,
          page: 1,
          pageSize: 100,
          stats: {},
        }),
      )
      .mockResolvedValueOnce(
        response(true, {
          items: [makeAnnotation(1), makeAnnotation(2)],
          total: 2,
          page: 2,
          pageSize: 100,
          stats: {},
        }),
      )
    const store = usePdfAnnotations(9, 33)

    await store.load()
    expect(store.hasMore.value).toBe(true)
    await store.loadMore()

    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/v1/books/9/annotations?page=2&pageSize=100&sortBy=position&sortDir=asc&bookFileId=33',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(store.annotations.value.map((annotation) => annotation.id)).toEqual([1, 2])
    expect(store.hasMore.value).toBe(false)
  })

  it('preserves an annotation created while the initial page is still loading', async () => {
    let resolveLoad!: (value: ApiResponse) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve
      }),
    )
    const created = makeAnnotation(2)
    fetchMock.mockResolvedValueOnce(
      response(true, {
        items: [makeAnnotation(1), created],
        total: 2,
        page: 1,
        pageSize: 100,
        stats: {},
      }),
    )
    apiMock.mockResolvedValueOnce(response(true, created))
    const store = usePdfAnnotations(9, 33)

    const loading = store.load()
    await store.create({
      pdf: PDF_POSITION,
      bookFileId: 33,
      text: 'Selection 2',
      color: '#FACC15',
      style: 'highlight',
      note: null,
    })
    resolveLoad(
      response(true, {
        items: [makeAnnotation(1)],
        total: 1,
        page: 1,
        pageSize: 100,
        stats: {},
      }),
    )
    await loading

    expect(store.annotations.value.map((annotation) => annotation.id)).toEqual([1, 2])
    expect(store.total.value).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
