import { describe, expect, it, vi } from 'vitest'
import type { BookRequestItem } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(url: string) => Promise<Response>>() }))

vi.mock('@/lib/api', () => ({ api: apiMock }))

import { useBookRequestDetail } from '../composables/useBookRequestDetail'

function request(title: string): BookRequestItem {
  return { id: 7, title } as BookRequestItem
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function response(body: BookRequestItem, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: vi.fn<() => Promise<BookRequestItem>>().mockResolvedValue(body) } as unknown as Response
}

describe('useBookRequestDetail', () => {
  it('keeps an existing request mounted during a background refresh', async () => {
    const pending = deferredResponse()
    apiMock.mockReturnValueOnce(pending.promise)
    const detail = useBookRequestDetail()
    detail.setRequest(request('Before'))

    const refresh = detail.fetchRequest(7, { background: true })

    expect(detail.loading.value).toBe(false)
    expect(detail.request.value?.title).toBe('Before')

    pending.resolve(response(request('After')))
    await refresh

    expect(detail.request.value?.title).toBe('After')
    expect(detail.error.value).toBeNull()
  })

  it('uses the blocking loading state when navigating to a different request', async () => {
    const pending = deferredResponse()
    apiMock.mockReturnValueOnce(pending.promise)
    const detail = useBookRequestDetail()
    detail.setRequest(request('Request seven'))

    const refresh = detail.fetchRequest(8, { background: true })

    expect(detail.loading.value).toBe(true)

    pending.resolve(response({ ...request('Request eight'), id: 8 }))
    await refresh

    expect(detail.loading.value).toBe(false)
    expect(detail.request.value?.id).toBe(8)
  })

  /**
   * The drawer is a function of the URL, and stepping through the queue asks for the next request
   * before the answer about the previous one has arrived.
   */
  it('does not answer the request now open with the one open a moment ago', async () => {
    const older = deferredResponse()
    apiMock.mockReturnValueOnce(older.promise)
    apiMock.mockResolvedValueOnce(response({ ...request('Request eight'), id: 8 }))
    const detail = useBookRequestDetail()

    const stale = detail.fetchRequest(7)
    await detail.fetchRequest(8)
    older.resolve(response(request('Request seven')))
    await stale

    expect(detail.request.value?.id).toBe(8)
    expect(detail.loading.value).toBe(false)
  })

  /** An action answers with the row it wrote, which is newer than any refresh already in flight. */
  it('does not let a refresh already in flight undo what an action just wrote', async () => {
    const older = deferredResponse()
    apiMock.mockReturnValueOnce(older.promise)
    const detail = useBookRequestDetail()
    detail.setRequest(request('Before'))

    const refresh = detail.fetchRequest(7, { background: true })
    detail.setRequest(request('Approved'))
    older.resolve(response(request('Before')))
    await refresh

    expect(detail.request.value?.title).toBe('Approved')
  })

  it('preserves the displayed request when a background refresh fails transiently', async () => {
    apiMock.mockResolvedValueOnce(response(request('Unused'), false))
    const detail = useBookRequestDetail()
    detail.setRequest(request('Still visible'))

    await detail.fetchRequest(7, { background: true })

    expect(detail.request.value?.title).toBe('Still visible')
    expect(detail.error.value).toBeNull()
  })
})
