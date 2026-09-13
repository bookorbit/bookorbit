import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRequestSummary } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

const SUMMARY: BookRequestSummary = { pending: 2, active: 5, mine: 3, mineTotal: 1234, allTotal: 12000 }

function response(data?: unknown, ok = true): Response {
  return { ok, json: async () => data } as Response
}

async function loadComposable() {
  return import('../composables/useBookRequestSummary')
}

describe('useBookRequestSummary', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('fetches the shared summary once', async () => {
    apiMock.mockResolvedValue(response(SUMMARY))
    const { useBookRequestSummary } = await loadComposable()
    const { summary, fetchSummary } = useBookRequestSummary()

    await fetchSummary()
    await fetchSummary()

    expect(summary.value).toEqual(SUMMARY)
    expect(apiMock).toHaveBeenCalledExactlyOnceWith('/api/v1/book-requests/summary')
  })

  it('refreshes the summary after a request changes', async () => {
    apiMock.mockResolvedValueOnce(response(SUMMARY)).mockResolvedValueOnce(response({ ...SUMMARY, active: 4 }))
    const { useBookRequestSummary } = await loadComposable()
    const { summary, fetchSummary, refreshSummary } = useBookRequestSummary()

    await fetchSummary()
    await refreshSummary()

    expect(summary.value?.active).toBe(4)
    expect(apiMock).toHaveBeenCalledTimes(2)
  })

  it('drops a response that lands after the session resets', async () => {
    const { resetBookRequestSummary, useBookRequestSummary } = await loadComposable()
    const { summary, fetchSummary } = useBookRequestSummary()
    let resolveResponse: ((res: Response) => void) | undefined
    apiMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const pending = fetchSummary()
    resetBookRequestSummary()
    resolveResponse?.(response(SUMMARY))
    await pending

    expect(summary.value).toBeNull()
  })
})
