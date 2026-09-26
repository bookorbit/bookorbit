import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeSummary, PodcastPlaybackContext, PodcastQueueItem } from '@bookorbit/types'
import { jsonResponse } from '../test/fixtures'
import { stubMediaSession } from '../test/stubs'
import { __resetPodcastPlayerForTests, usePodcastPlayer } from './usePodcastPlayer'
import { usePodcastQueue } from './usePodcastQueue'
import { usePodcastAnnouncer } from './usePodcastAnnouncer'

const apiMock = vi.hoisted(() => vi.fn<(url: string, init?: RequestInit) => Promise<Response>>())

const podcastEvents = await vi.hoisted(async () => {
  const { mockPodcastEvents } = await import('../test/stubs')
  return mockPodcastEvents()
})

/**
 * The player is mocked at its own boundary: it asks an engine to load a stream and hands it
 * callbacks. How that engine reaches Howler, and how it reads buffering off a media element, is the
 * engine spec's business.
 */
const audio = await vi.hoisted(async () => {
  const { createPodcastAudioEngineStub } = await import('../test/audio-engine-stub')
  const engines: Array<ReturnType<typeof createPodcastAudioEngineStub>> = []
  return {
    engines,
    create: () => {
      const engine = createPodcastAudioEngineStub()
      engines.push(engine)
      return engine
    },
  }
})
const engines = audio.engines

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('./usePodcastEvents', () => ({ usePodcastEvents: podcastEvents.usePodcastEvents }))
vi.mock('./podcast-audio-engine', () => ({ createPodcastAudioEngine: audio.create }))

