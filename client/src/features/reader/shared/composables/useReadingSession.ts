import { onUnmounted, ref, unref, type MaybeRef } from 'vue'
import { api } from '@/lib/api'
import { createUuid } from '@/lib/uuid'

export interface ProgressSnapshot {
  percentage: number
  cfi?: string | null
  pageNumber?: number | null
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const MIN_SESSION_MS = 10 * 1000
const ELAPSED_UPDATE_INTERVAL_MS = 30 * 1000

export type ReadingSessionType = 'read' | 'tts' | 'listen'

export interface ReadingSessionOptions {
  trackingEnabled?: MaybeRef<boolean>
  sessionType?: ReadingSessionType
}

export function useReadingSession(bookFileId: number, getProgress: () => ProgressSnapshot, options: ReadingSessionOptions = {}) {
  let sessionId = createUuid()
  let startedAt: Date | null = null
  let activeMs = 0
  let activeStart: number | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let startProgress: number | null = null
  let ended = false

  const elapsedMinutes = ref(0)
  let elapsedInterval: ReturnType<typeof setInterval> | null = null
  const trackingEnabled = options.trackingEnabled ?? true

  function canTrack(): boolean {
    return unref(trackingEnabled)
  }

  function getActiveMs(): number {
    if (activeStart === null) return activeMs
    return activeMs + (Date.now() - activeStart)
  }

  function updateElapsed() {
    if (!startedAt || ended) {
      elapsedMinutes.value = 0
      return
    }
    elapsedMinutes.value = Math.floor(getActiveMs() / 60_000)
  }

  function startElapsedInterval() {
    stopElapsedInterval()
    elapsedInterval = setInterval(updateElapsed, ELAPSED_UPDATE_INTERVAL_MS)
  }

  function stopElapsedInterval() {
    if (elapsedInterval !== null) {
      clearInterval(elapsedInterval)
      elapsedInterval = null
    }
  }

  function startSession() {
    startedAt = new Date()
    activeStart = Date.now()
    activeMs = 0
    ended = false
    startProgress = getProgress().percentage
    resetIdleTimer()
    updateElapsed()
    startElapsedInterval()
  }

  function pauseTimer() {
    if (activeStart !== null) {
      activeMs += Date.now() - activeStart
      activeStart = null
    }
    clearIdleTimer()
  }

  function resumeTimer() {
    if (activeStart !== null) return
    activeStart = Date.now()
    resetIdleTimer()
  }

  function resetIdleTimer() {
    clearIdleTimer()
    idleTimer = setTimeout(endSession, IDLE_TIMEOUT_MS)
  }

  function clearIdleTimer() {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  function onActivity() {
    if (!canTrack()) return
    // No active session or previous session ended (e.g. after idle timeout) - start fresh.
    if (!startedAt || ended) {
      sessionId = createUuid()
      startSession()
      return
    }
    if (activeStart === null) resumeTimer()
    resetIdleTimer()
  }

  function endSession(useBeacon = false) {
    if (!canTrack()) {
      clearIdleTimer()
      stopElapsedInterval()
      startedAt = null
      activeStart = null
      activeMs = 0
      ended = true
      elapsedMinutes.value = 0
      return
    }
    if (ended || !startedAt) return
    ended = true
    clearIdleTimer()
    stopElapsedInterval()

    if (activeStart !== null) {
      activeMs += Date.now() - activeStart
      activeStart = null
    }

    elapsedMinutes.value = 0

    if (activeMs < MIN_SESSION_MS) return

    const endedAt = new Date()
    const snap = getProgress()
    const durationSeconds = Math.floor(activeMs / 1000)
    const progressDelta = startProgress !== null ? Number((snap.percentage - startProgress).toFixed(4)) : null
    const endProgress = snap.percentage

    const payload = JSON.stringify({
      sessionId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      durationSeconds,
      progressDelta,
      endProgress,
      ...(options.sessionType ? { sessionType: options.sessionType } : {}),
    })

    const url = `/api/v1/books/files/${bookFileId}/sessions`

    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
    } else {
      api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).catch(() => {})
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      pauseTimer()
    } else if (startedAt && !ended) {
      resumeTimer()
    }
  }

  function onBeforeUnload() {
    endSession(true)
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('beforeunload', onBeforeUnload)

  onUnmounted(() => {
    endSession()
    stopElapsedInterval()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('beforeunload', onBeforeUnload)
  })

  return { onActivity, endSession, elapsedMinutes }
}
