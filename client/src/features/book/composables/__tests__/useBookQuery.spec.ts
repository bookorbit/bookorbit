import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BooksPage } from '@bookorbit/types'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

function makePage(items: Partial<BookCard>[], total: number): BooksPage {
  return { items: items as BookCard[], total, page: 0, size: 50 }
}

function makeBook(overrides: Partial<BookCard> = {}): BookCard {
  return {
    id: 1,
    status: 'active',
    title: 'Book A',
    authors: [],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    metadataScore: null,
    hasCover: false,
    hasMetadataLocks: false,
    lockedFields: [],
    subtitle: null,
    publisher: null,
    pageCount: null,
    isbn13: null,
    narrators: [],
    ...overrides,
  }
}

function mockOkResponse(page: BooksPage) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(page),
  })
}

describe('useBookQuery', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('fetches books when load is called', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, load } = useBookQuery(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 1))
    await load(true)

    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('A')
  })

  it('reloads automatically when libraryId changes', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(null)
    const { items } = useBookQuery(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 1))
    libraryId.value = 42
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('A')
  })

  it('does not clear items before server response arrives (keeps old items visible during reset)', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, load } = useBookQuery(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'First' })], 1))
    await load(true)
    expect(items.value).toHaveLength(1)

    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const loadPromise = load(true)
    // Items should NOT be cleared while fetch is in-flight
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('First')

    resolveFetch({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Second' })], 1)) })
    await loadPromise
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('Second')
  })

  it('atomically replaces items on page 0 response', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, load } = useBookQuery(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' }), makeBook({ id: 2, title: 'B' })], 2))
    await load(true)
    expect(items.value).toHaveLength(2)

    mockOkResponse(makePage([makeBook({ id: 2, title: 'B' }), makeBook({ id: 1, title: 'A' })], 2))
    await load(true)
    expect(items.value[0]!.title).toBe('B')
    expect(items.value[1]!.title).toBe('A')
  })

  it('appends items on subsequent page loads', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, load, hasMore } = useBookQuery(libraryId)

    // Page 0: 1 item, total=2 → hasMore=true
    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 2))
    await load(true)
    expect(items.value).toHaveLength(1)
    expect(hasMore.value).toBe(true)

    // Page 1: next item
    mockOkResponse(makePage([makeBook({ id: 2, title: 'B' })], 2))
    await load()
    expect(items.value).toHaveLength(2)
  })

  it('sets error on fetch failure', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { error, load } = useBookQuery(libraryId)

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    await load(true)
    expect(error.value).toBe('HTTP 500')
  })

  it('load() (non-reset) is a no-op when a load is already in-flight', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { load, items } = useBookQuery(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'First' })], 10))
    await load(true)

    let resolvePage2!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolvePage2 = r
      }),
    )

    const p1 = load() // page 2, in-flight
    const p2 = load() // loading=true → no-op (non-reset)

    resolvePage2({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Second' })], 10)) })
    await Promise.all([p1, p2])

    // Only 2 fetch calls total: initial reset + one page-2 load
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(items.value).toHaveLength(2)
  })

  it('load(true) while in-flight aborts the first request and uses the second response', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, load } = useBookQuery(libraryId)

    let resolveFirst!: (v: unknown) => void
    let resolveSecond!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r
      }),
    )
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveSecond = r
      }),
    )

    const p1 = load(true) // starts, in-flight
    const p2 = load(true) // aborts first, starts new

    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveSecond({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Second' })], 1)) })
    await p2

    resolveFirst({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 1, title: 'First' })], 1)) })
    await p1

    // Only second response should be applied
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('Second')
  })
})

