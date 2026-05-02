import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BooksPage, SortSpec } from '@bookorbit/types'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

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

function makePage(items: Partial<BookCard>[], total: number): BooksPage {
  return { items: items as BookCard[], total, page: 0, size: 50 }
}

function mockOkResponse(page: BooksPage) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(page),
  })
}

describe('useCollectionBooks', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('posts collection table queries to the unified endpoint', async () => {
    const { useCollectionBooks } = await import('../useCollectionBooks')
    const collectionId = ref(7)
    const collapseEnabled = ref(true)
    const q = ref('tolkien')
    const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])
    const { items, total, hasMore, load } = useCollectionBooks(collectionId, collapseEnabled, q, sort)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'The Hobbit' })], 2))
    await load(true)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/collections/7/books/query',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sort: [{ field: 'title', dir: 'asc' }],
          pagination: { page: 0, size: 50 },
          collapseSeries: true,
          q: 'tolkien',
        }),
      }),
    )
    expect(items.value.map((book) => book.id)).toEqual([1])
    expect(total.value).toBe(2)
    expect(hasMore.value).toBe(true)
  })

  it('keeps existing rows visible until the replacement sort response arrives', async () => {
    const { useCollectionBooks } = await import('../useCollectionBooks')
    const collectionId = ref(7)
    const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])
    const { items, load } = useCollectionBooks(collectionId, ref(false), ref(''), sort)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'Zulu' }), makeBook({ id: 2, title: 'Alpha' })], 2))
    await load(true)
    expect(items.value.map((book) => book.title)).toEqual(['Zulu', 'Alpha'])

    let resolveFetch!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    sort.value = [{ field: 'author', dir: 'desc' }]
    await Promise.resolve()

    expect(items.value.map((book) => book.title)).toEqual(['Zulu', 'Alpha'])

    resolveFetch({
      ok: true,
      json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Alpha' }), makeBook({ id: 1, title: 'Zulu' })], 2)),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(items.value.map((book) => book.title)).toEqual(['Alpha', 'Zulu'])
  })

  it('aborts stale reset requests and keeps only the latest response', async () => {
    const { useCollectionBooks } = await import('../useCollectionBooks')
    const collectionId = ref(7)
    const { items, load } = useCollectionBooks(collectionId)

    let resolveFirst!: (value: unknown) => void
    let resolveSecond!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve
      }),
    )
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve
      }),
    )

    const first = load(true)
    const second = load(true)

    resolveSecond({
      ok: true,
      json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Second' })], 1)),
    })
    await second

    resolveFirst({
      ok: true,
      json: () => Promise.resolve(makePage([makeBook({ id: 1, title: 'First' })], 1)),
    })
    await first

    expect(items.value.map((book) => book.title)).toEqual(['Second'])
  })
})
