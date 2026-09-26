import type { PodcastEpisodeSummary } from '@bookorbit/types'

const MEDIA_SESSION_ACTIONS = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'stop', 'previoustrack', 'nexttrack'] as const
const ARTWORK_SIZES = '512x512'
const ARTWORK_MIME_TYPES: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export interface PodcastMediaSessionActions {
  play: () => void
  pause: () => void
  seekBackward: () => void
  seekForward: () => void
  seekTo: (seconds: number) => void
  stop: () => void
  previous: () => void
  next: () => void
}

export interface PodcastMediaPosition {
  duration: number
  playbackRate: number
  currentTime: number
}

export function createPodcastMediaSession() {
  function updateEpisode(episode: PodcastEpisodeSummary, actions: PodcastMediaSessionActions) {
    const mediaSession = getMediaSession()
    if (!mediaSession) return
    mediaSession.metadata = new MediaMetadata({
      title: episode.title,
      artist: episode.podcastTitle,
      artwork: artworkEntries(episode.podcastImageUrl),
    })
    setAction('play', actions.play)
    setAction('pause', actions.pause)
    setAction('seekbackward', actions.seekBackward)
    setAction('seekforward', actions.seekForward)
    setAction('seekto', (details) => {
      if (typeof details.seekTime === 'number' && Number.isFinite(details.seekTime)) actions.seekTo(details.seekTime)
    })
    setAction('stop', actions.stop)
    setAction('previoustrack', actions.previous)
    setAction('nexttrack', actions.next)
  }

  function updatePlaybackState(isPlaying: boolean) {
    const mediaSession = getMediaSession()
    if (mediaSession) mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
  }

  function updatePositionState(position: PodcastMediaPosition) {
    const mediaSession = getMediaSession()
    if (!mediaSession?.setPositionState) return
    if (position.duration <= 0) {
      clearPositionState(mediaSession)
      return
    }
    mediaSession.setPositionState({
      duration: position.duration,
      playbackRate: position.playbackRate,
      position: Math.min(position.currentTime, position.duration),
    })
  }

  function clear() {
    const mediaSession = getMediaSession()
    if (!mediaSession) return
    mediaSession.metadata = null
    mediaSession.playbackState = 'none'
    clearPositionState(mediaSession)
    for (const action of MEDIA_SESSION_ACTIONS) setAction(action, null)
  }

  function setAction(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
    const mediaSession = getMediaSession()
    if (!mediaSession) return
    try {
      mediaSession.setActionHandler(action, handler)
    } catch {
      return
    }
  }

  return { updateEpisode, updatePlaybackState, updatePositionState, clear }
}

function clearPositionState(mediaSession: MediaSession) {
  try {
    mediaSession.setPositionState?.()
  } catch {
    return
  }
}

function getMediaSession(): MediaSession | null {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null
}

function artworkEntries(imageUrl: string | null): MediaImage[] {
  if (!imageUrl) return []
  const extension = imageUrl.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() ?? ''
  const type = ARTWORK_MIME_TYPES[extension]
  return [{ src: imageUrl, sizes: ARTWORK_SIZES, ...(type ? { type } : {}) }]
}
