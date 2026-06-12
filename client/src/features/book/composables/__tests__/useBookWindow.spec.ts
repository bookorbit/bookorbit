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
})
