import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

import { ReadStatusUpdateError, useBookStatus } from '../useBookStatus'

describe('useBookStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('setStatus sends a status patch and returns the server payload', async () => {
    ;(mocks.api as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'reading',
        source: 'manual',
        startedAt: '2026-04-01',
        finishedAt: null,
        updatedAt: '2026-04-02T00:00:00.000Z',
      }),
    } as Response)

    const { setStatus } = useBookStatus()
    const payload = await setStatus(5, 'reading')

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/5/status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'reading' }),
      }),
    )
    expect(payload).toEqual({
      status: 'reading',
      source: 'manual',
      startedAt: '2026-04-01',
      finishedAt: null,
      updatedAt: '2026-04-02T00:00:00.000Z',
    })
  })

  it('updateStatus supports partial date updates and explicit null clears', async () => {
    ;(mocks.api as Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'reading',
        source: 'manual',
        startedAt: null,
        finishedAt: '2026-04-04',
        updatedAt: '2026-04-05T00:00:00.000Z',
      }),
    } as Response)

    const { updateStatus } = useBookStatus()
    await updateStatus(7, { startedAt: null, finishedAt: '2026-04-04' })

    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/7/status',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ startedAt: null, finishedAt: '2026-04-04' }),
      }),
    )
  })

  it('throws on non-ok responses', async () => {
    ;(mocks.api as Mock).mockResolvedValue({ ok: false, status: 400 } as Response)
    const { setStatus } = useBookStatus()
    await expect(setStatus(2, 'read')).rejects.toThrow('HTTP 400')
  })

  it('preserves stable server error codes on failed updates', async () => {
    ;(mocks.api as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ errorCode: 'READING_DATES_INVALID_ORDER' }),
    } as Response)
    const { updateStatus } = useBookStatus()

    const error = await updateStatus(2, { startedAt: '2026-02-02' }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(ReadStatusUpdateError)
    expect(error).toMatchObject({ message: 'HTTP 400', errorCode: 'READING_DATES_INVALID_ORDER' })
  })
})
