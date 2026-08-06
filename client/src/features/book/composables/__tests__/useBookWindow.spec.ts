import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BooksPage } from '@bookorbit/types'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

import { BOOK_WINDOW_BLOCK_SIZE, isBookPlaceholder, useBookWindow, type BookWindowQuery } from '../useBookWindow'

function makeBook(id: number, overrides: Partial<BookCard> = {}): BookCard {
  return {
    id,
    status: 'active',
    title: `Book ${id}`,
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
    customMetadata: [],
    ...overrides,
  } as BookCard
}

function pageFor(block: number, total: number): BooksPage {
  const start = block * BOOK_WINDOW_BLOCK_SIZE
  const count = Math.max(0, Math.min(BOOK_WINDOW_BLOCK_SIZE, total - start))
  return {
    items: Array.from({ length: count }, (_, i) => makeBook(start + i + 1)),
    total,
    page: block,
    size: BOOK_WINDOW_BLOCK_SIZE,
  }
}

function mockBlocks(total: number) {
  fetchMock.mockImplementation((_url, init) => {
    const body = JSON.parse(String(init?.body)) as { pagination: { page: number } }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(pageFor(body.pagination.page, total)),
    })
  })
}

function requestedBlocks(): number[] {
  return fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { pagination: { page: number } }).pagination.page)
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function makeWindow(endpointValue: string | null = '/api/v1/libraries/1/books') {
  const endpoint = ref<string | null>(endpointValue)
  const query = ref<BookWindowQuery>({ sort: [{ field: 'title', dir: 'asc' }] })
  const window = useBookWindow({ endpoint, query })
  return { window, endpoint, query }
}

