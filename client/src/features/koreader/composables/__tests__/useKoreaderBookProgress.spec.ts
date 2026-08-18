import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { KoreaderBookSyncInfo } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeBookProgress(overrides: Partial<KoreaderBookSyncInfo> = {}): KoreaderBookSyncInfo {
  return {
    bookId: 42,
    bookFileId: 84,
    canonicalPercentage: 0.73,
    canonicalChapterIndex: 11,
    canonicalChapterTitle: 'The Turn',
    canonicalSource: 'koreader',
    canonicalUpdatedAt: '2026-01-02T00:00:00.000Z',
    devices: [
      {
        device: 'Kobo Clara BW',
        deviceId: 'device-1',
        percentage: 0.73,
        chapterIndex: 11,
        chapterTitle: 'The Turn',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    fileModifiedSinceLastSync: false,
    heldByReset: [],
    ...overrides,
  }
}

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

describe('useKoreaderBookProgress', () => {
  beforeEach(() => {
    vi.resetModules()
    apiMock.mockReset()
  })

  it('fetchBookProgress makes GET request and updates bookProgress ref', async () => {
    const progress = makeBookProgress()
    apiMock.mockResolvedValueOnce(makeResponse(progress))

    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress } = useKoreaderBookProgress()

    await fetchBookProgress(42)

    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/books/42/progress')
    expect(bookProgress.value).toEqual(progress)
  })

  it('fetchBookProgress sets loading to true during fetch and false after', async () => {
    const progress = makeBookProgress()
    let resolveResponse: ((value: Response) => void) | undefined
    apiMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveResponse = resolve
      }),
    )

    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { loading, fetchBookProgress } = useKoreaderBookProgress()

    const fetchPromise = fetchBookProgress(42)
    expect(loading.value).toBe(true)

    resolveResponse?.(makeResponse(progress))
    await fetchPromise

    expect(loading.value).toBe(false)
  })

  it('fetchBookProgress sets bookProgress to null when server returns null (no koreader data)', async () => {
    apiMock.mockResolvedValueOnce(makeResponse(null))

    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress } = useKoreaderBookProgress()
    bookProgress.value = makeBookProgress()

    await fetchBookProgress(42)

    expect(bookProgress.value).toBeNull()
  })

  it('fetchBookProgress sets bookProgress to null on error response', async () => {
    apiMock.mockResolvedValueOnce(makeResponse({}, { ok: false, status: 500 }))

    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress } = useKoreaderBookProgress()
    bookProgress.value = makeBookProgress()

    await fetchBookProgress(42)

    expect(bookProgress.value).toBeNull()
  })

  it('fetchBookProgress sets bookProgress to null on network error', async () => {
    apiMock.mockRejectedValueOnce(new Error('Network error'))

    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, loading, fetchBookProgress } = useKoreaderBookProgress()
    bookProgress.value = makeBookProgress()

    await fetchBookProgress(42)

    expect(bookProgress.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('posts the device id when releasing a reset hold and refreshes the book', async () => {
    apiMock.mockResolvedValue(makeResponse(makeBookProgress()))
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { releaseResetHold } = useKoreaderBookProgress()

    await expect(releaseResetHold(42, 'device-1')).resolves.toBe(true)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/koreader/books/42/reset-hold/release',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ deviceId: 'device-1' }) }),
    )
    // The hold disappears from the book page only if the refreshed state is pulled back in.
    expect(apiMock).toHaveBeenCalledWith('/api/v1/koreader/books/42/progress')
  })

  it('reports a failed release rather than pretending the hold is gone', async () => {
    apiMock.mockResolvedValue(makeResponse(null, { ok: false, status: 404 }))
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { releaseResetHold } = useKoreaderBookProgress()

    await expect(releaseResetHold(42, 'device-1')).resolves.toBe(false)
  })
})
