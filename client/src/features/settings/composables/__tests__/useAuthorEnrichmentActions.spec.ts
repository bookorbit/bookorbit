import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthorEnrichmentActions } from '../useAuthorEnrichmentActions'

const apiMock = vi.hoisted(() =>
  vi.fn<(input: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>(),
)

vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('useAuthorEnrichmentActions backfill', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ queued: 4 }) })
  })

  it('queues eligible authors with no body unless cached results are ignored', async () => {
    const { backfill } = useAuthorEnrichmentActions()

    await expect(backfill()).resolves.toEqual({ queued: 4 })
    await backfill({ ignoreCache: true })

    expect(apiMock.mock.calls[0]).toEqual(['/api/v1/authors/enrichment/backfill', { method: 'POST' }])
    expect(apiMock.mock.calls[1]![0]).toBe('/api/v1/authors/enrichment/backfill')
    expect(JSON.parse(String(apiMock.mock.calls[1]![1]?.body))).toEqual({ ignoreCache: true })
  })

  it('queues every author with ignoreCache only when asked', async () => {
    const { backfillAll } = useAuthorEnrichmentActions()

    await backfillAll({ ignoreCache: false })
    await backfillAll({ ignoreCache: true })

    expect(apiMock.mock.calls[0]).toEqual(['/api/v1/authors/enrichment/backfill-all', { method: 'POST' }])
    expect(JSON.parse(String(apiMock.mock.calls[1]![1]?.body))).toEqual({ ignoreCache: true })
  })

  it('throws when the server refuses the run', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) })
    const { backfill } = useAuthorEnrichmentActions()

    await expect(backfill()).rejects.toThrow('HTTP 403')
  })
})
