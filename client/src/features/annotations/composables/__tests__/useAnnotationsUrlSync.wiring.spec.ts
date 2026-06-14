import { describe, it, expect, vi, beforeEach } from 'vitest'
import { nextTick } from 'vue'

const replaceMock = vi.hoisted(() => vi.fn<(to: unknown) => void>())
const routeStub = vi.hoisted(() => ({ query: {} as Record<string, unknown> }))
const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('vue-router', () => ({
  useRoute: () => routeStub,
  useRouter: () => ({ replace: replaceMock }),
}))
vi.mock('@/lib/api', () => ({ api: apiMock }))

import { useAnnotationsUrlSync } from '../useAnnotationsUrlSync'
import { useAnnotationsHub } from '../useAnnotationsHub'

function hubResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ items: [], total: 0, page: 1, pageSize: 25, stats: { books: 0, withNotes: 0, originBreakdown: [] } }),
  } as Response
}

describe('useAnnotationsUrlSync wiring', () => {
  beforeEach(() => {
    replaceMock.mockReset()
    routeStub.query = {}
    apiMock.mockReset()
    apiMock.mockResolvedValue(hubResponse())
  })

  it('hydrates the hub from the query and does not write while hydrating', async () => {
    routeStub.query = { status: 'trashed', page: '2' }
    const hub = useAnnotationsHub()
    useAnnotationsUrlSync(hub)

    expect(replaceMock).not.toHaveBeenCalled()
    await nextTick()
    expect(hub.status.value).toBe('trashed')
    expect(hub.page.value).toBe(2)
  })

  it('mirrors a later filter change into the URL via router.replace', async () => {
    const hub = useAnnotationsHub()
    useAnnotationsUrlSync(hub)
    await nextTick()

    hub.status.value = 'trashed'
    await nextTick()

    expect(replaceMock.mock.calls.slice(-1)[0]![0]).toEqual({ query: { status: 'trashed' } })
  })

  it('debounces search writes', async () => {
    vi.useFakeTimers()
    try {
      const hub = useAnnotationsHub()
      useAnnotationsUrlSync(hub)
      await nextTick()
      replaceMock.mockClear()

      hub.search.value = 'dune'
      await nextTick()
      expect(replaceMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(300)
      expect(replaceMock).toHaveBeenCalledWith({ query: { search: 'dune' } })
    } finally {
      vi.useRealTimers()
    }
  })
})
