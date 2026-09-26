import type { PodcastPlaybackPreferences } from '@bookorbit/types'
import { api } from '@/lib/api'

type ApiRequest = (url: string, init?: RequestInit) => Promise<Response>

/**
 * A volume drag and a held keyboard step both change the level continuously, and only the value
 * the user settles on is worth a write. Preferences are small and idempotent, so the whole set is
 * coalesced rather than just the level.
 */
const PREFERENCE_WRITE_DEBOUNCE_MS = 400

export function createPodcastPlayerPersistence(request: ApiRequest = api) {
  let stateWrite = Promise.resolve()
  let preferenceWrite = Promise.resolve()
  let sessionWrite = Promise.resolve()
  let preferenceGeneration = 0
  let playbackGeneration = 0
  let playStartedAt: Date | null = null
  let sessionId: string | null = null
  let pendingPreferences: PodcastPlaybackPreferences | null = null
  let preferenceDebounceTimer: ReturnType<typeof setTimeout> | null = null

  function preferenceLoadGeneration(): number {
    return preferenceGeneration
  }

  function isPreferenceGenerationCurrent(generation: number): boolean {
    return generation === preferenceGeneration
  }

  function invalidatePreferenceWrites() {
    preferenceGeneration++
    discardPendingPreferenceWrite()
  }

  function queuePreferenceWrite(settings: PodcastPlaybackPreferences) {
    pendingPreferences = settings
    if (preferenceDebounceTimer) clearTimeout(preferenceDebounceTimer)
    preferenceDebounceTimer = setTimeout(flushPreferenceWrites, PREFERENCE_WRITE_DEBOUNCE_MS)
  }

  /** Issues the settled preferences immediately; safe to call when nothing is waiting. */
  function flushPreferenceWrites() {
    if (preferenceDebounceTimer) clearTimeout(preferenceDebounceTimer)
    preferenceDebounceTimer = null
    const settings = pendingPreferences
    if (!settings) return
    pendingPreferences = null
    const activeGeneration = preferenceGeneration
    preferenceWrite = preferenceWrite
      .then(async () => {
        if (activeGeneration !== preferenceGeneration) return
        await request('/api/v1/user-preferences/podcast-playback', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings }),
        })
      })
      .catch(() => undefined)
  }

  function discardPendingPreferenceWrite() {
    if (preferenceDebounceTimer) clearTimeout(preferenceDebounceTimer)
    preferenceDebounceTimer = null
    pendingPreferences = null
  }

  function queueStateWrite(episodeId: number, payload: Record<string, unknown>): Promise<void> {
    const activeGeneration = playbackGeneration
    const capturedAt = new Date().toISOString()
    stateWrite = stateWrite
      .then(async () => {
        if (activeGeneration !== playbackGeneration) return
        await request(`/api/v1/podcast-episodes/${episodeId}/state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, capturedAt }),
          keepalive: true,
        })
      })
      .catch(() => undefined)
    return stateWrite
  }

  function startListeningSession(startedAt = new Date(), activeSessionId: string = crypto.randomUUID()) {
    playStartedAt = startedAt
    sessionId = activeSessionId
  }

  function closeListeningSession(episodeId: number | null, endPositionSeconds: number): Promise<void> {
    const startedAt = playStartedAt
    const currentSessionId = sessionId
    playStartedAt = null
    sessionId = null
    if (!episodeId || !startedAt || !currentSessionId) return Promise.resolve()
    const endedAt = new Date()
    if (endedAt.getTime() - startedAt.getTime() < 1_000) return Promise.resolve()
    const activeGeneration = playbackGeneration
    sessionWrite = sessionWrite
      .then(async () => {
        if (activeGeneration !== playbackGeneration) return
        await request(`/api/v1/podcast-episodes/${episodeId}/sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: currentSessionId,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            endPositionSeconds,
          }),
          keepalive: true,
        })
      })
      .catch(() => undefined)
    return sessionWrite
  }

  function discardListeningSession() {
    playStartedAt = null
    sessionId = null
  }

  function invalidatePlaybackWrites() {
    playbackGeneration++
    discardListeningSession()
  }

  async function waitForStateWrites() {
    await stateWrite.catch(() => undefined)
  }

  async function waitForPreferenceWrites() {
    flushPreferenceWrites()
    await preferenceWrite.catch(() => undefined)
  }

  return {
    preferenceLoadGeneration,
    isPreferenceGenerationCurrent,
    invalidatePreferenceWrites,
    queuePreferenceWrite,
    flushPreferenceWrites,
    queueStateWrite,
    startListeningSession,
    closeListeningSession,
    discardListeningSession,
    invalidatePlaybackWrites,
    waitForStateWrites,
    waitForPreferenceWrites,
  }
}