function stateWriteBodies(episodeId = 42): Array<Record<string, unknown>> {
  return apiMock.mock.calls
    .filter(([url, init]) => url === `/api/v1/podcast-episodes/${episodeId}/state` && init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

describe('usePodcastPlayer', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    localStorage.clear()
    engines.length = 0
    __resetPodcastPlayerForTests()
    apiMock.mockReset()
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(playbackContext())
      if (url === '/api/v1/podcast-episodes/42/bookmarks' && !init?.method) return jsonResponse([])
      if (url.endsWith('/bookmarks') && init?.method === 'POST') {
        return jsonResponse({
          id: 9,
          episodeId: 42,
          positionSeconds: 45,
          title: 'Important',
          note: null,
          createdAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T00:00:00.000Z',
        })
      }
      if (url === '/api/v1/podcast-bookmarks/9' && init?.method === 'PATCH') {
        return jsonResponse({
          id: 9,
          episodeId: 42,
          positionSeconds: 45,
          title: 'Revised',
          note: 'Remember this',
          createdAt: '2026-07-10T00:00:00.000Z',
          updatedAt: '2026-07-10T01:00:00.000Z',
        })
      }
      return new Response(null, { status: 204 })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares one player state and audio engine across facade consumers', async () => {
    const first = usePodcastPlayer()
    const second = usePodcastPlayer()

    expect(second.episode).toBe(first.episode)
    expect(second.currentTime).toBe(first.currentTime)

    await first.loadEpisode(42)
    await second.loadEpisode(42)

    expect(engines).toHaveLength(1)
    expect(second.episode.value?.id).toBe(42)
  })

  it('releases the engine, its timers, and the media-session handlers when cleared', async () => {
    const session = stubMediaSession()
    const player = usePodcastPlayer()
    await player.loadEpisode(42)
    await flushPromises()
    const engine = engines[0]!
    engine.emitLoad()
    player.togglePlayback()

    expect(session.handlers.get('play')).toEqual(expect.any(Function))

    await player.clearPlayer()

    expect(engine.disposed).toBe(true)
    expect(player.episode.value).toBeNull()
    expect(session.metadata).toBeNull()
    expect([...session.handlers.values()]).toEqual(expect.arrayContaining([null]))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let an older episode request replace a newer load', async () => {
    let resolveFirst!: (response: Response) => void
    const firstContext = new Promise<Response>((resolve) => {
      resolveFirst = resolve
    })
    const secondContext = playbackContext()
    secondContext.episode = { ...secondContext.episode, id: 43, title: 'Newer episode' }
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return firstContext
      if (url === '/api/v1/podcast-episodes/43/playback-context') return jsonResponse(secondContext)
      if (url.endsWith('/bookmarks')) return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const player = usePodcastPlayer()

    const olderLoad = player.loadEpisode(42)
    await player.loadEpisode(43)
    resolveFirst(jsonResponse(playbackContext()))
    await olderLoad

    expect(player.episode.value).toMatchObject({ id: 43, title: 'Newer episode' })
    expect(engines).toHaveLength(1)
    expect(engines[0]!.options!.src).toBe('/api/v1/podcast-episodes/43/stream')
  })

  it('loads the stream, resumes playback, and periodically persists progress', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()
    const engine = engines[0]!
    engine.emitLoad()

    expect(engine.options!.src).toBe('/api/v1/podcast-episodes/42/stream')
    expect(engine.options!.format).toBe('mp3')
    expect(engine.currentPosition).toBe(30)

    player.togglePlayback()
    engine.currentPosition = 90
    await vi.advanceTimersByTimeAsync(15_000)
    await flushPromises()

    expect(stateWriteBodies()).toEqual([{ positionSeconds: 90, progressPercent: 30, finished: false, capturedAt: expect.any(String) }])
    wrapper.unmount()
  })

  it('restarts a completed episode only when playback actually starts', async () => {
    const context = playbackContext()
    context.episode.finished = true
    context.episode.positionSeconds = 300
    context.episode.progressPercent = 100
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks' && !init?.method) return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()

    await player.loadEpisode(42, true)
    await flushPromises()
    const engine = engines[0]!
    expect(apiMock.mock.calls.some(([url, init]) => url.endsWith('/state') && init?.method === 'PATCH')).toBe(false)
    engine.emitLoad()
    await flushPromises()

    expect(stateWriteBodies()).toEqual([{ finished: false, positionSeconds: 0, progressPercent: 0, capturedAt: expect.any(String) }])
    expect(engine.currentPosition).toBe(0)
    expect(player.isPlaying.value).toBe(true)
    wrapper.unmount()
  })

  it('uses the episode audio format instead of forcing MP3 playback', async () => {
    const context = playbackContext()
    context.episode.audioFormat = 'm4a'
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks') return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()

    await player.loadEpisode(42)

    expect(engines[0]!.options!.format).toBe('m4a')
    wrapper.unmount()
  })

  it('lets the browser detect an unknown audio format instead of assuming MP3', async () => {
    const context = playbackContext()
    context.episode.audioFormat = null
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks') return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()

    await player.loadEpisode(42)

    expect(engines[0]!.options!.format).toBeNull()
    wrapper.unmount()
  })

  it('anchors Play next immediately after the active episode', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)

    await player.queueEpisodeNext(99)

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-episodes/42/queue',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ placement: 'end' }) }),
    )
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-episodes/99/queue',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ placement: 'next', afterEpisodeId: 42 }) }),
    )
    wrapper.unmount()
  })

  it('refreshes the active player when another screen changes the queue', async () => {
    let context = playbackContext()
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks') return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    context = playbackContext()
    context.queue.total = 1
    context.queue.upcoming = [queueItem(99)]

    await usePodcastQueue().add(99)

    await vi.waitFor(() => expect(player.queueTotal.value).toBe(1))
    expect(player.upcomingQueueItems.value.map((item) => item.id)).toEqual([99])
    wrapper.unmount()
  })

  it('refreshes queue context when reopening the already loaded episode', async () => {
    let context = playbackContext()
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks') return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    context = playbackContext()
    context.queue.total = 1
    context.queue.upcoming = [queueItem(99)]

    await player.loadEpisode(42)

    expect(player.upcomingQueueItems.value.map((item) => item.id)).toEqual([99])
    wrapper.unmount()
  })

  it('ignores playback preferences that finish loading after a user reset', async () => {
    let resolvePreferences!: (response: Response) => void
    apiMock.mockReturnValueOnce(new Promise<Response>((resolve) => (resolvePreferences = resolve)))
    const { player, wrapper } = mountPlayer()

    const loadingPreferences = player.loadPreferences()
    player.resetPreferences()
    resolvePreferences(
      jsonResponse({
        settings: { defaultPlaybackRate: 2, skipBackwardSeconds: 20, skipForwardSeconds: 40, podcastPlaybackRates: {} },
      }),
    )
    await loadingPreferences

    expect(player.playbackRate.value).toBe(1)
    expect(player.skipBackwardSeconds.value).toBe(15)
    wrapper.unmount()
  })

  it('applies and persists volume changes', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    apiMock.mockClear()

    player.setVolume(0.35)
    await settlePreferenceWrites()

    expect(engines[0]!.currentVolume).toBe(0.35)
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/podcast-playback',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"volume":0.35'),
      }),
    )
    wrapper.unmount()
  })

  it('clears the active show playback-rate override', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    player.setPlaybackRate(1.5)
    await flushPromises()

    expect(player.hasPlaybackRateOverride.value).toBe(true)

    apiMock.mockClear()
    player.clearPlaybackRateOverride()
    await settlePreferenceWrites()

    expect(player.hasPlaybackRateOverride.value).toBe(false)
    expect(player.playbackRate.value).toBe(1)
    expect(engines[0]!.currentRate).toBe(1)
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/podcast-playback',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"podcastPlaybackRates":{}'),
      }),
    )
    wrapper.unmount()
  })

  it('steps playback rate to the next preset in either direction', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)

    player.setPlaybackRate(1.05, false)
    player.stepPlaybackRate(1)
    expect(player.playbackRate.value).toBe(1.1)

    player.stepPlaybackRate(-1)
    expect(player.playbackRate.value).toBe(1)
    wrapper.unmount()
  })

  it('updates pinned state through the episode state endpoint', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    apiMock.mockClear()

    await player.togglePinned()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-episodes/42/state',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ pinned: true }) }),
    )
    expect(player.episode.value?.pinned).toBe(true)
    wrapper.unmount()
  })

  it('pauses playback and announces the end of a countdown sleep timer', async () => {
    const { player, wrapper } = mountPlayer()
    const { message } = usePodcastAnnouncer()
    await player.loadEpisode(42)
    await flushPromises()
    const engine = engines[0]!
    engine.emitLoad()
    player.togglePlayback()

    player.setSleepTimer(5)
    expect(player.sleepRemainingSeconds.value).toBe(300)

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000)
    await flushPromises()

    expect(engine.active).toBe(false)
    expect(player.sleepRemainingSeconds.value).toBeNull()
    expect(message.value).toBe('Sleep timer ended, playback paused')
    wrapper.unmount()
  })

  it('extends a running sleep timer without restarting it', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()
    const engine = engines[0]!
    engine.emitLoad()
    player.togglePlayback()
    player.setSleepTimer(5)

    await vi.advanceTimersByTimeAsync(60_000)
    player.extendSleepTimer(5)

    expect(player.sleepRemainingSeconds.value).toBe(9 * 60)

    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(engine.active).toBe(true)
    wrapper.unmount()
  })

  it('ignores an extend request when no sleep timer is running', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()

    player.extendSleepTimer(5)

    expect(player.sleepRemainingSeconds.value).toBeNull()
    expect(player.sleepTimerMinutes.value).toBeNull()
    wrapper.unmount()
  })

  it('does not enable chapter sleep mode when the episode has no chapters', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()

    player.setSleepAtEnd('chapter')

    expect(player.sleepEndMode.value).toBeNull()
    wrapper.unmount()
  })

  it('stops at the episode boundary when chapter sleep is set in the final chapter', async () => {
    const context = playbackContext()
    context.episode.chapters = [{ title: 'Only chapter', startSeconds: 0 }]
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks') return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    player.setSleepAtEnd('chapter')

    engines[0]!.emitEnd()

    expect(player.sleepEndMode.value).toBeNull()
    wrapper.unmount()
  })

  it('keeps a completed episode finished while advancing to the next episode', async () => {
    const context = playbackContext()
    const nextEpisode = { ...episode(), id: 43, title: 'Second episode', positionSeconds: 0, progressPercent: 0 }
    context.navigation = { source: 'podcast', previous: null, next: nextEpisode }
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/43/playback-context') {
        return jsonResponse({
          episode: nextEpisode,
          queue: { position: null, total: 0, previous: null, upcoming: [] },
          navigation: { source: null, previous: null, next: null },
        })
      }
      if (url.endsWith('/bookmarks')) return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)

    engines[0]!.emitEnd()
    await flushPromises()

    expect(stateWriteBodies()).toEqual([{ positionSeconds: 300, progressPercent: 100, finished: true, capturedAt: expect.any(String) }])
    wrapper.unmount()
  })

  it('stops instead of advancing into a next episode whose media is gone', async () => {
    const context = playbackContext()
    const nextEpisode = { ...episode(), id: 43, title: 'Second episode', mediaStatus: 'unavailable' as const }
    context.navigation = { source: 'podcast', previous: null, next: nextEpisode }
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url.endsWith('/bookmarks')) return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)

    engines[0]!.emitEnd()
    await flushPromises()

    // Loading it would strand the player on an unrecoverable stream error nobody asked for.
    expect(apiMock.mock.calls.some(([url]) => url === '/api/v1/podcast-episodes/43/playback-context')).toBe(false)
    expect(player.episode.value?.id).toBe(42)
    expect(player.error.value).toBeNull()
    wrapper.unmount()
  })

  it('lets the finished-state write dequeue the completed episode instead of deleting it', async () => {
    const context = playbackContext()
    context.queue = { position: 0, total: 2, previous: null, upcoming: [queueItem(43)] }
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url.endsWith('/bookmarks')) return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)

    engines[0]!.emitEnd()
    await flushPromises()

    const queueCalls = apiMock.mock.calls.filter(([url, init]) => url.endsWith('/queue') && init?.method === 'DELETE')
    expect(queueCalls).toEqual([])
    expect(stateWriteBodies()).toEqual([expect.objectContaining({ finished: true })])
    wrapper.unmount()
  })

  it('captures the selected chapter boundary for chapter sleep', async () => {
    const context = playbackContext()
    context.episode.chapters = [
      { title: 'One', startSeconds: 0 },
      { title: 'Two', startSeconds: 100 },
      { title: 'Three', startSeconds: 200 },
    ]
    apiMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks') return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    const engine = engines[0]!
    engine.emitLoad()
    player.togglePlayback()
    engine.currentPosition = 90
    await vi.advanceTimersByTimeAsync(500)
    player.setSleepAtEnd('chapter')

    engine.currentPosition = 101
    await vi.advanceTimersByTimeAsync(500)

    expect(player.sleepEndMode.value).toBeNull()
    expect(engine.active).toBe(false)
    wrapper.unmount()
  })

  it('discards player persistence when the authenticated user changes', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    apiMock.mockClear()

    await player.resetForUserChange()

    expect(apiMock).not.toHaveBeenCalled()
    expect(player.episode.value).toBeNull()
    wrapper.unmount()
  })

  it('creates bookmarks at the current playback position', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()
    engines[0]!.emitLoad()
    player.seekTo(45)
    player.bookmarkTitle.value = 'Important'

    await player.createBookmark()

    expect(player.bookmarks.value).toEqual([expect.objectContaining({ id: 9, positionSeconds: 45, title: 'Important' })])
    wrapper.unmount()
  })

  it('updates bookmark titles and notes in place', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()
    engines[0]!.emitLoad()
    player.seekTo(45)
    player.bookmarkTitle.value = 'Important'
    await player.createBookmark()

    await player.updateBookmark(player.bookmarks.value[0]!, 'Revised', 'Remember this')

    expect(player.bookmarks.value[0]).toEqual(expect.objectContaining({ title: 'Revised', note: 'Remember this' }))
    wrapper.unmount()
  })

  it('mutes to silence and restores the previous level without storing either as a preference', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()
    const engine = engines[0]!
    engine.emitLoad()
    player.setVolume(0.8)
    await settlePreferenceWrites()
    expect(volumePreferenceWrites()).toEqual([0.8])

    player.toggleMute()
    await settlePreferenceWrites()

    expect(player.volume.value).toBe(0)
    expect(engine.currentVolume).toBe(0)
    expect(volumePreferenceWrites()).toEqual([0.8])

    player.toggleMute()
    await settlePreferenceWrites()

    expect(player.volume.value).toBe(0.8)
    expect(engine.currentVolume).toBe(0.8)
    expect(volumePreferenceWrites()).toEqual([0.8])
    wrapper.unmount()
  })

  it('keeps the stored volume when an unrelated preference is written while muted', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    await flushPromises()
    engines[0]!.emitLoad()
    player.setVolume(0.8)
    await settlePreferenceWrites()

    player.toggleMute()
    player.setPlaybackRate(1.5)
    await settlePreferenceWrites()

    // The rate write must carry the chosen level, not the silence the mute put on the engine.
    expect(volumePreferenceWrites()).toEqual([0.8, 0.8])
    wrapper.unmount()
  })

  it('restores the default level when unmuting a session that was already silent', () => {
    const { player, wrapper } = mountPlayer()
    player.setVolume(0, false)

    player.toggleMute()

    expect(player.volume.value).toBe(1)
    wrapper.unmount()
  })

  it('drops a finished-state write that resolves after another episode was loaded', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    let resolveMark!: (response: Response) => void
    apiMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveMark = resolve)))

    const marking = player.markPlayed()
    await loadSecondEpisode(player)
    resolveMark(new Response(null, { status: 204 }))
    await marking

    expect(player.episode.value?.id).toBe(43)
    expect(player.episode.value?.finished).toBe(false)
    wrapper.unmount()
  })

  it('does not file a bookmark against the episode that replaced the one it was taken on', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    let resolveBookmark!: (response: Response) => void
    apiMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (resolveBookmark = resolve)))

    const creating = player.createBookmark()
    await loadSecondEpisode(player)
    resolveBookmark(
      jsonResponse({
        id: 9,
        episodeId: 42,
        positionSeconds: 45,
        title: 'Important',
        note: null,
        createdAt: '2026-07-10T00:00:00.000Z',
        updatedAt: '2026-07-10T00:00:00.000Z',
      }),
    )
    await creating

    expect(player.bookmarks.value).toEqual([])
    wrapper.unmount()
  })

  it('writes the current position when the page is hidden', async () => {
    const { player, wrapper } = mountPlayer()
    await player.loadEpisode(42)
    engines[0]!.emitLoad()
    engines[0]!.currentPosition = 128
    apiMock.mockClear()

    window.dispatchEvent(new Event('pagehide'))
    await flushPromises()

    expect(stateWriteBodies(42).at(-1)).toMatchObject({ positionSeconds: 128 })
    wrapper.unmount()
  })

  it('exposes scrub and stop controls plus artwork hints to the OS media session', async () => {
    const context = playbackContext()
    context.episode.podcastImageUrl = 'https://feed.example/art.png?size=large'
    apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/podcast-episodes/42/playback-context') return jsonResponse(context)
      if (url === '/api/v1/podcast-episodes/42/bookmarks' && !init?.method) return jsonResponse([])
      return new Response(null, { status: 204 })
    })
    const session = stubMediaSession()
    const { player, wrapper } = mountPlayer()

    await player.loadEpisode(42)
    await flushPromises()
    engines[0]!.emitLoad()

    expect(session.metadata?.artwork).toEqual([{ src: 'https://feed.example/art.png?size=large', sizes: '512x512', type: 'image/png' }])

    session.handlers.get('seekto')?.({ action: 'seekto', seekTime: 120, fastSeek: true })
    expect(player.currentTime.value).toBe(120)

    session.handlers.get('seekto')?.({ action: 'seekto' })
    expect(player.currentTime.value).toBe(120)

    session.handlers.get('stop')?.({ action: 'stop' })
    await flushPromises()
    expect(player.episode.value).toBeNull()
    wrapper.unmount()
  })
})

