import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const mocks = vi.hoisted(() => ({
  apiJson: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  requestAudioFocus: vi.fn<(owner: string) => void>(),
  onEnd: null as null | ((id: string) => void),
  queue: null as null | {
    currentIndex: { value: number }
    isPlaying: { value: boolean }
    loadError: { value: string | null }
    activateIndex: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    position: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
  },
}))

vi.mock('@/lib/api-json', () => ({
  apiJson: mocks.apiJson,
  errorMessage: (_reason: unknown, key: string) => key,
}))

vi.mock('@/lib/audio-focus', () => ({
  registerAudioFocusOwner: vi.fn<(owner: string, pause: () => void) => void>(),
  releaseAudioFocusOwner: vi.fn<(owner: string) => void>(),
  requestAudioFocus: mocks.requestAudioFocus,
}))

vi.mock('@/features/reader/audiobook/composables/useAudioQueue', async () => {
  const { ref: vueRef } = await import('vue')
  return {
    useAudioQueue: (_bookId: number, _assets: unknown, onEnd: (id: string) => void) => {
      mocks.onEnd = onEnd
      const queue = {
        currentIndex: vueRef(0),
        isPlaying: vueRef(false),
        loadError: vueRef<string | null>(null),
        activateIndex: vi.fn<(index: number, seconds: number) => void>((index: number) => {
          queue.currentIndex.value = index
        }),
        play: vi.fn<() => void>(() => {
          queue.isPlaying.value = true
        }),
        pause: vi.fn<() => void>(() => {
          queue.isPlaying.value = false
        }),
        position: vi.fn<() => number>(() => 0),
        destroy: vi.fn<() => void>(),
      }
      mocks.queue = queue
      return queue
    },
  }
})

import { useChapterPreview } from '../useChapterPreview'

const MANIFEST = {
  assets: [
    { assetId: 'aud_a', format: 'mp3', durationMs: 60_000 },
    { assetId: 'aud_b', format: 'mp3', durationMs: 90_000 },
  ],
}

describe('useChapterPreview', () => {
  beforeEach(() => {
    mocks.queue = null
    vi.useFakeTimers()
    mocks.apiJson.mockResolvedValue(MANIFEST)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  function setup() {
    const scope = effectScope()
    const preview = scope.run(() => useChapterPreview(ref(7)))!
    return { preview, scope }
  }

  it('maps a book position onto the track that holds it and claims audio focus', async () => {
    const { preview, scope } = setup()

    await preview.playFrom(75_000)

    expect(mocks.apiJson).toHaveBeenCalledWith('/api/v1/audiobooks/7/manifest', undefined, 'book.detail.chapters.errors.preview')
    expect(mocks.queue!.activateIndex).toHaveBeenCalledWith(1, 15)
    expect(mocks.requestAudioFocus).toHaveBeenCalledWith('chapter-preview')
    expect(preview.isPlaying.value).toBe(true)
    scope.stop()
  })

  it('plays a few seconds either side of a boundary and stops by itself', async () => {
    const { preview, scope } = setup()

    await preview.playAround(70_000)
    expect(mocks.queue!.activateIndex).toHaveBeenCalledWith(1, 7)
    expect(preview.previewingCut.value).toBe(true)

    mocks.queue!.position.mockReturnValue(14.9)
    vi.advanceTimersByTime(100)
    expect(mocks.queue!.pause).not.toHaveBeenCalled()

    mocks.queue!.position.mockReturnValue(15.2)
    vi.advanceTimersByTime(100)
    expect(mocks.queue!.pause).toHaveBeenCalled()
    expect(preview.positionMs.value).toBe(70_000)
    await nextTick()
    expect(preview.isPlaying.value).toBe(false)
    expect(preview.previewingCut.value).toBe(false)
    expect(preview.positionMs.value).toBe(70_000)
    scope.stop()
  })

  it('keeps the playhead where the listener paused a boundary preview', async () => {
    const { preview, scope } = setup()

    await preview.playAround(70_000)
    mocks.queue!.position.mockReturnValue(11.4)
    vi.advanceTimersByTime(100)
    preview.pause()
    await nextTick()

    expect(preview.positionMs.value).toBe(71_400)
    scope.stop()
  })

  it('stops whatever plays and parks the playhead, even when the queue reports its pause late', async () => {
    const { preview, scope } = setup()
    await preview.playFrom(10_000)
    mocks.queue!.position.mockReturnValue(4)
    vi.advanceTimersByTime(100)
    mocks.queue!.pause.mockImplementationOnce(() => {})

    preview.park(42_000)
    expect(mocks.queue!.pause).toHaveBeenCalled()
    expect(preview.positionMs.value).toBe(42_000)

    mocks.queue!.isPlaying.value = false
    await nextTick()
    expect(preview.isPlaying.value).toBe(false)
    expect(preview.positionMs.value).toBe(42_000)
    scope.stop()
  })

  it('parks the playhead without loading audio until something plays', async () => {
    const { preview, scope } = setup()

    await preview.seek(12_345)

    expect(preview.positionMs.value).toBe(12_345)
    expect(mocks.apiJson).not.toHaveBeenCalled()
    scope.stop()
    expect(mocks.queue).toBeNull()
  })

  it('tears the queue down with its scope', async () => {
    const { preview, scope } = setup()
    await preview.playFrom(0)

    scope.stop()

    expect(mocks.queue!.destroy).toHaveBeenCalled()
  })
  it('shares pending initialization between play commands', async () => {
    const { preview, scope } = setup()
    let resolve!: (value: unknown) => void
    mocks.apiJson.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const first = preview.playFrom(1000)
    const second = preview.playFrom(2000)
    expect(mocks.apiJson).toHaveBeenCalledTimes(1)
    resolve(MANIFEST)
    await Promise.all([first, second])
    scope.stop()
  })
  it('does not create a queue after its scope is disposed during initialization', async () => {
    const { preview, scope } = setup()
    let resolve!: (value: unknown) => void
    mocks.apiJson.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const playing = preview.playFrom(1000)
    scope.stop()
    resolve(MANIFEST)
    await playing
    expect(mocks.queue).toBeNull()
  })
  it('settles at final EOF and surfaces queue errors', async () => {
    const { preview, scope } = setup()
    await preview.playFrom(0)
    mocks.onEnd!('aud_b')
    expect(mocks.queue!.pause).toHaveBeenCalled()
    mocks.queue!.loadError.value = 'Stream failed'
    await Promise.resolve()
    expect(preview.error.value).toBe('book.detail.chapters.errors.preview')
    scope.stop()
  })
})
