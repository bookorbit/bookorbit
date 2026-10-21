import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBookmarks, type Bookmark } from '../useBookmarks'

interface ApiResponse {
  ok: boolean
  json: () => Promise<unknown>
}

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<ApiResponse>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeBookmark(id: number, cfi: string, title = `Bookmark ${id}`): Bookmark {
  return {
    id,
    bookId: 7,
    cfi,
    title,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function response(ok: boolean, payload: unknown = null): ApiResponse {
  return {
    ok,
    json: async () => payload,
  }
}

describe('useBookmarks', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads bookmarks on success and clears loadError', async () => {
    const items = [makeBookmark(1, 'epubcfi(/6/2)')]
    apiMock.mockResolvedValueOnce(response(true, items))

    const store = useBookmarks()
    store.loadError.value = 'stale error'

    await store.load(7)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/7/bookmarks')
    expect(store.loadError.value).toBeNull()
    expect(store.bookmarks.value).toEqual(items)
  })

  it('sets loadError when load fails', async () => {
    apiMock.mockResolvedValueOnce(response(false))

    const store = useBookmarks()

    await store.load(7)

    expect(store.loadError.value).toBe('Failed to load')
    expect(store.bookmarks.value).toEqual([])
  })

  it('requests bookmark positions for the selected reader and records the source on creation', async () => {
    apiMock.mockResolvedValueOnce(response(true, []))
    apiMock.mockResolvedValueOnce(response(true, makeBookmark(1, 'epubcfi(/6/2)')))
    const store = useBookmarks()

    await store.load(7, 42)
    await store.toggle(7, 'epubcfi(/6/2)', 'Chapter', 42)

    expect(apiMock.mock.calls[0]![0]).toBe('/api/v1/books/7/bookmarks?readerFileId=42')
    expect(JSON.parse(String(apiMock.mock.calls[1]![1]!.body))).toEqual({ cfi: 'epubcfi(/6/2)', title: 'Chapter', bookFileId: 42 })
  })

  it('creates bookmark on toggle when CFI does not exist', async () => {
    const created = makeBookmark(21, 'epubcfi(/6/10)', 'Chapter 2')
    apiMock.mockResolvedValueOnce(response(true, created))

    const store = useBookmarks()

    await store.toggle(7, created.cfi!, created.title)

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/7/bookmarks')
    expect(req.method).toBe('POST')
    expect(JSON.parse(String(req.body))).toEqual({ cfi: created.cfi!, title: created.title })
    expect(store.bookmarks.value).toEqual([created])
  })

  it('removes existing bookmark on toggle when CFI already exists', async () => {
    apiMock.mockResolvedValueOnce(response(true))

    const existing = makeBookmark(10, 'epubcfi(/6/8)')
    const store = useBookmarks()
    store.bookmarks.value = [existing, makeBookmark(11, 'epubcfi(/6/12)')]

    await store.toggle(7, existing.cfi!, existing.title)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/7/bookmarks/10', { method: 'DELETE' })
    expect(store.bookmarks.value.map((b) => b.id)).toEqual([11])
  })

  it('does not mutate list when remove endpoint fails', async () => {
    apiMock.mockResolvedValueOnce(response(false))

    const store = useBookmarks()
    store.bookmarks.value = [makeBookmark(1, 'epubcfi(/6/2)')]

    expect(await store.remove(7, 1)).toBe(false)

    expect(store.bookmarks.value).toHaveLength(1)
  })

  it('reports a bookmark that could not be added', async () => {
    apiMock.mockRejectedValueOnce(new Error('offline'))

    const store = useBookmarks()

    expect(await store.toggle(7, 'epubcfi(/6/2)', 'Chapter')).toBe(false)
    expect(store.bookmarks.value).toHaveLength(0)
  })

  it('renames a bookmark and sets its note in one request', async () => {
    apiMock.mockResolvedValueOnce(response(true, { ...makeBookmark(1, 'epubcfi(/6/2)', 'Renamed'), note: 'Why it matters' }))

    const store = useBookmarks()
    store.bookmarks.value = [makeBookmark(1, 'epubcfi(/6/2)'), makeBookmark(2, 'epubcfi(/6/4)')]

    expect(await store.update(7, 1, { title: 'Renamed', note: 'Why it matters' })).toBe(true)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/7/bookmarks/1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed', note: 'Why it matters' }),
    })
    expect(store.bookmarks.value.map((b) => [b.title, b.note ?? null])).toEqual([
      ['Renamed', 'Why it matters'],
      ['Bookmark 2', null],
    ])
  })

  it('leaves the bookmark as it was when a rename fails', async () => {
    apiMock.mockResolvedValueOnce(response(false))

    const store = useBookmarks()
    store.bookmarks.value = [makeBookmark(1, 'epubcfi(/6/2)')]

    expect(await store.update(7, 1, { title: 'Renamed', note: null })).toBe(false)
    expect(store.bookmarks.value[0]!.title).toBe('Bookmark 1')
  })

  it('tracks whether current CFI is bookmarked', () => {
    const store = useBookmarks()
    store.bookmarks.value = [makeBookmark(1, 'epubcfi(/6/2)')]

    store.setCfi('epubcfi(/6/2)')
    expect(store.isCurrentCfiBookmarked.value).toBe(true)

    store.setCfi('epubcfi(/6/4)')
    expect(store.isCurrentCfiBookmarked.value).toBe(false)

    store.setCfi(null)
    expect(store.isCurrentCfiBookmarked.value).toBe(false)
  })
})
