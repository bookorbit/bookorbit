import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

import { useResetReadingState } from '../useResetReadingState'

function response(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

const resetResult = {
  readStatus: {
    status: 'unread' as const,
    source: 'manual' as const,
    startedAt: null,
    finishedAt: null,
    updatedAt: '2026-07-09T12:00:00.000Z',
  },
}

describe('useResetReadingState', () => {
  beforeEach(() => {
    mocks.api.mockReset()
  })

  it('posts the book reset endpoint, returns the server status, and closes the dialog', async () => {
    mocks.api.mockResolvedValueOnce(response(resetResult))
    const { open, resetting, error, openDialog, resetReadingState } = useResetReadingState(ref(42))

    openDialog()
    const result = await resetReadingState()

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/42/reset-reading-state', { method: 'POST' })
    expect(result).toEqual(resetResult)
    expect(open.value).toBe(false)
    expect(resetting.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('keeps the dialog open and exposes API validation errors', async () => {
    mocks.api.mockResolvedValueOnce(response({ message: ['Book is locked', 'Try again later'] }, { ok: false, status: 409 }))
    const { open, error, openDialog, resetReadingState } = useResetReadingState(ref(42))

    openDialog()
    await expect(resetReadingState()).resolves.toBeNull()

    expect(open.value).toBe(true)
    expect(error.value).toBe('Book is locked, Try again later')
  })

  it('prevents duplicate requests while resetting and recovers from network errors', async () => {
    let resolveRequest: ((value: Response) => void) | undefined
    mocks.api.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve
      }),
    )
    const { open, resetting, error, openDialog, resetReadingState } = useResetReadingState(ref(42))

    openDialog()
    const pending = resetReadingState()
    expect(resetting.value).toBe(true)
    await expect(resetReadingState()).resolves.toBeNull()
    expect(mocks.api).toHaveBeenCalledOnce()

    resolveRequest?.(response(resetResult))
    await expect(pending).resolves.toEqual(resetResult)

    mocks.api.mockRejectedValueOnce(new Error('Network unavailable'))
    openDialog()
    await expect(resetReadingState()).resolves.toBeNull()
    expect(open.value).toBe(true)
    expect(resetting.value).toBe(false)
    expect(error.value).toBe('Network unavailable')
  })
})
