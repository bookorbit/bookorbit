import { effectScope, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AddedAtRecomputeJob } from '@bookorbit/types'
import { useLibraryAddedAt } from '../useLibraryAddedAt'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>())
vi.mock('@/lib/api', () => ({ api: apiMock }))
const job: AddedAtRecomputeJob = {
  id: 'job',
  libraryId: 1,
  source: 'file_modified',
  status: 'running',
  total: 100,
  processed: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
  failureSamples: [],
}
const response = (value: unknown, ok = true) => ({ ok, json: async () => value })
let scope: ReturnType<typeof effectScope>

beforeEach(() => {
  vi.useFakeTimers()
  apiMock.mockReset()
  scope = effectScope()
})
afterEach(() => {
  scope.stop()
  vi.useRealTimers()
})

function setup() {
  const id = ref<number | null>(1)
  const state = scope.run(() => useLibraryAddedAt(id))!
  return { ...state, id }
}

describe('useLibraryAddedAt', () => {
  it('resumes an active background job and stops polling when complete', async () => {
    apiMock.mockResolvedValueOnce(response(job)).mockResolvedValueOnce(response({ ...job, status: 'completed', processed: 100, updated: 100 }))
    const state = setup()
    await flushPromises()
    expect(state.running.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.job.value).toMatchObject({ status: 'completed', processed: 100 })
    expect(state.running.value).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(apiMock).toHaveBeenCalledTimes(2)
  })

  it('starts a job and does not submit duplicates while running', async () => {
    apiMock.mockResolvedValueOnce(response(null)).mockResolvedValue(response(job))
    const state = setup()
    await flushPromises()
    await state.start()
    await state.start()
    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(apiMock.mock.calls[1][1]).toMatchObject({ method: 'POST' })
    expect(state.running.value).toBe(true)
  })

  it('localizes structured errors without displaying backend text', async () => {
    apiMock
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response({ errorCode: 'ADDED_AT_BUSY', message: 'Internal server detail' }, false))
    const state = setup()
    await flushPromises()
    await state.start()
    expect(state.errorKey.value).toBe('library.creator.scanner.addedAt.errors.busy')
    expect(state.running.value).toBe(false)
  })

  it('retains progress through a polling failure and reconnects', async () => {
    apiMock
      .mockResolvedValueOnce(response(job))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(response({ ...job, processed: 50 }))
    const state = setup()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.job.value?.processed).toBe(0)
    expect(state.errorKey.value).toBeTruthy()
    await vi.advanceTimersByTimeAsync(5000)
    expect(state.job.value?.processed).toBe(50)
    expect(state.errorKey.value).toBeNull()
  })

  it('reports lost job state after a server restart instead of claiming success', async () => {
    apiMock.mockResolvedValueOnce(response(job)).mockResolvedValueOnce(response(null))
    const state = setup()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.running.value).toBe(false)
    expect(state.errorKey.value).toBe('library.creator.scanner.addedAt.errors.interrupted')
  })

  it('ignores a stale response after switching libraries and aborts on disposal', async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void
    apiMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve
          }),
      )
      .mockResolvedValueOnce(response({ ...job, id: 'new', libraryId: 2 }))
    const state = setup()
    state.id.value = 2
    await flushPromises()
    resolveOld(response(job))
    await flushPromises()
    expect(state.job.value?.libraryId).toBe(2)
    scope.stop()
    expect(apiMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(apiMock).toHaveBeenCalledTimes(2)
  })
})
