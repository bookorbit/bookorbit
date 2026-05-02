import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BooksPage, SortField } from '@bookorbit/types'

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

describe('sortItems', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('sorts supported fields in ascending order', async () => {
    const { sortItems } = await import('../useLibraryBooks')
    const cases: Array<{ field: SortField; low: Partial<BookCard>; high: Partial<BookCard> }> = [
      { field: 'title', low: { title: 'Alpha' }, high: { title: 'Zulu' } },
      { field: 'author', low: { authors: ['Alpha'] }, high: { authors: ['Zulu'] } },
      { field: 'series', low: { seriesName: 'Alpha Series' }, high: { seriesName: 'Zulu Series' } },
      { field: 'seriesIndex', low: { seriesIndex: 1 }, high: { seriesIndex: 2 } },
      { field: 'addedAt', low: { addedAt: '2024-01-01T00:00:00Z' }, high: { addedAt: '2024-02-01T00:00:00Z' } },
      { field: 'publishedYear', low: { publishedYear: 2010 }, high: { publishedYear: 2020 } },
      { field: 'updatedAt', low: { updatedAt: '2024-01-01T00:00:00Z' }, high: { updatedAt: '2024-02-01T00:00:00Z' } },
      { field: 'pageCount', low: { pageCount: 100 }, high: { pageCount: 200 } },
      { field: 'rating', low: { rating: 3 }, high: { rating: 5 } },
      { field: 'publisher', low: { publisher: 'Alpha Press' }, high: { publisher: 'Zulu Press' } },
      {
        field: 'fileSize',
        low: { files: [{ id: 11, format: 'epub', role: 'primary', sizeBytes: 100 }] },
        high: { files: [{ id: 22, format: 'epub', role: 'secondary', sizeBytes: 200 }] },
      },
      { field: 'language', low: { language: 'en' }, high: { language: 'fr' } },
      { field: 'readProgress', low: { readingProgress: 25 }, high: { readingProgress: 75 } },
      {
        field: 'lastReadAt',
        low: { readStatus: { updatedAt: '2024-01-01T00:00:00Z', finishedAt: null } as never },
        high: { readStatus: { updatedAt: '2024-02-01T00:00:00Z', finishedAt: null } as never },
      },
      {
        field: 'finishedAt',
        low: { readStatus: { updatedAt: null, finishedAt: '2024-01-01T00:00:00Z' } as never },
        high: { readStatus: { updatedAt: null, finishedAt: '2024-02-01T00:00:00Z' } as never },
      },
      { field: 'metadataScore', low: { metadataScore: 2 }, high: { metadataScore: 9 } },
    ]

    for (const { field, low, high } of cases) {
      const sorted = sortItems([makeBook({ id: 2, ...high }), makeBook({ id: 1, ...low })], [{ field, dir: 'asc' }])
      expect(sorted.map((book) => book.id)).toEqual([1, 2])
    }
  })

  it('places null values last', async () => {
    const { sortItems } = await import('../useLibraryBooks')

    const sorted = sortItems([makeBook({ id: 2, rating: null }), makeBook({ id: 1, rating: 4 })], [{ field: 'rating', dir: 'asc' }])

    expect(sorted.map((book) => book.id)).toEqual([1, 2])
  })

  it('leaves items unchanged for unsupported sort fields', async () => {
    const { sortItems } = await import('../useLibraryBooks')

    const sorted = sortItems([makeBook({ id: 2, title: 'Bravo' }), makeBook({ id: 1, title: 'Alpha' })], [{ field: 'unknown' as never, dir: 'asc' }])

    expect(sorted.map((book) => book.id)).toEqual([2, 1])
  })
})

