import { ref } from 'vue'
import { api } from '@/lib/api'

interface SaveSessionParams {
  bookFileId: number
  sessionId: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  progressDelta: number | null
  endProgress: number | null
}

export function useTtsReadingSession() {
  const sessionId = ref<string | null>(null)
  const sessionStartedAt = ref<Date | null>(null)

  function generateSessionId(): string {
    return `tts-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }

  function startSession() {
    sessionId.value = generateSessionId()
    sessionStartedAt.value = new Date()
  }

  async function endSession(params: Omit<SaveSessionParams, 'sessionId' | 'startedAt'>) {
    if (!sessionId.value || !sessionStartedAt.value) return
    const endedAt = params.endedAt
    const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - sessionStartedAt.value.getTime()) / 1000))
    if (durationSeconds < 10) return

    try {
      await api(`/api/v1/books/files/${params.bookFileId}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: sessionId.value,
          startedAt: sessionStartedAt.value.toISOString(),
          endedAt: endedAt.toISOString(),
          durationSeconds,
          progressDelta: params.progressDelta,
          endProgress: params.endProgress,
          sessionType: 'tts',
        }),
      })
    } catch {
      // session save failure is non-fatal
    } finally {
      sessionId.value = null
      sessionStartedAt.value = null
    }
  }

  return {
    sessionId,
    sessionStartedAt,
    startSession,
    endSession,
  }
}
