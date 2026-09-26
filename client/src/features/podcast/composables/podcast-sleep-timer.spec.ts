import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPodcastSleepTimer } from './podcast-sleep-timer'

describe('createPodcastSleepTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires a countdown once and disposes its ticker', async () => {
    const onExpire = vi.fn<(pausePlayback: boolean) => void>()
    const timer = createPodcastSleepTimer({ onExpire, onExtend: vi.fn<(minutes: number) => void>() })

    timer.setTimer(5)
    expect(timer.sleepRemainingSeconds.value).toBe(300)

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(onExpire).toHaveBeenCalledWith(true)
    expect(timer.sleepRemainingSeconds.value).toBeNull()
    expect(timer.sleepTimerMinutes.value).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('extends only a running countdown from its existing deadline', async () => {
    const onExtend = vi.fn<(minutes: number) => void>()
    const timer = createPodcastSleepTimer({ onExpire: vi.fn<(pausePlayback: boolean) => void>(), onExtend })
    timer.extendTimer(5)
    expect(onExtend).not.toHaveBeenCalled()

    timer.setTimer(5)
    await vi.advanceTimersByTimeAsync(60_000)
    timer.extendTimer(5)

    expect(timer.sleepRemainingSeconds.value).toBe(9 * 60)
    expect(timer.sleepTimerMinutes.value).toBe(10)
    expect(onExtend).toHaveBeenCalledWith(5)
  })

  it('captures the selected chapter boundary across later positions', () => {
    const onExpire = vi.fn<(pausePlayback: boolean) => void>()
    const timer = createPodcastSleepTimer({ onExpire, onExtend: vi.fn<(minutes: number) => void>() })
    timer.setAtEnd('chapter', {
      chapters: [
        { title: 'One', startSeconds: 0 },
        { title: 'Two', startSeconds: 100 },
        { title: 'Three', startSeconds: 200 },
      ],
      activeChapterIndex: 0,
      duration: 300,
    })

    timer.handlePosition(99)
    expect(onExpire).not.toHaveBeenCalled()
    timer.handlePosition(100)

    expect(onExpire).toHaveBeenCalledOnce()
    expect(timer.sleepEndMode.value).toBeNull()
  })

  it('uses the episode boundary for the final chapter and ignores chapter mode without chapters', () => {
    const onExpire = vi.fn<(pausePlayback: boolean) => void>()
    const timer = createPodcastSleepTimer({ onExpire, onExtend: vi.fn<(minutes: number) => void>() })
    timer.setAtEnd('chapter', { chapters: [], activeChapterIndex: -1, duration: 300 })
    expect(timer.sleepEndMode.value).toBeNull()

    timer.setAtEnd('chapter', { chapters: [{ title: 'Only', startSeconds: 0 }], activeChapterIndex: 0, duration: 300 })
    timer.handlePosition(299)
    expect(onExpire).not.toHaveBeenCalled()
    timer.handlePosition(300)
    expect(onExpire).toHaveBeenCalledOnce()
  })

  it('reports an episode-end interception only while an end mode is active', () => {
    const onExpire = vi.fn<(pausePlayback: boolean) => void>()
    const timer = createPodcastSleepTimer({ onExpire, onExtend: vi.fn<(minutes: number) => void>() })
    expect(timer.handleEpisodeEnd()).toBe(false)

    timer.setAtEnd('episode', { chapters: [], activeChapterIndex: -1, duration: 300 })
    expect(timer.handleEpisodeEnd()).toBe(true)
    expect(timer.handleEpisodeEnd()).toBe(false)
    expect(onExpire).toHaveBeenCalledExactlyOnceWith(false)
  })
})
