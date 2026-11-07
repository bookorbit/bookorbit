import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/lib/api', () => ({
  api: mocks.api,
}))

import { useBookDetail } from '../useBookDetail'

function makeResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  } as Response
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<Response>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('useBookDetail', () => {
  beforeEach(() => {
    mocks.api.mockReset()
  })

  it('loads a book detail successfully', async () => {
    mocks.api.mockResolvedValue(makeResponse({ id: 20, title: 'Dune', readStatus: { status: 'reading' } }))
    const detailState = useBookDetail()

    await detailState.fetch(20)

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/20')
    expect(detailState.detail.value).toEqual({ id: 20, title: 'Dune', readStatus: { status: 'reading' } })
    expect(detailState.loading.value).toBe(false)
    expect(detailState.error.value).toBeNull()
    expect(detailState.notFound.value).toBe(false)
  })

  it('clears stale detail immediately while a new request is loading', async () => {
    const pending = deferredResponse()
    mocks.api.mockReturnValue(pending.promise)
    const detailState = useBookDetail()
    detailState.detail.value = { id: 19 } as never

    const fetchPromise = detailState.fetch(20)

    expect(detailState.detail.value).toBeNull()
    expect(detailState.loading.value).toBe(true)
    expect(detailState.notFound.value).toBe(false)
    expect(detailState.error.value).toBeNull()

    pending.resolve(makeResponse({ id: 20, title: 'Hyperion', readStatus: null }))
    await fetchPromise

    expect(detailState.detail.value).toEqual({ id: 20, title: 'Hyperion', readStatus: null })
    expect(detailState.loading.value).toBe(false)
  })

  it('keeps the current detail visible while reloading the same book', async () => {
    const pending = deferredResponse()
    mocks.api.mockReturnValue(pending.promise)
    const detailState = useBookDetail()
    detailState.detail.value = { id: 20, title: 'Current Book', readStatus: { status: 'reading' } } as never

    const fetchPromise = detailState.fetch(20)

    expect(detailState.detail.value).toEqual({ id: 20, title: 'Current Book', readStatus: { status: 'reading' } })
    expect(detailState.loading.value).toBe(true)

    pending.resolve(makeResponse({ id: 20, title: 'Current Book', readStatus: { status: 'finished' } }))
    await fetchPromise

    expect(detailState.detail.value).toEqual({ id: 20, title: 'Current Book', readStatus: { status: 'finished' } })
    expect(detailState.loading.value).toBe(false)
  })

  it('marks notFound for a 404 response', async () => {
    mocks.api.mockResolvedValue(makeResponse({ message: 'missing' }, 404))
    const detailState = useBookDetail()
    detailState.detail.value = { id: 19 } as never

    await detailState.fetch(999)

    expect(detailState.detail.value).toBeNull()
    expect(detailState.notFound.value).toBe(true)
    expect(detailState.error.value).toBeNull()
    expect(detailState.loading.value).toBe(false)
  })

  it('surfaces HTTP failures', async () => {
    mocks.api.mockResolvedValue(makeResponse({ message: 'boom' }, 500))
    const detailState = useBookDetail()

    await detailState.fetch(20)

    expect(detailState.detail.value).toBeNull()
    expect(detailState.notFound.value).toBe(false)
    expect(detailState.error.value).toBe('HTTP 500')
    expect(detailState.loading.value).toBe(false)
  })

  it('surfaces thrown network errors', async () => {
    mocks.api.mockRejectedValue(new Error('network down'))
    const detailState = useBookDetail()

    await detailState.fetch(20)

    expect(detailState.detail.value).toBeNull()
    expect(detailState.error.value).toBe('network down')
    expect(detailState.notFound.value).toBe(false)
    expect(detailState.loading.value).toBe(false)
  })

  it('ignores stale earlier responses after a newer fetch starts', async () => {
    const first = deferredResponse()
    const second = deferredResponse()
    mocks.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const detailState = useBookDetail()

    const firstFetch = detailState.fetch(20)
    const secondFetch = detailState.fetch(21)

    second.resolve(makeResponse({ id: 21, title: 'New Book', readStatus: null }))
    await secondFetch

    first.resolve(makeResponse({ id: 20, title: 'Old Book', readStatus: { status: 'reading' } }))
    await firstFetch

    expect(detailState.detail.value).toEqual({ id: 21, title: 'New Book', readStatus: null })
    expect(detailState.error.value).toBeNull()
    expect(detailState.notFound.value).toBe(false)
    expect(detailState.loading.value).toBe(false)
  })

  it('ignores stale earlier failures after a newer fetch succeeds', async () => {
    const first = deferredResponse()
    const second = deferredResponse()
    mocks.api.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const detailState = useBookDetail()

    const firstFetch = detailState.fetch(20)
    const secondFetch = detailState.fetch(21)

    second.resolve(makeResponse({ id: 21, title: 'New Book', readStatus: null }))
    await secondFetch

    first.reject(new Error('stale failure'))
    await firstFetch

    expect(detailState.detail.value).toEqual({ id: 21, title: 'New Book', readStatus: null })
    expect(detailState.error.value).toBeNull()
    expect(detailState.loading.value).toBe(false)
  })
  it('reports the kept book when a 404 says the id was merged away', async () => {
    mocks.api.mockResolvedValue(makeResponse({ errorCode: 'BOOK_MERGED', errorMeta: { targetBookId: 88 } }, 404))
    const detailState = useBookDetail()

    await detailState.fetch(20)

    expect(detailState.mergedInto.value).toBe(88)
    expect(detailState.notFound.value).toBe(false)
    expect(detailState.detail.value).toBeNull()
    expect(detailState.loading.value).toBe(false)
  })

  it('treats a 404 without a usable merge target as not found', async () => {
    mocks.api.mockResolvedValueOnce(makeResponse({ errorCode: 'BOOK_MERGED', errorMeta: { targetBookId: 'x' } }, 404))
    const detailState = useBookDetail()

    await detailState.fetch(20)
    expect(detailState.mergedInto.value).toBeNull()
    expect(detailState.notFound.value).toBe(true)

    mocks.api.mockResolvedValueOnce({ ok: false, status: 404, json: async () => Promise.reject(new Error('not json')) } as unknown as Response)
    await detailState.fetch(21)
    expect(detailState.mergedInto.value).toBeNull()
    expect(detailState.notFound.value).toBe(true)
  })
})
