import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerAudioFocusOwner, releaseAudioFocusOwner, requestAudioFocus } from '../audio-focus'

afterEach(() => {
  releaseAudioFocusOwner('podcast')
  releaseAudioFocusOwner('tts')
  releaseAudioFocusOwner('media-overlay')
})

describe('audio focus', () => {
  it('pauses every other registered owner when one claims focus', () => {
    const pausePodcast = vi.fn<() => void>()
    const pauseTts = vi.fn<() => void>()
    const pauseMediaOverlay = vi.fn<() => void>()
    registerAudioFocusOwner('podcast', pausePodcast)
    registerAudioFocusOwner('tts', pauseTts)
    registerAudioFocusOwner('media-overlay', pauseMediaOverlay)

    requestAudioFocus('tts')

    expect(pausePodcast).toHaveBeenCalledOnce()
    expect(pauseMediaOverlay).toHaveBeenCalledOnce()
    expect(pauseTts).not.toHaveBeenCalled()
  })

  it('re-registering an owner replaces its pause callback', () => {
    const stale = vi.fn<() => void>()
    const current = vi.fn<() => void>()
    registerAudioFocusOwner('podcast', stale)
    registerAudioFocusOwner('podcast', current)

    requestAudioFocus('tts')

    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
  })

  it('leaves released owners alone', () => {
    const pausePodcast = vi.fn<() => void>()
    registerAudioFocusOwner('podcast', pausePodcast)
    releaseAudioFocusOwner('podcast')

    requestAudioFocus('tts')

    expect(pausePodcast).not.toHaveBeenCalled()
  })
})
