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

  it('creates bookmark on toggle when CFI does not exist', async () => {
    const created = makeBookmark(21, 'epubcfi(/6/10)', 'Chapter 2')
    apiMock.mockResolvedValueOnce(response(true, created))

    const store = useBookmarks()

    await store.toggle(7, created.cfi, created.title)

    const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/books/7/bookmarks')
    expect(req.method).toBe('POST')
    expect(JSON.parse(String(req.body))).toEqual({ cfi: created.cfi, title: created.title })
    expect(store.bookmarks.value).toEqual([created])
  })

  it('removes existing bookmark on toggle when CFI already exists', async () => {
    apiMock.mockResolvedValueOnce(response(true))

    const existing = makeBookmark(10, 'epubcfi(/6/8)')
    const store = useBookmarks()
    store.bookmarks.value = [existing, makeBookmark(11, 'epubcfi(/6/12)')]

    await store.toggle(7, existing.cfi, existing.title)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/books/7/bookmarks/10', { method: 'DELETE' })
    expect(store.bookmarks.value.map((b) => b.id)).toEqual([11])
  })

  it('does not mutate list when remove endpoint fails', async () => {
    apiMock.mockResolvedValueOnce(response(false))

    const store = useBookmarks()
    store.bookmarks.value = [makeBookmark(1, 'epubcfi(/6/2)')]

    await store.remove(7, 1)

    expect(store.bookmarks.value).toHaveLength(1)
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
