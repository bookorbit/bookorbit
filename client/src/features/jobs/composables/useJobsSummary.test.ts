import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobsSummary } from '@bookorbit/types'
import type { JobsListener } from '../lib/jobs-socket'

const mocks = vi.hoisted(() => ({
  api: vi.fn<(path: string) => Promise<unknown>>(),
  listeners: [] as JobsListener[],
  stopped: 0,
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('../lib/jobs-socket', () => ({
  listenToJobs: (listener: JobsListener) => {
    mocks.listeners.push(listener)
    return () => {
      mocks.stopped += 1
    }
  },
}))

const { JOBS_SUMMARY_POLL_MS, JOBS_SUMMARY_REFRESH_MS, followJobsSummary, useJobsNeedsYou, useJobsSummary } = await import('./useJobsSummary')

function answer(summary: Partial<JobsSummary>) {
  const body: JobsSummary = { running: 0, waiting: 0, needsYou: 0, failed: 0, background: [], ...summary }
  mocks.api.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) })
}

async function flush(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms)
}

describe('useJobsSummary', () => {
  let stop: (() => void) | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    mocks.api.mockReset()
    mocks.listeners.length = 0
    mocks.stopped = 0
  })

  afterEach(() => {
    stop?.()
    stop = null
    vi.useRealTimers()
  })

  it('reads the summary once following starts, and shares one reading between followers', async () => {
    answer({ running: 1, needsYou: 2 })
    stop = followJobsSummary()
    const second = followJobsSummary()
    await flush()

    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/jobs/summary')
    expect(mocks.listeners).toHaveLength(1)
    expect(useJobsSummary().summary.value).toMatchObject({ running: 1, needsYou: 2 })
    expect(useJobsNeedsYou().value).toBe(2)

    second()
    expect(mocks.stopped).toBe(0)
  })

  it('reads again once per burst of status changes and never for progress', async () => {
    answer({})
    stop = followJobsSummary()
    await flush()
    const listener = mocks.listeners[0]!

    listener.changed({ type: 'read-along', state: false })
    await flush(JOBS_SUMMARY_REFRESH_MS * 2)
    expect(mocks.api).toHaveBeenCalledTimes(1)

    answer({ waiting: 4 })
    listener.changed({ type: 'read-along', state: true })
    listener.changed({ type: 'bulk-run', state: true })
    listener.changed({ type: 'story-guide', state: true })
    await flush(JOBS_SUMMARY_REFRESH_MS)
    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(useJobsSummary().summary.value?.waiting).toBe(4)
  })

  it('polls while the socket is down and stops once it is live', async () => {
    answer({})
    stop = followJobsSummary()
    await flush()
    const listener = mocks.listeners[0]!

    mocks.api.mockResolvedValue({ ok: true, json: () => Promise.resolve({ running: 0, waiting: 0, needsYou: 0, failed: 0, background: [] }) })
    await flush(JOBS_SUMMARY_POLL_MS + 1)
    expect(mocks.api).toHaveBeenCalledTimes(2)

    listener.live(true)
    await flush(1)
    const afterLive = mocks.api.mock.calls.length
    await flush(JOBS_SUMMARY_POLL_MS * 2)
    expect(mocks.api).toHaveBeenCalledTimes(afterLive)

    listener.live(false)
    await flush(JOBS_SUMMARY_POLL_MS + 1)
    expect(mocks.api.mock.calls.length).toBeGreaterThan(afterLive)
  })

  it('forgets the summary when the last follower stops, even with a read still on the wire', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mocks.api.mockReturnValueOnce(new Promise((done) => (resolve = done)))
    const only = followJobsSummary()
    await flush()

    only()
    resolve({ ok: true, json: () => Promise.resolve({ running: 3, waiting: 0, needsYou: 0, failed: 0, background: [] }) })
    await flush()

    expect(mocks.stopped).toBe(1)
    expect(useJobsSummary().summary.value).toBeNull()
    expect(useJobsNeedsYou().value).toBe(0)
  })

  it('keeps the last summary when a read fails', async () => {
    answer({ failed: 1 })
    stop = followJobsSummary()
    await flush()

    mocks.api.mockRejectedValueOnce(new Error('offline'))
    mocks.listeners[0]!.changed({ type: 'bulk-run', state: true })
    await flush(JOBS_SUMMARY_REFRESH_MS)

    expect(useJobsSummary().summary.value?.failed).toBe(1)
  })
})
