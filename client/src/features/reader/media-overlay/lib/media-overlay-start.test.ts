import { describe, expect, it, vi } from 'vitest'
import type { FoliateMediaOverlay } from '@/features/reader/epub/composables/useFoliate'
import { startMediaOverlayWithFallback } from './media-overlay-start'

function makeMediaOverlay(start: FoliateMediaOverlay['start']): FoliateMediaOverlay {
  const mediaOverlay = new EventTarget() as FoliateMediaOverlay
  mediaOverlay.start = start
  mediaOverlay.pause = vi.fn<() => void>()
  mediaOverlay.resume = vi.fn<() => void>()
  mediaOverlay.stop = vi.fn<() => void>()
  mediaOverlay.next = vi.fn<() => void>()
  mediaOverlay.prev = vi.fn<() => void>()
  mediaOverlay.setRate = vi.fn<(rate: number) => void>()
  mediaOverlay.setVolume = vi.fn<(volume: number) => void>()
  return mediaOverlay
}

describe('startMediaOverlayWithFallback', () => {
  it('waits for a matching start without launching a time-based fallback', async () => {
    let resolveStart!: (found: boolean) => void
    const firstStart = new Promise<boolean>((resolve) => {
      resolveStart = resolve
    })
    const start = vi.fn<FoliateMediaOverlay['start']>(() => firstStart)
    const mediaOverlay = makeMediaOverlay(start)
    const filter = (item: { text: string }) => item.text.endsWith('#selected')

    const result = startMediaOverlayWithFallback(mediaOverlay, 3, filter, () => true)

    expect(start).toHaveBeenCalledOnce()
    resolveStart(true)
    await result
    expect(start).toHaveBeenCalledOnce()
  })

  it('falls back to the section start only when no matching SMIL entry exists', async () => {
    const start = vi.fn<FoliateMediaOverlay['start']>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const mediaOverlay = makeMediaOverlay(start)
    const filter = (item: { text: string }) => item.text.endsWith('#missing')

    await startMediaOverlayWithFallback(mediaOverlay, 3, filter, () => true)

    expect(start).toHaveBeenNthCalledWith(1, 3, filter)
    expect(start).toHaveBeenNthCalledWith(2, 3)
  })

  it('does not fall back after the request is no longer current', async () => {
    const start = vi.fn<FoliateMediaOverlay['start']>().mockResolvedValue(false)
    const mediaOverlay = makeMediaOverlay(start)
    const filter = (item: { text: string }) => item.text.endsWith('#missing')

    await startMediaOverlayWithFallback(mediaOverlay, 3, filter, () => false)

    expect(start).toHaveBeenCalledOnce()
  })
})