describe('useBookQuery - server-driven sort', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('keeps the current order while a new sort request is pending', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useBookQuery(libraryId)

    const books = [makeBook({ id: 1, title: 'Zebra' }), makeBook({ id: 2, title: 'Apple' }), makeBook({ id: 3, title: 'Mango' })]
    mockOkResponse(makePage(books, 3))
    await load(true)
    expect(items.value[0]!.title).toBe('Zebra') // original order

    // Deferred second fetch so we can inspect optimistic state
    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r
      }),
    )

    sort.value = [{ field: 'title', dir: 'desc' }]
    await Promise.resolve() // flush Vue watcher

    expect(items.value.map((item) => item.title)).toEqual(['Zebra', 'Apple', 'Mango'])

    resolveFetch({ ok: true, json: () => Promise.resolve(makePage(books, 3)) })
    await new Promise((r) => setTimeout(r, 0))
    expect(items.value).toHaveLength(3)
  })

  it('only updates the order after the server response arrives', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useBookQuery(libraryId)

    const books = [makeBook({ id: 1, title: 'Apple' }), makeBook({ id: 2, title: 'Mango' }), makeBook({ id: 3, title: 'Zebra' })]
    mockOkResponse(makePage(books, 3))
    await load(true)

    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r
      }),
    )

    sort.value = [{ field: 'title', dir: 'desc' }]
    await Promise.resolve()

    expect(items.value.map((item) => item.title)).toEqual(['Apple', 'Mango', 'Zebra'])

    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve(makePage([makeBook({ id: 3, title: 'Zebra' }), makeBook({ id: 2, title: 'Mango' }), makeBook({ id: 1, title: 'Apple' })], 3)),
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(items.value.map((item) => item.title)).toEqual(['Zebra', 'Mango', 'Apple'])
  })

  it('keeps null values in place until the server returns the new ordering', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useBookQuery(libraryId)

    const books = [
      makeBook({ id: 1, title: 'A', rating: null }),
      makeBook({ id: 2, title: 'B', rating: 5 }),
      makeBook({ id: 3, title: 'C', rating: 3 }),
    ]
    mockOkResponse(makePage(books, 3))
    await load(true)

    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r
      }),
    )

    sort.value = [{ field: 'rating', dir: 'asc' }]
    await Promise.resolve()

    const nullIdx = items.value.findIndex((b) => b.rating === null)
    expect(nullIdx).toBe(0)

    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve(
          makePage(
            [makeBook({ id: 3, title: 'C', rating: 3 }), makeBook({ id: 2, title: 'B', rating: 5 }), makeBook({ id: 1, title: 'A', rating: null })],
            3,
          ),
        ),
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(items.value.findIndex((b) => b.rating === null)).toBe(2)
  })

  it('waits for the server response before reordering by publishedYear', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useBookQuery(libraryId)

    const books = [makeBook({ id: 1, publishedYear: 2020 }), makeBook({ id: 2, publishedYear: 2010 }), makeBook({ id: 3, publishedYear: 2015 })]
    mockOkResponse(makePage(books, 3))
    await load(true)

    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r
      }),
    )

    sort.value = [{ field: 'publishedYear', dir: 'asc' }]
    await Promise.resolve()

    expect(items.value.map((book) => book.publishedYear)).toEqual([2020, 2010, 2015])

    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve(
          makePage([makeBook({ id: 2, publishedYear: 2010 }), makeBook({ id: 3, publishedYear: 2015 }), makeBook({ id: 1, publishedYear: 2020 })], 3),
        ),
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(items.value.map((book) => book.publishedYear)).toEqual([2010, 2015, 2020])
  })

  it('waits for the server response before reordering by primary file size', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useBookQuery(libraryId)

    const books = [
      makeBook({ id: 1, files: [{ id: 11, format: 'epub', role: 'primary', sizeBytes: 500 }] }),
      makeBook({ id: 2, files: [{ id: 12, format: 'epub', role: 'primary', sizeBytes: 100 }] }),
      makeBook({ id: 3, files: [{ id: 13, format: 'epub', role: 'primary', sizeBytes: 300 }] }),
    ]
    mockOkResponse(makePage(books, 3))
    await load(true)

    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r
      }),
    )

    sort.value = [{ field: 'fileSize', dir: 'asc' }]
    await Promise.resolve()

    expect(items.value.map((book) => book.files[0]?.sizeBytes)).toEqual([500, 100, 300])

    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve(
          makePage(
            [
              makeBook({ id: 2, files: [{ id: 12, format: 'epub', role: 'primary', sizeBytes: 100 }] }),
              makeBook({ id: 3, files: [{ id: 13, format: 'epub', role: 'primary', sizeBytes: 300 }] }),
              makeBook({ id: 1, files: [{ id: 11, format: 'epub', role: 'primary', sizeBytes: 500 }] }),
            ],
            3,
          ),
        ),
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(items.value.map((book) => book.files[0]?.sizeBytes)).toEqual([100, 300, 500])
  })

  it('waits for the server response before reordering by updatedAt', async () => {
    const { useBookQuery } = await import('../useBookQuery')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useBookQuery(libraryId)

    const books = [
      makeBook({ id: 1, updatedAt: '2024-03-01T00:00:00Z' }),
      makeBook({ id: 2, updatedAt: '2024-01-01T00:00:00Z' }),
      makeBook({ id: 3, updatedAt: '2024-02-01T00:00:00Z' }),
    ]
    mockOkResponse(makePage(books, 3))
    await load(true)

    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r
      }),
    )

    sort.value = [{ field: 'updatedAt', dir: 'asc' }]
    await Promise.resolve()

    expect(items.value.map((book) => book.updatedAt)).toEqual(['2024-03-01T00:00:00Z', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z'])

    resolveFetch({
      ok: true,
      json: () =>
        Promise.resolve(
          makePage(
            [
              makeBook({ id: 2, updatedAt: '2024-01-01T00:00:00Z' }),
              makeBook({ id: 3, updatedAt: '2024-02-01T00:00:00Z' }),
              makeBook({ id: 1, updatedAt: '2024-03-01T00:00:00Z' }),
            ],
            3,
          ),
        ),
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(items.value.map((book) => book.updatedAt)).toEqual(['2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z', '2024-03-01T00:00:00Z'])
  })
})
