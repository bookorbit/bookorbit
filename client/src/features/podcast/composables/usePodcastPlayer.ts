import type { PodcastBookmark, PodcastEpisodeSummary, PodcastPlaybackContext, PodcastPlaybackPreferences } from '@bookorbit/types'
import { apiJson, ApiError } from '@/lib/api-json'
import { i18n } from '@/i18n'
import { createRequestGeneration } from '@/lib/async'
import { usePodcastQueue } from './usePodcastQueue'
import { usePodcastEvents } from './usePodcastEvents'
import { usePodcastAnnouncer } from './usePodcastAnnouncer'
import { createPodcastMediaSession } from './podcast-media-session'
import { createPodcastSleepTimer } from './podcast-sleep-timer'
import { createPodcastAudioEngine } from './podcast-audio-engine'
import { createPodcastPlayerPersistence } from './podcast-player-persistence'
import { createPodcastPlayerState } from './podcast-player-state'
import { createPodcastPlayerActions } from './podcast-player-actions'
import { createPodcastPlayerPreferences } from './podcast-player-preferences'
import { createPodcastPlayerQueue } from './podcast-player-queue'

const DEFAULT_PREFERENCES: PodcastPlaybackPreferences = {
  defaultPlaybackRate: 1,
  volume: 1,
  skipBackwardSeconds: 15,
  skipForwardSeconds: 30,
  podcastPlaybackRates: {},
}
/** Progress is written every thirtieth engine tick, so roughly every fifteen seconds of playback. */
const TICKS_PER_STATE_WRITE = 30
const MEDIA_STATUS_POLL_MS = 5_000

/**
 * There is one player for the whole app: the mini player, the full player and every list row drive
 * the same audio element and the same episode. It is built on first use rather than at module
 * evaluation so that importing the module has no side effects, and so tests get a clean one.
 */
