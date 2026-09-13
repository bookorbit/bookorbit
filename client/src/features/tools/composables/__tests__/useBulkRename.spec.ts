import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBulkRename } from '../useBulkRename'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>())

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

/** Builds a response whose body streams the given SSE frames and then closes. */
function sseResponse(frames: string[], options: { ok?: boolean; status?: number } = {}) {
  const encoder = new TextEncoder()
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame))
        controller.close()
      },
    }),
  }
}

function frame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

describe('useBulkRename execute stream', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  function armed() {
    const bulk = useBulkRename()
    bulk.selectLibrary(1)
    return bulk
  }

  it('takes the run total from the started event', async () => {
    apiMock.mockResolvedValue(
      sseResponse([frame({ started: true, total: 7 }), frame({ done: true, processed: 7, succeeded: 7, failed: 0, skipped: 0 })]),
    )

    const bulk = armed()
    await bulk.execute({ excludeBookIds: [] })

    expect(bulk.runTotal.value).toBe(7)
  })

  it('counts only per-book events as renamed, never the lifecycle events', async () => {
    apiMock.mockResolvedValue(
      sseResponse([
        frame({ started: true, total: 2 }),
        frame({ bookId: 1, status: 'success' }),
        frame({ bookId: 2, status: 'success' }),
        frame({ done: true, processed: 2, succeeded: 2, failed: 0, skipped: 0 }),
      ]),
    )

    const bulk = armed()
    await bulk.execute({ excludeBookIds: [] })

    expect(bulk.renamedCount.value).toBe(2)
    expect(bulk.runTotal.value).toBe(2)
    expect(bulk.executionStats.value).toEqual({ processed: 2, succeeded: 2, failed: 0, skipped: 0 })
    expect(bulk.executionError.value).toBeNull()
  })

  it('handles frames split across chunk boundaries', async () => {
    const full =
      frame({ started: true, total: 1 }) +
      frame({ bookId: 1, status: 'success' }) +
      frame({ done: true, processed: 1, succeeded: 1, failed: 0, skipped: 0 })
    const cut = Math.floor(full.length / 3)

    apiMock.mockResolvedValue(sseResponse([full.slice(0, cut), full.slice(cut, cut * 2), full.slice(cut * 2)]))

    const bulk = armed()
    await bulk.execute({ excludeBookIds: [] })

    expect(bulk.runTotal.value).toBe(1)
    expect(bulk.renamedCount.value).toBe(1)
    expect(bulk.executionStats.value?.succeeded).toBe(1)
  })

  it('reports an error when the stream ends without a completion event', async () => {
    // Headers now flush before the run, so a mid-run server failure arrives as a stream that just
    // stops. Reporting success here would tell the user files moved when they may not have.
    apiMock.mockResolvedValue(sseResponse([frame({ started: true, total: 3 }), frame({ bookId: 1, status: 'success' })]))

    const bulk = armed()
    await bulk.execute({ excludeBookIds: [] })

    expect(bulk.executionStats.value).toBeNull()
    // A stable code, never a user-facing string: the view owns the wording so it can be translated.
    expect(bulk.executionError.value).toEqual({ code: 'incomplete' })
  })

  it('reports an error when the stream carries nothing at all', async () => {
    apiMock.mockResolvedValue(sseResponse([]))

    const bulk = armed()
    await bulk.execute({ excludeBookIds: [] })

    expect(bulk.executionError.value).toEqual({ code: 'incomplete' })
  })

  it('surfaces a non-ok response instead of reading the body', async () => {
    apiMock.mockResolvedValue(sseResponse([], { ok: false, status: 500 }))

    const bulk = armed()
    await bulk.execute({ excludeBookIds: [] })

    expect(bulk.executionError.value).toEqual({ code: 'http', status: 500 })
  })

  it('stays silent when the user cancels the run', async () => {
    apiMock.mockImplementation((_url, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError', signal }))
    })

    const bulk = armed()
    const promise = bulk.execute({ excludeBookIds: [] })
    bulk.cancelExecution()
    await promise

    expect(bulk.executionError.value).toBeNull()
  })

  it('resets the run total between runs so a stale total cannot linger', async () => {
    apiMock.mockResolvedValue(
      sseResponse([frame({ started: true, total: 9 }), frame({ done: true, processed: 9, succeeded: 9, failed: 0, skipped: 0 })]),
    )

    const bulk = armed()
    await bulk.execute({ excludeBookIds: [] })
    expect(bulk.runTotal.value).toBe(9)

    apiMock.mockResolvedValue(
      sseResponse([frame({ started: true, total: 2 }), frame({ done: true, processed: 2, succeeded: 2, failed: 0, skipped: 0 })]),
    )
    await bulk.execute({ excludeBookIds: [] })

    expect(bulk.runTotal.value).toBe(2)
  })

  it('sends the selection through to the execute endpoint', async () => {
    apiMock.mockResolvedValue(
      sseResponse([frame({ started: true, total: 1 }), frame({ done: true, processed: 1, succeeded: 1, failed: 0, skipped: 0 })]),
    )

    const bulk = armed()
    await bulk.execute({ includeBookIds: [42] })

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/libraries/1/bulk-rename/execute',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ includeBookIds: [42] }) }),
    )
  })

  it('does nothing when no library is selected', async () => {
    const bulk = useBulkRename()
    await bulk.execute({ excludeBookIds: [] })

    expect(apiMock).not.toHaveBeenCalled()
    expect(bulk.executing.value).toBe(false)
  })
})
