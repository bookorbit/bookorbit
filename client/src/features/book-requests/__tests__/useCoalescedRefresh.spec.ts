// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useCoalescedRefresh } from '../composables/useCoalescedRefresh'

/**
 * The server emits a change event per transition from eleven places, and every connected page
 * answers each one with a list fetch and a summary whose five counts include two subqueries. A
 * request moving from approved through to available is several transitions in a couple of seconds.
 */
describe('useCoalescedRefresh', () => {
  const WINDOW_MS = 400

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function coalesced(refresh: () => void) {
    const scope = effectScope()
    const trigger = scope.run(() => useCoalescedRefresh(refresh, WINDOW_MS))!
    return { trigger, scope }
  }

  it('answers a burst of broadcasts once', async () => {
    const refresh = vi.fn<() => void>()
    const { trigger } = coalesced(refresh)

    for (let i = 0; i < 20; i++) trigger()
    await vi.advanceTimersByTimeAsync(WINDOW_MS)

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  /** A single change is the common case, and waiting out a window to show it would be a delay. */
  it('answers a lone broadcast without waiting out the window', async () => {
    const refresh = vi.fn<() => void>()
    const { trigger } = coalesced(refresh)

    trigger()
    await vi.advanceTimersByTimeAsync(0)

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  /** Whatever changed last still has to be read, so the burst ends in a refresh rather than before it. */
  it('refreshes again for a broadcast that arrives inside the window', async () => {
    const refresh = vi.fn<() => void>()
    const { trigger } = coalesced(refresh)

    trigger()
    await vi.advanceTimersByTimeAsync(0)
    trigger()
    await vi.advanceTimersByTimeAsync(WINDOW_MS)

    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('holds a sustained stream to one refresh per window', async () => {
    const refresh = vi.fn<() => void>()
    const { trigger } = coalesced(refresh)

    // One broadcast every hundred milliseconds for four windows.
    for (let i = 0; i < 16; i++) {
      trigger()
      await vi.advanceTimersByTimeAsync(100)
    }

    expect(refresh.mock.calls.length).toBeLessThanOrEqual(5)
    expect(refresh.mock.calls.length).toBeGreaterThan(0)
  })

  it('does not refresh a page that has gone away', async () => {
    const refresh = vi.fn<() => void>()
    const { trigger, scope } = coalesced(refresh)

    trigger()
    scope.stop()
    await vi.advanceTimersByTimeAsync(WINDOW_MS)

    expect(refresh).not.toHaveBeenCalled()
  })
})
