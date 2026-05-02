import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BooksPage, SortSpec } from '@bookorbit/types'

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

const endpointForId = (id: number) => `/api/v1/scopes/${id}/books`

describe('useBookDataSource', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('returns initial state', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(1)
    const { items, total, loading, error, initialized, hasMore } = useBookDataSource(scopeId, endpointForId)

    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(initialized.value).toBe(false)
    expect(hasMore.value).toBe(false)
  })

  it('loads books and populates total', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const { items, total, load } = useBookDataSource(scopeId, endpointForId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 3))
    await load(true)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/scopes/7/books',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    )
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.title).toBe('A')
    expect(total.value).toBe(3)
  })

  it('sets loading while a request is in flight and clears it after completion', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const { loading, load } = useBookDataSource(scopeId, endpointForId)

    let resolveFetch!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve
      }),
    )

    const loadPromise = load(true)
    expect(loading.value).toBe(true)

    resolveFetch({ ok: true, json: () => Promise.resolve(makePage([], 0)) })
    await loadPromise

    expect(loading.value).toBe(false)
  })

  it('sets initialized after the first successful load', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const { initialized, load } = useBookDataSource(scopeId, endpointForId)

    mockOkResponse(makePage([], 0))
    await load(true)

    expect(initialized.value).toBe(true)
  })

  it('accumulates pages across subsequent loads', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const { items, load } = useBookDataSource(scopeId, endpointForId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 2))
    await load(true)

    mockOkResponse(makePage([makeBook({ id: 2, title: 'B' })], 2))
    await load()

    expect(items.value.map((book) => book.id)).toEqual([1, 2])
  })

  it('sets error when the request throws', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const { error, load } = useBookDataSource(scopeId, endpointForId)

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await load(true)

    expect(error.value).toBe('network down')
  })

  it('clears state when clear is called', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const { items, total, error, clear, load } = useBookDataSource(scopeId, endpointForId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 1))
    await load(true)
    clear()

    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(error.value).toBeNull()
  })

  it('includes page, size, sort, collapseSeries, and q in the request body', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const collapseEnabled = ref(true)
    const q = ref('  needle  ')
    const sort = ref<SortSpec[]>([{ field: 'author', dir: 'desc' }])
    const { load } = useBookDataSource(scopeId, endpointForId, { collapseEnabled, q, sort })

    mockOkResponse(makePage([], 0))
    await load(true)

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init!.body as string)).toEqual({
      sort: [{ field: 'author', dir: 'desc' }],
      pagination: { page: 0, size: 50 },
      collapseSeries: true,
      q: 'needle',
    })
  })

  it('marks initialized and skips fetching when the scope id is invalid', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(0)
    const { items, total, initialized, load } = useBookDataSource(scopeId, endpointForId)

    await load(true)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(initialized.value).toBe(true)
  })

  it('does not fetch another page once all results have been loaded', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const { load } = useBookDataSource(scopeId, endpointForId)

    mockOkResponse(makePage([makeBook({ id: 1, title: 'A' })], 1))
    await load(true)
    await load()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reloads when sort or collapseEnabled changes', async () => {
    const { useBookDataSource } = await import('../useBookDataSource')
    const scopeId = ref(7)
    const collapseEnabled = ref(false)
    const sort = ref<SortSpec[]>([{ field: 'title', dir: 'asc' }])
    useBookDataSource(scopeId, endpointForId, { collapseEnabled, sort })

    mockOkResponse(makePage([], 0))
    sort.value = [{ field: 'author', dir: 'desc' }]
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    mockOkResponse(makePage([], 0))
    collapseEnabled.value = true
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      sort: [{ field: 'author', dir: 'desc' }],
      pagination: { page: 0, size: 50 },
    })
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string)).toEqual({
      sort: [{ field: 'author', dir: 'desc' }],
      pagination: { page: 0, size: 50 },
      collapseSeries: true,
    })
  })
})
