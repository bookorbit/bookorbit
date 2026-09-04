import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { AuthorBooksPage, BookCard } from '@bookorbit/types'

vi.mock('../api/author', () => ({
  fetchAuthorBooks: vi.fn<typeof import('../api/author').fetchAuthorBooks>(),
}))

import { fetchAuthorBooks } from '../api/author'
import { useAuthorBooks } from './useAuthorBooks'

const mockFetchAuthorBooks = vi.mocked(fetchAuthorBooks)

function makeBook(id: number): BookCard {
  return { id, title: `Book ${id}` } as BookCard
}

function makePage(items: BookCard[], total = items.length, bookTotal = total): AuthorBooksPage {
  return { items, total, bookTotal, page: 0, size: 50 }
}

describe('useAuthorBooks', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('initializes with empty state', () => {
    const authorId = ref(1)
    const { items, total, loading, error, hasMore, sort, order, libraryId } = useAuthorBooks(authorId)

    expect(items.value).toEqual([])
    expect(total.value).toBe(0)
    expect(loading.value).toBe(false)
    expect(error.value).toBeNull()
    expect(hasMore.value).toBe(false)
    expect(sort.value).toBe('addedAt')
    expect(order.value).toBe('desc')
    expect(libraryId.value).toBeNull()
  })

  it('does not fetch when authorId is 0', async () => {
    const authorId = ref(0)
    const { load } = useAuthorBooks(authorId)

    await load(true)

    expect(mockFetchAuthorBooks).not.toHaveBeenCalled()
  })

  it('does not fetch when authorId is NaN', async () => {
    const authorId = ref(NaN)
    const { load } = useAuthorBooks(authorId)

    await load(true)

    expect(mockFetchAuthorBooks).not.toHaveBeenCalled()
  })

  it('does not fire a second request while one is in flight', async () => {
    const authorId = ref(1)
    let resolveFirst!: (v: AuthorBooksPage) => void
    mockFetchAuthorBooks.mockImplementation(
      () =>
        new Promise<AuthorBooksPage>((resolve) => {
          resolveFirst = resolve
        }),
    )

    const { load } = useAuthorBooks(authorId)
    const firstLoad = load(true)
    const secondLoad = load(false)

    resolveFirst(makePage([makeBook(1)]))
    await Promise.all([firstLoad, secondLoad])

    expect(mockFetchAuthorBooks).toHaveBeenCalledTimes(1)
  })

  it('reloads with the new flag when collapseSeries changes during an unresolved load', async () => {
    const authorId = ref(1)
    let resolveFirst!: (v: AuthorBooksPage) => void
    mockFetchAuthorBooks
      .mockImplementationOnce(
        () =>
          new Promise<AuthorBooksPage>((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(makePage([makeBook(50)], 1, 4))

    const { load, items, total, bookTotal, collapseSeries } = useAuthorBooks(authorId)
    const flatLoad = load(true)

    // The toggle flips while the flat request is still out, so the reset it asks for is the one
    // that has to win.
    collapseSeries.value = true
    void load(true)

    resolveFirst(makePage([makeBook(1), makeBook(2), makeBook(3), makeBook(4)], 4, 4))
    await flatLoad
    await vi.waitFor(() => expect(mockFetchAuthorBooks).toHaveBeenCalledTimes(2))

    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ collapseSeries: false }))
    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(2, 1, expect.objectContaining({ collapseSeries: true, page: 0 }))
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.id).toBe(50)
    expect(total.value).toBe(1)
    expect(bookTotal.value).toBe(4)
  })

  it('keeps the error of a stale request off the page when a reset is queued behind it', async () => {
    const authorId = ref(1)
    let rejectFirst!: (e: unknown) => void
    mockFetchAuthorBooks
      .mockImplementationOnce(
        () =>
          new Promise<AuthorBooksPage>((_resolve, reject) => {
            rejectFirst = reject
          }),
      )
      .mockResolvedValueOnce(makePage([makeBook(7)], 1))

    const { load, error, items, collapseSeries } = useAuthorBooks(authorId)
    const flatLoad = load(true)

    collapseSeries.value = true
    void load(true)

    rejectFirst(new Error('stale request failed'))
    await flatLoad
    await vi.waitFor(() => expect(items.value).toHaveLength(1))

    expect(error.value).toBeNull()
    expect(items.value[0]!.id).toBe(7)
  })

  it('skips non-reset load when no more items to load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1), makeBook(2)], 2))

    const { load, items, total } = useAuthorBooks(authorId)
    await load(true)

    expect(items.value).toHaveLength(2)
    expect(total.value).toBe(2)

    await load(false)

    expect(mockFetchAuthorBooks).toHaveBeenCalledTimes(1)
  })

  it('loads books and updates items and total on success', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1), makeBook(2)], 5))

    const { load, items, total, hasMore } = useAuthorBooks(authorId)
    await load(true)

    expect(items.value).toHaveLength(2)
    expect(total.value).toBe(5)
    expect(hasMore.value).toBe(true)
  })

  it('sends collapseSeries only once it is turned on', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1)]))

    const { load, collapseSeries } = useAuthorBooks(authorId)
    await load(true)
    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ collapseSeries: false }))

    collapseSeries.value = true
    await load(true)

    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(2, 1, expect.objectContaining({ collapseSeries: true }))
  })

  it('paginates on rows while keeping the book count separately', async () => {
    const authorId = ref(1)
    // 30 collapsed rows standing for 200 books: the row count is what says there is more to load,
    // and the book count must not be the thing driving it.
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1), makeBook(2)], 30, 200))

    const { load, items, total, bookTotal, hasMore } = useAuthorBooks(authorId)
    await load(true)

    expect(items.value).toHaveLength(2)
    expect(total.value).toBe(30)
    expect(bookTotal.value).toBe(200)
    expect(hasMore.value).toBe(true)
  })

  it('stops loading once every row has arrived, however many books they stand for', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1), makeBook(2)], 2, 200))

    const { load, hasMore, bookTotal } = useAuthorBooks(authorId)
    await load(true)

    expect(hasMore.value).toBe(false)
    expect(bookTotal.value).toBe(200)
  })

  it('resets items and page on reset=true', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 3)).mockResolvedValueOnce(makePage([makeBook(99)], 1))

    const { load, items, total } = useAuthorBooks(authorId)
    await load(true)
    expect(items.value).toHaveLength(1)
    expect(total.value).toBe(3)

    await load(true)

    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.id).toBe(99)
    expect(total.value).toBe(1)
  })

  it('appends items on subsequent non-reset load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 2)).mockResolvedValueOnce(makePage([makeBook(2)], 2))

    const { load, items, hasMore } = useAuthorBooks(authorId)
    await load(true)
    expect(hasMore.value).toBe(true)

    await load(false)

    expect(items.value).toHaveLength(2)
    expect(items.value[0]!.id).toBe(1)
    expect(items.value[1]!.id).toBe(2)
  })

  it('increments page number after each load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 2)).mockResolvedValueOnce(makePage([makeBook(2)], 2))

    const { load } = useAuthorBooks(authorId)
    await load(true)
    await load()

    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ page: 0 }))
    expect(mockFetchAuthorBooks).toHaveBeenNthCalledWith(2, 1, expect.objectContaining({ page: 1 }))
  })

  it('sets error on fetch failure', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValue(new Error('network error'))

    const { load, error, items } = useAuthorBooks(authorId)
    await load(true)

    expect(error.value).toBe('network error')
    expect(items.value).toEqual([])
  })

  it('uses fallback error message for non-Error thrown values', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValue('string error')

    const { load, error } = useAuthorBooks(authorId)
    await load(true)

    expect(error.value).toBe('Failed to load books')
  })

  it('clears previous error on new load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValueOnce(new Error('first failure')).mockResolvedValueOnce(makePage([makeBook(1)]))

    const { load, error } = useAuthorBooks(authorId)
    await load(true)
    expect(error.value).toBe('first failure')

    await load(true)
    expect(error.value).toBeNull()
  })

  it('resets loading to false after successful load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([]))

    const { load, loading } = useAuthorBooks(authorId)
    await load(true)

    expect(loading.value).toBe(false)
  })

  it('resets loading to false after failed load', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockRejectedValue(new Error('fail'))

    const { load, loading } = useAuthorBooks(authorId)
    await load(true)

    expect(loading.value).toBe(false)
  })

  it('passes sort, order, libraryId, and collapseSeries to fetchAuthorBooks', async () => {
    const authorId = ref(5)
    mockFetchAuthorBooks.mockResolvedValue(makePage([]))

    const { load, sort, order, libraryId, collapseSeries } = useAuthorBooks(authorId)
    sort.value = 'title'
    order.value = 'asc'
    libraryId.value = 7
    collapseSeries.value = true

    await load(true)

    expect(mockFetchAuthorBooks).toHaveBeenCalledWith(5, {
      page: 0,
      size: 50,
      sort: 'title',
      order: 'asc',
      libraryId: 7,
      collapseSeries: true,
    })
  })

  it('passes null libraryId through unchanged', async () => {
    const authorId = ref(3)
    mockFetchAuthorBooks.mockResolvedValue(makePage([]))

    const { load } = useAuthorBooks(authorId)
    await load(true)

    expect(mockFetchAuthorBooks).toHaveBeenCalledWith(3, expect.objectContaining({ libraryId: null }))
  })

  it('hasMore is false when all items are loaded', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1), makeBook(2)], 2))

    const { load, hasMore } = useAuthorBooks(authorId)
    await load(true)

    expect(hasMore.value).toBe(false)
  })

  it('hasMore is true when not all items are loaded', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1)], 10))

    const { load, hasMore } = useAuthorBooks(authorId)
    await load(true)

    expect(hasMore.value).toBe(true)
  })

  it('load(false) default argument behaves same as load(false) explicit', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(1)], 5))

    const { load, items } = useAuthorBooks(authorId)
    await load(true)

    mockFetchAuthorBooks.mockResolvedValue(makePage([makeBook(2)], 5))
    await load()

    expect(items.value).toHaveLength(2)
  })

  it('reset clears items immediately before fetch resolves', async () => {
    const authorId = ref(1)
    mockFetchAuthorBooks.mockResolvedValueOnce(makePage([makeBook(1)], 1))

    const { load, items } = useAuthorBooks(authorId)
    await load(true)
    expect(items.value).toHaveLength(1)

    let resolve!: (v: AuthorBooksPage) => void
    mockFetchAuthorBooks.mockImplementation(
      () =>
        new Promise<AuthorBooksPage>((r) => {
          resolve = r
        }),
    )

    const pending = load(true)
    expect(items.value).toHaveLength(0)

    resolve(makePage([makeBook(99)]))
    await pending
    expect(items.value).toHaveLength(1)
    expect(items.value[0]!.id).toBe(99)
  })
})
