import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

const emptyHub = { items: [], total: 0, page: 1, pageSize: 25, stats: { books: 0, withNotes: 0, originBreakdown: [] } }

function paramsFromUrl(url: string): URLSearchParams {
  return new URLSearchParams(url.split('?')[1] ?? '')
}

describe('useAnnotationsHub', () => {
  beforeEach(() => {
    // Fake only the timer functions so the search-debounce setTimeout can never
    // leak a real timer into a later test (which would call the mock mid-reset).
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    vi.resetModules()
    apiMock.mockReset()
    // Safe default so any watcher-triggered reload resolves cleanly.
    apiMock.mockResolvedValue(makeResponse(emptyHub))
  })

  afterEach(() => {
    if (vi.isFakeTimers()) {
      vi.clearAllTimers()
      vi.useRealTimers()
    }
  })

  describe('query building', () => {
    it('builds the query with the date range as local-day-boundary ISO and the notes-only flag', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      hub.dateFrom.value = '2026-01-10'
      hub.dateTo.value = '2026-01-12'
      hub.notesOnly.value = true

      const params = paramsFromUrl(hub.exportUrl('json'))
      expect(params.get('dateFrom')).toBe(new Date('2026-01-10T00:00:00.000').toISOString())
      expect(params.get('dateTo')).toBe(new Date('2026-01-12T23:59:59.999').toISOString())
      expect(params.get('hasNote')).toBe('true')
      expect(params.get('format')).toBe('json')
    })

    it('omits the date range and notes-only params when they are unset', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      const params = paramsFromUrl(hub.exportUrl('md'))
      expect(params.has('dateFrom')).toBe(false)
      expect(params.has('dateTo')).toBe(false)
      expect(params.has('hasNote')).toBe(false)
      expect(params.get('status')).toBe('active')
    })

    it('includes the search, book, color, style and origin filters when set', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      hub.search.value = '  needle  '
      hub.bookFilter.value = 5
      hub.colors.value = ['#FACC15', '#4ADE80']
      hub.styleFilter.value = 'underline'
      hub.originFilter.value = 'koreader'

      const params = paramsFromUrl(hub.exportUrl('csv'))
      expect(params.get('search')).toBe('needle')
      expect(params.get('bookId')).toBe('5')
      expect(params.get('colors')).toBe('#FACC15,#4ADE80')
      expect(params.get('styles')).toBe('underline')
      expect(params.get('origins')).toBe('koreader')
    })

    it('ignores an unparseable date value instead of sending an empty param', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      hub.dateFrom.value = 'not-a-date'

      const params = paramsFromUrl(hub.exportUrl('csv'))
      expect(params.has('dateFrom')).toBe(false)
    })
  })

  describe('toggles', () => {
    it('toggleNotesOnly flips the flag and clearDates resets both dates', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      expect(hub.notesOnly.value).toBe(false)
      hub.toggleNotesOnly()
      expect(hub.notesOnly.value).toBe(true)

      hub.dateFrom.value = '2026-01-01'
      hub.dateTo.value = '2026-01-02'
      hub.clearDates()
      expect(hub.dateFrom.value).toBe('')
      expect(hub.dateTo.value).toBe('')
    })

    it('manages selection state', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()
      hub.items.value = [{ id: 1 }, { id: 2 }, { id: 3 }] as never

      hub.toggleSelected(1)
      hub.toggleSelected(2)
      expect(hub.hasSelection.value).toBe(true)
      expect(hub.selectedIds.value.has(1)).toBe(true)

      hub.toggleSelected(1)
      expect(hub.selectedIds.value.has(1)).toBe(false)

      hub.selectAllOnPage()
      expect(hub.selectedIds.value.size).toBe(3)

      hub.clearSelection()
      expect(hub.selectedIds.value.size).toBe(0)
    })

    it('reports more to load until the loaded window covers the total', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      expect(hub.hasMore.value).toBe(false)

      hub.total.value = 60
      expect(hub.hasMore.value).toBe(true)

      hub.items.value = Array.from({ length: 60 }, (_, index) => ({ id: index }) as never)
      expect(hub.hasMore.value).toBe(false)
    })
  })

  describe('requests', () => {
    it('load fetches the hub list and populates items and total', async () => {
      const body = {
        items: [{ id: 1, bookId: 5, note: 'n' }],
        total: 1,
        page: 1,
        pageSize: 25,
        stats: { books: 1, withNotes: 1, originBreakdown: [{ origin: 'web', count: 1 }] },
      }
      apiMock.mockResolvedValueOnce(makeResponse(body))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      await hub.load()

      const url = String(apiMock.mock.calls[0][0])
      expect(url.startsWith('/api/v1/annotations?')).toBe(true)
      expect(hub.items.value).toEqual(body.items)
      expect(hub.total.value).toBe(1)
    })

    it('loadMore appends the next page instead of replacing the window', async () => {
      const first = { items: [{ id: 1 }], total: 2, page: 1, pageSize: 50, stats: emptyHub.stats }
      const second = { items: [{ id: 2 }], total: 2, page: 2, pageSize: 50, stats: emptyHub.stats }
      apiMock.mockResolvedValueOnce(makeResponse(first)).mockResolvedValueOnce(makeResponse(second))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      await hub.load()
      await hub.loadMore()

      expect(hub.items.value.map((item) => item.id)).toEqual([1, 2])
      expect(String(apiMock.mock.calls[1][0])).toContain('page=2')
      expect(hub.hasMore.value).toBe(false)
    })

    it('loadOverview populates the side rail facets', async () => {
      const overview = {
        total: 3,
        books: 2,
        withNotes: 1,
        needsReview: 0,
        trashed: 0,
        originBreakdown: [],
        colorBreakdown: [],
        shelf: [],
        weeks: [],
        busiestWeek: null,
        longestQuietWeeks: 0,
        devices: [],
      }
      apiMock.mockResolvedValueOnce(makeResponse(overview))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      await hub.loadOverview()

      expect(String(apiMock.mock.calls[0][0])).toContain('/api/v1/annotations/overview?')
      expect(hub.overview.value).toEqual(overview)
    })

    it('load surfaces an error message when the request fails', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      await hub.load()

      expect(hub.error.value).toBe('failed')
    })

    it('searchBooks queries the books facet endpoint with the trimmed term', async () => {
      apiMock.mockResolvedValueOnce(makeResponse([{ bookId: 5, bookTitle: 'B', author: 'A', count: 3 }]))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      const facets = await hub.searchBooks('  dune  ')

      const url = String(apiMock.mock.calls[0][0])
      expect(url).toContain('/api/v1/annotations/books?')
      expect(url).toContain('status=active')
      expect(url).toContain('q=dune')
      expect(facets).toEqual([{ bookId: 5, bookTitle: 'B', author: 'A', count: 3 }])
    })

    it('resolveSelectedBook fills the label for the selected book id', async () => {
      apiMock.mockResolvedValueOnce(makeResponse([{ bookId: 7, bookTitle: 'Dune', author: 'FH', count: 9 }]))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()
      hub.hydrate({ bookFilter: 7 })

      await hub.resolveSelectedBook()

      const url = String(apiMock.mock.calls[0][0])
      expect(url).toContain('selectedId=7')
      expect(hub.selectedBookLabel.value).toBe('Dune')
    })

    it('resolveSelectedBook clears the label when no book is selected', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      await hub.resolveSelectedBook()

      expect(apiMock).not.toHaveBeenCalled()
      expect(hub.selectedBookLabel.value).toBeNull()
    })

    it('bulk returns 0 and skips the request when nothing is selected', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      expect(await hub.bulk('trash')).toBe(0)
      expect(apiMock).not.toHaveBeenCalled()
    })

    it('bulk posts the action and returns the affected count', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({ affected: 2 }))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()
      hub.selectedIds.value = new Set([1, 2])

      const affected = await hub.bulk('restyle', { color: '#FACC15' })

      expect(affected).toBe(2)
      const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/v1/annotations/bulk')
      expect(req.method).toBe('POST')
      expect(JSON.parse(String(req.body))).toEqual({ ids: [1, 2], action: 'restyle', color: '#FACC15' })
      expect(hub.selectedIds.value.size).toBe(0)
    })

    it('restore posts and resolves true on success', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({}))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      const ok = await hub.restore(7)

      expect(ok).toBe(true)
      expect(apiMock).toHaveBeenCalledWith('/api/v1/annotations/7/restore', { method: 'POST' })
    })

    it('purge deletes and resolves ok on success', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({}, { ok: true, status: 204 }))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      const result = await hub.purge(7)

      expect(result.ok).toBe(true)
      expect(apiMock).toHaveBeenCalledWith('/api/v1/annotations/7', { method: 'DELETE' })
    })

    it('purge surfaces the conflict message on 409', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({ message: 'Still queued' }, { ok: false, status: 409 }))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      const result = await hub.purge(7)

      expect(result).toEqual({ ok: false, message: 'Still queued' })
    })

    it('purge returns a generic failure on other errors', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      const result = await hub.purge(7)

      expect(result).toEqual({ ok: false })
    })
  })

  describe('reactivity', () => {
    it('reloads on filter changes and resets the book filter when the tab changes', async () => {
      const { nextTick } = await import('vue')
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      hub.bookFilter.value = 5
      hub.status.value = 'trashed'
      await nextTick()
      expect(hub.bookFilter.value).toBe('all')

      apiMock.mockClear()
      hub.view.value = 'book'
      await nextTick()
      expect(apiMock).toHaveBeenCalled()
    })
  })

  describe('view', () => {
    it('drives the grouping and the server sort from one key', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      expect(hub.view.value).toBe('newest')
      expect(hub.groupMode.value).toBe('month')

      hub.view.value = 'oldest'
      expect(hub.groupMode.value).toBe('month')
      expect(hub.exportUrl('md')).toContain('sortDir=asc')

      hub.view.value = 'book'
      expect(hub.groupMode.value).toBe('book')
      expect(hub.exportUrl('md')).toContain('sortBy=book')

      hub.view.value = 'source'
      expect(hub.groupMode.value).toBe('source')
      expect(hub.exportUrl('md')).toContain('sortBy=origin')
    })
  })

  describe('popover filters', () => {
    it('builds chips, counts them, and clears individually or all at once', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      expect(hub.popoverFilterCount.value).toBe(0)

      hub.colors.value = ['#FACC15']
      hub.styleFilter.value = 'underline'
      hub.originFilter.value = 'koreader'
      hub.dateFrom.value = '2026-01-10'

      expect(hub.popoverFilterCount.value).toBe(4)

      hub.removeFilterChip('color:#FACC15')
      expect(hub.colors.value).toEqual([])
      expect(hub.popoverFilterCount.value).toBe(3)

      hub.clearPopoverFilters()
      expect(hub.popoverFilterCount.value).toBe(0)
      expect(hub.styleFilter.value).toBe('all')
      expect(hub.originFilter.value).toBe('all')
      expect(hub.dateFrom.value).toBe('')
    })

    it('does not count the book or notes-only filters as popover filters', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      hub.bookFilter.value = 5
      hub.notesOnly.value = true

      expect(hub.popoverFilterCount.value).toBe(0)
      expect(hub.hasActiveFilters.value).toBe(true)
    })
  })

  describe('hydrate', () => {
    it('restores state without letting the filter watcher reload mid-hydration', async () => {
      const { nextTick } = await import('vue')
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      apiMock.mockClear()
      hub.hydrate({ colors: ['#FACC15'], notesOnly: true, needsReviewOnly: true, view: 'oldest' })

      expect(hub.colors.value).toEqual(['#FACC15'])
      expect(hub.notesOnly.value).toBe(true)
      expect(hub.needsReviewOnly.value).toBe(true)
      expect(hub.view.value).toBe('oldest')
      expect(apiMock).not.toHaveBeenCalled()

      await nextTick()
      expect(hub.hydrating.value).toBe(false)
    })
  })

  describe('search debounce', () => {
    it('defers the search-triggered reload until the debounce elapses', async () => {
      vi.useFakeTimers()
      try {
        const { nextTick } = await import('vue')
        const { useAnnotationsHub } = await import('../useAnnotationsHub')
        const hub = useAnnotationsHub()
        apiMock.mockClear()

        hub.search.value = 'dune'
        await nextTick()
        expect(apiMock).not.toHaveBeenCalled()

        vi.advanceTimersByTime(300)
        expect(apiMock).toHaveBeenCalledTimes(2)
        expect(String(apiMock.mock.calls[0][0])).toContain('search=dune')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('filter reset', () => {
    it('hasActiveFilters reflects active filters and resetAllFilters clears them', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      expect(hub.hasActiveFilters.value).toBe(false)

      hub.colors.value = ['#FACC15']
      hub.bookFilter.value = 5
      hub.selectedBookLabel.value = 'Dune'
      hub.notesOnly.value = true
      hub.dateFrom.value = '2026-01-01'
      expect(hub.hasActiveFilters.value).toBe(true)

      hub.resetAllFilters()
      expect(hub.hasActiveFilters.value).toBe(false)
      expect(hub.bookFilter.value).toBe('all')
      expect(hub.selectedBookLabel.value).toBeNull()
      expect(hub.notesOnly.value).toBe(false)
      expect(hub.colors.value).toEqual([])
      expect(hub.dateFrom.value).toBe('')
    })
  })

  describe('updateAnnotation', () => {
    it('optimistically patches the item and PATCHes the book-scoped endpoint', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({}))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()
      hub.items.value = [{ id: 1, bookId: 5, note: 'old', color: '#FACC15' }] as never

      await hub.updateNote(1, 'new')

      const [url, req] = apiMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('/api/v1/books/5/annotations/1')
      expect(req.method).toBe('PATCH')
      expect(JSON.parse(String(req.body))).toEqual({ note: 'new' })
      expect(hub.items.value[0]!.note).toBe('new')
      expect(hub.savingIds.value.has(1)).toBe(false)
    })

    it('reverts the optimistic change when the request fails', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()
      hub.items.value = [{ id: 1, bookId: 5, note: 'old' }] as never

      await hub.updateNote(1, 'new')

      expect(hub.items.value[0]!.note).toBe('old')
      expect(hub.savingIds.value.has(1)).toBe(false)
    })
  })

  describe('load sequencing', () => {
    it('reloads the list and the overview exactly once when a filter changes', async () => {
      const { nextTick } = await import('vue')
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      apiMock.mockClear()
      hub.colors.value = ['#FACC15']
      await nextTick()

      expect(apiMock).toHaveBeenCalledTimes(2)
      const urls = apiMock.mock.calls.map((call) => String(call[0]))
      expect(urls.filter((url) => url.startsWith('/api/v1/annotations?'))).toHaveLength(1)
      expect(urls.filter((url) => url.startsWith('/api/v1/annotations/overview?'))).toHaveLength(1)
    })

    it('discards a stale load when a newer load has superseded it', async () => {
      apiMock.mockReset()
      let resolveStale!: (res: Response) => void
      const stalePending = new Promise<Response>((resolve) => {
        resolveStale = resolve
      })
      const freshBody = { items: [{ id: 2 }], total: 2, page: 1, pageSize: 50, stats: emptyHub.stats }
      apiMock.mockReturnValueOnce(stalePending).mockResolvedValueOnce(makeResponse(freshBody))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      const stale = hub.load()
      const fresh = hub.load()
      await fresh

      expect(hub.total.value).toBe(2)
      expect(hub.loading.value).toBe(false)

      resolveStale(makeResponse({ items: [{ id: 1 }], total: 1, page: 1, pageSize: 50, stats: emptyHub.stats }))
      await stale

      expect(hub.total.value).toBe(2)
      expect(hub.loading.value).toBe(false)
    })
  })
})