describe('useBookWindow', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads block 0 on creation and sizes the slot array to the total', async () => {
    mockBlocks(250)
    const { window } = makeWindow()
    await flush()

    expect(requestedBlocks()).toEqual([0])
    expect(window.total.value).toBe(250)
    expect(window.slots.value).toHaveLength(250)
    expect(isBookPlaceholder(window.slots.value[0]!)).toBe(false)
    expect(isBookPlaceholder(window.slots.value[100]!)).toBe(true)
    expect(window.initialized.value).toBe(true)
  })

  it('does nothing when the endpoint is null', async () => {
    const { window } = makeWindow(null)
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(window.initialized.value).toBe(true)
    expect(window.total.value).toBe(0)
  })

  it('ensureRange fetches only missing blocks and dedupes in-flight requests', async () => {
    mockBlocks(500)
    const { window } = makeWindow()
    await flush()
    fetchMock.mockClear()

    window.ensureRange(150, 320)
    window.ensureRange(150, 320)
    await flush()

    expect(requestedBlocks().sort((a, b) => a - b)).toEqual([1, 2, 3])

    fetchMock.mockClear()
    window.ensureRange(150, 320)
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps placeholder ids unique across loads', async () => {
    mockBlocks(300)
    const { window } = makeWindow()
    await flush()
    window.ensureRange(200, 250)
    await flush()

    const ids = window.slots.value.map((slot) => slot.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('delays refetching a failed block and retries after the cooldown', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
      const { window } = makeWindow()
      await flush()
      expect(window.error.value).toBe('HTTP 500')

      fetchMock.mockClear()
      mockBlocks(120)
      window.ensureRange(0, 50)
      await flush()
      expect(fetchMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(2100)
      window.ensureRange(0, 50)
      await flush()
      expect(requestedBlocks()).toEqual([0])
      expect(window.error.value).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets and discards stale responses when the query changes', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
    )
    const { window, query } = makeWindow()
    await flush()

    mockBlocks(80)
    query.value = { sort: [{ field: 'author', dir: 'desc' }] }
    await flush()

    resolveFirst?.({ ok: true, json: () => Promise.resolve(pageFor(0, 999)) })
    await flush()

    expect(window.total.value).toBe(80)
    expect(window.slots.value).toHaveLength(80)
  })

  it('does not refetch when only query property order changes', async () => {
    mockBlocks(80)
    const { query } = makeWindow()
    await flush()
    fetchMock.mockClear()

    query.value = { sort: [{ dir: 'asc', field: 'title' }] }
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exposes the contiguous prefix for list mode', async () => {
    mockBlocks(250)
    const { window } = makeWindow()
    await flush()
    window.ensureRange(200, 249)
    await flush()

    expect(window.contiguousPrefix.value).toHaveLength(100)
    expect(window.loadedCards.value).toHaveLength(150)
  })

  it('updateBook replaces a loaded slot in place', async () => {
    mockBlocks(50)
    const { window } = makeWindow()
    await flush()

    window.updateBook(makeBook(3, { title: 'Renamed' }))
    expect((window.slots.value[2] as BookCard).title).toBe('Renamed')
  })

  it('removeBooks splices slots and keeps total aligned with server indexes', async () => {
    mockBlocks(150)
    const { window } = makeWindow()
    await flush()

    window.removeBooks([1, 2])
    expect(window.total.value).toBe(148)
    expect(window.slots.value).toHaveLength(148)
    expect((window.slots.value[0] as BookCard).id).toBe(3)
  })

  it('prependBooks adds new cards, dedupes known ids, and grows the total', async () => {
    mockBlocks(50)
    const { window } = makeWindow()
    await flush()

    window.prependBooks([makeBook(900), makeBook(1)])
    expect(window.total.value).toBe(51)
    expect((window.slots.value[0] as BookCard).id).toBe(900)
    expect((window.slots.value[1] as BookCard).id).toBe(1)
  })

  it('discards in-flight block writes after a removal shifts indexes', async () => {
    mockBlocks(300)
    const { window } = makeWindow()
    await flush()

    let resolveBlock: ((value: unknown) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBlock = resolve
        }),
    )
    window.ensureRange(100, 150)
    window.removeBooks([1])

    resolveBlock?.({ ok: true, json: () => Promise.resolve(pageFor(1, 300)) })
    await flush()

    expect(window.total.value).toBe(299)
    expect(isBookPlaceholder(window.slots.value[100]!)).toBe(true)
  })

  it('ensureRange resolves only after the requested block has finished loading', async () => {
    mockBlocks(500)
    const { window } = makeWindow()
    await flush()

    let resolveBlock: ((value: unknown) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBlock = resolve
        }),
    )

    let settled = false
    const pending = window.ensureRange(150, 199).then(() => {
      settled = true
    })
    await flush()
    expect(settled).toBe(false)
    expect(isBookPlaceholder(window.slots.value[150]!)).toBe(true)

    resolveBlock?.({ ok: true, json: () => Promise.resolve(pageFor(1, 500)) })
    await pending
    expect(settled).toBe(true)
    expect(isBookPlaceholder(window.slots.value[150]!)).toBe(false)
  })

  it('ensureRange resolves immediately without fetching when the range is already loaded', async () => {
    mockBlocks(50)
    const { window } = makeWindow()
    await flush()
    fetchMock.mockClear()

    await window.ensureRange(0, 49)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ensureRange resolves even when the block fails to load', async () => {
    mockBlocks(300)
    const { window } = makeWindow()
    await flush()
    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    let settled = false
    await window.ensureRange(100, 150).then(() => {
      settled = true
    })

    expect(settled).toBe(true)
    expect(requestedBlocks()).toEqual([1])
    expect(window.error.value).toBe('HTTP 500')
  })

  it('ensureRange awaits an already in-flight block rather than starting a second fetch', async () => {
    mockBlocks(500)
    const { window } = makeWindow()
    await flush()
    fetchMock.mockClear()

    let resolveBlock: ((value: unknown) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBlock = resolve
        }),
    )

    let firstSettled = false
    let secondSettled = false
    const first = window.ensureRange(150, 199).then(() => {
      firstSettled = true
    })
    const second = window.ensureRange(150, 199).then(() => {
      secondSettled = true
    })
    await flush()
    expect(requestedBlocks()).toEqual([1])
    expect(firstSettled).toBe(false)
    expect(secondSettled).toBe(false)

    resolveBlock?.({ ok: true, json: () => Promise.resolve(pageFor(1, 500)) })
    await Promise.all([first, second])
    expect(firstSettled).toBe(true)
    expect(secondSettled).toBe(true)
  })

  it('retry refetches previously failed blocks and clears the error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    const { window } = makeWindow()
    await flush()
    expect(window.error.value).toBe('HTTP 500')

    fetchMock.mockClear()
    mockBlocks(120)
    window.retry()
    await flush()

    expect(requestedBlocks()).toEqual([0])
    expect(window.error.value).toBeNull()
    expect(window.total.value).toBe(120)
  })

  it('retry reloads from scratch when the listing is empty', async () => {
    mockBlocks(0)
    const { window } = makeWindow()
    await flush()
    expect(window.total.value).toBe(0)

    fetchMock.mockClear()
    mockBlocks(40)
    window.retry()
    await flush()

    expect(requestedBlocks()).toEqual([0])
    expect(window.total.value).toBe(40)
  })

  it('retry re-ensures the first block without refetching what is already loaded', async () => {
    mockBlocks(250)
    const { window } = makeWindow()
    await flush()
    fetchMock.mockClear()

    window.retry()
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('booksProxy reconciles assignments by id (remove, update, prepend)', async () => {
    mockBlocks(50)
    const { window } = makeWindow()
    await flush()
    expect(window.booksProxy.value).toHaveLength(50)

    const current = window.booksProxy.value
    window.booksProxy.value = [
      makeBook(900),
      ...current.filter((card) => card.id !== 1).map((card) => (card.id === 2 ? makeBook(2, { title: 'Renamed' }) : card)),
    ]

    const ids = window.loadedCards.value.map((card) => card.id)
    expect(ids).not.toContain(1)
    expect(ids).toContain(900)
    expect((window.loadedCards.value.find((card) => card.id === 2) as BookCard).title).toBe('Renamed')
    expect(window.total.value).toBe(50)
  })

  it('removeBooks is a no-op when none of the ids are loaded', async () => {
    mockBlocks(20)
    const { window } = makeWindow()
    await flush()

    window.removeBooks([9999])
    expect(window.total.value).toBe(20)
    expect(window.slots.value).toHaveLength(20)
  })

  it('prependBooks ignores cards whose ids are already loaded', async () => {
    mockBlocks(20)
    const { window } = makeWindow()
    await flush()

    window.prependBooks([makeBook(1), makeBook(2)])
    expect(window.total.value).toBe(20)
  })

  it('booksProxy assignment with no structural change leaves the window untouched', async () => {
    mockBlocks(20)
    const { window } = makeWindow()
    await flush()

    window.booksProxy.value = [...window.booksProxy.value]
    expect(window.total.value).toBe(20)
    expect(window.loadedCards.value).toHaveLength(20)
  })

  it('updateBook is a no-op when the id is not loaded', async () => {
    mockBlocks(20)
    const { window } = makeWindow()
    await flush()

    const before = window.slots.value
    window.updateBook(makeBook(9999, { title: 'Ghost' }))
    expect(window.slots.value).toBe(before)
  })

  it('booksProxy replaces a card in place when only its contents change', async () => {
    mockBlocks(20)
    const { window } = makeWindow()
    await flush()

    window.booksProxy.value = window.booksProxy.value.map((card) => (card.id === 5 ? makeBook(5, { title: 'Updated' }) : card))

    expect((window.loadedCards.value.find((card) => card.id === 5) as BookCard).title).toBe('Updated')
    expect(window.total.value).toBe(20)
  })
})
