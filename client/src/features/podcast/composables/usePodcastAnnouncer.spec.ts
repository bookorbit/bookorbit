import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePodcastAnnouncer } from './usePodcastAnnouncer'

describe('usePodcastAnnouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('exposes the latest announcement', async () => {
    const { message, announce } = usePodcastAnnouncer()

    await announce('Launch added to the queue')

    expect(message.value).toBe('Launch added to the queue')
  })

  it('clears the region first so an identical repeat is still announced', async () => {
    const { message, announce } = usePodcastAnnouncer()
    await announce('Launch added to the queue')

    const pending = announce('Launch added to the queue')
    expect(message.value).toBe('')

    await pending
    expect(message.value).toBe('Launch added to the queue')
  })

  it('drops the announcement so it is not read again on the next focus pass', async () => {
    const { message, announce } = usePodcastAnnouncer()

    await announce('Launch finished downloading')
    await vi.advanceTimersByTimeAsync(8_000)

    expect(message.value).toBe('')
  })

  it('ignores blank announcements', async () => {
    const { message, announce } = usePodcastAnnouncer()
    await announce('Launch added to the queue')

    await announce('   ')

    expect(message.value).toBe('Launch added to the queue')
  })
})
