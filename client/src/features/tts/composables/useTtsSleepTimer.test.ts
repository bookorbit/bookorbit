import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTtsSleepTimer } from './useTtsSleepTimer'

describe('useTtsSleepTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should start timer with correct initial remainingSeconds', () => {
    const onExpire = vi.fn<() => void>()
    const { startTimer, remainingSeconds, activeMinutes } = useTtsSleepTimer(onExpire)

    startTimer(10)

    expect(activeMinutes.value).toBe(10)
    expect(remainingSeconds.value).toBe(600)
  })

  it('should decrement remainingSeconds every second', () => {
    const onExpire = vi.fn<() => void>()
    const { startTimer, remainingSeconds } = useTtsSleepTimer(onExpire)

    startTimer(1)
    vi.advanceTimersByTime(3000)

    expect(remainingSeconds.value).toBe(57)
  })

  it('should call onExpire when timer reaches zero', () => {
    const onExpire = vi.fn<() => void>()
    const { startTimer } = useTtsSleepTimer(onExpire)

    startTimer(1)
    vi.advanceTimersByTime(60000)

    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('should reset activeMinutes and remainingSeconds after expiry', () => {
    const onExpire = vi.fn<() => void>()
    const { startTimer, activeMinutes, remainingSeconds } = useTtsSleepTimer(onExpire)

    startTimer(1)
    vi.advanceTimersByTime(60000)

    expect(activeMinutes.value).toBeNull()
    expect(remainingSeconds.value).toBeNull()
  })

  it('should cancel the timer', () => {
    const onExpire = vi.fn<() => void>()
    const { startTimer, cancelTimer, activeMinutes, remainingSeconds } = useTtsSleepTimer(onExpire)

    startTimer(5)
    cancelTimer()

    vi.advanceTimersByTime(60000)

    expect(onExpire).not.toHaveBeenCalled()
    expect(activeMinutes.value).toBeNull()
    expect(remainingSeconds.value).toBeNull()
  })

  it('should restart timer when startTimer called again', () => {
    const onExpire = vi.fn<() => void>()
    const { startTimer, remainingSeconds } = useTtsSleepTimer(onExpire)

    startTimer(5)
    vi.advanceTimersByTime(30000)
    startTimer(10)

    expect(remainingSeconds.value).toBe(600)
  })

  it('should not call onExpire more than once', () => {
    const onExpire = vi.fn<() => void>()
    const { startTimer } = useTtsSleepTimer(onExpire)

    startTimer(1)
    vi.advanceTimersByTime(120000)

    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('should expose preset minutes', () => {
    const { presets } = useTtsSleepTimer(vi.fn<() => void>())
    expect(presets).toEqual([5, 10, 15, 30, 60])
  })
})
