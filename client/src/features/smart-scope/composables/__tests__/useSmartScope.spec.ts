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

describe('useSmartScope', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('posts SmartScope queries to the unified endpoint with temporary sort overrides', async () => {
    const { useSmartScope } = await import('../useSmartScope')
    const smartScopeId = ref(9)
    const q = ref('space')
    const sort = ref([{ field: 'author' as const, dir: 'desc' as const }])
    const { items, load } = useSmartScope(smartScopeId, q, sort)

    mockOkResponse(makePage([makeBook({ id: 4, title: 'Dune' })], 1))
    await load(true)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/smart-scopes/9/books/query',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sort: [{ field: 'author', dir: 'desc' }],
          pagination: { page: 0, size: 50 },
          q: 'space',
        }),
      }),
    )
    expect(items.value.map((book) => book.id)).toEqual([4])
  })

  it('does not hit the API for invalid SmartScope ids', async () => {
    const { useSmartScope } = await import('../useSmartScope')
    const smartScopeId = ref(Number.NaN)
    const { load, initialized, items } = useSmartScope(smartScopeId)

    await load(true)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(initialized.value).toBe(true)
    expect(items.value).toEqual([])
  })

  it('keeps current items in place while a new sort request is pending', async () => {
    const { useSmartScope } = await import('../useSmartScope')
    const smartScopeId = ref(9)
    const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])
    const { items, load } = useSmartScope(smartScopeId, ref(''), sort)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'Zulu' }), makeBook({ id: 2, title: 'Alpha' })], 2))
    await load(true)

    let resolveFetch!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    sort.value = [{ field: 'title', dir: 'desc' }]
    await Promise.resolve()

    expect(items.value.map((book) => book.title)).toEqual(['Zulu', 'Alpha'])

    resolveFetch({
      ok: true,
      json: () => Promise.resolve(makePage([makeBook({ id: 2, title: 'Alpha' }), makeBook({ id: 1, title: 'Zulu' })], 2)),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(items.value.map((book) => book.title)).toEqual(['Alpha', 'Zulu'])
  })
})
