import { describe, it, expect, vi, beforeEach } from 'vitest'

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
    vi.resetModules()
    apiMock.mockReset()
    // Safe default so any watcher-triggered reload resolves cleanly.
    apiMock.mockResolvedValue(makeResponse(emptyHub))
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
      hub.colorFilter.value = '#FACC15'
      hub.styleFilter.value = 'underline'
      hub.originFilter.value = 'koreader'

      const params = paramsFromUrl(hub.exportUrl('csv'))
      expect(params.get('search')).toBe('needle')
      expect(params.get('bookId')).toBe('5')
      expect(params.get('colors')).toBe('#FACC15')
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

    it('computes pagination ranges', async () => {
      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      hub.total.value = 0
      expect(hub.rangeStart.value).toBe(0)

      hub.total.value = 60
      hub.pageSize.value = 25
      hub.page.value = 2
      expect(hub.totalPages.value).toBe(3)
      expect(hub.rangeStart.value).toBe(26)
      expect(hub.rangeEnd.value).toBe(50)
    })
  })

  describe('requests', () => {
    it('load fetches the hub list and populates items, total and stats', async () => {
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
      expect(hub.stats.value).toEqual(body.stats)
    })

    it('load surfaces an error message when the request fails', async () => {
      apiMock.mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      await hub.load()

      expect(hub.error.value).toBe('Failed to load annotations')
    })

    it('loadBooks populates the book facets', async () => {
      apiMock.mockResolvedValueOnce(makeResponse([{ bookId: 5, bookTitle: 'B', author: 'A', count: 3 }]))

      const { useAnnotationsHub } = await import('../useAnnotationsHub')
      const hub = useAnnotationsHub()

      await hub.loadBooks()

      expect(apiMock).toHaveBeenCalledWith('/api/v1/annotations/books?status=active')
      expect(hub.books.value).toEqual([{ bookId: 5, bookTitle: 'B', author: 'A', count: 3 }])
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

      expect(result).toEqual({ ok: false, message: 'Failed to delete' })
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
      hub.page.value = 2
      await nextTick()
      expect(apiMock).toHaveBeenCalled()
    })
  })
})