/** Swaps the shared player onto a second episode, the way a queue advance or a list click would. */
async function loadSecondEpisode(player: ReturnType<typeof usePodcastPlayer>) {
  const context = playbackContext()
  context.episode = { ...episode(), id: 43, title: 'Second episode' }
  apiMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/podcast-episodes/43/playback-context') return jsonResponse(context)
    if (url === '/api/v1/podcast-episodes/43/bookmarks' && !init?.method) return jsonResponse([])
    return new Response(null, { status: 204 })
  })
  await player.loadEpisode(43)
}

/** Preference writes are coalesced behind a debounce, so the timer has to run before one lands. */
async function settlePreferenceWrites() {
  await vi.advanceTimersByTimeAsync(500)
}

function volumePreferenceWrites(): number[] {
  return apiMock.mock.calls
    .filter(([url, init]) => url === '/api/v1/user-preferences/podcast-playback' && init?.method === 'PUT')
    .map(([, init]) => (JSON.parse(String(init?.body)) as { settings: { volume: number } }).settings.volume)
}

function mountPlayer() {
  let player!: ReturnType<typeof usePodcastPlayer>
  const wrapper = mount(
    defineComponent({
      setup() {
        player = usePodcastPlayer()
        return () => h('div')
      },
    }),
  )
  return { player, wrapper }
}

function playbackContext(): PodcastPlaybackContext {
  return {
    episode: episode(),
    queue: { position: null, total: 0, previous: null, upcoming: [] },
    navigation: { source: null, previous: null, next: null },
  }
}

function queueItem(id: number): PodcastQueueItem {
  return { ...episode(), id, queued: true, queuePosition: 0 }
}

function episode(): PodcastEpisodeSummary {
  return {
    id: 42,
    libraryId: 2,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'First episode',
    subtitle: null,
    description: null,
    publishedAt: null,
    season: null,
    episode: null,
    episodeType: null,
    durationSeconds: 300,
    audioFormat: 'mp3',
    explicit: false,
    chapters: [],
    transcripts: [],
    lockedFields: [],
    inFeed: true,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 30,
    progressPercent: 10,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  }
}
