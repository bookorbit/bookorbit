import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type { JobActionRequest, JobActionResponse } from '@bookorbit/types'

import { i18n } from '@/i18n'

const mocks = vi.hoisted(() => ({
  actOnJobs: vi.fn<(request: JobActionRequest) => Promise<JobActionResponse>>(),
  toastInfo: vi.fn<(message: string, options?: unknown) => void>(),
  toastError: vi.fn<(message: string, options?: unknown) => void>(),
}))

vi.mock('../api/jobs.api', () => ({ actOnJobs: mocks.actOnJobs }))
vi.mock('vue-sonner', () => ({ toast: { info: mocks.toastInfo, error: mocks.toastError } }))

const { useBulkRunTracker } = await import('./useBulkRunTracker')

/** A bulk route's answer whose stream the test feeds by hand. */
function liveResponse(runId: string | null = 'run-1') {
  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
  })
  const headers = new Headers(runId ? { 'X-Bulk-Run-Id': runId } : {})
  return {
    response: { ok: true, status: 200, body, headers } as unknown as Response,
    send: (event: object) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    close: () => controller.close(),
    fail: () => controller.error(new TypeError('network error')),
  }
}

type Event = { bookId?: number; failed?: boolean; done?: boolean }

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useBulkRunTracker', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
    mocks.actOnJobs.mockReset()
    mocks.toastInfo.mockReset()
    mocks.toastError.mockReset()
  })

  function followWith(tracker: ReturnType<typeof useBulkRunTracker>, total = 3) {
    const run = tracker.begin('book-refresh-metadata', total)
    const live = liveResponse()
    const result = run.follow<Event>(live.response, (event) => {
      if (event.bookId !== undefined) run.advance(event.failed === true)
      return event.done === true
    })
    return { run, live, result }
  }

  it('waits until the first item lands, then counts items and failures', async () => {
    const tracker = useBulkRunTracker()
    const { live, result } = followWith(tracker)
    await flush()

    expect(tracker.inFlight.value).toMatchObject({ kind: 'book-refresh-metadata', runId: 'run-1', waiting: true, processed: 0, total: 3 })

    live.send({ bookId: 1 })
    live.send({ bookId: 2, failed: true })
    await flush()
    expect(tracker.inFlight.value).toMatchObject({ waiting: false, processed: 2, failed: 1 })

    live.send({ done: true })
    live.close()
    await expect(result).resolves.toEqual({ end: 'done', cancelled: false, processed: 2, total: 3 })
    expect(tracker.inFlight.value).toBeNull()
    expect(mocks.toastInfo).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('cancels through the Jobs action and reports the run as cancelled when it stops early', async () => {
    mocks.actOnJobs.mockResolvedValue({ results: [{ id: 'bulk-run:run-1', outcome: 'done', status: 'running' }] })
    const tracker = useBulkRunTracker()
    const { live, result } = followWith(tracker)
    live.send({ bookId: 1 })
    await flush()

    const cancelling = tracker.cancel()
    expect(tracker.inFlight.value?.cancelling).toBe(true)
    await cancelling
    expect(mocks.actOnJobs).toHaveBeenCalledWith({ action: 'cancel', ids: ['bulk-run:run-1'] })

    live.send({ done: true })
    live.close()
    await expect(result).resolves.toMatchObject({ end: 'done', cancelled: true, processed: 1, total: 3 })
  })

  it('treats a run that already ended as stopped when asked to cancel', async () => {
    mocks.actOnJobs.mockResolvedValue({ results: [{ id: 'bulk-run:run-1', outcome: 'skipped', status: 'completed' }] })
    const tracker = useBulkRunTracker()
    followWith(tracker)
    await flush()

    await tracker.cancel()

    expect(tracker.inFlight.value?.cancelling).toBe(true)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('says so when the cancel is refused, and offers Cancel again', async () => {
    mocks.actOnJobs.mockResolvedValue({ results: [{ id: 'bulk-run:run-1', outcome: 'refused', status: 'running' }] })
    const tracker = useBulkRunTracker()
    followWith(tracker)
    await flush()

    await tracker.cancel()

    expect(tracker.inFlight.value?.cancelling).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledWith('Could not cancel the bulk action.')
  })

  it('offers no cancel before the server names the run', async () => {
    const tracker = useBulkRunTracker()
    tracker.begin('book-move', 4)

    await tracker.cancel()

    expect(mocks.actOnJobs).not.toHaveBeenCalled()
  })

  it('lets the run go on in the background when the page stops following it', async () => {
    const tracker = useBulkRunTracker()
    const { live, result } = followWith(tracker)
    live.send({ bookId: 1 })
    await flush()

    tracker.detach()

    expect(tracker.inFlight.value).toBeNull()
    await expect(result).resolves.toMatchObject({ end: 'detached', cancelled: false })
    expect(mocks.toastInfo).toHaveBeenCalledWith(
      'The bulk action keeps running in the background.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open Jobs', onClick: expect.any(Function) }) }),
    )
  })

  it('detaches when the page that follows it goes away', async () => {
    const scope = effectScope()
    const tracker = scope.run(() => useBulkRunTracker())!
    const { result } = followWith(tracker)
    await flush()

    scope.stop()

    await expect(result).resolves.toMatchObject({ end: 'detached' })
    expect(mocks.toastInfo).toHaveBeenCalledWith('The bulk action keeps running in the background.', expect.anything())
  })

  it('says a stream that ends without its final event stopped, with a way to Jobs', async () => {
    const tracker = useBulkRunTracker()
    const { live, result } = followWith(tracker)
    live.send({ bookId: 1 })
    live.close()

    await expect(result).resolves.toMatchObject({ end: 'stopped' })
    expect(tracker.inFlight.value).toBeNull()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'The bulk action stopped before it finished.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Open Jobs' }) }),
    )
  })

  it('says the connection was lost when the stream breaks, since the run may still be going', async () => {
    const tracker = useBulkRunTracker()
    const { live, result } = followWith(tracker)
    await flush()
    live.fail()

    await expect(result).resolves.toMatchObject({ end: 'lost' })
    expect(mocks.toastInfo).toHaveBeenCalledWith('Lost the connection to the bulk action. It may still be running.', expect.anything())
  })

  it('keeps a newer run on screen when an older detached one ends', async () => {
    const tracker = useBulkRunTracker()
    const first = followWith(tracker)
    await flush()
    tracker.detach()
    const second = tracker.begin('book-re-extract-cover', 2)

    await first.result
    second.advance()

    expect(tracker.inFlight.value).toMatchObject({ kind: 'book-re-extract-cover', processed: 1 })
  })
})
