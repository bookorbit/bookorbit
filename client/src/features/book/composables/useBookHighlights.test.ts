import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFetch = vi.fn<(...args: any[]) => any>()
vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockFetch(...args),
}))

import { useBookHighlights } from './useBookHighlights'

function makeListResponse(overrides?: Record<string, unknown>) {
  return {
    items: [
      {
        id: 1,
        bookId: 5,
        cfi: 'epubcfi(/6/4!/4/2/1:0)',
        text: 'highlighted text',
        color: '#FACC15',
        style: 'highlight',
        note: null,
        chapterTitle: 'Chapter 1',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
    stats: {
      totalHighlights: 1,
      colorBreakdown: [{ color: '#FACC15', count: 1 }],
      chaptersWithHighlights: 1,
      highlightsWithNotes: 0,
      chapters: ['Chapter 1'],
    },
    ...overrides,
  }
}

function mockOkResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) }
}

function mockErrorResponse(status = 500) {
  return { ok: false, status, json: () => Promise.resolve({}) }
}

describe('useBookHighlights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches highlights on mount', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { items, total, stats, loading } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(loading.value).toBe(false))

    expect(items.value).toHaveLength(1)
    expect(total.value).toBe(1)
    expect(stats.value?.totalHighlights).toBe(1)
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/books/5/annotations?'))
  })

  it('sets error on failed fetch', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse())
    const bookId = ref(5)
    const { error, loading } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(loading.value).toBe(false))

    expect(error.value).toBe('HTTP 500')
  })

  it('includes pagination and sort params in the URL', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    const url = mockFetch.mock.calls[0]?.[0] as string
    expect(url).toContain('page=1')
    expect(url).toContain('pageSize=25')
    expect(url).toContain('sortBy=position')
    expect(url).toContain('sortDir=asc')
  })

  it('reloads with the selected colors when the colors filter changes', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { colors } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())
    mockFetch.mockClear()

    colors.value = ['#FACC15']

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(mockFetch.mock.calls[0]?.[0]).toContain('colors=%23FACC15')
  })

  it('maps the merged sort key to sortBy/sortDir', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { sortBy, sortDir, sortKey } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    expect(sortKey.value).toBe('position')
    sortKey.value = 'newest'
    expect(sortBy.value).toBe('createdAt')
    expect(sortDir.value).toBe('desc')
    sortKey.value = 'oldest'
    expect(sortDir.value).toBe('asc')
  })

  it('reloads when the page changes', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { page } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())
    mockFetch.mockClear()

    page.value = 3

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())
    expect(page.value).toBe(3)
    expect(mockFetch.mock.calls[0]?.[0]).toContain('page=3')
  })

  it('updateNote optimistically patches the item and PATCHes the endpoint', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { items, updateNote } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(items.value).toHaveLength(1))
    mockFetch.mockClear()
    mockFetch.mockResolvedValue(mockOkResponse({}))

    await updateNote(1, 'my note')

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/books/5/annotations/1', expect.objectContaining({ method: 'PATCH' }))
    expect(items.value[0]?.note).toBe('my note')
  })

  it('updateColor optimistically patches the item color', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { items, updateColor } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(items.value).toHaveLength(1))
    mockFetch.mockClear()
    mockFetch.mockResolvedValue(mockOkResponse({}))

    await updateColor(1, '#4ADE80')

    expect(items.value[0]?.color).toBe('#4ADE80')
  })

  it('deleteHighlight removes item optimistically and refetches', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { items, deleteHighlight } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(items.value).toHaveLength(1))
    mockFetch.mockClear()

    mockFetch.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(mockOkResponse(makeListResponse({ items: [], total: 0 })))

    await deleteHighlight(1)

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/books/5/annotations/1', expect.objectContaining({ method: 'DELETE' }))
  })

  it('deleteHighlight reverts on failure', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { items, total, error, deleteHighlight } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(items.value).toHaveLength(1))
    mockFetch.mockClear()

    mockFetch.mockResolvedValue(mockErrorResponse())

    await deleteHighlight(1)

    expect(items.value).toHaveLength(1)
    expect(total.value).toBe(1)
    expect(error.value).toBeTruthy()
  })

  it('builds color/date chips and resets all filters', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { colors, dateFrom, chapter, search, activeFilterChips, popoverFilterCount, hasActiveFilters, resetAllFilters } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    colors.value = ['#FACC15']
    dateFrom.value = '2026-01-10'
    chapter.value = 'Chapter 1'
    search.value = 'freedom'

    expect(hasActiveFilters.value).toBe(true)
    expect(popoverFilterCount.value).toBe(2)
    expect(activeFilterChips.value.map((chip) => chip.id)).toEqual(['color:#FACC15', 'date'])

    resetAllFilters()
    expect(colors.value).toEqual([])
    expect(dateFrom.value).toBe('')
    expect(chapter.value).toBe('')
    expect(search.value).toBe('')
    expect(hasActiveFilters.value).toBe(false)
  })

  it('bulkTrash returns 0 without calling the API for an empty selection', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { bulkTrash } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())
    mockFetch.mockClear()

    expect(await bulkTrash([])).toBe(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('bulkTrash posts the trash action, optimistically drops the item, and returns the affected count', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { items, bulkTrash } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(items.value).toHaveLength(1))
    mockFetch.mockClear()
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ affected: 1 }) })
      .mockResolvedValueOnce(mockOkResponse(makeListResponse({ items: [], total: 0 })))

    const affected = await bulkTrash([1])

    expect(affected).toBe(1)
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit
    expect(mockFetch.mock.calls[0]?.[0]).toBe('/api/v1/annotations/bulk')
    expect(JSON.parse(String(init.body))).toEqual({ ids: [1], action: 'trash' })
  })

  it('bulkTrash reverts items and total when the request fails', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { items, total, error, bulkTrash } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(items.value).toHaveLength(1))
    mockFetch.mockClear()
    mockFetch.mockResolvedValue(mockErrorResponse())

    const affected = await bulkTrash([1])

    expect(affected).toBe(0)
    expect(items.value).toHaveLength(1)
    expect(total.value).toBe(1)
    expect(error.value).toBeTruthy()
  })

  it('bulkRestyle posts the restyle patch and returns the affected count', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { bulkRestyle } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())
    mockFetch.mockClear()
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ affected: 2 }) })
      .mockResolvedValueOnce(mockOkResponse(makeListResponse()))

    const affected = await bulkRestyle([1, 2], { color: '#4ADE80' })

    expect(affected).toBe(2)
    const init = mockFetch.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(init.body))).toEqual({ ids: [1, 2], action: 'restyle', color: '#4ADE80' })
  })

  it('bulkRestyle returns 0 for an empty selection and sets an error on failure', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { bulkRestyle, error } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    expect(await bulkRestyle([], { color: '#fff' })).toBe(0)

    mockFetch.mockClear()
    mockFetch.mockResolvedValue(mockErrorResponse())
    expect(await bulkRestyle([1], { style: 'underline' })).toBe(0)
    expect(error.value).toBeTruthy()
  })

  it('removeFilterChip clears a single color or the whole date range', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { colors, dateFrom, dateTo, removeFilterChip } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    colors.value = ['#FACC15', '#4ADE80']
    removeFilterChip('color:#FACC15')
    expect(colors.value).toEqual(['#4ADE80'])

    dateFrom.value = '2026-01-01'
    dateTo.value = '2026-01-31'
    removeFilterChip('date')
    expect(dateFrom.value).toBe('')
    expect(dateTo.value).toBe('')
  })

  it('maps the position sort key back to sortBy/sortDir', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { sortKey, sortBy, sortDir } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    sortKey.value = 'newest'
    expect(sortBy.value).toBe('createdAt')

    sortKey.value = 'position'
    expect(sortBy.value).toBe('position')
    expect(sortDir.value).toBe('asc')
  })

  it('refetches exactly once when a filter changes while on a later page', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { page, colors } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    page.value = 3
    await nextTick()
    mockFetch.mockClear()

    colors.value = ['#FACC15']
    await nextTick()

    expect(page.value).toBe(1)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('discards a stale fetch when a newer fetch supersedes it', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { total, loading, fetchHighlights } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(loading.value).toBe(false))

    let resolveStale!: (res: unknown) => void
    const stalePending = new Promise((resolve) => {
      resolveStale = resolve
    })
    mockFetch.mockReset()
    mockFetch.mockReturnValueOnce(stalePending).mockResolvedValueOnce(mockOkResponse(makeListResponse({ total: 9 })))

    const stale = fetchHighlights()
    const fresh = fetchHighlights()
    await fresh

    expect(total.value).toBe(9)

    resolveStale(mockOkResponse(makeListResponse({ total: 1 })))
    await stale

    expect(total.value).toBe(9)
    expect(loading.value).toBe(false)
  })

  it('resets state when bookId changes', async () => {
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))
    const bookId = ref(5)
    const { colors, search, chapter, page } = useBookHighlights(bookId)

    await nextTick()
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled())

    colors.value = ['#FACC15']
    chapter.value = 'Chapter 1'
    page.value = 3
    mockFetch.mockClear()
    mockFetch.mockResolvedValue(mockOkResponse(makeListResponse()))

    bookId.value = 10
    await nextTick()

    expect(colors.value).toEqual([])
    expect(search.value).toBe('')
    expect(chapter.value).toBe('')
    expect(page.value).toBe(1)
  })
})
