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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
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

  it('reports a network failure without refreshing or discarding the held device', async () => {
    const progress = makeBookProgress({
      heldByReset: [{ device: 'Kindle', deviceId: 'device-1', percentage: 42, updatedAt: '2026-01-02T00:00:00.000Z' }],
    })
    apiMock.mockResolvedValueOnce(makeResponse(progress)).mockRejectedValueOnce(new Error('Offline'))
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress, releaseResetHold } = useKoreaderBookProgress()
    await fetchBookProgress(42)
    await expect(releaseResetHold(42, 'device-1')).resolves.toBe(false)
    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(bookProgress.value).toEqual(progress)
  })

  it('preserves the notice when the release succeeds but its refresh fails', async () => {
    const progress = makeBookProgress({
      heldByReset: [{ device: 'Kindle', deviceId: 'device-1', percentage: 42, updatedAt: '2026-01-02T00:00:00.000Z' }],
    })
    apiMock
      .mockResolvedValueOnce(makeResponse(progress))
      .mockResolvedValueOnce(makeResponse(null))
      .mockResolvedValueOnce(makeResponse(null, { ok: false }))
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress, releaseResetHold } = useKoreaderBookProgress()
    await fetchBookProgress(42)
    await expect(releaseResetHold(42, 'device-1')).resolves.toBe(false)
    expect(bookProgress.value).toEqual(progress)
  })

  it('does not report success while the refreshed response still holds the device', async () => {
    const progress = makeBookProgress({
      heldByReset: [{ device: 'Kindle', deviceId: 'device-1', percentage: 42, updatedAt: '2026-01-02T00:00:00.000Z' }],
    })
    apiMock.mockResolvedValue(makeResponse(progress))
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { releaseResetHold } = useKoreaderBookProgress()
    await expect(releaseResetHold(42, 'device-1')).resolves.toBe(false)
  })

  it('keeps the latest fetch and its loading state when an older request finishes first', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    apiMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, loading, fetchBookProgress } = useKoreaderBookProgress()
    const olderFetch = fetchBookProgress(42)
    const newerFetch = fetchBookProgress(43)
    first.resolve(makeResponse(makeBookProgress()))
    await olderFetch
    expect(bookProgress.value).toBeNull()
    expect(loading.value).toBe(true)
    second.resolve(makeResponse(makeBookProgress({ bookId: 43 })))
    await newerFetch
    expect(bookProgress.value?.bookId).toBe(43)
    expect(loading.value).toBe(false)
  })

  it.each(['success', 'failure'] as const)('ignores an older %s after a newer fetch completes', async (result) => {
    const older = deferred<Response>()
    apiMock.mockReturnValueOnce(older.promise).mockResolvedValueOnce(makeResponse(makeBookProgress({ bookId: 43 })))
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, loading, fetchBookProgress } = useKoreaderBookProgress()
    const olderFetch = fetchBookProgress(42)
    await fetchBookProgress(43)
    older.resolve(result === 'success' ? makeResponse(makeBookProgress()) : makeResponse(null, { ok: false }))
    await olderFetch
    expect(bookProgress.value?.bookId).toBe(43)
    expect(loading.value).toBe(false)
  })

  it('clears the previous book immediately when fetching another book', async () => {
    const next = deferred<Response>()
    apiMock.mockResolvedValueOnce(makeResponse(makeBookProgress())).mockReturnValueOnce(next.promise)
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress } = useKoreaderBookProgress()
    await fetchBookProgress(42)
    const nextFetch = fetchBookProgress(43)
    expect(bookProgress.value).toBeNull()
    next.resolve(makeResponse(null))
    await nextFetch
  })

  it('does not refetch the old book when its release finishes after navigation', async () => {
    const release = deferred<Response>()
    apiMock
      .mockResolvedValueOnce(makeResponse(makeBookProgress()))
      .mockReturnValueOnce(release.promise)
      .mockResolvedValueOnce(makeResponse(makeBookProgress({ bookId: 43 })))
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress, releaseResetHold } = useKoreaderBookProgress()
    await fetchBookProgress(42)
    const pendingRelease = releaseResetHold(42, 'device-1')
    await fetchBookProgress(43)
    release.resolve(makeResponse(null))
    await expect(pendingRelease).resolves.toBe(true)
    expect(bookProgress.value?.bookId).toBe(43)
    expect(apiMock).toHaveBeenCalledTimes(3)
  })

  it('invalidates a pending fetch when progress is cleared', async () => {
    const pending = deferred<Response>()
    apiMock.mockReturnValueOnce(pending.promise)
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, loading, fetchBookProgress, clearBookProgress } = useKoreaderBookProgress()
    const fetch = fetchBookProgress(42)
    clearBookProgress()
    pending.resolve(makeResponse(makeBookProgress()))
    await fetch
    expect(bookProgress.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('does not refresh after permission revocation clears a pending release', async () => {
    const pending = deferred<Response>()
    apiMock.mockResolvedValueOnce(makeResponse(makeBookProgress())).mockReturnValueOnce(pending.promise)
    const { useKoreaderBookProgress } = await import('../useKoreaderBookProgress')
    const { bookProgress, fetchBookProgress, clearBookProgress, releaseResetHold } = useKoreaderBookProgress()
    await fetchBookProgress(42)
    const release = releaseResetHold(42, 'device-1')
    clearBookProgress()
    pending.resolve(makeResponse(null))
    await expect(release).resolves.toBe(true)
    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(bookProgress.value).toBeNull()
  })
})
