import { ref } from 'vue'
import * as ttsApi from '../api/tts.api'
import type { TtsPosition } from '../api/tts.api'

interface PendingSave extends TtsPosition {
  bookFileId: number
}

export function useTtsPosition() {
  const savedPosition = ref<TtsPosition | null>(null)
  const hasSavedPosition = ref(false)
  let pendingSave: PendingSave | null = null
  let saveInFlight: Promise<void> | null = null

  async function loadPosition(bookFileId: number) {
    try {
      savedPosition.value = await ttsApi.getPosition(bookFileId)
      hasSavedPosition.value = savedPosition.value !== null
    } catch {
      savedPosition.value = null
      hasSavedPosition.value = false
    }
  }

  function samePosition(a: TtsPosition | null, b: TtsPosition): boolean {
    return !!a && a.cfi === b.cfi && a.chapterIndex === b.chapterIndex
  }

  function samePendingSave(a: PendingSave | null, b: PendingSave): boolean {
    return !!a && a.bookFileId === b.bookFileId && a.cfi === b.cfi && a.chapterIndex === b.chapterIndex
  }

  async function processPendingSave() {
    if (saveInFlight || !pendingSave) return

    const next = pendingSave
    pendingSave = null

    saveInFlight = (async () => {
      try {
        await ttsApi.savePosition(next.bookFileId, { cfi: next.cfi, chapterIndex: next.chapterIndex })
        savedPosition.value = { cfi: next.cfi, chapterIndex: next.chapterIndex }
        hasSavedPosition.value = true
      } catch {
        // position save failure is non-fatal
      }
    })()

    try {
      await saveInFlight
    } finally {
      saveInFlight = null
      if (pendingSave) void processPendingSave()
    }
  }

  function scheduleSave(bookFileId: number, cfi: string, chapterIndex: number | null) {
    const next: PendingSave = { bookFileId, cfi, chapterIndex }
    if (samePendingSave(pendingSave, next)) return
    if (!pendingSave && samePosition(savedPosition.value, next)) return
    pendingSave = next
    // Keep local resume marker in sync with playback immediately so stopping
    // playback does not briefly jump back to an older saved sentence.
    savedPosition.value = { cfi: next.cfi, chapterIndex: next.chapterIndex }
    hasSavedPosition.value = true
    void processPendingSave()
  }

  async function savePositionNow(bookFileId: number, cfi: string, chapterIndex: number | null) {
    scheduleSave(bookFileId, cfi, chapterIndex)
    await flushPendingSave()
  }

  async function flushPendingSave() {
    while (pendingSave || saveInFlight) {
      if (!saveInFlight && pendingSave) {
        await processPendingSave()
        continue
      }
      if (saveInFlight) {
        await saveInFlight
      }
    }
  }

  async function clearPosition(bookFileId: number) {
    pendingSave = null
    if (saveInFlight) await saveInFlight
    await ttsApi.deletePosition(bookFileId)
    savedPosition.value = null
    hasSavedPosition.value = false
  }

  function cleanup() {
    pendingSave = null
  }

  return {
    savedPosition,
    hasSavedPosition,
    loadPosition,
    scheduleSave,
    savePositionNow,
    flushPendingSave,
    clearPosition,
    cleanup,
  }
}
