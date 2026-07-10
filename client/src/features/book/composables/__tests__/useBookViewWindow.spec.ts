import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BooksPage, GroupRule, JumpBucket } from '@bookorbit/types'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

import { BOOK_WINDOW_BLOCK_SIZE } from '../useBookWindow'
import { useBookViewWindow } from '../useBookViewWindow'

function makeBook(id: number): BookCard {
  return {
    id,
    status: 'active',
    title: `Book ${id}`,
    authors: [],
    seriesName: null,
    seriesIndex: null,
    files: [],
    publishedDate: null,
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

function bucket(key: string, index: number): JumpBucket {
  return { key, label: key, index, count: 1 } as JumpBucket
}

function mockApi(total: number, buckets: JumpBucket[] = []) {
  fetchMock.mockImplementation((url, init) => {
    if (url.includes('jump-buckets')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ buckets }) })
    }
    const body = JSON.parse(String(init?.body)) as { pagination: { page: number } }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(pageFor(body.pagination.page, total)) })
  })
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function setup(options: { scope?: number | null; viewMode?: string; collapse?: boolean; q?: string } = {}) {
  const scopeId = ref<number | null>(options.scope === undefined ? 1 : options.scope)
  const viewMode = ref(options.viewMode ?? 'table')
  const collapseEnabled = ref(options.collapse ?? false)
  const q = ref(options.q ?? '')
  const win = useBookViewWindow({
    scopeId,
    listEndpoint: (id) => `/api/v1/libraries/${id}/books`,
    bucketsEndpoint: (id) => `/api/v1/libraries/${id}/books/jump-buckets`,
    viewMode,
    collapseEnabled,
    q,
  })
  return { win, scopeId, viewMode, collapseEnabled, q }
}

function listRequests(): number[] {
  return fetchMock.mock.calls
    .filter(([url]) => !url.includes('jump-buckets'))
    .map(([, init]) => (JSON.parse(String(init?.body)) as { pagination: { page: number } }).pagination.page)
}

describe('useBookViewWindow', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads the first block on creation and exposes window state', async () => {
    mockApi(250)
    const { win } = setup()
    await flush()

    expect(win.total.value).toBe(250)
    expect(win.contiguousPrefix.value).toHaveLength(100)
    expect(win.hasMorePrefix.value).toBe(true)
  })

  it('does not fetch when the scope id is invalid', async () => {
    mockApi(250)
    const { win } = setup({ scope: null })
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(win.total.value).toBe(0)
  })

  it('loadMorePrefix resolves only after the next contiguous chunk has loaded', async () => {
    mockApi(500)
    const { win } = setup()
    await flush()
    expect(win.contiguousPrefix.value).toHaveLength(100)

    let resolveBlock: ((value: unknown) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBlock = resolve
        }),
    )

    let settled = false
    const pending = win.loadMorePrefix()!.then(() => {
      settled = true
    })
    await flush()
    expect(settled).toBe(false)

    resolveBlock?.({ ok: true, json: () => Promise.resolve(pageFor(1, 500)) })
    await pending
    expect(settled).toBe(true)
    expect(win.contiguousPrefix.value).toHaveLength(200)
    expect(win.hasMorePrefix.value).toBe(true)
  })

  it('handleRange loads far blocks and handleFirstVisibleIndex tracks the viewport', async () => {
    mockApi(500)
    const { win } = setup()
    await flush()
    fetchMock.mockClear()

    win.handleRange(300, 320)
    await flush()
    expect(listRequests()).toEqual([3])

    win.handleFirstVisibleIndex(42)
    expect(win.firstVisibleIndex.value).toBe(42)
  })

  it('reflects filter, collapse, and search in the query', async () => {
    mockApi(120)
    const { win } = setup({ collapse: true, q: '  dune  ' })
    await flush()

    const filter: GroupRule = { type: 'group', join: 'AND', rules: [] }
    win.filter.value = filter

    expect(win.query.value).toMatchObject({
      collapseSeries: true,
      q: 'dune',
      filter,
    })
  })

  it('reverses the letter template for a descending sort', async () => {
    mockApi(120)
    const { win } = setup()
    await flush()

    expect(win.letterTemplate.value[0]).toBe('#')

    win.sort.value = [{ field: 'title', dir: 'desc' }]
    await nextTick()
    expect(win.letterTemplate.value[0]).not.toBe('#')
    expect(win.bucketKind.value).not.toBeNull()
  })

  it('keeps the jump rail hidden in table mode', async () => {
    mockApi(250, [bucket('A', 0), bucket('B', 120)])
    const { win } = setup({ viewMode: 'table' })
    await flush()

    expect(win.railVisible.value).toBe(false)
    expect(win.railGutterReserved.value).toBe(false)
  })

  it('shows the jump rail in grid mode once buckets load and jumps scroll to the bucket index', async () => {
    mockApi(250, [bucket('A', 0), bucket('B', 120)])
    const { win } = setup({ viewMode: 'grid' })
    await flush()

    expect(win.railVisible.value).toBe(true)
    expect(win.activeBucketKey.value).toBe('A')
    expect(typeof win.railGutterReserved.value).toBe('boolean')

    const scrollTo = vi.fn<(index: number) => void>()
    win.registerScroller(scrollTo)
    fetchMock.mockClear()

    win.handleJump(bucket('B', 120))
    await flush()

    expect(scrollTo).toHaveBeenCalledWith(120)
    expect(win.firstVisibleIndex.value).toBe(120)
    expect(listRequests()).toContain(1)

    win.releaseRailGutter()
  })
})
