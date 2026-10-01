import { onUnmounted, ref, unref, type MaybeRef } from 'vue'
import type { AudiobookManifestAsset, AudiobookPlaybackState } from '@bookorbit/types'
import { api } from '@/lib/api'
import { createUuid } from '@/lib/uuid'

const SAVE_THROTTLE_MS = 5_000

export interface AudioProgressOptions {
  trackingEnabled?: MaybeRef<boolean>
  manifestRevision: MaybeRef<string>
  assets?: MaybeRef<Pick<AudiobookManifestAsset, 'assetId' | 'durationMs'>[]>
  onManifestStale?: () => void
}

interface PendingWrite {
  assetId: string
  positionMs: number
  capturedAt: string
  operationId: string
}

export function useAudioProgress(bookId: number, options: AudioProgressOptions) {
  const resumeAssetId = ref<string | null>(null)
  const resumePosition = ref(0)
  const revision = ref(0)
  const loaded = ref(false)
  const trackingEnabled = options.trackingEnabled ?? true
  const url = `/api/v1/audiobooks/${bookId}/playback-state`

  let pending: PendingWrite | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saving = false
  let staleManifestRevision: string | null = null

  function applyState(state: AudiobookPlaybackState | null) {
    revision.value = state?.revision ?? 0
    resumeAssetId.value = state?.assetId ?? null
    resumePosition.value = (state?.positionMs ?? 0) / 1000
  }

  async function load() {
    if (!unref(trackingEnabled)) {
      loaded.value = true
      return
    }
    const res = await api(url)
    // Mark loaded regardless of response so callers can distinguish
    // "load attempted" from "load not yet called".
    loaded.value = true
    if (!res.ok) return
    applyState(await res.json())
  }

  function scheduleFlush() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void flushIfDirty()
    }, SAVE_THROTTLE_MS)
  }

  function update(assetId: string, positionSeconds: number) {
    if (!unref(trackingEnabled)) return
    pending = {
      assetId,
      positionMs: Math.max(0, Math.round(positionSeconds * 1000)),
      capturedAt: new Date().toISOString(),
      operationId: createUuid(),
    }
    scheduleFlush()
  }

  function settle(write: PendingWrite) {
    if (pending === write) pending = null
  }

  function clampToAsset(write: PendingWrite): number {
    const durationMs = unref(options.assets)?.find((asset) => asset.assetId === write.assetId)?.durationMs
    return typeof durationMs === 'number' ? Math.min(write.positionMs, durationMs) : write.positionMs
  }

  async function flushIfDirty() {
    if (!unref(trackingEnabled)) return
    const write = pending
    if (write === null || saving) return
    const manifestRevision = unref(options.manifestRevision)
    // A 412 means this manifest is gone; hold the write until the view loads the new one.
    if (manifestRevision === staleManifestRevision) return
    const body = JSON.stringify({
      assetId: write.assetId,
      positionMs: clampToAsset(write),
      capturedAt: write.capturedAt,
      operationId: write.operationId,
      baseRevision: revision.value,
      manifestRevision,
    })
    saving = true
    try {
      const res = await api(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (res.ok) {
        applyState(await res.json())
        settle(write)
      } else if (res.status === 409) {
        const current = await api(url)
        if (!current.ok) return
        const server = (await current.json()) as AudiobookPlaybackState | null
        applyState(server)
        if (server && Date.parse(server.capturedAt) >= Date.parse(write.capturedAt)) settle(write)
      } else if (res.status === 412) {
        staleManifestRevision = manifestRevision
        options.onManifestStale?.()
      } else if (res.status < 500 && res.status !== 429) {
        settle(write)
      }
    } catch {
      // Network failure: keep the write and retry it with the same operationId.
    } finally {
      saving = false
      if (pending !== null && unref(options.manifestRevision) !== staleManifestRevision) scheduleFlush()
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
