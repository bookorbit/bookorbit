import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

import { useBookReadingLog } from '../useBookReadingLog'

function makeResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

const emptyStats = {
  totalSessions: 0,
  totalSeconds: 0,
  avgDurationSeconds: 0,
  firstSessionAt: null,
  lastSessionAt: null,
  dailySummary: [],
  paceProgressDelta: 0,
  paceDurationSeconds: 0,
  progressSummary: [],
}

function makeSession(id: number, overrides?: Record<string, unknown>) {
  return {
    id,
    startedAt: '2026-04-15T10:00:00.000Z',
    endedAt: '2026-04-15T10:30:00.000Z',
    durationSeconds: 1800,
    progressDelta: null,
    endProgress: null,
    format: null,
    source: 'web',
    ...overrides,
  }
}

function makeListResponse(items: unknown[] = [], total?: number) {
  return makeResponse({
    items,
    total: total ?? items.length,
    page: 1,
    pageSize: 25,
    stats: emptyStats,
  })
}

describe('useBookReadingLog', () => {
  beforeEach(() => {
    mocks.api.mockReset()
    mocks.api.mockResolvedValue(makeListResponse())
  })

  it('fetches sessions immediately on mount', async () => {
    const bookId = ref(10)
    useBookReadingLog(bookId)
    await nextTick()
    await nextTick()
    expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining('/api/v1/books/10/sessions'))
  })

  it('updates sessions and stats after fetch', async () => {
    const session = makeSession(1, { format: 'epub' })
    mocks.api.mockResolvedValue(
      makeResponse({
        items: [session],
        total: 1,
        page: 1,
        pageSize: 25,
        stats: { ...emptyStats, totalSessions: 1, totalSeconds: 1800, avgDurationSeconds: 1800 },
      }),
    )

    const bookId = ref(10)
    const { sessions, total, stats } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    expect(sessions.value).toHaveLength(1)
    expect(total.value).toBe(1)
    expect(stats.value?.totalSessions).toBe(1)
  })

  it('re-fetches when bookId changes', async () => {
    const bookId = ref(10)
    useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    mocks.api.mockClear()
    mocks.api.mockResolvedValue(makeListResponse())

    bookId.value = 20
    await nextTick()
    await nextTick()

    expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining('/api/v1/books/20/sessions'))
  })

  it('sets error when fetch fails', async () => {
    mocks.api.mockRejectedValue(new Error('network error'))

    const bookId = ref(10)
    const { error } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    expect(error.value).toContain('network error')
  })

  it('deleteSession removes item optimistically then refreshes stats only', async () => {
    mocks.api
      .mockResolvedValueOnce(makeListResponse([makeSession(1), makeSession(2)], 2))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null } as Response)
      .mockResolvedValueOnce(makeListResponse([makeSession(2)], 1))

    const bookId = ref(10)
    const { sessions, total, deleteSession } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    await deleteSession(1)
    await nextTick()

    expect(sessions.value.map((s) => s.id)).toEqual([2])
    expect(total.value).toBe(1)
    const statsUrl = mocks.api.mock.calls[2]?.[0] as string
    expect(statsUrl).toContain('page=1')
    expect(statsUrl).toContain('pageSize=1')
  })

  it('deleteSession rolls back sessions and total on error', async () => {
    mocks.api
      .mockResolvedValueOnce(makeListResponse([makeSession(1)], 5))
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => null } as Response)

    const bookId = ref(10)
    const { sessions, total, error, deleteSession } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    expect(total.value).toBe(5)
    await deleteSession(1)

    expect(sessions.value).toHaveLength(1)
    expect(total.value).toBe(5)
    expect(error.value).toBeTruthy()
  })

  it('setFilters resets page to 1 and includes dateFrom in request', async () => {
    mocks.api.mockResolvedValue(makeListResponse())

    const bookId = ref(10)
    const { setFilters } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    mocks.api.mockClear()
    mocks.api.mockResolvedValue(makeListResponse())

    setFilters({ dateFrom: '2026-01-01T00:00:00.000Z' })
    await nextTick()
    await nextTick()

    const url = mocks.api.mock.calls[0]?.[0] as string
    expect(url).toContain('dateFrom=')
    expect(url).toContain('page=1')
  })

  it('setSort resets page to 1 and sorts by new column', async () => {
    mocks.api.mockResolvedValue(makeListResponse())

    const bookId = ref(10)
    const { setSort, page } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    mocks.api.mockClear()
    mocks.api.mockResolvedValue(makeListResponse())

    setSort('durationSeconds', 'asc')
    await nextTick()
    await nextTick()

    expect(page.value).toBe(1)
    const url = mocks.api.mock.calls[0]?.[0] as string
    expect(url).toContain('sortBy=durationSeconds')
    expect(url).toContain('sortDir=asc')
  })

  it('loadMore appends the next page without duplicates', async () => {
    const firstPage = Array.from({ length: 25 }, (_, i) => makeSession(i + 1))
    mocks.api.mockResolvedValueOnce(makeListResponse(firstPage, 30))

    const bookId = ref(10)
    const { sessions, hasMore, loadMore } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    expect(sessions.value).toHaveLength(25)
    expect(hasMore.value).toBe(true)

    mocks.api.mockClear()
    const secondPage = [makeSession(25), ...Array.from({ length: 5 }, (_, i) => makeSession(i + 26))]
    mocks.api.mockResolvedValueOnce(makeListResponse(secondPage, 30))

    await loadMore()

    const url = mocks.api.mock.calls[0]?.[0] as string
    expect(url).toContain('page=2')
    expect(sessions.value).toHaveLength(30)
    expect(hasMore.value).toBe(false)
  })

  it('loadMore is a no-op when everything is loaded', async () => {
    mocks.api.mockResolvedValueOnce(makeListResponse([makeSession(1)], 1))

    const bookId = ref(10)
    const { loadMore } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    mocks.api.mockClear()
    await loadMore()

    expect(mocks.api).not.toHaveBeenCalled()
  })

  it('addSession posts the payload and refetches from page 1', async () => {
    mocks.api.mockResolvedValueOnce(makeListResponse())

    const bookId = ref(10)
    const { addSession } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    mocks.api.mockClear()
    mocks.api
      .mockResolvedValueOnce(makeResponse({ id: 9, source: 'manual' }, 201))
      .mockResolvedValueOnce(makeListResponse([makeSession(9, { source: 'manual' })], 1))

    await addSession({ startedAt: '2026-04-15T10:00:00.000Z', durationMinutes: 30, endProgress: 50 })

    const [postUrl, postInit] = mocks.api.mock.calls[0] as [string, RequestInit]
    expect(postUrl).toBe('/api/v1/books/10/sessions')
    expect(postInit.method).toBe('POST')
    expect(JSON.parse(postInit.body as string)).toMatchObject({ durationMinutes: 30, endProgress: 50 })
    const refetchUrl = mocks.api.mock.calls[1]?.[0] as string
    expect(refetchUrl).toContain('page=1')
  })

  it('addSession throws with the server message on failure', async () => {
    mocks.api.mockResolvedValueOnce(makeListResponse())

    const bookId = ref(10)
    const { addSession } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    mocks.api.mockClear()
    mocks.api.mockResolvedValueOnce(makeResponse({ message: 'startedAt cannot be in the future' }, 400))

    await expect(addSession({ startedAt: '2099-01-01T00:00:00.000Z', durationMinutes: 30 })).rejects.toThrow('startedAt cannot be in the future')
  })

  it('exportAll pages through the full list at pageSize 100', async () => {
    mocks.api.mockResolvedValueOnce(makeListResponse())

    const bookId = ref(10)
    const { exportAll } = useBookReadingLog(bookId)
    await nextTick()
    await nextTick()

    mocks.api.mockClear()
    const pageOne = Array.from({ length: 100 }, (_, i) => makeSession(i + 1))
    const pageTwo = Array.from({ length: 20 }, (_, i) => makeSession(i + 101))
    mocks.api.mockResolvedValueOnce(makeListResponse(pageOne, 120)).mockResolvedValueOnce(makeListResponse(pageTwo, 120))

    const items = await exportAll()

    expect(items).toHaveLength(120)
    expect(mocks.api).toHaveBeenCalledTimes(2)
    const firstUrl = mocks.api.mock.calls[0]?.[0] as string
    expect(firstUrl).toContain('pageSize=100')
    expect(firstUrl).toContain('page=1')
    const secondUrl = mocks.api.mock.calls[1]?.[0] as string
    expect(secondUrl).toContain('page=2')
  })

  it('loading is true while fetching and false after', async () => {
    let resolve: (v: Response) => void
    const pending = new Promise<Response>((r) => {
      resolve = r
    })
    mocks.api.mockReturnValueOnce(pending)

    const bookId = ref(10)
    const { loading } = useBookReadingLog(bookId)
    await nextTick()

    expect(loading.value).toBe(true)

    resolve!(makeListResponse())
    await nextTick()
    await nextTick()

    expect(loading.value).toBe(false)
  })
})