function createPodcastPlayer() {
  const state = createPodcastPlayerState(DEFAULT_PREFERENCES)
  const {
    episode,
    playbackContext,
    bookmarks,
    loading,
    error,
    isPlaying,
    isAutoplayPending,
    currentTime,
    duration,
    playbackRate,
    volume,
    skipBackwardSeconds,
    skipForwardSeconds,
    bookmarkTitle,
    bookmarkNote,
    downloadProgress,
    progressPercent,
    previousQueueItem,
    nextQueueItem,
    upcomingQueueItems,
    queuePosition,
    queueTotal,
    navigationSource,
    activeChapterIndex,
    hasPlaybackRateOverride,
  } = state

  const t = i18n.global.t
  const podcastQueue = usePodcastQueue()
  const podcastEvents = usePodcastEvents()
  const { announce } = usePodcastAnnouncer()
  const mediaSession = createPodcastMediaSession()
  const audioEngine = createPodcastAudioEngine()
  const { isBuffering, bufferedRanges } = audioEngine
  const persistence = createPodcastPlayerPersistence()
  const loadGeneration = createRequestGeneration()
  const episodeChangeListeners = new Set<(episodeId: number) => void>()
  const teardown: Array<() => void> = []

  let tickCount = 0
  let mediaStatusTimer: ReturnType<typeof setTimeout> | null = null

  const sleepTimer = createPodcastSleepTimer({
    onExpire: (pausePlayback) => {
      if (pausePlayback) audioEngine.pause()
      void announce(t('podcast.announce.sleepExpired'))
    },
    onExtend: (minutes) => void announce(t('podcast.announce.sleepExtended', { count: minutes })),
  })
  const { sleepRemainingSeconds, sleepEndMode, sleepTimerMinutes } = sleepTimer

  const preferences = createPodcastPlayerPreferences({
    state,
    persistence,
    defaults: DEFAULT_PREFERENCES,
    engine: audioEngine,
    onPositionStateChanged: updateMediaPositionState,
  })

  const actions = createPodcastPlayerActions({
    state,
    currentGeneration: loadGeneration.current,
    currentPosition,
    seekTo,
    onDownloadRequested: scheduleMediaStatusRefresh,
  })

  const queue = createPodcastPlayerQueue({
    state,
    queue: podcastQueue,
    persistence,
    refreshPlaybackContext,
    loadEpisode,
  })

  teardown.push(podcastQueue.subscribe(queue.scheduleQueueContextRefresh))
  teardown.push(
    podcastEvents.onDownloadProgress((event) => {
      if (episode.value?.id !== event.episodeId) return
      episode.value = { ...episode.value, mediaStatus: event.status }
      downloadProgress.value = { receivedBytes: event.receivedBytes, totalBytes: event.totalBytes }
    }),
  )
  teardown.push(
    podcastEvents.onDownloadComplete((event) => {
      if (episode.value?.id !== event.episodeId) return
      episode.value = { ...episode.value, mediaStatus: event.mediaStatus, localSizeBytes: event.localSizeBytes }
      downloadProgress.value = null
    }),
  )
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPendingWrites)
    teardown.push(() => window.removeEventListener('pagehide', flushPendingWrites))
  }

  async function playInline(episodeId: number) {
    await loadEpisode(episodeId, true)
  }

  async function loadEpisode(episodeId: number, autoplay = false) {
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      error.value = t('podcast.errors.episodeNotFound')
      return
    }
    if (episode.value?.id === episodeId && audioEngine.loaded() && !error.value) {
      await refreshPlaybackContext().catch(() => undefined)
      if (autoplay && !audioEngine.playing()) {
        isAutoplayPending.value = true
        audioEngine.play()
      }
      return
    }

    const activeGeneration = loadGeneration.begin()
    await releasePlayer(false)
    isAutoplayPending.value = autoplay
    loading.value = true
    error.value = null
    try {
      // Bookmarks are supporting detail, so a failed read of them must not take the episode down
      // with it; the context is the only part of this that the player cannot open without.
      const [context, loadedBookmarks] = await Promise.all([
        apiJson<PodcastPlaybackContext>(`/api/v1/podcast-episodes/${episodeId}/playback-context`, undefined, 'podcast.errors.episodeNotFound'),
        apiJson<PodcastBookmark[]>(`/api/v1/podcast-episodes/${episodeId}/bookmarks`, undefined, 'podcast.errors.loadEpisode').catch(() => []),
      ])
      if (!loadGeneration.isCurrent(activeGeneration)) return
      // Only a finished episode starts over. A position at or past the declared duration used to
      // count as finished too, which threw away the place of anyone listening to a file that runs
      // longer than its feed claims, as any show with dynamically inserted ads does.
      const shouldRestart = context.episode.finished
      if (shouldRestart) {
        context.episode = { ...context.episode, positionSeconds: 0, progressPercent: 0 }
      }
      playbackContext.value = context
      episode.value = context.episode
      podcastEvents.subscribeLibrary(context.episode.libraryId)
      downloadProgress.value = null
      preferences.applyEpisodePlaybackRate(context.episode)
      // An end-of-chapter timer cannot survive an episode with no chapters. Dropping it silently
      // leaves someone who armed it expecting playback to stop listening on indefinitely, so the
      // cancellation is announced rather than just undone.
      if (sleepEndMode.value === 'chapter' && context.episode.chapters.length === 0) {
        sleepTimer.clear()
        void announce(t('podcast.announce.sleepChapterUnavailable'))
      }
      bookmarks.value = loadedBookmarks
      duration.value = context.episode.durationSeconds ?? 0
      currentTime.value = Math.max(0, context.episode.positionSeconds)
      loadStream(context.episode, activeGeneration, autoplay, shouldRestart)
      updateMediaSession()
      notifyEpisodeChange(context.episode.id)
      scheduleMediaStatusRefresh()
    } catch (reason) {
      if (loadGeneration.isCurrent(activeGeneration)) {
        isAutoplayPending.value = false
        error.value = describeFailure(reason, 'podcast.errors.loadEpisode')
      }
    } finally {
      if (loadGeneration.isCurrent(activeGeneration)) loading.value = false
    }
  }

  /**
   * Only text this feature authored is fit to render. A raw `TypeError` from a dropped connection
   * would otherwise reach the banner untranslated.
   */
  function describeFailure(reason: unknown, fallbackKey: string): string {
    return reason instanceof ApiError ? reason.message : t(fallbackKey)
  }

  async function refreshPlaybackContext() {
    const activeEpisode = episode.value
    if (!activeEpisode) return
    const activeGeneration = loadGeneration.current()
    const context = await apiJson<PodcastPlaybackContext>(
      `/api/v1/podcast-episodes/${activeEpisode.id}/playback-context`,
      undefined,
      'podcast.errors.refreshPlaybackContext',
    )
    if (!loadGeneration.isCurrent(activeGeneration) || episode.value?.id !== activeEpisode.id) return
    playbackContext.value = context
    episode.value = context.episode
    scheduleMediaStatusRefresh()
  }

  function loadStream(activeEpisode: PodcastEpisodeSummary, activeGeneration: number, autoplay: boolean, restartWhenPlayed: boolean) {
    let restartPending = restartWhenPlayed
    audioEngine.load({
      src: `/api/v1/podcast-episodes/${activeEpisode.id}/stream`,
      format: activeEpisode.audioFormat,
      rate: playbackRate.value,
      volume: volume.value,
      onLoad(loadedDuration) {
        if (!loadGeneration.isCurrent(activeGeneration) || !audioEngine.loaded()) return
        duration.value = loadedDuration || episode.value?.durationSeconds || 0
        const start = Math.min(currentTime.value, duration.value || currentTime.value)
        audioEngine.seek(start)
        if (autoplay) audioEngine.play()
      },
      onPlay() {
        if (!loadGeneration.isCurrent(activeGeneration)) return
        if (restartPending) {
          restartPending = false
          const positionSeconds = currentPosition()
          const total = duration.value || activeEpisode.durationSeconds || 0
          const progress = total > 0 ? Math.min(100, (positionSeconds / total) * 100) : 0
          if (episode.value?.id === activeEpisode.id) {
            episode.value = { ...episode.value, finished: false, positionSeconds, progressPercent: progress }
          }
          void persistence.queueStateWrite(activeEpisode.id, { finished: false, positionSeconds, progressPercent: progress })
        }
        isAutoplayPending.value = false
        isPlaying.value = true
        persistence.startListeningSession()
        // Read-aloud and the media overlay write the same global session, so whoever played last
        // owns the OS controls. Re-asserting on every play, not only on load, means resuming a
        // podcast after narration takes the lock screen back instead of leaving it on the book.
        updateMediaSession()
        updateMediaPlaybackState()
      },
      onPause() {
        if (loadGeneration.isCurrent(activeGeneration)) handlePlaybackStopped(false)
      },
      onStop() {
        if (loadGeneration.isCurrent(activeGeneration)) handlePlaybackStopped(false)
      },
      onEnd() {
        if (!loadGeneration.isCurrent(activeGeneration)) return
        currentTime.value = duration.value
        if (episode.value?.id === activeEpisode.id) {
          episode.value = { ...episode.value, finished: true, positionSeconds: duration.value, progressPercent: 100 }
        }
        handlePlaybackStopped(true)
        if (sleepTimer.handleEpisodeEnd()) return
        void queue.advanceAfterPlaybackEnd()
      },
      onLoadError() {
        if (loadGeneration.isCurrent(activeGeneration)) {
          isAutoplayPending.value = false
          isPlaying.value = false
          error.value = t('podcast.errors.streamUnavailable')
        }
      },
      onPlayError() {
        if (loadGeneration.isCurrent(activeGeneration)) {
          isAutoplayPending.value = false
          isPlaying.value = false
        }
      },
      onTick: handleTick,
    })
  }

  function togglePlayback() {
    audioEngine.togglePlayback()
  }

  /**
   * Hardware remotes, car heads and voice assistants send the literal action rather than a toggle,
   * so "play" while already playing has to stay playing. Only the in-app button toggles.
   */
  function resumePlayback() {
    if (!audioEngine.playing()) audioEngine.play()
  }

  function pausePlayback() {
    if (audioEngine.playing()) audioEngine.pause()
  }

  function seekTo(seconds: number) {
    if (!audioEngine.loaded()) return
    const upper = duration.value || episode.value?.durationSeconds || Number.POSITIVE_INFINITY
    const next = Math.max(0, Math.min(seconds, upper))
    audioEngine.seek(next)
    currentTime.value = next
    updateMediaPositionState()
  }

  function skipBackward() {
    seekTo(currentPosition() - skipBackwardSeconds.value)
  }

  function skipForward() {
    seekTo(currentPosition() + skipForwardSeconds.value)
  }

  function setSleepTimer(minutes: number) {
    sleepTimer.setTimer(minutes)
  }

  function extendSleepTimer(minutes = 5) {
    sleepTimer.extendTimer(minutes)
  }

  function setSleepAtEnd(mode: 'chapter' | 'episode') {
    sleepTimer.setAtEnd(mode, {
      chapters: episode.value?.chapters ?? [],
      activeChapterIndex: activeChapterIndex.value,
      duration: duration.value,
    })
  }

  function clearSleepTimer() {
    sleepTimer.clear()
  }

  function previousChapter() {
    const chapters = episode.value?.chapters ?? []
    const target = Math.max(0, activeChapterIndex.value - 1)
    if (activeChapterIndex.value >= 0) seekTo(chapters[target]?.startSeconds ?? 0)
  }

  function nextChapter() {
    const chapters = episode.value?.chapters ?? []
    if (activeChapterIndex.value >= 0 && activeChapterIndex.value < chapters.length - 1) seekTo(chapters[activeChapterIndex.value + 1]!.startSeconds)
  }

  function scheduleMediaStatusRefresh() {
    if (mediaStatusTimer) clearTimeout(mediaStatusTimer)
    mediaStatusTimer = null
    if (episode.value?.mediaStatus !== 'queued' && episode.value?.mediaStatus !== 'downloading') return
    if (podcastEvents.connected.value) return
    mediaStatusTimer = setTimeout(() => {
      void refreshPlaybackContext().catch(() => scheduleMediaStatusRefresh())
    }, MEDIA_STATUS_POLL_MS)
  }

  function handleTick(position: number) {
    currentTime.value = position
    sleepTimer.handlePosition(position)
    updateMediaPositionState()
    tickCount++
    if (tickCount >= TICKS_PER_STATE_WRITE) {
      tickCount = 0
      void persistState(false)
    }
  }

  function currentPosition() {
    return audioEngine.position(currentTime.value)
  }

  function handlePlaybackStopped(finished: boolean) {
    currentTime.value = finished ? duration.value || episode.value?.durationSeconds || currentPosition() : currentPosition()
    isAutoplayPending.value = false
    isPlaying.value = false
    tickCount = 0
    void persistState(finished)
    void closeListeningSession()
    updateMediaPlaybackState()
  }

  function persistState(finished: boolean): Promise<void> {
    const activeEpisode = episode.value
    if (!activeEpisode) return Promise.resolve()
    const positionSeconds = currentTime.value
    const total = duration.value || activeEpisode.durationSeconds || 0
    const progress = total > 0 ? Math.min(100, (positionSeconds / total) * 100) : 0
    return persistence.queueStateWrite(activeEpisode.id, {
      positionSeconds,
      progressPercent: progress,
      ...(finished ? { finished: true } : activeEpisode.finished ? {} : { finished: false }),
    })
  }

  function closeListeningSession(): Promise<void> {
    return persistence.closeListeningSession(episode.value?.id ?? null, currentTime.value)
  }

  /**
   * Progress is only written every thirtieth tick, so leaving the page mid-episode would drop up
   * to fifteen seconds of it. Both writes already set keepalive; they just have to be issued
   * before the page goes away.
   */
  function flushPendingWrites() {
    persistence.flushPreferenceWrites()
    if (!episode.value) return
    currentTime.value = currentPosition()
    void persistState(false)
  }

  async function clearPlayer() {
    await releasePlayer()
    await persistence.waitForPreferenceWrites()
    clearSleepTimer()
    mediaSession.clear()
    resetEpisodeState()
  }

  async function resetForUserChange() {
    preferences.resetPreferences()
    persistence.invalidatePlaybackWrites()
    await releasePlayer(true, false)
    clearSleepTimer()
    mediaSession.clear()
    resetEpisodeState()
  }

  function resetEpisodeState() {
    episode.value = null
    playbackContext.value = null
    bookmarks.value = []
    bookmarkTitle.value = ''
    bookmarkNote.value = ''
    duration.value = 0
    currentTime.value = 0
    downloadProgress.value = null
    error.value = null
  }

  async function releasePlayer(invalidate = true, persist = true) {
    if (invalidate) loadGeneration.invalidate()
    let pendingState = Promise.resolve()
    if (episode.value && persist && !episode.value.finished) {
      currentTime.value = currentPosition()
      pendingState = persistState(false)
    }
    const pendingSession = persist ? closeListeningSession() : Promise.resolve()
    if (!persist) {
      persistence.discardListeningSession()
    }
    tickCount = 0
    if (mediaStatusTimer) clearTimeout(mediaStatusTimer)
    mediaStatusTimer = null
    audioEngine.dispose()
    isAutoplayPending.value = false
    isPlaying.value = false
    await Promise.all([pendingState, pendingSession])
  }

  function subscribeToEpisodeChanges(listener: (episodeId: number) => void) {
    episodeChangeListeners.add(listener)
    return () => episodeChangeListeners.delete(listener)
  }

  function notifyEpisodeChange(episodeId: number) {
    for (const listener of episodeChangeListeners) listener(episodeId)
  }

  function updateMediaSession() {
    if (!episode.value) return
    mediaSession.updateEpisode(episode.value, {
      play: resumePlayback,
      pause: pausePlayback,
      seekBackward: skipBackward,
      seekForward: skipForward,
      seekTo,
      stop: () => void clearPlayer(),
      previous: () => void queue.playPrevious(),
      next: () => void queue.playNext(),
    })
  }

  function updateMediaPlaybackState() {
    mediaSession.updatePlaybackState(isPlaying.value)
  }

  function updateMediaPositionState() {
    mediaSession.updatePositionState({
      duration: duration.value,
      playbackRate: playbackRate.value,
      currentTime: currentTime.value,
    })
  }

  /** Unwinds everything the player registered outside its own state: listeners, timers, audio focus. */
  function dispose() {
    for (const stop of teardown.splice(0)) stop()
    if (mediaStatusTimer) clearTimeout(mediaStatusTimer)
    mediaStatusTimer = null
    sleepTimer.clear()
    mediaSession.clear()
    audioEngine.dispose()
    episodeChangeListeners.clear()
  }

  return {
    episode,
    bookmarks,
    loading,
    error,
    isPlaying,
    isAutoplayPending,
    isBuffering,
    bufferedRanges,
    currentTime,
    duration,
    playbackRate,
    volume,
    hasPlaybackRateOverride,
    skipBackwardSeconds,
    skipForwardSeconds,
    bookmarkTitle,
    bookmarkNote,
    progressPercent,
    previousQueueItem,
    nextQueueItem,
    upcomingQueueItems,
    queuePosition,
    queueTotal,
    navigationSource,
    sleepRemainingSeconds,
    sleepEndMode,
    sleepTimerMinutes,
    activeChapterIndex,
    loadEpisode,
    playInline,
    togglePlayback,
    seekTo,
    setPlaybackRate: preferences.setPlaybackRate,
    cyclePlaybackRate: preferences.cycleRate,
    stepPlaybackRate: preferences.stepRate,
    clearPlaybackRateOverride: preferences.clearPlaybackRateOverride,
    setVolume: preferences.setVolume,
    toggleMute: preferences.toggleMute,
    loadPreferences: preferences.loadPreferences,
    resetPreferences: preferences.resetPreferences,
    skipBackward,
    skipForward,
    setSleepTimer,
    setSleepAtEnd,
    extendSleepTimer,
    clearSleepTimer,
    previousChapter,
    nextChapter,
    markPlayed: actions.markPlayed,
    restartEpisode: actions.restartEpisode,
    togglePinned: actions.togglePinned,
    createBookmark: actions.createBookmark,
    updateBookmark: actions.updateBookmark,
    deleteBookmark: actions.deleteBookmark,
    requestDownload: actions.requestDownload,
    removeDownload: actions.removeDownload,
    addToQueue: queue.addToQueue,
    queueEpisodeNext: queue.queueEpisodeNext,
    removeFromQueue: queue.removeFromQueue,
    playPrevious: queue.playPrevious,
    playNext: queue.playNext,
    clearPlayer,
    resetForUserChange,
    subscribeToEpisodeChanges,
    dispose,
  }
}

export type PodcastPlayer = ReturnType<typeof createPodcastPlayer>

let player: PodcastPlayer | null = null

export function usePodcastPlayer(): PodcastPlayer {
  player ??= createPodcastPlayer()
  return player
}

/**
 * An HMR edit would otherwise leave the previous module's Howl playing and its listeners registered,
 * with no way to reach either.
 */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    player?.dispose()
    player = null
  })
}

/** Drops the singleton so the next `usePodcastPlayer()` builds a clean one. Tests only. */
export function __resetPodcastPlayerForTests(): void {
  player?.dispose()
  player = null
}
