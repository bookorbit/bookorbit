import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowseCounts } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

const COUNTS: BrowseCounts = { authors: 1234, series: 312, annotations: 18000 }

function makeResponse(data?: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response
}

async function loadComposable() {
  const module = await import('../useBrowseCounts')
  return module
}

describe('useBrowseCounts', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('fetches the counts once and serves later callers from memory', async () => {
    apiMock.mockResolvedValue(makeResponse(COUNTS))
    const { useBrowseCounts } = await loadComposable()
    const { counts, fetchCounts } = useBrowseCounts()

    await fetchCounts()
    await fetchCounts()

    expect(counts.value).toEqual(COUNTS)
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/api/v1/browse-counts')
  })

  it('shares one in-flight request between concurrent callers', async () => {
    apiMock.mockResolvedValue(makeResponse(COUNTS))
    const { useBrowseCounts } = await loadComposable()
    const { fetchCounts } = useBrowseCounts()

    await Promise.all([fetchCounts(), fetchCounts(), fetchCounts()])

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('refetches on demand after a scan or upload changed the library', async () => {
    apiMock.mockResolvedValueOnce(makeResponse(COUNTS)).mockResolvedValueOnce(makeResponse({ ...COUNTS, authors: 1300 }))
    const { useBrowseCounts } = await loadComposable()
    const { counts, fetchCounts, refreshCounts } = useBrowseCounts()

    await fetchCounts()
    await refreshCounts()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(counts.value?.authors).toBe(1300)
  })

  it('leaves the counts unset when the request fails', async () => {
    apiMock.mockRejectedValueOnce(new Error('offline'))
    const { useBrowseCounts } = await loadComposable()
    const { counts, fetchCounts } = useBrowseCounts()

    await fetchCounts()

    expect(counts.value).toBeNull()
  })

  it('drops a response that lands after a sign-out reset', async () => {
    const { resetBrowseCounts, useBrowseCounts } = await loadComposable()
    const { counts, fetchCounts } = useBrowseCounts()
    let resolveResponse: ((res: Response) => void) | undefined
    apiMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const pending = fetchCounts()
    resetBrowseCounts()
    resolveResponse?.(makeResponse(COUNTS))
    await pending

    expect(counts.value).toBeNull()
  })
})
