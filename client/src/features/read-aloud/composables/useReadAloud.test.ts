import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref, type EffectScope, type Ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { READ_ALOUD_JOB_UPDATED_EVENT, READ_ALOUD_SOCKET_NAMESPACE, type ReadAloudJob } from '@bookorbit/types'
import { BOOK_ID, JOB_ID, errorResponse, jsonResponse, makeCapability, makeJob } from '../__tests__/fixtures'

const mocks = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void
  const handlers = new Map<string, Set<Handler>>()
  const socket = {
    on: (event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
      return socket
    },
    off: (event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler)
      return socket
    },
    disconnect: () => {
      handlers.clear()
      return socket
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args)
    },
    reset() {
      handlers.clear()
    },
  }
  return {
    api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
    createAuthenticatedSocket: vi.fn<(namespace: string, options?: object) => typeof socket>(() => socket),
    socket,
  }
})

vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('@/lib/socket', () => ({ createAuthenticatedSocket: mocks.createAuthenticatedSocket }))

import { READ_ALOUD_POLL_INTERVAL_MS, useReadAloud } from './useReadAloud'

const CAPABILITY_URL = `/api/v1/books/${BOOK_ID}/read-aloud`
const JOB_URL = `/api/v1/read-aloud-jobs/${JOB_ID}`

let scope: EffectScope | null = null
let visibility: DocumentVisibilityState = 'visible'

type Route = (init?: RequestInit) => Response | Promise<Response>

/** Answers by method and path; an unexpected request fails the test instead of hanging it. */
function routeApi(routes: Record<string, Route>): void {
  mocks.api.mockImplementation(async (input, init) => {
    const method = init?.method ?? 'GET'
    const key = `${method} ${String(input)}`
    const route = routes[key]
    if (!route) throw new Error(`Unexpected request: ${key}`)
    return route(init)
  })
}

function callsTo(method: string, url: string): number {
  return mocks.api.mock.calls.filter(([input, init]) => String(input) === url && (init?.method ?? 'GET') === method).length
}

function setVisibility(state: DocumentVisibilityState): void {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

/** The fixtures' jobs are requested by user 1, so by default the viewer is their requester. */
const REQUESTER_ID = 1

function setup(
  overrides: {
    enabled?: Ref<boolean>
    fileIds?: Ref<readonly number[]>
    bookId?: Ref<number>
    viewerId?: Ref<number | null>
    onJobCompleted?: (job: ReadAloudJob) => void
  } = {},
) {
  scope = effectScope()
  const options = {
    bookId: overrides.bookId ?? ref(BOOK_ID),
    enabled: overrides.enabled ?? ref(true),
    fileIds: overrides.fileIds ?? ref<readonly number[]>([101, 102, 103, 104]),
    viewerId: overrides.viewerId ?? ref<number | null>(REQUESTER_ID),
    onJobCompleted: overrides.onJobCompleted,
  }
  return scope.run(() => useReadAloud(options))!
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.api.mockReset()
  mocks.createAuthenticatedSocket.mockClear()
  mocks.socket.reset()
  visibility = 'visible'
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
})

afterEach(() => {
  scope?.stop()
  scope = null
  vi.useRealTimers()
})

