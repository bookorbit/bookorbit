import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeSummary } from '@bookorbit/types'
import { createPodcastMediaSession } from './podcast-media-session'

describe('createPodcastMediaSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'mediaSession')
  })

  it('registers metadata and transport actions, including validated seeks', () => {
    const session = stubMediaSession()
    const actions = createActions()
    const mediaSession = createPodcastMediaSession()

    mediaSession.updateEpisode(episode(), actions)
    session.handlers.get('seekto')?.({ action: 'seekto', seekTime: 75, fastSeek: true })
    session.handlers.get('seekto')?.({ action: 'seekto' })
    session.handlers.get('nexttrack')?.({ action: 'nexttrack' })

    expect(session.metadata).toMatchObject({
      title: 'First episode',
      artist: 'Orbit Radio',
      artwork: [{ src: 'https://feed.example/art.png?size=large', sizes: '512x512', type: 'image/png' }],
    })
    expect(actions.seekTo).toHaveBeenCalledExactlyOnceWith(75)
    expect(actions.next).toHaveBeenCalledOnce()
  })

  it('updates playback and bounded position state before clearing every handler', () => {
    const session = stubMediaSession()
    const mediaSession = createPodcastMediaSession()
    mediaSession.updateEpisode(episode(), createActions())

    mediaSession.updatePlaybackState(true)
    mediaSession.updatePositionState({ duration: 300, playbackRate: 1.5, currentTime: 450 })
    mediaSession.clear()

    expect(session.positionStates).toEqual([{ duration: 300, playbackRate: 1.5, position: 300 }, null])
    expect(session.playbackState).toBe('none')
    expect(session.metadata).toBeNull()
    expect([...session.handlers.values()]).toEqual(Array(8).fill(null))
  })

  it('tolerates unavailable and unsupported Media Session actions', () => {
    const mediaSession = createPodcastMediaSession()
    expect(() => mediaSession.clear()).not.toThrow()

    const session = stubMediaSession(new Set<MediaSessionAction>(['seekto']))
    expect(() => mediaSession.updateEpisode(episode(), createActions())).not.toThrow()
    expect(session.handlers.has('play')).toBe(true)
    expect(session.handlers.has('seekto')).toBe(false)
  })
})

function createActions() {
  return {
    play: vi.fn<() => void>(),
    pause: vi.fn<() => void>(),
    seekBackward: vi.fn<() => void>(),
    seekForward: vi.fn<() => void>(),
    seekTo: vi.fn<(seconds: number) => void>(),
    stop: vi.fn<() => void>(),
    previous: vi.fn<() => void>(),
    next: vi.fn<() => void>(),
  }
}

interface StubbedMediaSession {
  handlers: Map<MediaSessionAction, MediaSessionActionHandler | null>
  metadata: MediaMetadataInit | null
  playbackState: MediaSessionPlaybackState
  positionStates: Array<MediaPositionState | null>
}

function stubMediaSession(unsupported = new Set<MediaSessionAction>()): StubbedMediaSession {
  const stub: StubbedMediaSession = { handlers: new Map(), metadata: null, playbackState: 'none', positionStates: [] }
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(init: MediaMetadataInit) {
        Object.assign(this, init)
      }
    },
  )
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: {
      get playbackState() {
        return stub.playbackState
      },
      set playbackState(value: MediaSessionPlaybackState) {
        stub.playbackState = value
      },
      get metadata() {
        return stub.metadata
      },
      set metadata(value: MediaMetadataInit | null) {
        stub.metadata = value
      },
      setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
        if (unsupported.has(action)) throw new DOMException('Unsupported action')
        stub.handlers.set(action, handler)
      },
      setPositionState(position?: MediaPositionState) {
        stub.positionStates.push(position ?? null)
      },
    },
  })
  return stub
}

function episode(): PodcastEpisodeSummary {
  return {
    id: 42,
    libraryId: 2,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: 'https://feed.example/art.png?size=large',
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
