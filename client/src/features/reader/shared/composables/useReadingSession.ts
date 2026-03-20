import { onUnmounted } from 'vue'
import { api } from '@/lib/api'

export interface ProgressSnapshot {
  percentage: number
  cfi?: string | null
  pageNumber?: number | null
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const MIN_SESSION_MS = 10 * 1000

function generateSessionId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function useReadingSession(bookFileId: number, getProgress: () => ProgressSnapshot) {
  let sessionId = generateSessionId()
  let startedAt: Date | null = null
  let activeMs = 0
  let activeStart: number | null = null
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let startProgress: number | null = null
  let ended = false

  function startSession() {
    startedAt = new Date()
    activeStart = Date.now()
    activeMs = 0
    ended = false
    startProgress = getProgress().percentage
    resetIdleTimer()
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
    // No active session or previous session ended (e.g. after idle timeout) — start fresh.
    if (!startedAt || ended) {
      sessionId = generateSessionId()
      startSession()
      return
    }
    if (activeStart === null) resumeTimer()
    resetIdleTimer()
  }

  function endSession(useBeacon = false) {
    if (ended || !startedAt) return
    ended = true
    clearIdleTimer()

    if (activeStart !== null) {
      activeMs += Date.now() - activeStart
      activeStart = null
    }

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
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('beforeunload', onBeforeUnload)
  })

  return { onActivity, endSession }
}
