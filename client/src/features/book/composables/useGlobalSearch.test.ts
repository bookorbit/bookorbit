import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BookQuery, BooksPage } from '@bookorbit/types'

type ApiResponse = {
  ok: boolean
  status?: number
  json: () => Promise<unknown>
}

const apiMock = vi.fn<(url: string, init?: RequestInit) => Promise<ApiResponse>>()

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => apiMock(url, init),
}))

import { setShelfmarkEnabled, useGlobalSearch } from './useGlobalSearch'

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
  return apiMock.mock.calls.filter(([url]) => url === '/api/v1/books/query').map(([, init]) => JSON.parse(String(init?.body)) as BookQuery)
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('useGlobalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setShelfmarkEnabled(false)
    apiMock.mockReset()
    apiMock.mockImplementation((url) => {
      if (url.includes('/api/v1/user-preferences/shelfmark')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ settings: { enabled: false } }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(pageFor(0, 0)),
      })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads the first page through the book query endpoint after the debounce', async () => {
    apiMock.mockImplementation((url) => {
      if (url.includes('/api/v1/user-preferences/shelfmark')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ settings: { enabled: false } }),
        })
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(pageFor(0, 45)),
      })
    })
    const query = ref('')
    const search = useGlobalSearch(query)

    query.value = '  Prey  '
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    await flush()

    const queryCalls = apiMock.mock.calls.filter(([url]) => url === '/api/v1/books/query')
    expect(queryCalls).toHaveLength(1)
    expect(queryCalls[0]?.[0]).toBe('/api/v1/books/query')
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
    apiMock.mockImplementation((url, init) => {
      if (url.includes('/api/v1/user-preferences/shelfmark')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ settings: { enabled: false } }),
        })
      }
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

  describe('shelfmark enabled', () => {
    it('reacts when saved settings update the shared enabled state', () => {
      const search = useGlobalSearch(ref(''))

      setShelfmarkEnabled(true)

      expect(search.shelfmarkEnabled.value).toBe(true)
    })

    it('merges unique external results from shelfmark after the first local page', async () => {
      const externalBook = { ...makeBook(9999), doesNotExistLocally: true }
      apiMock.mockImplementation((url, init) => {
        if (url.includes('/api/v1/user-preferences/shelfmark')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ settings: { enabled: true } }),
          })
        }
        if (url.includes('/api/v1/books/shelfmark')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([externalBook]),
          })
        }
        const body = JSON.parse(String(init?.body)) as BookQuery
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(pageFor(body.pagination.page, 10)),
        })
      })

      const query = ref('')
      const search = useGlobalSearch(query)

      query.value = 'Prey'
      await nextTick()
      await vi.advanceTimersByTimeAsync(300)
      await flush()

      expect(search.shelfmarkEnabled.value).toBe(true)
      expect(search.results.value.some((r) => r.id === 9999)).toBe(true)
      expect(search.total.value).toBe(11)
    })

    it('deduplicates external results already present locally', async () => {
      const localBook = makeBook(1)
      apiMock.mockImplementation((url, init) => {
        if (url.includes('/api/v1/user-preferences/shelfmark')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ settings: { enabled: true } }),
          })
        }
        if (url.includes('/api/v1/books/shelfmark')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([localBook]),
          })
        }
        const body = JSON.parse(String(init?.body)) as BookQuery
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(pageFor(body.pagination.page, 5)),
        })
      })

      const query = ref('')
      const search = useGlobalSearch(query)

      query.value = 'Prey'
      await nextTick()
      await vi.advanceTimersByTimeAsync(300)
      await flush()

      const ids = search.results.value.map((r) => r.id)
      const occurrences = ids.filter((id) => id === 1).length
      expect(occurrences).toBe(1)
    })

    it('preserves the shelfmark-augmented total across subsequent local pages', async () => {
      const externalBook = { ...makeBook(9999), doesNotExistLocally: true }
      apiMock.mockImplementation((url, init) => {
        if (url.includes('/api/v1/user-preferences/shelfmark')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ settings: { enabled: true } }),
          })
        }
        if (url.includes('/api/v1/books/shelfmark')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([externalBook]),
          })
        }
        const body = JSON.parse(String(init?.body)) as BookQuery
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(pageFor(body.pagination.page, 25)),
        })
      })

      const query = ref('')
      const search = useGlobalSearch(query)

      query.value = 'Prey'
      await nextTick()
      await vi.advanceTimersByTimeAsync(300)
      await flush()

      const totalAfterFirstPage = search.total.value
      expect(totalAfterFirstPage).toBe(26)

      await search.loadMore()
      await flush()

      expect(search.total.value).toBe(26)
      expect(search.results.value).toHaveLength(26)
    })

    it('cancels shelfmark loading when the query changes', async () => {
      let shelfmarkSignal: AbortSignal | null | undefined
      let shelfmarkResolve!: (v: ApiResponse) => void
      apiMock.mockImplementation((url, init) => {
        if (url.includes('/api/v1/user-preferences/shelfmark')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ settings: { enabled: true } }),
          })
        }
        if (url.includes('/api/v1/books/shelfmark')) {
          shelfmarkSignal = init?.signal
          return new Promise((resolve) => {
            shelfmarkResolve = resolve
          })
        }
        const body = JSON.parse(String(init?.body)) as BookQuery
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(pageFor(body.pagination.page, 5)),
        })
      })

      const query = ref('')
      const search = useGlobalSearch(query)

      query.value = 'Prey'
      await nextTick()
      await vi.advanceTimersByTimeAsync(300)
      await flush()

      expect(search.shelfmarkLoading.value).toBe(true)

      query.value = ''
      await nextTick()

      expect(shelfmarkSignal).toBeDefined()
      expect(shelfmarkSignal?.aborted).toBe(true)

      shelfmarkResolve({
        ok: true,
        json: () => Promise.resolve([{ ...makeBook(9999), doesNotExistLocally: true }]),
      })
      await flush()

      expect(search.results.value).toHaveLength(0)
      expect(search.shelfmarkLoading.value).toBe(false)
    })
  })
})
