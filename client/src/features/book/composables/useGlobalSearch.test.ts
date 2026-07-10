import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BookQuery, BooksPage } from '@bookorbit/types'

type ApiResponse = {
  ok: boolean
  status?: number
  json: () => Promise<BooksPage>
}

const apiMock = vi.fn<(url: string, init?: RequestInit) => Promise<ApiResponse>>()

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => apiMock(url, init),
}))

import { useGlobalSearch } from './useGlobalSearch'

function makeBook(id: number): BookCard {
  return {
    id,
    status: 'present',
    title: `Prey ${id}`,
    authors: ['Author'],
    seriesId: null,
    seriesName: null,
    seriesIndex: null,
    files: [{ id: id * 10, format: 'epub', role: 'primary', sizeBytes: null }],
    publishedDate: null,
    publishedYear: null,
    language: null,
    genres: [],
    tags: [],
    rating: null,
    readingProgress: null,
    readStatus: null,
    addedAt: '2026-01-01T00:00:00.000Z',
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
    customMetadata: [],
  }
}

function pageFor(page: number, total: number, size = 20): BooksPage {
  const start = page * size
  const count = Math.max(0, Math.min(size, total - start))
  return {
    items: Array.from({ length: count }, (_, i) => makeBook(start + i + 1)),
    total,
    page,
    size,
  }
}

function requestedBodies(): BookQuery[] {
  return apiMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as BookQuery)
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('useGlobalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads the first page through the book query endpoint after the debounce', async () => {
    apiMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(pageFor(0, 45)),
    })
    const query = ref('')
    const search = useGlobalSearch(query)

    query.value = '  Prey  '
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    await flush()

    expect(apiMock).toHaveBeenCalledOnce()
    expect(apiMock.mock.calls[0]?.[0]).toBe('/api/v1/books/query')
    expect(requestedBodies()[0]).toEqual({
      q: 'Prey',
      sort: [{ field: 'title', dir: 'asc' }],
      pagination: { page: 0, size: 20 },
    })
    expect(search.results.value).toHaveLength(20)
    expect(search.total.value).toBe(45)
    expect(search.hasMore.value).toBe(true)
    expect(search.loading.value).toBe(false)
    expect(search.settled.value).toBe(true)
  })

  it('appends the next page when loading more results', async () => {
    apiMock.mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body)) as BookQuery
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(pageFor(body.pagination.page, 45)),
      })
    })
    const query = ref('')
    const search = useGlobalSearch(query)

    query.value = 'Prey'
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    await flush()
    await search.loadMore()
    await flush()

    expect(requestedBodies().map((body) => body.pagination.page)).toEqual([0, 1])
    expect(search.results.value).toHaveLength(40)
    expect(search.results.value[0]?.id).toBe(1)
    expect(search.results.value[39]?.id).toBe(40)
    expect(search.total.value).toBe(45)
    expect(search.hasMore.value).toBe(true)
  })
})