describe('useLibraryBooks', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('fetches books when load is called', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, load } = useLibraryBooks(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 1))
    await load(true)

    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('A')
  })

  it('reloads automatically when libraryId changes', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(null)
    const { items } = useLibraryBooks(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 1))
    libraryId.value = 42
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('A')
  })

  it('does not fetch when load is called without a library id', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(null)
    const { load } = useLibraryBooks(libraryId)

    await load(true)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not clear items before server response arrives (keeps old items visible during reset)', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, load } = useLibraryBooks(libraryId)

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
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('First')

    resolveFetch({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Second' })], 1)) })
    await loadPromise
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('Second')
  })

  it('atomically replaces items on page 0 response', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, load } = useLibraryBooks(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' }), makeBook({ id: 2, title: 'B' })], 2))
    await load(true)
    expect(items.value).toHaveLength(2)

    mockOkResponse(makePage([makeBook({ id: 2, title: 'B' }), makeBook({ id: 1, title: 'A' })], 2))
    await load(true)
    expect(items.value[0]!.title).toBe('B')
    expect(items.value[1]!.title).toBe('A')
  })

  it('appends items on subsequent page loads', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, load, hasMore } = useLibraryBooks(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 2))
    await load(true)
    expect(items.value).toHaveLength(1)
    expect(hasMore.value).toBe(true)

    mockOkResponse(makePage([makeBook({ id: 2, title: 'B' })], 2))
    await load()
    expect(items.value).toHaveLength(2)
  })

  it('sets error on fetch failure', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { error, load } = useLibraryBooks(libraryId)

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    await load(true)
    expect(error.value).toBe('HTTP 500')
  })

  it('load() (non-reset) is a no-op when a load is already in-flight', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { load, items } = useLibraryBooks(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'First' })], 10))
    await load(true)

    let resolvePage2!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolvePage2 = r
      }),
    )

    const p1 = load()
    const p2 = load()

    resolvePage2({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Second' })], 10)) })
    await Promise.all([p1, p2])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(items.value).toHaveLength(2)
  })

  it('load(true) while in-flight aborts the first request and uses the second response', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, load } = useLibraryBooks(libraryId)

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

    const p1 = load(true)
    const p2 = load(true)

    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveSecond({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Second' })], 1)) })
    await p2

    resolveFirst({ ok: true, json: () => Promise.resolve(makePage([makeBook({ id: 1, title: 'First' })], 1)) })
    await p1

    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('Second')
  })

  it('clears items, totals, and pagination state', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, total, pagination, clear, load } = useLibraryBooks(libraryId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 1))
    await load(true)
    clear()

    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(pagination.page).toBe(0)
  })

  it('includes filter, collapseSeries, and trimmed q in the request body', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(7)
    const collapseEnabled = ref(true)
    const q = ref('  needle  ')
    const { filter, sort, load } = useLibraryBooks(libraryId, collapseEnabled, q)
    filter.value = {
      type: 'group',
      join: 'AND',
      rules: [{ type: 'rule', field: 'title', operator: 'contains', value: 'space' }],
    }
    sort.value = [{ field: 'author', dir: 'desc' }]

    mockOkResponse(makePage([], 0))
    await load(true)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/v1/libraries/7/books')
    expect(JSON.parse(init!.body as string)).toEqual({
      filter: filter.value,
      sort: [{ field: 'author', dir: 'desc' }],
      pagination: { page: 0, size: 50 },
      collapseSeries: true,
      q: 'needle',
    })
  })
})

describe('useLibraryBooks - server-driven sort', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('keeps the current order while a new sort request is pending', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useLibraryBooks(libraryId)

    const books = [makeBook({ id: 1, title: 'Zebra' }), makeBook({ id: 2, title: 'Apple' }), makeBook({ id: 3, title: 'Mango' })]
    mockOkResponse(makePage(books, 3))
    await load(true)
    expect(items.value[0]!.title).toBe('Zebra')

    let resolveFetch!: (v: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r
      }),
    )

    sort.value = [{ field: 'title', dir: 'desc' }]
    await Promise.resolve()

    expect(items.value.map((item) => item.title)).toEqual(['Zebra', 'Apple', 'Mango'])

    resolveFetch({ ok: true, json: () => Promise.resolve(makePage(books, 3)) })
    await new Promise((r) => setTimeout(r, 0))
    expect(items.value).toHaveLength(3)
  })

  it('only updates the order after the server response arrives', async () => {
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useLibraryBooks(libraryId)

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
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useLibraryBooks(libraryId)

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
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useLibraryBooks(libraryId)

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
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useLibraryBooks(libraryId)

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
    const { useLibraryBooks } = await import('../useLibraryBooks')
    const libraryId = ref<number | null>(1)
    const { items, sort, load } = useLibraryBooks(libraryId)

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
