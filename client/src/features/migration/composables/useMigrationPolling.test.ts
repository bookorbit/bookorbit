import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref, nextTick } from 'vue'
import { useMigrationPolling } from './useMigrationPolling'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function makePolling(options?: { intervalMs?: number; pollFn?: () => Promise<void> }) {
  const runState = ref<string | undefined>(undefined)
  const pollFn = options?.pollFn ?? vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const result = useMigrationPolling({ runState, pollFn, intervalMs: options?.intervalMs ?? 1000 })
  return { runState, pollFn: pollFn as ReturnType<typeof vi.fn>, ...result }
}

describe('useMigrationPolling', () => {
  describe('start/stop', () => {
    it('starts polling at the given interval', async () => {
      const { pollFn, start } = makePolling({ intervalMs: 500 })
      start()
      vi.advanceTimersByTime(1500)
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(3)
    })

    it('stop clears the interval and stops polling', async () => {
      const { pollFn, start, stop } = makePolling({ intervalMs: 500 })
      start()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      stop()
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(1)
    })

    it('stop is a no-op when not running', () => {
      const { stop } = makePolling()
      expect(() => stop()).not.toThrow()
    })

    it('calling start twice only runs one timer', async () => {
      const { pollFn, start } = makePolling({ intervalMs: 500 })
      start()
      start()
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(2)
    })
  })

  describe('doPoll error handling', () => {
    it('sets pollingError to true and stops polling on pollFn rejection', async () => {
      const pollFn = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('network error'))
      const { pollingError, start } = makePolling({ pollFn, intervalMs: 500 })
      start()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
      expect(pollingError.value).toBe(true)
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(1)
    })

    it('clears pollingError on successful poll', async () => {
      const pollFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      const { pollingError, start } = makePolling({ pollFn, intervalMs: 500 })
      start()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      expect(pollingError.value).toBe(false)
    })
  })

  describe('retry', () => {
    it('clears pollingError and starts polling again', async () => {
      const pollFn = vi.fn<() => Promise<void>>()
      pollFn.mockRejectedValueOnce(new Error('fail')).mockResolvedValue(undefined)
      const { pollingError, start, retry } = makePolling({ pollFn, intervalMs: 500 })

      start()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      await Promise.resolve()
      expect(pollingError.value).toBe(true)

      retry()
      await Promise.resolve()
      expect(pollingError.value).toBe(false)
    })

    it('calls pollFn immediately on retry', async () => {
      const pollFn = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
      const { retry } = makePolling({ pollFn, intervalMs: 1000 })
      retry()
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('watcher on runState', () => {
    it('starts polling when runState changes to running', async () => {
      const { runState, pollFn } = makePolling({ intervalMs: 500 })
      runState.value = 'running'
      await nextTick()
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(2)
    })

    it('stops polling when runState changes away from running', async () => {
      const { runState, pollFn } = makePolling({ intervalMs: 500 })
      runState.value = 'running'
      await nextTick()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      runState.value = 'completed'
      await nextTick()
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(1)
    })

    it('stops polling for idle state', async () => {
      const { runState, pollFn } = makePolling({ intervalMs: 500 })
      runState.value = 'running'
      await nextTick()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
      runState.value = 'idle'
      await nextTick()
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(pollFn).toHaveBeenCalledTimes(1)
    })

    it('does not start polling when runState is undefined', async () => {
      const { runState, pollFn } = makePolling({ intervalMs: 500 })
      runState.value = undefined
      await nextTick()
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(pollFn).not.toHaveBeenCalled()
    })
  })

  describe('pollingError state', () => {
    it('starts with pollingError false', () => {
      const { pollingError } = makePolling()
      expect(pollingError.value).toBe(false)
    })
  })
})
