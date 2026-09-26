import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastPlaybackPreferences } from '@bookorbit/types'
import { createPodcastPlayerPersistence } from './podcast-player-persistence'

describe('createPodcastPlayerPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('serializes state writes and stamps each observation before it waits', async () => {
    let releaseFirst!: () => void
    const first = new Promise<Response>((resolve) => {
      releaseFirst = () => resolve(new Response(null, { status: 204 }))
    })
    const request = vi
      .fn<(url: string, init?: RequestInit) => Promise<Response>>()
      .mockReturnValueOnce(first)
      .mockResolvedValue(new Response(null, { status: 204 }))
    const persistence = createPodcastPlayerPersistence(request)

    const firstWrite = persistence.queueStateWrite(42, { positionSeconds: 10 })
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    vi.setSystemTime(new Date('2026-08-01T12:00:05.000Z'))
    const secondWrite = persistence.queueStateWrite(42, { positionSeconds: 20 })
    expect(request).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([firstWrite, secondWrite])

    const bodies = request.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
    expect(bodies).toEqual([
      { positionSeconds: 10, capturedAt: '2026-08-01T12:00:00.000Z' },
      { positionSeconds: 20, capturedAt: '2026-08-01T12:00:05.000Z' },
    ])
  })

  it('drops queued state and preference writes after their generations are invalidated', async () => {
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 204 }))
    const persistence = createPodcastPlayerPersistence(request)

    const stateWrite = persistence.queueStateWrite(42, { positionSeconds: 10 })
    persistence.queuePreferenceWrite(preferences())
    persistence.invalidatePlaybackWrites()
    persistence.invalidatePreferenceWrites()
    await stateWrite
    await persistence.waitForPreferenceWrites()

    expect(request).not.toHaveBeenCalled()
  })

  it('collapses a burst of preference changes into one write carrying the settled values', async () => {
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 204 }))
    const persistence = createPodcastPlayerPersistence(request)

    for (const volume of [0.2, 0.4, 0.6, 0.8]) persistence.queuePreferenceWrite(preferences(volume))
    await vi.advanceTimersByTimeAsync(500)

    expect(request).toHaveBeenCalledOnce()
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({ settings: { volume: 0.8 } })
  })

  it('flushes a pending preference write rather than waiting out the debounce', async () => {
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 204 }))
    const persistence = createPodcastPlayerPersistence(request)

    persistence.queuePreferenceWrite(preferences(0.5))
    await persistence.waitForPreferenceWrites()

    expect(request).toHaveBeenCalledOnce()
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({ settings: { volume: 0.5 } })
  })

  it('exposes a preference generation guard for stale reads', () => {
    const persistence = createPodcastPlayerPersistence(vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())
    const generation = persistence.preferenceLoadGeneration()
    expect(persistence.isPreferenceGenerationCurrent(generation)).toBe(true)

    persistence.invalidatePreferenceWrites()

    expect(persistence.isPreferenceGenerationCurrent(generation)).toBe(false)
  })

  it('closes a listening session once with its captured timestamps and end position', async () => {
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>().mockResolvedValue(new Response(null, { status: 204 }))
    const persistence = createPodcastPlayerPersistence(request)
    persistence.startListeningSession(new Date('2026-08-01T12:00:00.000Z'), 'session-1')
    vi.setSystemTime(new Date('2026-08-01T12:02:00.000Z'))

    await persistence.closeListeningSession(42, 75)
    await persistence.closeListeningSession(42, 100)

    expect(request).toHaveBeenCalledExactlyOnceWith(
      '/api/v1/podcast-episodes/42/sessions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          startedAt: '2026-08-01T12:00:00.000Z',
          endedAt: '2026-08-01T12:02:00.000Z',
          endPositionSeconds: 75,
        }),
      }),
    )
  })

  it('does not persist sub-second or discarded listening sessions', async () => {
    const request = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
    const persistence = createPodcastPlayerPersistence(request)
    persistence.startListeningSession(new Date(), 'short')
    await persistence.closeListeningSession(42, 1)
    persistence.startListeningSession(new Date(), 'discarded')
    persistence.discardListeningSession()
    await persistence.closeListeningSession(42, 2)

    expect(request).not.toHaveBeenCalled()
  })
})

function preferences(volume = 1): PodcastPlaybackPreferences {
  return {
    defaultPlaybackRate: 1,
    volume,
    skipBackwardSeconds: 15,
    skipForwardSeconds: 30,
    podcastPlaybackRates: {},
  }
}
