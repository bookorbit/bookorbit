import { onUnmounted, ref, unref, type MaybeRef } from 'vue'
import { api } from '@/lib/api'

const SAVE_THROTTLE_MS = 5_000

export interface AudioProgressOptions {
  trackingEnabled?: MaybeRef<boolean>
  manifestRevision: MaybeRef<string>
}

export function useAudioProgress(bookId: number, options: AudioProgressOptions) {
  const resumeAssetId = ref<string | null>(null)
  const resumePosition = ref(0)
  const revision = ref(0)
  const loaded = ref(false)
  const trackingEnabled = options.trackingEnabled ?? true

  let pendingAssetId: string | null = null
  let pendingPosition = 0
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let dirty = false
  let saving = false

  async function load() {
    if (!unref(trackingEnabled)) {
      loaded.value = true
      return
    }
    const res = await api(`/api/v1/audiobooks/${bookId}/playback-state`)
    // Mark loaded regardless of response so callers can distinguish
    // "load attempted" from "load not yet called".
    loaded.value = true
    if (!res.ok) return
    const data = await res.json()
    if (data) {
      resumeAssetId.value = data.assetId ?? null
      resumePosition.value = (data.positionMs ?? 0) / 1000
      revision.value = data.revision ?? 0
    }
  }

  function update(assetId: string, positionSeconds: number) {
    if (!unref(trackingEnabled)) return
    pendingAssetId = assetId
    pendingPosition = positionSeconds
    dirty = true

    if (!saveTimer) {
      saveTimer = setTimeout(() => {
        saveTimer = null
        flushIfDirty()
      }, SAVE_THROTTLE_MS)
    }
  }

  async function flushIfDirty() {
    if (!unref(trackingEnabled)) return
    if (!dirty || pendingAssetId === null || saving) return
    const assetId = pendingAssetId
    const positionMs = Math.max(0, Math.round(pendingPosition * 1000))
    const body = JSON.stringify({
      assetId,
      positionMs,
      capturedAt: new Date().toISOString(),
      operationId: crypto.randomUUID(),
      baseRevision: revision.value,
      manifestRevision: unref(options.manifestRevision),
    })
    dirty = false
    saving = true
    try {
      const res = await api(`/api/v1/audiobooks/${bookId}/playback-state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!res.ok) {
        dirty = true
        if (res.status === 409) await load()
        return
      }
      const state = await res.json()
      revision.value = state.revision
      resumeAssetId.value = state.assetId
      resumePosition.value = state.positionMs / 1000
    } catch {
      dirty = true
    } finally {
      saving = false
      if (dirty && !saveTimer) {
        saveTimer = setTimeout(() => {
          saveTimer = null
          void flushIfDirty()
        }, SAVE_THROTTLE_MS)
      }
    }
  }

  function flush() {
    if (!unref(trackingEnabled)) return
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    void flushIfDirty()
  }

  onUnmounted(flush)

  return { resumeAssetId, resumePosition, revision, loaded, load, update, flush }
}
