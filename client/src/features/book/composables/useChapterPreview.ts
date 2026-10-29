import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { AudiobookManifest, AudiobookManifestAsset } from '@bookorbit/types'
import { apiJson, errorMessage } from '@/lib/api-json'
import { registerAudioFocusOwner, releaseAudioFocusOwner, requestAudioFocus } from '@/lib/audio-focus'
import { useAudioQueue } from '@/features/reader/audiobook/composables/useAudioQueue'

/** How much lead-in and run-on a boundary preview plays around a chapter start. */
export const BOUNDARY_PREVIEW = { beforeMs: 3_000, afterMs: 5_000 }

const TICK_MS = 100

/**
 * A player for checking chapter boundaries without leaving the editor. It streams the same assets
 * as the reader, maps book time onto (track, offset), and never reports listening progress.
 */
export function useChapterPreview(bookId: Ref<number>) {
  const isPlaying = ref(false)
  const positionMs = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** True while the audio playing is a few seconds around a cut rather than the book. */
  const windowed = ref(false)
  const previewingCut = computed(() => isPlaying.value && windowed.value)

  let queue: ReturnType<typeof useAudioQueue> | null = null
  let assets: AudiobookManifestAsset[] = []
  let queueBookId: number | null = null
  let stopAtMs: number | null = null
  /** Where a boundary preview leaves the playhead when it runs out: on the cut, not past it. */
  let returnToMs: number | null = null
  let parkedMs: number | null = null
  let ticker: ReturnType<typeof setInterval> | null = null
  let stopWatch: (() => void) | null = null
  let stopErrorWatch: (() => void) | null = null
  let generation = 0
  let disposed = false
  let initialization: Promise<ReturnType<typeof useAudioQueue> | null> | null = null

  registerAudioFocusOwner('chapter-preview', pause)

  function assetStartMs(index: number): number {
    return assets.slice(0, index).reduce((sum, asset) => sum + (asset.durationMs ?? 0), 0)
  }

  function locate(ms: number): { index: number; offsetSeconds: number } {
    let elapsed = 0
    for (const [index, asset] of assets.entries()) {
      const duration = asset.durationMs ?? 0
      if (index === assets.length - 1 || ms < elapsed + duration) return { index, offsetSeconds: Math.max(0, ms - elapsed) / 1000 }
      elapsed += duration
    }
    return { index: 0, offsetSeconds: 0 }
  }

  function ensureQueue(): Promise<ReturnType<typeof useAudioQueue> | null> {
    if (disposed) return Promise.resolve(null)
    if (queue && queueBookId === bookId.value) return Promise.resolve(queue)
    if (initialization) return initialization
    teardown()
    const token = generation
    const id = bookId.value
    loading.value = true
    error.value = null
    const pending = (async () => {
      try {
        const manifest = await apiJson<AudiobookManifest>(`/api/v1/audiobooks/${id}/manifest`, undefined, 'book.detail.chapters.errors.preview')
        if (disposed || token !== generation || id !== bookId.value) return null
        assets = manifest.assets
        queueBookId = id
        queue = useAudioQueue(
          id,
          assets.map((asset) => ({ assetId: asset.assetId, format: asset.format, durationMs: asset.durationMs })),
          handleFileEnd,
        )
        stopWatch = watch(queue.isPlaying, (playing) => {
          isPlaying.value = playing
          if (playing) startTicker()
          else stopTicker()
        })
        stopErrorWatch = watch(queue.loadError, (reason) => {
          if (reason) {
            error.value = errorMessage(reason, 'book.detail.chapters.errors.preview')
            pause()
          }
        })
        return queue
      } catch (reason) {
        if (token === generation) error.value = errorMessage(reason, 'book.detail.chapters.errors.preview')
        return null
      } finally {
        if (token === generation) {
          loading.value = false
          initialization = null
        }
      }
    })()
    initialization = pending
    return pending
  }

  function handleFileEnd(assetId: string): void {
    const index = assets.findIndex((asset) => asset.assetId === assetId)
    if (!queue || index < 0) return
    if (index >= assets.length - 1 || (stopAtMs !== null && assetStartMs(index + 1) >= stopAtMs)) {
      runOut()
      return
    }
    queue.activateIndex(index + 1, 0)
    queue.play()
  }

  function readPosition(): number {
    if (!queue) return positionMs.value
    return assetStartMs(queue.currentIndex.value) + Math.round(queue.position() * 1000)
  }

  function startTicker(): void {
    if (ticker) return
    ticker = setInterval(() => {
      positionMs.value = readPosition()
      if (stopAtMs !== null && positionMs.value >= stopAtMs) runOut()
    }, TICK_MS)
  }

  function stopTicker(): void {
    if (!ticker) return
    clearInterval(ticker)
    ticker = null
    positionMs.value = parkedMs ?? readPosition()
    parkedMs = null
  }

  async function playFrom(ms: number, options: { stopAtMs?: number; returnToMs?: number } = {}): Promise<void> {
    const active = await ensureQueue()
    if (!active || disposed || active !== queue) return
    const { index, offsetSeconds } = locate(Math.max(0, ms))
    stopAtMs = options.stopAtMs ?? null
    returnToMs = options.returnToMs ?? null
    windowed.value = stopAtMs !== null
    parkedMs = null
    requestAudioFocus('chapter-preview')
    active.activateIndex(index, offsetSeconds)
    positionMs.value = Math.max(0, ms)
    active.play()
  }

  /** Plays a few seconds either side of a chapter start, then stops with the playhead back on that start. */
  function playAround(ms: number): Promise<void> {
    return playFrom(Math.max(0, ms - BOUNDARY_PREVIEW.beforeMs), { stopAtMs: ms + BOUNDARY_PREVIEW.afterMs, returnToMs: ms })
  }

  /** A pause the listener asked for keeps the playhead where it stopped. */
  function pause(): void {
    stopAtMs = null
    returnToMs = null
    windowed.value = false
    queue?.pause()
  }

  function runOut(): void {
    const target = returnToMs
    if (target === null) pause()
    else park(target)
  }

  /** Stops whatever is playing and leaves the playhead at `ms`, even if the queue reports its pause late. */
  function park(ms: number): void {
    const target = Math.max(0, ms)
    pause()
    parkedMs = ticker ? target : null
    positionMs.value = target
  }

  async function toggle(): Promise<void> {
    if (isPlaying.value) pause()
    else await playFrom(positionMs.value)
  }

  /** Moves the playhead; keeps playing if it was, otherwise just parks it there. */
  async function seek(ms: number): Promise<void> {
    const target = Math.max(0, ms)
    if (isPlaying.value) await playFrom(target)
    else {
      parkedMs = null
      positionMs.value = target
    }
  }

  function teardown(): void {
    generation += 1
    initialization = null
    loading.value = false
    stopErrorWatch?.()
    stopErrorWatch = null
    stopTicker()
    stopWatch?.()
    stopWatch = null
    queue?.destroy()
    queue = null
    queueBookId = null
    isPlaying.value = false
    stopAtMs = null
    returnToMs = null
    parkedMs = null
  }

  onScopeDispose(() => {
    disposed = true
    teardown()
    releaseAudioFocusOwner('chapter-preview')
  })

  return { isPlaying, previewingCut, positionMs, loading, error, playFrom, playAround, pause, park, toggle, seek, teardown }
}
