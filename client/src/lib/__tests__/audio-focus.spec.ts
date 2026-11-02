import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerAudioFocusOwner, releaseAudioFocusOwner, requestAudioFocus } from '../audio-focus'

afterEach(() => {
  releaseAudioFocusOwner('chapter-preview')
  releaseAudioFocusOwner('tts')
  releaseAudioFocusOwner('media-overlay')
})

describe('audio focus', () => {
  it('pauses every other registered owner when one claims focus', () => {
    const pauseChapterPreview = vi.fn<() => void>()
    const pauseTts = vi.fn<() => void>()
    const pauseMediaOverlay = vi.fn<() => void>()
    registerAudioFocusOwner('chapter-preview', pauseChapterPreview)
    registerAudioFocusOwner('tts', pauseTts)
    registerAudioFocusOwner('media-overlay', pauseMediaOverlay)

    requestAudioFocus('tts')

    expect(pauseChapterPreview).toHaveBeenCalledOnce()
    expect(pauseMediaOverlay).toHaveBeenCalledOnce()
    expect(pauseTts).not.toHaveBeenCalled()
  })

  it('re-registering an owner replaces its pause callback', () => {
    const stale = vi.fn<() => void>()
    const current = vi.fn<() => void>()
    registerAudioFocusOwner('chapter-preview', stale)
    registerAudioFocusOwner('chapter-preview', current)

    requestAudioFocus('tts')

    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
  })

  it('leaves released owners alone', () => {
    const pauseChapterPreview = vi.fn<() => void>()
    registerAudioFocusOwner('chapter-preview', pauseChapterPreview)
    releaseAudioFocusOwner('chapter-preview')

    requestAudioFocus('tts')

    expect(pauseChapterPreview).not.toHaveBeenCalled()
  })
})