describe('useReadAloud', () => {
  it('does not probe the API until the permission-backed flag is true', async () => {
    const enabled = ref(false)
    const result = setup({ enabled })
    await flushPromises()
    expect(mocks.api).not.toHaveBeenCalled()

    routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability()) })
    enabled.value = true
    await flushPromises()

    expect(callsTo('GET', CAPABILITY_URL)).toBe(1)
    expect(result.capability.value?.eligible).toBe(true)
    expect(result.loading.value).toBe(false)
  })

  it('applies job updates pushed over the socket for this book only', async () => {
    routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob({ status: 'queued' }) })) })
    const result = setup()
    await flushPromises()

    expect(mocks.createAuthenticatedSocket).toHaveBeenCalledWith(READ_ALOUD_SOCKET_NAMESPACE, expect.any(Object))

    mocks.socket.emit(READ_ALOUD_JOB_UPDATED_EVENT, makeJob({ status: 'processing', progress: 55, updatedAt: '2026-01-01T00:10:00.000Z' }))
    expect(result.job.value).toMatchObject({ status: 'processing', progress: 55 })

    mocks.socket.emit(READ_ALOUD_JOB_UPDATED_EVENT, makeJob({ id: 'other', bookId: 99, status: 'failed', updatedAt: '2026-01-01T00:20:00.000Z' }))
    expect(result.job.value?.id).toBe(JOB_ID)

    // An older copy arriving late never rolls the job back.
    mocks.socket.emit(READ_ALOUD_JOB_UPDATED_EVENT, makeJob({ status: 'queued', updatedAt: '2026-01-01T00:05:00.000Z' }))
    expect(result.job.value?.status).toBe('processing')
  })

  describe('live updates for someone else’s job', () => {
    it('polls instead of holding a socket the server never pushes to', async () => {
      routeApi({
        [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob({ requestedBy: { id: 2, name: 'Sam' } }) })),
        [`GET ${JOB_URL}`]: () => jsonResponse(makeJob({ requestedBy: { id: 2, name: 'Sam' }, progress: 60, updatedAt: '2026-01-01T00:10:00.000Z' })),
      })
      const result = setup({ viewerId: ref(REQUESTER_ID) })
      await flushPromises()

      expect(mocks.createAuthenticatedSocket).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS)
      expect(callsTo('GET', JOB_URL)).toBe(1)
      expect(result.job.value?.progress).toBe(60)
    })

    it('gives a job whose requester was deleted no socket either', async () => {
      routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob({ requestedBy: { id: null, name: null } }) })) })
      setup({ viewerId: ref(null) })
      await flushPromises()

      expect(mocks.createAuthenticatedSocket).not.toHaveBeenCalled()
    })

    it('opens the socket once the signed-in account turns out to be the requester, and closes it when it is not', async () => {
      routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob() })) })
      const viewerId = ref<number | null>(null)
      const disconnect = vi.spyOn(mocks.socket, 'disconnect')
      setup({ viewerId })
      await flushPromises()
      expect(mocks.createAuthenticatedSocket).not.toHaveBeenCalled()

      viewerId.value = REQUESTER_ID
      await flushPromises()
      expect(mocks.createAuthenticatedSocket).toHaveBeenCalledTimes(1)

      viewerId.value = 2
      await flushPromises()
      expect(disconnect).toHaveBeenCalledTimes(1)
      disconnect.mockRestore()
    })
  })

  it('polls an active job every 30 seconds only while the page is visible', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob() })),
      [`GET ${JOB_URL}`]: () => jsonResponse(makeJob()),
    })
    setup()
    await flushPromises()

    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS - 1_000)
    expect(callsTo('GET', JOB_URL)).toBe(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(callsTo('GET', JOB_URL)).toBe(1)

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS * 4)
    expect(callsTo('GET', JOB_URL)).toBe(1)

    // Coming back catches up at once, then resumes the slow cadence.
    setVisibility('visible')
    await flushPromises()
    expect(callsTo('GET', JOB_URL)).toBe(2)
    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS)
    expect(callsTo('GET', JOB_URL)).toBe(3)
  })

  it('never polls a finished job', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob({ status: 'failed', errorCode: 'alignment_failed' }) })),
    })
    setup()
    await flushPromises()

    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS * 3)
    expect(callsTo('GET', JOB_URL)).toBe(0)
    expect(mocks.createAuthenticatedSocket).not.toHaveBeenCalled()
  })

  it('stops polling a job whose status route answers 404', async () => {
    let capabilityCalls = 0
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => {
        capabilityCalls += 1
        return jsonResponse(makeCapability({ latestJob: capabilityCalls === 1 ? makeJob() : null }))
      },
      [`GET ${JOB_URL}`]: () => errorResponse(404),
    })
    const result = setup()
    await flushPromises()

    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS)
    expect(callsTo('GET', JOB_URL)).toBe(1)
    await flushPromises()
    expect(result.job.value).toBeNull()

    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS * 3)
    expect(callsTo('GET', JOB_URL)).toBe(1)
  })

  it('stops polling on 403 without dropping the job', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob() })),
      [`GET ${JOB_URL}`]: () => errorResponse(403),
    })
    const result = setup()
    await flushPromises()

    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS * 4)
    expect(callsTo('GET', JOB_URL)).toBe(1)
    expect(result.job.value?.id).toBe(JOB_ID)
  })

  it('refetches the job after a failed publish so the card is not stuck in review', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob({ status: 'awaiting_review' }) })),
      [`POST ${JOB_URL}/publish`]: () => errorResponse(500),
      [`GET ${JOB_URL}`]: () => jsonResponse(makeJob({ status: 'failed', errorCode: 'publication_failed', updatedAt: '2026-01-01T02:00:00.000Z' })),
    })
    const result = setup()
    await flushPromises()

    await expect(result.publish()).resolves.toBe(false)

    expect(callsTo('GET', JOB_URL)).toBe(1)
    expect(result.job.value).toMatchObject({ status: 'failed', errorCode: 'publication_failed' })
    expect(result.jobErrorKey.value).toBe('book.detail.files.readAloud.errors.publish')
    expect(result.action.value).toBeNull()
  })

  it('refetches the job after a failed cancel and explains a conflict', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob() })),
      [`DELETE ${JOB_URL}`]: () => errorResponse(409),
      [`GET ${JOB_URL}`]: () => jsonResponse(makeJob({ status: 'completed', updatedAt: '2026-01-01T02:00:00.000Z' })),
    })
    const result = setup()
    await flushPromises()

    await expect(result.cancel()).resolves.toBe(false)

    expect(callsTo('GET', JOB_URL)).toBe(1)
    expect(result.job.value?.status).toBe('completed')
    expect(result.jobErrorKey.value).toBe('book.detail.files.readAloud.errors.conflict')
  })

  it('keeps a running job processing with cancelRequested after cancel, as the server answers', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob() })),
      [`DELETE ${JOB_URL}`]: () => jsonResponse(makeJob({ cancelRequested: true, updatedAt: '2026-01-01T00:30:00.000Z' })),
    })
    const result = setup()
    await flushPromises()

    await expect(result.cancel()).resolves.toBe(true)

    expect(result.job.value).toMatchObject({ status: 'processing', cancelRequested: true })
    expect(result.jobErrorKey.value).toBeNull()
  })

  it('rechecks availability when the book gains or loses a file', async () => {
    routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ eligible: false, reason: 'no_epub', epubFiles: [] })) })
    const fileIds = ref<readonly number[]>([102, 103, 104])
    const result = setup({ fileIds })
    await flushPromises()
    expect(callsTo('GET', CAPABILITY_URL)).toBe(1)

    routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability()) })
    fileIds.value = [101, 102, 103, 104]
    await flushPromises()

    expect(callsTo('GET', CAPABILITY_URL)).toBe(2)
    expect(mocks.api).toHaveBeenLastCalledWith(CAPABILITY_URL, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(result.capability.value?.eligible).toBe(true)
    // A silent recheck never puts the entry back into its first-load state.
    expect(result.loading.value).toBe(false)
  })

  it('does not report a job that loaded finished as a completion', async () => {
    const onJobCompleted = vi.fn<(job: ReadAloudJob) => void>()
    routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob({ status: 'completed' }) })) })
    setup({ onJobCompleted })
    await flushPromises()

    expect(onJobCompleted).not.toHaveBeenCalled()
  })

  it('reports a completion exactly once when the watched job finishes', async () => {
    const onJobCompleted = vi.fn<(job: ReadAloudJob) => void>()
    routeApi({ [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob({ stage: 'publishing' }) })) })
    const result = setup({ onJobCompleted })
    await flushPromises()

    mocks.socket.emit(READ_ALOUD_JOB_UPDATED_EVENT, makeJob({ status: 'completed', updatedAt: '2026-01-01T01:00:00.000Z' }))
    await flushPromises()
    mocks.socket.emit(READ_ALOUD_JOB_UPDATED_EVENT, makeJob({ status: 'completed', updatedAt: '2026-01-01T01:00:01.000Z' }))
    await flushPromises()

    expect(onJobCompleted).toHaveBeenCalledTimes(1)
    expect(result.job.value?.status).toBe('completed')
    // The freed slot and the new file change availability, so it is read again.
    expect(callsTo('GET', CAPABILITY_URL)).toBeGreaterThanOrEqual(2)
  })

  it('maps create failures to dialog errors and refreshes a stale capability', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability()),
      [`POST /api/v1/books/${BOOK_ID}/read-aloud-jobs`]: () => errorResponse(409),
    })
    const result = setup()
    await flushPromises()

    const outcome = await result.create({ epubFileId: 101, audioFileIds: [103, 102], language: 'en', granularity: 'sentence' })
    await flushPromises()

    expect(outcome).toEqual({ ok: false, errorKey: 'book.detail.files.readAloud.errors.createConflict' })
    expect(result.jobErrorKey.value).toBeNull()
    expect(callsTo('GET', CAPABILITY_URL)).toBe(2)
  })

  it('adopts the job a successful create returns', async () => {
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability()),
      [`POST /api/v1/books/${BOOK_ID}/read-aloud-jobs`]: () => jsonResponse(makeJob({ status: 'queued' }), 201),
    })
    const result = setup()
    await flushPromises()

    const input = { epubFileId: 101, audioFileIds: [103, 102], language: 'en', granularity: 'sentence' as const, replaceFileId: 300 }
    await expect(result.create(input)).resolves.toEqual({ ok: true })

    const [, init] = mocks.api.mock.calls.find(([url]) => String(url).endsWith('/read-aloud-jobs'))!
    expect(JSON.parse(String(init?.body))).toEqual(input)
    expect(result.job.value?.status).toBe('queued')
  })

  it('resets everything when the book changes', async () => {
    const bookId = ref(BOOK_ID)
    routeApi({
      [`GET ${CAPABILITY_URL}`]: () => jsonResponse(makeCapability({ latestJob: makeJob() })),
      ['GET /api/v1/books/13/read-aloud']: () => jsonResponse(makeCapability()),
    })
    const result = setup({ bookId })
    await flushPromises()
    expect(result.job.value?.id).toBe(JOB_ID)

    bookId.value = 13
    await flushPromises()

    expect(result.job.value).toBeNull()
    expect(callsTo('GET', '/api/v1/books/13/read-aloud')).toBe(1)
    await vi.advanceTimersByTimeAsync(READ_ALOUD_POLL_INTERVAL_MS * 2)
    expect(callsTo('GET', JOB_URL)).toBe(0)
  })

  it('reports a failed first check instead of hiding it', async () => {
    routeApi({ [`GET ${CAPABILITY_URL}`]: () => errorResponse(500) })
    const result = setup()
    await flushPromises()

    expect(result.loadFailed.value).toBe(true)
    expect(result.capability.value).toBeNull()
  })

  it('counts checks that keep failing, shows a recheck as loading, and clears the count on an answer', async () => {
    let answer: () => Response = () => errorResponse(500)
    routeApi({ [`GET ${CAPABILITY_URL}`]: () => answer() })
    const result = setup()
    await flushPromises()
    expect(result.failedChecks.value).toBe(1)

    const recheck = result.reload()
    expect(result.loading.value).toBe(true)
    await recheck
    expect(result.loading.value).toBe(false)
    expect(result.loadFailed.value).toBe(true)
    expect(result.failedChecks.value).toBe(2)

    answer = () => jsonResponse(makeCapability())
    await result.reload()
    expect(result.loadFailed.value).toBe(false)
    expect(result.failedChecks.value).toBe(0)
  })
})
