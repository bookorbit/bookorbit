import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

import type { SessionOutcome } from '../useAuth'

const { initMock, fetchSetupStatusMock, setupState } = vi.hoisted(() => ({
  initMock: vi.fn<() => Promise<SessionOutcome>>(),
  fetchSetupStatusMock: vi.fn<() => Promise<boolean>>(),
  setupState: { needsSetup: { value: null as boolean | null } },
}))

vi.mock('../useAuth', () => ({ useAuth: () => ({ init: initMock }) }))

vi.mock('../useSetupStatus', () => ({
  useSetupStatus: () => ({ needsSetup: setupState.needsSetup, fetchSetupStatus: fetchSetupStatusMock }),
}))

vi.mock('../useLoginOptions', () => ({
  useLoginOptions: () => ({ fetchLoginOptions: vi.fn<() => Promise<object>>(async () => ({})) }),
}))

/** Module state is the point of this composable, so every test gets a fresh copy. */
async function loadBootstrap() {
  return import('../useSessionBootstrap')
}

function track(promise: Promise<void>) {
  const state = { settled: false }
  void promise.then(() => {
    state.settled = true
  })
  return state
}

beforeEach(() => {
  vi.resetModules()
  // setImmediate stays real so flushPromises can drain the retry chain between timer steps.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  initMock.mockReset()
  fetchSetupStatusMock.mockReset().mockResolvedValue(false)
  setupState.needsSetup.value = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('bootstrapSession', () => {
  it('lets the router through at once when the server answers', async () => {
    initMock.mockResolvedValue('anonymous')
    const boot = await loadBootstrap()

    await boot.bootstrapSession()

    expect(boot.useSessionBootstrap().unreachable.value).toBe(false)
    await expect(boot.whenSessionResolved()).resolves.toBeUndefined()
  })

  it('skips the session check while the server still needs setup', async () => {
    setupState.needsSetup.value = true
    const boot = await loadBootstrap()

    await boot.bootstrapSession()

    expect(initMock).not.toHaveBeenCalled()
    expect(boot.useSessionBootstrap().unreachable.value).toBe(false)
  })

  it('holds the router and keeps asking, backing off, while the server is unreachable', async () => {
    initMock.mockResolvedValueOnce('unreachable').mockResolvedValueOnce('unreachable').mockResolvedValue('authenticated')
    const boot = await loadBootstrap()

    await boot.bootstrapSession()
    const resolved = track(boot.whenSessionResolved())
    expect(boot.useSessionBootstrap().unreachable.value).toBe(true)

    vi.advanceTimersByTime(1_000)
    await flushPromises()
    expect(initMock).toHaveBeenCalledTimes(2)
    expect(resolved.settled).toBe(false)

    vi.advanceTimersByTime(1_999)
    await flushPromises()
    expect(initMock).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(1)
    await flushPromises()
    expect(initMock).toHaveBeenCalledTimes(3)
    expect(resolved.settled).toBe(true)
    expect(boot.useSessionBootstrap().unreachable.value).toBe(false)
  })

  it('asks again at once on request and drops the scheduled attempt', async () => {
    initMock.mockResolvedValueOnce('unreachable').mockResolvedValue('anonymous')
    const boot = await loadBootstrap()
    await boot.bootstrapSession()

    await boot.useSessionBootstrap().retryNow()

    expect(initMock).toHaveBeenCalledTimes(2)
    await expect(boot.whenSessionResolved()).resolves.toBeUndefined()
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(initMock).toHaveBeenCalledTimes(2)
  })
})
