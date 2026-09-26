import { describe, expect, it } from 'vitest'
import type { EpubMediaOverlayPlaylist } from '@bookorbit/types'
import { mediaOverlayItemFragment, resolveMediaOverlayResume } from './media-overlay-resume'

function makePlaylist(): EpubMediaOverlayPlaylist {
  return {
    bookId: 1,
    fileId: 42,
    durationSeconds: 30,
    sections: [
      { index: 0, href: 'OPS/ch1.xhtml', label: 'One', smilHref: 'OPS/ch1.smil', startSeconds: 0, durationSeconds: 12 },
      { index: 1, href: 'OPS/ch2.xhtml', label: 'Two', smilHref: 'OPS/ch2.smil', startSeconds: 12, durationSeconds: 18 },
    ],
    resources: [],
    items: [
      {
        index: 0,
        sectionIndex: 0,
        smilHref: 'OPS/ch1.smil',
        textHref: 'OPS/ch1.xhtml',
        textFragment: 's1',
        audioHref: 'OPS/audio/ch1.mp3',
        audioMimeType: 'audio/mpeg',
        clipBeginSeconds: 0,
        clipEndSeconds: 4,
        durationSeconds: 4,
        label: 'One',
      },
      {
        index: 1,
        sectionIndex: 0,
        smilHref: 'OPS/ch1.smil',
        textHref: 'OPS/ch1.xhtml',
        textFragment: 's2',
        audioHref: 'OPS/audio/ch1.mp3',
        audioMimeType: 'audio/mpeg',
        clipBeginSeconds: 4,
        clipEndSeconds: 12,
        durationSeconds: 8,
        label: 'One',
      },
      {
        index: 2,
        sectionIndex: 1,
        smilHref: 'OPS/ch2.smil',
        textHref: 'OPS/ch2.xhtml',
        textFragment: 's1',
        audioHref: 'OPS/audio/ch2.mp3',
        audioMimeType: 'audio/mpeg',
        clipBeginSeconds: 0,
        clipEndSeconds: 18,
        durationSeconds: 18,
        label: 'Two',
      },
    ],
  }
}

describe('media-overlay resume', () => {
  it('builds full text fragments from playlist items', () => {
    expect(mediaOverlayItemFragment(makePlaylist().items[0]!)).toBe('OPS/ch1.xhtml#s1')
  })

  it('keeps an exact saved fragment and section without requiring playlist lookup', () => {
    expect(
      resolveMediaOverlayResume(makePlaylist(), {
        fragment: 'OPS/ch9.xhtml#s9',
        sectionIndex: 9,
        positionSeconds: 20,
      }),
    ).toEqual({ section: 9, fragment: 'OPS/ch9.xhtml#s9' })
  })

  it('fills a missing section from the saved fragment', () => {
    expect(
      resolveMediaOverlayResume(makePlaylist(), {
        fragment: 'OPS/ch2.xhtml#s1',
        sectionIndex: null,
        positionSeconds: null,
      }),
    ).toEqual({ section: 1, fragment: 'OPS/ch2.xhtml#s1' })
  })

  it('maps absolute narration seconds to the matching sentence', () => {
    expect(
      resolveMediaOverlayResume(makePlaylist(), {
        fragment: null,
        sectionIndex: null,
        positionSeconds: 6,
      }),
    ).toEqual({ section: 0, fragment: 'OPS/ch1.xhtml#s2' })

    expect(
      resolveMediaOverlayResume(makePlaylist(), {
        fragment: null,
        sectionIndex: null,
        positionSeconds: 15,
      }),
    ).toEqual({ section: 1, fragment: 'OPS/ch2.xhtml#s1' })
  })
})
