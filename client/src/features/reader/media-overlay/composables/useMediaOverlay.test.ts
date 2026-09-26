import { describe, expect, it, vi, beforeEach } from 'vitest'
import { useMediaOverlay } from './useMediaOverlay'
import type { FoliateMediaOverlay } from '@/features/reader/epub/composables/useFoliate'
import type { TtsCurrentBook } from '@/features/tts/lib/tts-state'

function makeFakeMediaOverlay() {
  const mo = new EventTarget() as FoliateMediaOverlay & {
    start: ReturnType<typeof vi.fn>
    pause: ReturnType<typeof vi.fn>
    resume: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    next: ReturnType<typeof vi.fn>
    prev: ReturnType<typeof vi.fn>
    setRate: ReturnType<typeof vi.fn>
    setVolume: ReturnType<typeof vi.fn>
  }
  mo.start = vi.fn<FoliateMediaOverlay['start']>().mockResolvedValue(true)
  mo.pause = vi.fn<() => void>()
  mo.resume = vi.fn<() => void>()
  mo.stop = vi.fn<() => void>()
  mo.next = vi.fn<() => void>()
  mo.prev = vi.fn<() => void>()
  mo.setRate = vi.fn<(rate: number) => void>()
  mo.setVolume = vi.fn<(volume: number) => void>()
  return mo
}

const book: TtsCurrentBook = {
  bookId: 1,
  bookFileId: 2,
  title: 'Test Book',
  author: 'Author',
  coverUrl: null,
  totalChapters: 5,
}

describe('useMediaOverlay', () => {
  beforeEach(() => {
    useMediaOverlay().stop()
  })

  it('start activates playback, applies rate/volume and invokes the start fn', () => {
    const mo = makeFakeMediaOverlay()
    const startFn = vi.fn<() => void>()
    const player = useMediaOverlay()

    player.start(mo, startFn, book)

    expect(player.isActive.value).toBe(true)
    expect(player.isPlaying.value).toBe(true)
    expect(player.currentBook.value).toEqual(book)
    expect(mo.setRate).toHaveBeenCalledWith(player.rate.value)
    expect(mo.setVolume).toHaveBeenCalledWith(player.volume.value)
    expect(startFn).toHaveBeenCalledOnce()
  })

  it('returns the start function result', async () => {
    const mo = makeFakeMediaOverlay()
    const player = useMediaOverlay()
    const result = Promise.resolve('started')

    expect(player.start(mo, () => result, book)).toBe(result)
    await result
  })

  it('toggle pauses then resumes the underlying instance', () => {
    const mo = makeFakeMediaOverlay()
    const player = useMediaOverlay()
    player.start(mo, vi.fn<() => void>(), book)

    player.toggle()
    expect(mo.pause).toHaveBeenCalledOnce()
    expect(player.isPlaying.value).toBe(false)

    player.toggle()
    expect(mo.resume).toHaveBeenCalledOnce()
    expect(player.isPlaying.value).toBe(true)
  })

  it('next/prev delegate to the instance', () => {
    const mo = makeFakeMediaOverlay()
    const player = useMediaOverlay()
    player.start(mo, vi.fn<() => void>(), book)

    player.nextSentence()
    player.prevSentence()

    expect(mo.next).toHaveBeenCalledOnce()
    expect(mo.prev).toHaveBeenCalledOnce()
  })

  it('setRate clamps to the supported range and forwards to the instance', () => {
    const mo = makeFakeMediaOverlay()
    const player = useMediaOverlay()
    player.start(mo, vi.fn<() => void>(), book)

    player.setRate(10)
    expect(player.rate.value).toBe(4)
    expect(mo.setRate).toHaveBeenLastCalledWith(4)

    player.setRate(0.1)
    expect(player.rate.value).toBe(0.5)
    expect(mo.setRate).toHaveBeenLastCalledWith(0.5)
  })

  it('stop tears down state and stops the instance', () => {
    const mo = makeFakeMediaOverlay()
    const player = useMediaOverlay()
    player.start(mo, vi.fn<() => void>(), book)

    player.stop()

    expect(mo.stop).toHaveBeenCalledOnce()
    expect(player.isActive.value).toBe(false)
    expect(player.isPlaying.value).toBe(false)
    expect(player.currentBook.value).toBeNull()
  })

  it('highlight events keep playback marked as playing and track the fragment', () => {
    const mo = makeFakeMediaOverlay()
    const player = useMediaOverlay()
    player.start(mo, vi.fn<() => void>(), book)
    player.pause()
    expect(player.isPlaying.value).toBe(false)

    mo.dispatchEvent(new CustomEvent('highlight', { detail: { text: 'ch.xhtml#s1' } }))
    expect(player.isPlaying.value).toBe(true)
    expect(player.currentFragment.value).toBe('ch.xhtml#s1')
  })

  it('stop clears the tracked fragment', () => {
    const mo = makeFakeMediaOverlay()
    const player = useMediaOverlay()
    player.start(mo, vi.fn<() => void>(), book)
    mo.dispatchEvent(new CustomEvent('highlight', { detail: { text: 'ch.xhtml#s9' } }))
    expect(player.currentFragment.value).toBe('ch.xhtml#s9')

    player.stop()
    expect(player.currentFragment.value).toBeNull()
  })
})
